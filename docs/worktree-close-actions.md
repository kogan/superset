# Worktree deletion actions

In project settings, open **Project lifecycle scripts → On worktree deletion**. Choose **Command** or **Skill**, then use **Run action before deleting a worktree** to turn it on or off. Disabling the action keeps its configuration. Changes save automatically to the project's `.superset/config.json`.

Actions run before deleting an app-managed worktree, while its files still exist. Removing an imported worktree from the sidebar while keeping its files does not run them. Closing an editor tab, stopping an agent, quitting the app, or closing a workspace that shares the project's main checkout does not run them either.

## Run a skill

Choose **Skill**, select **Claude** or **Codex**, and select an installed skill. For example, select Claude and `work-note` to record the work before deletion. Optional instructions let you customize the skill's task for this project. The picker discovers project and user skills on the project's host; the selected agent must be configured under **Agent commands**.

```json
{
  "closeEnabled": true,
  "closeAction": {
    "type": "skill",
    "agent": "claude",
    "name": "work-note",
    "instructions": "Record the completed work and any remaining follow-ups."
  }
}
```

The skill runs in a separate, noninteractive agent session in the worktree. When Superset has a matching session ID for that workspace and agent, it forks that conversation so the skill can use its history. Otherwise it starts a fresh session and asks the agent to inspect the branch commits and working-tree changes. It does not send instructions to, or stop, the original agent session. The configured agent command, arguments, account, and environment are reused.

Skills have up to 10 minutes to finish. The agent must exit successfully and confirm completion through a temporary completion file requested in its prompt. A missing skill, agent failure, timeout, or missing completion confirmation blocks desktop deletion. This includes runs that stop to request input or permission without completing the skill. Resolve the issue and retry, or explicitly skip cleanup. A skill that requires interactive approval cannot receive it in this background run.

## Run shell commands

Choose **Command** and enter commands, one per line:

```json
{
  "closeEnabled": true,
  "closeAction": { "type": "command" },
  "close": ["./scripts/stop-worktree-services.sh"]
}
```

Commands run through your configured terminal shell in the worktree, with the same environment as its terminals. A configured `cwd` can override the directory. Commands run sequentially and stop at the first failure, before the existing teardown and file removal. They have a 60-second timeout.

You can also use `.superset/close.sh`. Configured commands take precedence over fallback scripts, which are searched in the worktree, then the main repository. Worktree configuration and local overrides can supply commands. The project's `closeEnabled` switch and `closeAction` selection control deletion actions and cannot be overridden by a worktree. Omitting those settings keeps existing commands enabled. Skill mode ignores the saved commands; switching back to Command makes them available again. Disabling the action does not disable separate teardown scripts.

## Failure and retries

A failed action in the desktop restores the workspace and displays its output. You can retry or explicitly skip cleanup. Noninteractive cleanup keeps its existing best-effort behavior and reports failures as warnings. Actions may run again after a retry or interrupted cleanup, so use commands and skills that are safe to repeat.
