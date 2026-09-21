import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('worktrees', Path(__file__).with_name('import-existing-worktrees.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorktreeCopyTest(unittest.TestCase):
    def test_independent_copy_and_omission(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / 'source'
            source.mkdir()
            def git(*args):
                return subprocess.check_output(['git', '-C', str(source), *args], stderr=subprocess.DEVNULL)
            git('init', '-b', 'main')
            git('config', 'user.email', 'fixture@example.test')
            git('config', 'user.name', 'Fixture')
            (source / 'tracked').write_text('original')
            (source / 'deleted').write_text('delete later')
            (source / '.gitignore').write_text('node_modules/\n.env\n')
            git('add', '.')
            git('commit', '-m', 'fixture')
            linked = root / 'linked'
            git('worktree', 'add', '-b', 'feature', str(linked))
            (source / 'tracked').write_text('dirty main')
            (source / 'deleted').unlink()
            (source / '.env').write_text('LOCAL_FIXTURE=1')
            (linked / 'tracked').write_text('dirty linked')
            (linked / 'untracked').write_text('keep me')
            (linked / 'link').symlink_to('tracked')
            (linked / 'node_modules').mkdir()
            (linked / 'node_modules' / 'ignored').write_text('skip')
            before = git('status', '--porcelain')
            stage = root / 'stage'
            host = stage / 'data/host/h'
            host.mkdir(parents=True)
            (stage / 'receipt.json').write_text(json.dumps({'activationAllowed': False, 'externallyOwnedPaths': []}))
            with sqlite3.connect(host / 'host.db') as db:
                db.executescript('CREATE TABLE projects(id TEXT PRIMARY KEY,repo_path TEXT,worktree_base_dir TEXT); CREATE TABLE workspaces(id TEXT PRIMARY KEY,project_id TEXT,worktree_path TEXT,branch TEXT,head_sha TEXT); CREATE TABLE tags(workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE);')
                db.execute('INSERT INTO projects VALUES(?,?,NULL)', ['p', str(source)])
                for name, path in [('main', source), ('linked', linked), ('missing', root / 'missing'), ('omit', source)]:
                    db.execute('INSERT INTO workspaces VALUES(?,?,?,NULL,NULL)', [name, 'p', str(path)])
                db.execute('INSERT INTO tags VALUES(?)', ['omit'])
            result = module.copy_workspaces(stage, {'omit'}, True)
            self.assertEqual(result['workspaces'], 2)
            self.assertEqual(result['omittedCount'], 2)
            target = stage / 'data/projects/p'
            target_linked = stage / 'data/worktrees/p/linked'
            self.assertEqual((target / 'tracked').read_text(), 'dirty main')
            self.assertFalse((target / 'deleted').exists())
            self.assertEqual((target / '.env').read_text(), 'LOCAL_FIXTURE=1')
            self.assertEqual((target_linked / 'untracked').read_text(), 'keep me')
            self.assertEqual((target_linked / 'link').read_text(), 'dirty linked')
            self.assertFalse((target_linked / 'node_modules').exists())
            self.assertEqual(git('status', '--porcelain'), before)
            with sqlite3.connect(host / 'host.db') as db:
                self.assertEqual(db.execute('SELECT count(*) FROM tags').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT count(*) FROM workspaces').fetchone()[0], 2)
            moved = root / 'moved'
            (stage / 'data').rename(moved)
            linked_moved = moved / 'worktrees/p/linked'
            common = module.common_dir(linked_moved)
            self.assertEqual(common, moved / 'projects/p/.git')
            self.assertNotEqual(common, source / '.git')
            self.assertEqual(subprocess.check_output(['git', '-C', str(linked_moved), 'show', 'HEAD:tracked']), b'original')


if __name__ == '__main__':
    unittest.main()
