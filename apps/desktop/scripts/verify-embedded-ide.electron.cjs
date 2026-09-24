const { app, BrowserWindow, session, clipboard, Menu } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { mkdtemp, mkdir, readFile, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const net = require("node:net");
const { randomUUID, randomBytes } = require("node:crypto");
const assert = require("node:assert/strict");
const { IdeManager } = require(join(process.argv[3], "ide-manager.js"));
const { initializeIdeSettings, setIdeTheme } = require(
	join(process.argv[3], "default-settings.js"),
);
const { installBranchChangesExtension } = require(
	join(process.argv[3], "branch-changes-extension.js"),
);
app.on("window-all-closed", () => {});
let runtime;
let temporary;
let finishing = false;
const windows = [];
const fail = (error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	if (finishing) app.exit(1);
	else void finish(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForFile(path, accept = () => true) {
	let latest;
	for (let i = 0; i < 250; i++) {
		try {
			const value = await readFile(path, "utf8");
			latest = value;
			if (accept(value)) return value;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await pause(100);
	}
	throw new Error(
		`Timed out waiting for fixture ${path}; last value: ${latest}`,
	);
}
async function waitForBranchView(guest, accept) {
	let state;
	for (let i = 0; i < 100; i++) {
		state = await guest.executeJavaScript(`(() => {
   const header = document.querySelector('.pane-header[aria-label^="Branch Changes"]');
   const pane = header?.parentElement;
   const visible = element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight;
   };
   return {
    expanded: header?.getAttribute('aria-expanded') === 'true',
    files: [...(pane?.querySelectorAll('[role="treeitem"]') || [])].filter(visible).map(element => element.getAttribute('aria-label')),
    noChanges: [...(pane?.querySelectorAll('.message') || [])].some(element => visible(element) && element.textContent === 'No changes'),
   };
  })()`);
		if (accept(state)) return state;
		await pause(100);
	}
	throw new Error(`Unexpected Branch Changes view: ${JSON.stringify(state)}`);
}
async function freePort() {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}
app
	.whenReady()
	.then(async () => {
		temporary = await mkdtemp(join(tmpdir(), "superset-ide-electron-"));
		const git = (...args) =>
			execFileSync("git", args, { cwd: temporary, stdio: "pipe" });
		git("init", "-b", "main");
		git("config", "user.email", "ide-test@example.com");
		git("config", "user.name", "IDE Test");
		await writeFile(join(temporary, ".git/info/exclude"), "*\n");
		await writeFile(
			join(temporary, "branch-check.ts"),
			"export const value = 1;\n",
		);
		await writeFile(join(temporary, "deleted.py"), "print('deleted')\n");
		git("add", "-f", "branch-check.ts", "deleted.py");
		git("commit", "-m", "base");
		git("checkout", "-b", "feature");
		git("config", "branch.feature.base", "main");
		await writeFile(
			join(temporary, "branch-check.ts"),
			"export const value = 2;\n",
		);
		git("rm", "deleted.py");
		git("commit", "-am", "branch changes");

		const config = join(temporary, "config.yaml");
		await writeFile(config, "{}\n");
		const userData = join(temporary, "data");
		await mkdir(join(userData, "User"), { recursive: true });
		await writeFile(
			join(userData, "User", "settings.json"),
			JSON.stringify({ "files.autoSave": "off" }),
		);
		await initializeIdeSettings(userData);
		await mkdir(join(temporary, "extensions"), { recursive: true });
		await writeFile(join(temporary, "extensions/extensions.json"), "[]");
		await installBranchChangesExtension({
			executable: process.argv[2],
			extensionsDirectory: join(temporary, "extensions"),
			userDataDirectory: userData,
			config,
			environment: process.env,
		});
		await setIdeTheme(userData, "dark");
		const fixtureExtension = join(temporary, "fixture-package", "extension");
		await mkdir(fixtureExtension, { recursive: true });
		await writeFile(
			join(fixtureExtension, "package.json"),
			JSON.stringify({
				name: "dirty-close-fixture",
				publisher: "superset",
				version: "0.0.0",
				engines: { vscode: "^1.90.0" },
				main: "./extension.js",
				activationEvents: ["*"],
				capabilities: { untrustedWorkspaces: { supported: true } },
			}),
		);
		await writeFile(
			join(fixtureExtension, "extension.js"),
			`
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const root = ${JSON.stringify(temporary)};
exports.activate = async context => {
 if (vscode.workspace.workspaceFolders[0].uri.path.endsWith("/clean-worktree")) {
  const countPath=path.join(root,"clean-load-count");
  const count=fs.existsSync(countPath)?Number(fs.readFileSync(countPath,"utf8")):0;
  fs.writeFileSync(countPath,String(count+1));
  return;
 }
 const assert = require("node:assert/strict");
 const branchExtension = vscode.extensions.getExtension("superset.branch-changes");
 assert(branchExtension, "managed branch extension is installed");
 const branchApi = await branchExtension.activate();
 await branchApi.refresh();
 const changes = branchApi.getSnapshot();
 assert.equal(changes.baseRef, "main");
 assert.equal(changes.files.length, 2);
 const changed = changes.files.find(file => file.path === "branch-check.ts");
 await branchApi.openDiff(changed);
 let diff = vscode.window.tabGroups.activeTabGroup.activeTab.input;
 assert(diff instanceof vscode.TabInputTextDiff, "opens a native VS Code diff editor");
 assert.equal((await vscode.workspace.openTextDocument(diff.original)).getText(), "export const value = 1;\\n");
 assert.equal((await vscode.workspace.openTextDocument(diff.modified)).getText(), "export const value = 2;\\n");
 await branchApi.openDiff(changes.files.find(file => file.path === "deleted.py"));
 diff = vscode.window.tabGroups.activeTabGroup.activeTab.input;
 assert.equal((await vscode.workspace.openTextDocument(diff.original)).getText(), "print('deleted')\\n");
 assert.equal((await vscode.workspace.openTextDocument(diff.modified)).getText(), "");
 fs.writeFileSync(path.join(root, "branch-ready"), JSON.stringify({ files: changes.files.length, nativeDiff: true }));
 const document = await vscode.workspace.openTextDocument({ content: "unsaved IDE close regression", language: "plaintext" });
 await vscode.window.showTextDocument(document);
 let configurationChanges=0;
 let themeChanges=0;
 const reportTheme=()=>fs.writeFileSync(path.join(root,"theme-state"),JSON.stringify({
  theme:vscode.workspace.getConfiguration("workbench").get("colorTheme"),
  inspected:vscode.workspace.getConfiguration("workbench").inspect("colorTheme"),
  kind:vscode.window.activeColorTheme.kind,
  dirty:document.isDirty,closed:document.isClosed,text:document.getText(),uri:document.uri.toString(),
  configurationChanges,themeChanges
 }));
 context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{
  if(event.affectsConfiguration("workbench.colorTheme")){configurationChanges++;reportTheme();}
 }));
 context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(()=>{themeChanges++;reportTheme();}));
 reportTheme();
 fs.writeFileSync(path.join(root, "dirty-ready"), JSON.stringify({dirty:document.isDirty,hotExit:vscode.workspace.getConfiguration("files").get("hotExit")}));
 let reverting = false;
 const interval = setInterval(async () => {
  if (reverting || !fs.existsSync(path.join(root,"revert-request"))) return;
  reverting = true;
  try {
   await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri,"post-veto.txt"),Buffer.from("remote filesystem remains available"));
   await vscode.window.showTextDocument(document);
   await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
   fs.writeFileSync(path.join(root,"revert-done"), JSON.stringify({dirty:document.isDirty,closed:document.isClosed}));
  } catch (error) { fs.writeFileSync(path.join(root,"revert-done"),JSON.stringify({error:String(error)})); }
 },100);
 context.subscriptions.push({dispose:()=>clearInterval(interval)});
};
`,
		);
		await writeFile(
			join(temporary, "fixture-package/extension.vsixmanifest"),
			'<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="dirty-close-fixture" Version="0.0.0" Publisher="superset"/><DisplayName>Fixture</DisplayName><Description xml:space="preserve">Fixture</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>',
		);
		await writeFile(
			join(temporary, "fixture-package/[Content_Types].xml"),
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>',
		);
		const fixtureVsix = join(temporary, "fixture.vsix");
		execFileSync("zip", ["-qr", fixtureVsix, "."], {
			cwd: join(temporary, "fixture-package"),
		});
		execFileSync(
			process.argv[2],
			[
				"--config",
				config,
				"--user-data-dir",
				userData,
				"--extensions-dir",
				join(temporary, "extensions"),
				"--install-extension",
				fixtureVsix,
			],
			{ timeout: 60000, stdio: "pipe" },
		);
		const port = await freePort();
		const password = randomBytes(32).toString("base64url");
		runtime = spawn(
			process.argv[2],
			[
				"--bind-addr",
				`127.0.0.1:${port}`,
				"--auth",
				"password",
				"--config",
				config,
				"--user-data-dir",
				join(temporary, "data"),
				"--extensions-dir",
				join(temporary, "extensions"),
				"--disable-telemetry",
				"--disable-update-check",
				"--disable-workspace-trust",
				temporary,
			],
			{
				env: { ...process.env, PASSWORD: password },
				detached: true,
				stdio: "ignore",
			},
		);
		const origin = `http://127.0.0.1:${port}`;
		let ready = false;
		for (let i = 0; i < 100; i++) {
			try {
				const r = await fetch(origin, { redirect: "manual" });
				if (r.status === 302) {
					ready = true;
					break;
				}
			} catch {}
			await pause(100);
		}
		assert(ready, "code-server became ready");
		const manager = new IdeManager();
		const owner = new BrowserWindow({
			show: false,
			width: 1200,
			height: 900,
			webPreferences: {
				webviewTag: true,
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			},
		});
		windows.push(owner);
		await owner.loadURL("data:text/html,<body></body>");
		const input = {
			paneId: randomUUID(),
			workspaceId: randomUUID(),
			target: { kind: "local" },
			connection: {
				sessionId: randomUUID(),
				port,
				password,
				folderPath: temporary,
			},
		};
		const cleanFolder = join(temporary, "clean-worktree");
		git("worktree", "add", cleanFolder, "main");
		const cleanInput = {
			...input,
			paneId: randomUUID(),
			workspaceId: randomUUID(),
			connection: { ...input.connection, folderPath: cleanFolder },
		};
		const cleanView = await manager.prepare(owner, cleanInput);
		const cleanLoaded = new Promise((resolve) =>
			owner.webContents.once("did-attach-webview", (_event, contents) =>
				contents.once("dom-ready", () => resolve(contents)),
			),
		);
		await owner.webContents.executeJavaScript(`(() => {
   const view=document.createElement("webview");
   view.style.cssText="position:fixed;inset:0;width:100%;height:100%";
   view.setAttribute("partition",${JSON.stringify(cleanView.partition)});
   view.src=${JSON.stringify(cleanView.url)};
   document.body.append(view);
  })()`);
		const cleanGuest = await cleanLoaded;
		manager.register(owner, cleanInput.paneId, cleanGuest.id);
		const cleanLoadCount = join(temporary, "clean-load-count");
		assert.equal(await waitForFile(cleanLoadCount), "1");
		await waitForBranchView(
			cleanGuest,
			(state) => state.expanded && state.noChanges,
		);
		await cleanGuest.executeJavaScript(
			`document.querySelector('.pane-header[aria-label^="Branch Changes"]').click(); void 0`,
		);
		await waitForBranchView(cleanGuest, (state) => !state.expanded);
		const [view, reused] = await Promise.all([
			manager.prepare(owner, input),
			manager.prepare(owner, input),
		]);
		assert.deepEqual(view, reused);
		assert(!view.url.includes(password));
		assert.equal(new URL(view.url).searchParams.get("folder"), temporary);
		const isolated = session.fromPartition(`check-${randomUUID()}`);
		assert.equal((await isolated.cookies.get({ url: origin })).length, 0);
		assert.match(await (await isolated.fetch(origin)).text(), /password/);
		assert.match(
			await (
				await session.fromPartition(view.partition).fetch(view.url)
			).text(),
			/workbench/,
		);
		console.log(
			"PASS Electron cookie authentication, clean URL, coalesced prepare, separate session",
		);
		const loaded = new Promise((resolve) =>
			owner.webContents.once("did-attach-webview", (_event, guest) =>
				guest.once("dom-ready", () => resolve(guest)),
			),
		);
		await owner.webContents.executeJavaScript(
			`(()=>{const guest=document.createElement('webview');guest.style.cssText="position:fixed;inset:0;width:100%;height:100%";guest.setAttribute('partition',${JSON.stringify(view.partition)});guest.src=${JSON.stringify(view.url)};document.body.append(guest);})()`,
		);
		const guest = await loaded;
		manager.register(owner, input.paneId, guest.id);
		let focusCount = 0;
		const unsubscribe = manager.onFocus(
			owner,
			input.paneId,
			() => focusCount++,
		);
		await guest.executeJavaScript(
			'document.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));void 0',
		);
		await pause(100);
		assert.equal(focusCount, 1);
		unsubscribe();
		console.log("PASS guest focus forwards to its owning pane");
		const stranger = new BrowserWindow({ show: false });
		windows.push(stranger);
		assert.throws(
			() => manager.register(stranger, input.paneId, guest.id),
			/does not belong/,
		);
		assert.throws(
			() => manager.prepare(owner, { ...input, workspaceId: randomUUID() }),
			/another workspace/,
		);
		console.log("PASS guest attached with sandbox and sender-window ownership");
		if (!process.argv.includes("--skip-clipboard")) {
			const originalClipboard = {
				text: clipboard.readText(),
				html: clipboard.readHTML(),
				rtf: clipboard.readRTF(),
			};
			try {
				Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "editMenu" }]));
				owner.show();
				owner.focus();
				app.focus({ steal: true });
				await owner.webContents.executeJavaScript(
					`document.querySelector('webview[partition="${view.partition}"]').focus()`,
				);
				await guest.executeJavaScript(`(() => {
				const field = document.createElement("textarea");
				field.id = "superset-clipboard-check";
				field.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:2147483647";
				document.body.append(field);
				field.focus();
			})()`);
				await pause(200);
				const chord = async (keyCode) => {
					const modifiers = [
						process.platform === "darwin" ? "meta" : "control",
					];
					guest.sendInputEvent({ type: "keyDown", keyCode, modifiers });
					guest.sendInputEvent({ type: "keyUp", keyCode, modifiers });
					await pause(150);
				};
				clipboard.writeText("native IDE clipboard");
				assert.equal(clipboard.readText(), "native IDE clipboard");
				await guest.executeJavaScript(
					"document.getElementById('superset-clipboard-check').focus(); void 0",
				);
				await chord("V");
				assert.equal(
					await guest.executeJavaScript(
						"document.getElementById('superset-clipboard-check').value",
					),
					"native IDE clipboard",
				);
				await guest.executeJavaScript(
					"document.getElementById('superset-clipboard-check').select()",
				);
				await chord("X");
				assert.equal(clipboard.readText(), "native IDE clipboard");
				assert.equal(
					await guest.executeJavaScript(
						"document.getElementById('superset-clipboard-check').value",
					),
					"",
				);
				await chord("V");
				await guest.executeJavaScript(
					"document.getElementById('superset-clipboard-check').select()",
				);
				clipboard.writeText("replace copy fixture");
				await chord("C");
				assert.equal(clipboard.readText(), "native IDE clipboard");
				await guest.executeJavaScript(
					"document.getElementById('superset-clipboard-check').remove()",
				);
				console.log(
					"PASS native clipboard paste, cut and copy in an IDE guest",
				);
			} finally {
				clipboard.write(originalClipboard);
				owner.hide();
			}
		}

		const dirtyState = JSON.parse(
			await waitForFile(join(temporary, "dirty-ready")),
		);
		assert.deepEqual(dirtyState, { dirty: true, hotExit: "off" });
		assert.deepEqual(
			JSON.parse(await waitForFile(join(temporary, "branch-ready"))),
			{ files: 2, nativeDiff: true },
		);
		console.log(
			"PASS managed branch changes extension, committed files, native VS Code modified/deleted diffs",
		);
		const branchViewState = await waitForBranchView(
			guest,
			(state) => state.expanded && state.files.length === 2,
		);
		assert.match(branchViewState.files[0], /branch-check.ts.*Modified/);
		assert.match(branchViewState.files[1], /deleted.py.*Deleted/);
		console.log(
			"PASS Branch Changes opens on IDE startup with committed files; empty worktrees show No changes",
		);
		const themeStatePath = join(temporary, "theme-state");
		const initialTheme = JSON.parse(await waitForFile(themeStatePath));
		assert.equal(initialTheme.kind, 2);
		let themeNavigations = 0;
		const trackThemeNavigation = () => themeNavigations++;
		guest.on("did-start-navigation", trackThemeNavigation);
		await setIdeTheme(userData, "light");
		const lightTheme = JSON.parse(
			await waitForFile(themeStatePath, (value) => {
				const state = JSON.parse(value);
				return state.theme === "Light Modern" && state.kind === 1;
			}),
		);
		assert.equal(lightTheme.dirty, true);
		assert.equal(lightTheme.closed, false);
		assert.equal(lightTheme.text, "unsaved IDE close regression");
		assert.equal(lightTheme.uri, initialTheme.uri);
		assert(lightTheme.configurationChanges > 0);
		assert(lightTheme.themeChanges > 0);
		assert.equal(guest.isDestroyed(), false);
		await setIdeTheme(userData, "dark");
		const restoredTheme = JSON.parse(
			await waitForFile(themeStatePath, (value) => {
				const state = JSON.parse(value);
				return state.theme === "Dark Modern" && state.kind === 2;
			}),
		);
		assert.equal(restoredTheme.dirty, true);
		assert.equal(restoredTheme.closed, false);
		assert.equal(restoredTheme.text, "unsaved IDE close regression");
		assert.equal(restoredTheme.uri, initialTheme.uri);
		assert(
			restoredTheme.configurationChanges > lightTheme.configurationChanges,
		);
		assert(restoredTheme.themeChanges > lightTheme.themeChanges);
		assert.equal(themeNavigations, 0);
		guest.off("did-start-navigation", trackThemeNavigation);
		console.log(
			"PASS live Light/Dark theme applies through VS Code configuration with unsaved text retained",
		);
		await waitForBranchView(cleanGuest, (state) => !state.expanded);
		const windowCheck = manager.canCloseWindow(owner);
		assert.equal(manager.canCloseWindow(owner), windowCheck);
		assert.equal(await windowCheck, false);
		assert.equal(
			await waitForFile(cleanLoadCount, (value) => value === "2"),
			"2",
		);
		assert.equal(cleanGuest.isDestroyed(), false);
		await waitForBranchView(
			cleanGuest,
			(state) => state.expanded && state.noChanges,
		);
		console.log("PASS saved collapsed Branch Changes reopens on IDE reload");
		const appCheck = manager.canCloseApp();
		assert.equal(manager.canCloseApp(), appCheck);
		assert.equal(await appCheck, false);
		assert.equal(
			await waitForFile(cleanLoadCount, (value) => value === "3"),
			"3",
		);
		assert.equal(cleanGuest.isDestroyed(), false);
		console.log(
			"PASS window/app close vetoes dirty IDE and restores previously checked clean IDE",
		);
		await guest.executeJavaScript("void 0", true);
		assert.equal(await manager.close(owner, input.paneId), false);
		assert.equal(guest.isDestroyed(), false);
		await pause(1000);
		assert.equal(
			guest.isDestroyed(),
			false,
			"veto must keep the guest alive after native callbacks settle",
		);
		await writeFile(join(temporary, "revert-request"), "");
		const reverted = JSON.parse(
			await waitForFile(join(temporary, "revert-done")),
		);
		assert.equal(reverted.error, undefined);
		assert(reverted.closed || !reverted.dirty);
		assert.equal(
			await readFile(join(temporary, "post-veto.txt"), "utf8"),
			"remote filesystem remains available",
		);
		assert.equal(await manager.close(owner, input.paneId), true);
		assert.equal(guest.isDestroyed(), true);
		await manager.release(owner, input.paneId);
		assert.equal(await manager.canCloseWindow(owner), true);
		assert.equal(await manager.close(owner, cleanInput.paneId), true);
		await manager.release(owner, cleanInput.paneId);
		assert.equal(await manager.canCloseApp(), true);
		console.log(
			"PASS actual unsaved VS Code document vetoes close; explicit revert allows close",
		);
		const genericInput = { ...input, paneId: randomUUID() };
		const genericView = await manager.prepare(owner, genericInput);
		const genericLoaded = new Promise((resolve) =>
			owner.webContents.once("did-attach-webview", (_event, contents) =>
				contents.once("dom-ready", () => resolve(contents)),
			),
		);
		await owner.webContents.executeJavaScript(`(() => {
   const view=document.createElement("webview");
   view.setAttribute("partition",${JSON.stringify(genericView.partition)});
   view.src=${JSON.stringify(`${origin}/healthz`)};
   document.body.append(view);
  })()`);
		const genericGuest = await genericLoaded;
		manager.register(owner, genericInput.paneId, genericGuest.id);
		await genericGuest.executeJavaScript(
			'window.__closeGuard=event=>event.preventDefault();window.addEventListener("beforeunload",window.__closeGuard);void 0',
		);
		assert.equal(await manager.close(owner, genericInput.paneId), false);
		await pause(250);
		assert.equal(genericGuest.isDestroyed(), false);
		await genericGuest.executeJavaScript(
			'window.removeEventListener("beforeunload",window.__closeGuard);void 0',
		);
		assert.equal(await manager.close(owner, genericInput.paneId), true);
		await manager.release(owner, genericInput.paneId);
		assert.equal(await manager.close(owner, genericInput.paneId), true);
		console.log(
			"PASS generic beforeunload veto, clean close and already-closed pane",
		);

		const racing = { ...input, paneId: randomUUID() };
		const pending = manager.prepare(owner, racing);
		await manager.release(owner, racing.paneId);
		await assert.rejects(pending, /closed while connecting/);
		console.log("PASS release during preparation cancels late view");
	})
	.then(
		() => finish(0),
		(error) => {
			console.error(error.stack);
			finish(1);
		},
	);
async function finish(code) {
	if (finishing) return;
	finishing = true;
	for (const w of windows) {
		if (!w.isDestroyed()) w.destroy();
	}
	if (runtime?.pid) {
		try {
			process.kill(-runtime.pid, "SIGTERM");
		} catch {}
	}
	if (temporary) await rm(temporary, { recursive: true, force: true });
	app.exit(code);
}
setTimeout(() => {
	console.error("Electron IDE check timed out");
	finish(1);
}, 45000).unref();
