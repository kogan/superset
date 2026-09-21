#!/usr/bin/env python3
"""Export the running personal stack into a new, unactivated snapshot directory."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import urllib.request
from urllib.parse import quote, urlencode, urlsplit
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

EXCLUDED_TABLES = {
    'auth.accounts', 'auth.apikeys', 'auth.device_codes', 'auth.invitations',
    'auth.jwkss', 'auth.oauth_access_tokens', 'auth.oauth_clients',
    'auth.oauth_consents', 'auth.oauth_refresh_tokens', 'auth.sessions',
    'auth.verifications', 'public.agent_credentials', 'public.environment_secrets',
    'public.github_user_connections', 'public.integration_connections',
    'public.plugin_connections', 'public.v2_clients',
}
IDENTIFIER = re.compile(r'^[a-z_][a-z0-9_]*$')


def quoted_table(name):
    schema, table = name.split('.')
    if not IDENTIFIER.fullmatch(schema) or not IDENTIFIER.fullmatch(table):
        raise ValueError('Unsupported database identifier')
    return f'"{schema}"."{table}"'


def digest(path):
    with path.open('rb') as stream:
        result = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
        return result.hexdigest()


def snapshot_sqlite(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as original:
        with closing(sqlite3.connect(target)) as copied:
            original.backup(copied)
    owned_paths = []
    with closing(sqlite3.connect(target)) as copied:
        tables = {row[0] for row in copied.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in ('terminal_agent_bindings', 'terminal_sessions'):
            if table in tables:
                copied.execute(f'DELETE FROM "{table}"')
        for table, column in [('projects', 'repo_path'), ('projects', 'main_repo_path'), ('workspaces', 'worktree_path'), ('worktrees', 'path')]:
            if table not in tables:
                continue
            columns = {row[1] for row in copied.execute(f'PRAGMA table_info("{table}")')}
            if column in columns:
                for row_id, path in copied.execute(f'SELECT id,"{column}" FROM "{table}"'):
                    if path:
                        owned_paths.append({'table': table, 'rowId': row_id, 'column': column, 'path': path, 'ownership': 'external'})
        for table in ('settings', 'host_settings', 'projects'):
            if table not in tables:
                continue
            columns = {row[1] for row in copied.execute(f'PRAGMA table_info("{table}")')}
            for column in ('worktree_base_dir', 'default_claude_config_dir', 'default_codex_home'):
                if column in columns:
                    copied.execute(f'UPDATE "{table}" SET "{column}"=NULL')
            if 'expose_host_service_via_relay' in columns:
                copied.execute(f'UPDATE "{table}" SET expose_host_service_via_relay=0')
        copied.commit()
        copied.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        copied.execute('PRAGMA journal_mode=DELETE')
        integrity = copied.execute('PRAGMA integrity_check').fetchall()
        if integrity != [('ok',)]:
            raise RuntimeError('SQLite backup integrity check failed')
    return owned_paths


def export_objects(endpoint, buckets, output):
    url = urlsplit(endpoint)
    if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.username or url.password or url.query or url.fragment:
        raise ValueError('Object export requires a loopback HTTP endpoint')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, newurl):
            raise ValueError('Object export does not follow redirects')
    opener = urllib.request.build_opener(NoRedirect)
    files, object_count, total_bytes = [], 0, 0
    for alias, bucket in buckets.items():
        token = None
        while True:
            params = {'list-type': '2'}
            if token:
                params['continuation-token'] = token
            bucket_url = endpoint.rstrip('/') + '/' + quote(bucket, safe='')
            with opener.open(bucket_url + '?' + urlencode(params), timeout=15) as response:
                listing = ET.fromstring(response.read())
            for item in listing.findall('{*}Contents'):
                key = item.findtext('{*}Key')
                if not key or '\\' in key or any(part in ('', '.', '..') for part in key.split('/')):
                    raise ValueError('Object key escapes destination')
                size = int(item.findtext('{*}Size'))
                etag = item.findtext('{*}ETag')
                request = urllib.request.Request(bucket_url + '/' + quote(key, safe='/'), headers={'If-Match': etag} if etag else {})
                with opener.open(request, timeout=30) as response:
                    body = response.read()
                    if len(body) != size or (etag and response.headers.get('ETag') != etag):
                        raise RuntimeError('Object changed during read-only export')
                    metadata = {'contentType': response.headers.get('Content-Type', 'application/octet-stream'), 'sizeBytes': size, 'updatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}
                    if response.headers.get('Cache-Control'):
                        metadata['cacheControl'] = response.headers['Cache-Control']
                body_path = output / 'objects' / alias / 'data' / key
                meta_path = output / 'objects' / alias / 'meta' / (key + '.json')
                for path in (body_path, meta_path):
                    path.parent.mkdir(parents=True, exist_ok=True)
                body_path.write_bytes(body)
                meta_path.write_text(json.dumps(metadata, indent=2) + '\n')
                for path, kind in [(body_path, 'object'), (meta_path, 'object-metadata')]:
                    files.append({'path': str(path.relative_to(output)), 'sha256': digest(path), 'bytes': path.stat().st_size, 'kind': kind})
                object_count += 1
                total_bytes += size
            if listing.findtext('{*}IsTruncated') != 'true':
                break
            token = listing.findtext('{*}NextContinuationToken')
            if not token:
                raise RuntimeError('Truncated object listing lacks continuation token')
    return files, {'status': 'complete', 'count': object_count, 'bytes': total_bytes}


def export_snapshot(source_home, output, container, database, user, object_endpoint=None, buckets=None):
    source_home = source_home.resolve(strict=True)
    output = output.resolve()
    if output == source_home or source_home in output.parents:
        raise ValueError('Snapshot must be outside the source home')
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    command = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', container,
               'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database]
    psql = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    def query(sql):
        psql.stdin.write(sql + '\n')
        psql.stdin.flush()
        line = psql.stdout.readline().strip()
        if not line:
            raise RuntimeError('Read-only snapshot query failed')
        return line
    try:
        psql.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n')
        snapshot_id = query('SELECT pg_export_snapshot();')
        if not re.fullmatch(r'[A-Fa-f0-9-]+', snapshot_id):
            raise RuntimeError('Invalid PostgreSQL snapshot identifier')
        tables = json.loads(query("SELECT coalesce(json_agg(n.nspname||'.'||c.relname ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','public','ingest') AND c.relkind IN ('r','p') AND NOT EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid);"))
        dependencies = json.loads(query("SELECT coalesce(json_agg(json_build_array(n.nspname||'.'||c.relname,pn.nspname||'.'||p.relname)),'[]') FROM pg_constraint fk JOIN pg_class c ON c.oid=fk.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=fk.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace WHERE fk.contype='f' AND n.nspname IN ('auth','public','ingest');"))
        excluded = set(EXCLUDED_TABLES)
        while True:
            children = {child for child, parent in dependencies if parent in excluded}
            if children <= excluded:
                break
            excluded |= children
        included = [table for table in tables if table not in excluded]
        rows_sql = ' UNION ALL '.join(f"SELECT '{table}' AS name, (SELECT count(*) FROM {quoted_table(table)}) AS total" for table in included)
        counts = json.loads(query(f'SELECT json_object_agg(name,total) FROM ({rows_sql}) t;'))
        excluded_sql = ' UNION ALL '.join(f"SELECT '{table}' AS name, (SELECT count(*) FROM {quoted_table(table)}) AS total" for table in tables if table in excluded)
        excluded_counts = json.loads(query(f'SELECT json_object_agg(name,total) FROM ({excluded_sql}) t;'))
        migrations = json.loads(query("SELECT json_agg(json_build_object('hash',hash,'created_at',created_at) ORDER BY id) FROM drizzle.__drizzle_migrations;"))
        dump = ['docker', 'exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', container,
                'pg_dump', '-U', user, '-d', database, '--data-only', '--column-inserts', '--rows-per-insert=100',
                '--no-owner', '--no-privileges', '--no-comments', '--no-security-labels',
                '--load-via-partition-root', '--schema=auth', '--schema=public', '--schema=ingest', f'--snapshot={snapshot_id}']
        dump += [f'--exclude-table-data={table}' for table in sorted(excluded)]
        with (output / 'metadata.sql').open('wb') as stream:
            result = subprocess.run(dump, stdout=stream, stderr=subprocess.PIPE, timeout=180)
        if result.returncode:
            raise RuntimeError('Read-only PostgreSQL export failed; no import was attempted')
    finally:
        if psql.poll() is None:
            psql.stdin.write('ROLLBACK;\n\\q\n')
            psql.stdin.flush()
        try:
            psql.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            psql.kill()
            psql.communicate()
    files = []
    externally_owned = []
    candidates = {source_home / 'local.db', source_home / 'jira-workspaces.db'}
    candidates.update(source_home.glob('host/*/host.db'))
    candidates.update(source_home.rglob('chat.db'))
    for source in sorted(candidates):
        if not source.is_file() or source.is_symlink():
            continue
        relative = source.relative_to(source_home)
        target = output / 'home' / relative
        paths = snapshot_sqlite(source, target)
        externally_owned.extend({'database': str(relative), **path} for path in paths)
        files.append({'path': str(target.relative_to(output)), 'sha256': digest(target), 'bytes': target.stat().st_size, 'kind': 'sqlite'})
    for name in ('window-state.json', 'jira-preferences.json', 'app-state.json'):
        source = source_home / name
        if not source.is_file() or source.is_symlink():
            continue
        value = json.loads(source.read_text())
        if name == 'app-state.json':
            value = {key: value[key] for key in ('themeState', 'hotkeysState') if key in value}
        target = output / 'home' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, indent=2) + '\n')
        files.append({'path': str(target.relative_to(output)), 'sha256': digest(target), 'bytes': target.stat().st_size, 'kind': 'json'})
    sql_path = output / 'metadata.sql'
    files.append({'path': 'metadata.sql', 'sha256': digest(sql_path), 'bytes': sql_path.stat().st_size, 'kind': 'postgres'})
    objects = {'status': 'pending-export'}
    if object_endpoint:
        object_files, objects = export_objects(object_endpoint, buckets, output)
        files.extend(object_files)
    manifest = {'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'sourceHome': str(source_home),
                'postgresContainer': container, 'migrations': migrations, 'counts': counts, 'excludedTables': sorted(excluded),
                'files': files, 'excludedCounts': excluded_counts, 'externallyOwnedPaths': externally_owned, 'activationAllowed': False,
                'consistency': 'PostgreSQL is one read-only snapshot; each SQLite database is an independent online backup.',
                'objects': objects}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-home', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--postgres-container', required=True)
    parser.add_argument('--database', default='main')
    parser.add_argument('--database-user', default='postgres')
    parser.add_argument('--objects-endpoint')
    parser.add_argument('--private-bucket')
    parser.add_argument('--public-bucket')
    args = parser.parse_args()
    if args.objects_endpoint and not (args.private_bucket and args.public_bucket):
        parser.error("Both bucket names are required for object export")
    result = export_snapshot(args.source_home, args.output, args.postgres_container, args.database, args.database_user, args.objects_endpoint, {"private": args.private_bucket, "public": args.public_bucket})
    print(json.dumps({'snapshot': str(args.output.resolve()), 'tables': len(result['counts']), 'files': len(result['files']), 'externalPaths': len(result['externallyOwnedPaths']), 'activationAllowed': False}))


if __name__ == '__main__':
    main()
