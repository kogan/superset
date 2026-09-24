# Worktree close actions

In project settings, open **Project lifecycle scripts → On worktree close** and enter the commands to run, one per line. Changes save automatically to the project's `.superset/config.json`:

```json
{
  "close": ["./scripts/stop-worktree-services.sh"]
}
```

These commands run when you close the worktree from the sidebar, including imported worktrees whose files are preserved. Closing an editor tab, stopping an agent, or quitting the app does not run them. Local workspaces sharing the project's main checkout do not run worktree close actions.

The commands run through your configured terminal shell in the worktree, with the same environment as its terminals. A configured `cwd` can override the directory. Commands run sequentially and stop at the first failure. For worktrees managed by this app, close actions run before the existing teardown and file removal. Imported worktrees run close actions without running teardown or removing files.

You can also use `.superset/close.sh`. The same precedence as other lifecycle scripts applies: configured commands first, then a script in the worktree, then the main repository. Worktree configuration and local overrides are supported.

A failed close action in the desktop restores the workspace and displays the command output. You can retry or explicitly skip cleanup. The existing 60-second timeout applies. Noninteractive cleanup keeps its existing best-effort behavior and reports failures as warnings. Actions may run again after a retry or interrupted cleanup, so write commands that are safe to repeat.
