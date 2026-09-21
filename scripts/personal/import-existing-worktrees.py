#!/usr/bin/env python3
"""Copy Git repositories and working files into an unactivated imported staging area."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess

SKIP_DIRS = {'.git', 'node_modules', '.next', '.turbo', '.cache', '.import-review', 'dist', 'build', 'coverage', '__pycache__', '.venv'}
GIT_ENV = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0', 'GIT_TERMINAL_PROMPT': '0'}


def git(path, *args, allow_failure=False):
    result = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(path), *args], env=GIT_ENV, capture_output=True)
    if result.returncode and not allow_failure:
        raise RuntimeError(f'Git {args[0]} failed for {path.name}; source has not been modified')
    return result.stdout


def common_dir(path):
    value = os.fsdecode(git(path, 'rev-parse', '--git-common-dir')).strip()
    return (path / value).resolve()


def source_files(path):
    tracked = {os.fsdecode(value) for value in git(path, 'ls-files', '-z', '--cached').split(b'\0') if value}
    untracked = {os.fsdecode(value) for value in git(path, 'ls-files', '-z', '--others', '--exclude-standard').split(b'\0') if value}
    ignored = {os.fsdecode(value) for value in git(path, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory').split(b'\0') if value}
    important_ignored = {value for value in ignored if Path(value).name.startswith('.env') and not value.endswith('/')}
    skipped = sorted(value for value in untracked | ignored if any(part in SKIP_DIRS for part in Path(value).parts) or (value in ignored and value not in important_ignored))
    included = tracked | {value for value in untracked | important_ignored if not any(part in SKIP_DIRS for part in Path(value).parts)}
    for value in included:
        if Path(value).is_absolute() or '..' in Path(value).parts or '.git' in Path(value).parts:
            raise ValueError('Working-tree file path escapes source')
    return sorted(included), skipped


def file_hash(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def mapped_symlink(source, destination, mapping):
    target = source.resolve(strict=False)
    for old, new in sorted(mapping.items(), key=lambda item: len(str(item[0])), reverse=True):
        if target == old or old in target.parents:
            mapped = new / target.relative_to(old)
            return os.path.relpath(mapped, destination.parent)
    raise ValueError(f'External symlink needs an explicit import policy: {source.name}')


def copy_working_files(source, destination, mapping, evidence):
    before_head = git(source, 'rev-parse', 'HEAD').strip()
    paths, skipped = source_files(source)
    records = []
    for relative in paths:
        src, dst = source / relative, destination / relative
        if not src.exists() and not src.is_symlink():
            records.append({'path': relative, 'kind': 'deleted'})
            continue
        if src.is_dir() and not src.is_symlink():
            raise ValueError(f'Nested Git repository or submodule requires explicit import: {relative}')
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.is_symlink():
            link = mapped_symlink(src, dst, mapping)
            dst.symlink_to(link)
            records.append({'path': relative, 'kind': 'symlink', 'sourceLink': os.readlink(src), 'targetLink': link})
        elif src.is_file():
            shutil.copy2(src, dst)
            records.append({'path': relative, 'kind': 'file', 'sha256': file_hash(dst), 'bytes': dst.stat().st_size})
        else:
            raise ValueError(f'Unsupported working-tree file type: {relative}')
    if git(source, 'rev-parse', 'HEAD').strip() != before_head or source_files(source)[0] != paths:
        raise RuntimeError('Source checkout changed during snapshot; discard this staged copy and retry')
    for record in records:
        src, dst = source / record['path'], destination / record['path']
        if record['kind'] == 'file' and (file_hash(src) != record['sha256'] or file_hash(dst) != record['sha256']):
            raise RuntimeError('Source file changed during snapshot or copy verification failed')
        if record['kind'] == 'symlink' and (os.readlink(src) != record['sourceLink'] or os.readlink(dst) != record['targetLink']):
            raise RuntimeError('Symlink changed during snapshot')
        if record['kind'] == 'deleted' and (src.exists() or dst.exists()):
            raise RuntimeError('Deleted file changed during snapshot')
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(''.join(json.dumps(row) + '\n' for row in records))
    return {'files': len(records), 'bytes': sum(row.get('bytes', 0) for row in records), 'skipped': skipped, 'evidence': str(evidence), 'head': before_head.decode()}


def copy_workspaces(stage, omitted_ids, apply=False):
    stage = stage.resolve(strict=True)
    if '.superestset' in stage.parts:
        raise ValueError('This command only operates on staging directories')
    receipt_path = stage / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    if receipt.get('activationAllowed') is not False:
        raise ValueError('Stage must not be active')
    if receipt.get('worktrees'):
        raise ValueError('Workspace copy already completed; it must not be repeated over live copies')
    data = stage / 'data'
    projects, workspaces, omissions = [], [], []
    mapping = {}
    for database in sorted((data / 'host').glob('*/host.db')):
        with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            db_projects = [dict(row) for row in connection.execute('SELECT * FROM projects')]
            db_workspaces = [dict(row) for row in connection.execute('SELECT * FROM workspaces')]
        for project in db_projects:
            source = Path(project['repo_path']).resolve(strict=True)
            target = data / 'projects' / project['id']
            entry = {'database': str(database.relative_to(data)), 'record': project, 'source': source, 'target': target, 'common': common_dir(source)}
            projects.append(entry)
            mapping[source] = target
        for workspace in db_workspaces:
            source = Path(workspace['worktree_path'])
            if workspace['id'] in omitted_ids or not source.is_dir():
                omissions.append({'database': str(database.relative_to(data)), 'record': workspace, 'reason': 'active migration task' if workspace['id'] in omitted_ids else 'source directory missing'})
                continue
            project = next(row for row in projects if row['database'] == str(database.relative_to(data)) and row['record']['id'] == workspace['project_id'])
            if common_dir(source) != project['common']:
                raise ValueError(f"Workspace {workspace['id']} belongs to a different Git repository; group it explicitly before import")
            target = project['target'] if source.resolve() == project['source'] else data / 'worktrees' / project['record']['id'] / workspace['id']
            mapping[source.resolve()] = target
            workspaces.append({'database': str(database.relative_to(data)), 'record': workspace, 'source': source.resolve(), 'target': target, 'project': project})
    summary = {'projects': len(projects), 'workspaces': len(workspaces), 'omitted': omissions, 'activationAllowed': False}
    if not apply:
        return summary
    proof = []
    branches = {}
    for project in projects:
        target, source = project['target'], project['source']
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise ValueError('A target repository already exists; refusing to overwrite')
        git(target.parent, 'clone', '--no-hardlinks', '--no-checkout', '--quiet', str(source), str(target))
        if (target / '.git/objects/info/alternates').exists():
            raise ValueError('Cloned repository unexpectedly depends on alternate object storage')
        remote = os.fsdecode(git(source, 'config', '--get', 'remote.origin.url', allow_failure=True)).strip()
        if remote and not remote.startswith(('/', 'file:')):
            git(target, 'remote', 'set-url', 'origin', remote)
        else:
            git(target, 'remote', 'remove', 'origin')
        branch = os.fsdecode(git(source, 'symbolic-ref', '--quiet', '--short', 'HEAD', allow_failure=True)).strip() or f"superestset/import/{project['record']['id']}"
        head = os.fsdecode(git(source, 'rev-parse', 'HEAD')).strip()
        git(target, 'update-ref', f'refs/heads/{branch}', head)
        git(target, 'symbolic-ref', 'HEAD', f'refs/heads/{branch}')
        git(target, 'reset', '--mixed', '--quiet', 'HEAD')
        branches[str(target)] = {branch}
        copied = copy_working_files(source, target, mapping, stage / 'worktree-evidence' / (project['record']['id'] + '.jsonl'))
        proof.append({'kind': 'project', 'id': project['record']['id'], 'source': str(source), 'target': str(target), 'branch': branch, **copied})
    for workspace in workspaces:
        source, target, project = workspace['source'], workspace['target'], workspace['project']
        if target == project['target']:
            match = next(row for row in proof if row['kind'] == 'project' and row['id'] == project['record']['id'])
            workspace['branch'], workspace['head'] = match['branch'], match['head']
            continue
        original_branch = os.fsdecode(git(source, 'symbolic-ref', '--quiet', '--short', 'HEAD', allow_failure=True)).strip()
        branch = original_branch if original_branch and original_branch not in branches[str(project['target'])] else f"superestset/import/{workspace['record']['id']}"
        head = os.fsdecode(git(source, 'rev-parse', 'HEAD')).strip()
        target.parent.mkdir(parents=True, exist_ok=True)
        git(project['target'], 'worktree', 'add', '--no-checkout', '--relative-paths', '-b', branch, str(target), head)
        git(target, 'reset', '--mixed', '--quiet', 'HEAD')
        copied = copy_working_files(source, target, mapping, stage / 'worktree-evidence' / (workspace['record']['id'] + '.jsonl'))
        branches[str(project['target'])].add(branch)
        workspace['branch'], workspace['head'] = branch, head
        proof.append({'kind': 'workspace', 'id': workspace['record']['id'], 'source': str(source), 'target': str(target), 'branch': branch, **copied})
    for database in sorted((data / 'host').glob('*/host.db')):
        relative_db = str(database.relative_to(data))
        with closing(sqlite3.connect(database)) as connection:
            connection.execute('PRAGMA foreign_keys=ON')
            for entry in omissions:
                if entry['database'] == relative_db:
                    connection.execute('DELETE FROM workspaces WHERE id=?', [entry['record']['id']])
            for project in projects:
                if project['database'] == relative_db:
                    connection.execute('UPDATE projects SET repo_path=?,worktree_base_dir=? WHERE id=?', [str(project['target']), str(data / 'worktrees'), project['record']['id']])
            for workspace in workspaces:
                if workspace['database'] == relative_db:
                    connection.execute('UPDATE workspaces SET worktree_path=?,branch=?,head_sha=? WHERE id=?', [str(workspace['target']), workspace['branch'], workspace['head'], workspace['record']['id']])
            connection.commit()
            if connection.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeError('Copied host database has invalid foreign keys')
    jira = data / 'jira-workspaces.db'
    if jira.exists():
        with closing(sqlite3.connect(jira)) as connection:
            for entry in omissions:
                connection.execute('DELETE FROM workspace_links WHERE workspace_id=?', [entry['record']['id']])
            connection.commit()
    receipt['worktrees'] = {'copies': proof, 'omitted': omissions, 'pathsAreRelativeInGitMetadata': True, 'databasePathsRequireRelocationOnActivation': True, 'stagingState': 'verified'}
    receipt['dataDirectory'] = str(data)
    receipt['externallyOwnedPaths'] = []
    receipt['requiredBeforeActivation'] = ['Relocate copied database absolute paths to the final data root', 'Select imported user identity and bootstrap new credentials']
    temporary = receipt_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(receipt, indent=2) + '\n')
    temporary.replace(receipt_path)
    return {'projects': len(projects), 'workspaces': len(workspaces), 'omittedCount': len(omissions), 'filesVerified': sum(row['files'] for row in proof), 'bytesVerified': sum(row['bytes'] for row in proof), 'activationAllowed': False}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--omit-workspace', action='append', default=[])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(json.dumps(copy_workspaces(args.stage, set(args.omit_workspace), args.apply)))


if __name__ == '__main__':
    main()
