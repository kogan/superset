# In-app updates and workspace adoption

## Decision

Packaged superset++ installs use Electron's existing updater. Development runs
and unpackaged local runtimes remain excluded. Each release publishes the DMG,
the updater ZIP, and `latest-mac.yml` to the GitHub release; the ZIP and
manifest are the updater's payload.

When a source workspace has an earlier internal copy with the same stable ID,
the record is moved to the original folder. Its ID is retained so terminal and
agent associations survive. The old copied folder is left untouched on disk as
a recovery copy, but it is no longer shown as a second workspace or tagged
"Previous copies".

## Alternatives considered

- Delete old copied folders: rejected because they can contain uncommitted or
  otherwise unique files.
- Hide the old entry: rejected because it retains duplicate project state and
  leaves future migration behaviour unclear.
- Enable updates for every local runtime: rejected because development runs
  must not contact the public release feed.

## Verification

- Workspace test proves the original path replaces the copied record, terminal
  ownership remains stable, the recovery file remains on disk, and a second
  discovery does not add another workspace.
- Packaging checks require the DMG, ZIP, and `latest-mac.yml` artifacts.
