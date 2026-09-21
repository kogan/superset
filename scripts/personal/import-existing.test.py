import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('import_existing', Path(__file__).with_name('import-existing.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTest(unittest.TestCase):
    def test_online_backup_keeps_committed_wal_and_clears_only_copied_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source.db'
            target = root / 'snapshot.db'
            with sqlite3.connect(source) as original:
                original.execute('pragma journal_mode=wal')
                original.executescript('''
                    create table projects(id text primary key, repo_path text, worktree_base_dir text);
                    create table workspaces(id text primary key, worktree_path text);
                    create table terminal_sessions(id text primary key);
                    create table terminal_agent_bindings(id text primary key);
                    create table host_settings(id integer, worktree_base_dir text, default_codex_home text);
                    insert into projects values ('project','/original/repo','/original/worktrees');
                    insert into workspaces values ('workspace','/original/worktrees/branch');
                    insert into terminal_sessions values ('original-terminal');
                    insert into terminal_agent_bindings values ('original-binding');
                    insert into host_settings values (1,'/original/worktrees','/original/credentials');
                ''')
                original.commit()
                paths = module.snapshot_sqlite(source, target)
                self.assertEqual(len(paths), 2)
                self.assertTrue(all(row['ownership'] == 'external' for row in paths))
                self.assertEqual(original.execute('select count(*) from terminal_sessions').fetchone()[0], 1)
                self.assertEqual(original.execute('select worktree_base_dir from projects').fetchone()[0], '/original/worktrees')
                with sqlite3.connect(target.as_uri() + '?mode=ro', uri=True) as copied:
                    self.assertEqual(copied.execute('select repo_path from projects').fetchone()[0], '/original/repo')
                    self.assertEqual(copied.execute('select count(*) from terminal_sessions').fetchone()[0], 0)
                    self.assertEqual(copied.execute('select count(*) from terminal_agent_bindings').fetchone()[0], 0)
                    self.assertIsNone(copied.execute('select worktree_base_dir from projects').fetchone()[0])
                    self.assertIsNone(copied.execute('select default_codex_home from host_settings').fetchone()[0])

    def test_rejects_identifier_injection(self):
        with self.assertRaises(ValueError):
            module.quoted_table('auth.users; DROP TABLE auth.users')


if __name__ == '__main__':
    unittest.main()
