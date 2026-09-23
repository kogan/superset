# Embedded worktree IDE

## Progress

- [x] Ground existing editor, workspace roots, panes and forwarding.
- [x] Sketch and compare host-owned and desktop-owned runtimes.
- [x] Select host ownership and incorporate independent review.
- [x] Implement runtime, desktop bridge and IDE pane.
- [x] Verify real editing, extension installation, debugging and worktree switching.
- [x] Replace Files navigation with worktree IDE and verify feature toggle.
- [x] Verify unsaved-buffer close protection in actual code-server.
- [x] Verify live Dark / Light selection in the final managed runtime.
- [x] Revise any architecture that fails those checks.
- [x] Show all branch changes alongside the IDE and route Jira PR links into the app.
- [x] Show branch changes, Explorer badges, and native diffs inside VS Code itself.

## Usage and contract

Open IDE from the workspace top bar or the new-tab menu. Superset installs its pinned code-server runtime on first use, opens the actual worktree, and preserves the IDE while switching tabs or worktrees. Extensions and debug adapters run on the machine holding the checkout. All internal file-opening actions target that worktree's IDE. Clean legacy Files panes migrate into one IDE; dirty or conflicted buffers retain recovery views until saved or closed.

New profiles use Dark Modern. The visible Dark / Light selector beside Stop IDE saves the choice per worktree without restarting the editor. The IDE's Color Theme command also supports custom themes. Settings > General > Features > Embedded IDE hides entry points and prevents inactive panes starting when disabled. Open sessions remain available to save and stop.

Opening IDE also opens the workspace Changes sidebar with all changes against its configured base, including committed files. The IDE toolbar's Changes button restores this scope and follows the IDE's originating workspace if the pane was moved. Native VS Code Source Control remains subject to workspace trust and normally lists uncommitted changes. Jira PR links use the shared GitHub URL-to-project resolver to open the app's PR detail view, with the existing browser fallback for repositories that have not been added.

`workspaceTrpc.ide.start({workspaceId})` resolves the authoritative root and returns `{sessionId, port, password, folderPath}` over authenticated transport. These credentials are transient and never enter pane persistence. `ide.stop({workspaceId})` explicitly stops that worktree's runtime. Host shutdown and workspace deletion stop it too; closing one view does not interrupt other clients.

`electronTrpc.ide.prepare({paneId, workspaceId, target, connection})` acquires a dedicated remote forward when needed, authenticates through code-server's login endpoint into an isolated Electron session, and returns `{url, partition, sessionId}`. `target` is `{kind:'local'}` or `{kind:'remote', hostUrl:string}`. The desktop uses its existing authenticated TCP transport for remote hosts. `ide.release({paneId})` drops only this window's view and forwarding ownership. `ide.register({paneId, webContentsId})` constrains guest navigation and keeps IDE shortcuts out of the desktop menu.

An `ide` pane persists only `{kind:'ide', workspaceId}`. The originating workspace stays explicit when a pane is moved to another workspace. A dedicated guest registry preserves the webview across route unmounts without browser history or browser automation registration. Explicit view close releases the guest; it does not stop the host debugger. Profiles disable hot exit so unsaved files veto closure, because a fresh authenticated browser session cannot reliably restore VS Code's backup metadata.

## Synthesis

The host-owned candidate is the base because workspace roots and process execution already belong to host-service. Independent review scored it 22/25 versus 17/25 for desktop ownership. Desktop ownership cannot execute native extensions against remote files without moving that responsibility back to the host.

Grafted desktop candidate details: separate nonpersistent Electron partitions, authenticating through the real login endpoint, dedicated guests that preserve IDE shortcuts, parent-death supervision and real breakpoint verification. Rejected automatic host shutdown on pane close because another window may still use the same worktree. Rejected a second HTTP/WebSocket reverse proxy because existing TCP forwarding already carries both protocols.

## Implementation boundaries

- Host: immutable versioned runtime download with checked-in SHA-256; per-workspace writable user/extension directories; coalesced startup; random password and loopback binding; bounded startup; owned-process shutdown; exact IDE port added to forwarding authorization.
- Desktop: schema-validated IPC, sender-window ownership, local/remote endpoint resolution, isolated cookies, no credential persistence, guest navigation and shortcut policy.
- Renderer: one IDE pane per worktree, loading/retry states, persistent guest geometry, an IDE entry point, and transient file/line requests delivered to the existing workbench without reload.

Accept the runtime download and separate extension directories in exchange for a complete extension host without native compilation or system installation. Open VSX/VSIX compatibility is verified per extension. Platform support follows the pinned release, with testing reported explicitly.

## Verification

A repeatable integration check must launch actual code-server instances in temporary worktrees, check authenticated/anonymous access, isolation, extension installation and shutdown. Desktop verification must exercise real editing, a breakpoint, worktree switching, keyboard shortcuts and pane closure. Unit/type checks supplement those observations.

### Repeatable checks

- `cd packages/host-service && bun run test:ide [code-server executable]`: real git worktrees, authenticated access, independent cookies and extensions, VSIX installation, settings restoration, and stopped-port cleanup. Omit the executable to exercise first-use download and checksum verification.
- `cd packages/host-service && bun run test:ide:open-file /path/to/code-server/bin/code-server`: connected editor session, encoded file paths, line/column, and reuse-window protocol.
- `cd packages/host-service && bun run test:ide:electron /path/to/code-server/bin/code-server`: packaged Electron supervisor startup and parent-death process cleanup.
- `cd apps/desktop && bun scripts/verify-embedded-ide.ts /path/to/code-server/bin/code-server`: real Electron session authentication, guest ownership, anonymous isolation, focus forwarding, beforeunload, and cancellation cleanup. This check covers local connections; remote forwarding requires a connected remote host.
- Focused unit tests cover the IPC schema, authentication failure paths, process supervision, workspace authorization and cleanup, and restoring earlier clean IDE views when another view vetoes a group close.

Verified on macOS ARM64 with code-server 4.138.0: host runtime smoke, Electron bridge smoke, desktop and host typechecks, host build, and all locale catalog checks. Python 2026.4.0, Python Debugger 2026.6.0, and BasedPyright 1.40.1 install successfully from Open VSX. Linux, x64 and remote-host UI verification remain outstanding.

Packaged native UI checks used a disposable worktree at `/tmp/superset-ide-test-project`: edit/save to disk; JavaScript and Python breakpoints at line 3; TypeScript semantic completions for Person.age and Person.name; dark theme; paused Python debug session surviving a worktree roundtrip; Files-to-IDE layout migration; disabling and enabling the IDE feature; and Changes file links reusing the existing IDE while preserving an unsaved untitled buffer. Reloading the workbench was needed for the TypeScript extension to activate after extension installation/trust changes.

The close check caught two real failures. Hot exit bypassed the dirty-file veto even though the next browser session could not restore backup metadata. Electron also destroyed a webview after its native beforeunload veto. Profiles now disable hot exit, and the desktop dispatches the cancelable lifecycle event before native close. A real VS Code test extension verifies that a dirty document blocks close, remains writable after cancellation, and closes after explicit revert. Window/app checks restore previously checked clean guests if another guest vetoes. Restart and update installation use the same guard before teardown. The verification cleanup also captures its owner WebContents before destruction, fixing the native error popup.

The first visible Dark / Light check caught a code-server 4.138.0 settings-watcher mismatch. The user settings URI lacked the remote authority carried by file-change events, so saved settings were never applied live. The corrected runtime passed real extension-level checks for configuration events, Light/Dark theme kinds, unchanged unsaved document URI/text, and zero reloads or navigation. The compatibility patch verifies exact input/output bundle checksums, writes atomically, and runs for fresh installs and existing caches. All four official release assets have the same verified browser bundle. The desktop smoke creates its own temporary runtime copy and applies the production patch, leaving the supplied runtime untouched. Clean-install Electron and cached-runtime migration checks also passed.

The Python universal extension on Open VSX lacks its native `pet` interpreter-discovery binary. Debugging passed with an explicitly selected interpreter. This does not verify automatic Python environment discovery.

Final packaged UI verification: the worktree reopened in its saved Light theme; switching the toolbar to Dark visibly changed the running editor while preserving the dirty untitled document and its connection URL. Stop IDE refused the dirty close with the save-files message. Saving afterward created `theme-close-check.txt` with the expected content on disk, proving the remote filesystem remained usable after cancellation. The app bundle at `apps/desktop/release/embedded-ide/mac-arm64/superset++.app` passed integrity verification for all 83,320 packed files. The installed application was not replaced.

Branch comparison and Jira follow-up: desktop typecheck, all locale checks, formatting, and 33 focused navigation/sidebar tests passed. The latest bundle at `apps/desktop/release/ide-jira/mac-arm64/superset++.app` passed integrity verification for all 83,322 packed files. In an existing worktree, opening IDE showed all committed changes against its configured base. Selecting Uncommitted showed no changes; clicking the IDE's Changes button restored the full branch comparison. This check did not edit files or change workspace trust. Jira was not connected in the preview profile, so live Jira-card navigation remains unverified; the shared PR resolver tests passed. The preview is running and the installed application was not replaced.

Native VS Code branch changes follow-up: the host now installs a managed workspace extension through code-server's VSIX installer. Directly placing an extension directory worked in a fresh profile but failed with an existing extensions.json; the repeatable Electron check now starts from an existing profile to cover that failure. The extension contributes Branch Changes to Explorer, file decorations, and native modified/deleted diffs, using the current worktree's configured base and merge base. Read-only Git commands disable repository fsmonitor, external diffs, and text conversion. It does not grant workspace trust. Lingui generates the extension's manifest and runtime translations for all 17 locales.

Five real-Git tests passed for committed and local changes, renames and unusual paths, upstream base selection, linked-worktree isolation, refreshes, and suppression of repository Git helpers. Desktop/host typechecks and catalog checks passed. The Electron smoke verified installed-profile discovery and real VS Code diff documents, then passed theme and unsaved-close checks. The final preview at `apps/desktop/release/ide-branch-ready/mac-arm64/superset++.app` passed integrity checks for 83,340 packed files. In an existing workspace, clicking a modified TypeScript file in Branch Changes opened the native diff against its configured base with visible added/deleted lines and Explorer status badges, while Restricted Mode remained enabled. A screenshot was captured locally. In a second worktree, expanding Branch Changes below Timeline showed that worktree's changed files. No source files or workspace-trust settings were changed in either worktree.
