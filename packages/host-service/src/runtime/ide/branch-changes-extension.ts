import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getIdeExtensionTranslations } from "@superset/i18n/ide-extension";
import { strToU8, zipSync } from "fflate";

// Runs in VS Code's Node extension host, including in packaged Electron builds.
export const BRANCH_CHANGES_SOURCE = String.raw`
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { lstat, readlink } = require("node:fs/promises");
const path = require("node:path");
const run = promisify(execFile);

async function git(root, args) {
  const { stdout } = await run("git", ["--no-pager", "-c", "core.fsmonitor=false", ...args], {
    cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }
  });
  return stdout;
}
async function optionalGit(root, args) {
  try { return (await git(root, args)).trim(); }
  catch (error) { if (error.code === 1 || error.code === 128) return ""; throw error; }
}
async function readBranchChanges(root) {
  const branch = await optionalGit(root, ["symbolic-ref", "--short", "HEAD"]);
  const configured = branch ? await optionalGit(root, ["config", "--get", "branch." + branch + ".base"]) : "";
  const remoteHead = await optionalGit(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const base = configured || remoteHead.replace(/^origin\//, "");
  const candidates = [];
  if (base) {
    const remote = await optionalGit(root, ["config", "--get", "branch." + base + ".remote"]);
    const merge = await optionalGit(root, ["config", "--get", "branch." + base + ".merge"]);
    if (remote && merge) candidates.push(remote === "." ? merge : "refs/remotes/" + remote + "/" + merge.replace(/^refs\/heads\//, ""));
    candidates.push("refs/remotes/origin/" + base, "refs/heads/" + base, base);
  } else {
    candidates.push("refs/heads/main", "refs/heads/master");
  }
  let baseRef = "";
  let baseCommit = "";
  for (const candidate of candidates) {
    baseCommit = await optionalGit(root, ["rev-parse", "--verify", "--end-of-options", candidate + "^{commit}"]);
    if (baseCommit) { baseRef = candidate.replace(/^refs\/(heads|remotes)\//, ""); break; }
  }
  if (!baseCommit) throw new Error("Choose an available base branch in Superset's Changes sidebar.");
  const mergeBase = (await git(root, ["merge-base", "HEAD", baseCommit])).trim();
  const [raw, untracked] = await Promise.all([
    git(root, ["diff", "--no-ext-diff", "--no-textconv", "--ignore-submodules=all", "--name-status", "-z", "--find-renames", mergeBase, "--"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  ]);
  const fields = raw.split("\0");
  const files = [];
  for (let i = 0; i < fields.length && fields[i]; i++) {
    const status = fields[i][0];
    const originalPath = fields[++i];
    const filePath = status === "R" || status === "C" ? fields[++i] : originalPath;
    files.push({ status, path: filePath, originalPath });
  }
  const seen = new Set(files.map(file => file.path));
  for (const filePath of untracked.split("\0")) {
    if (filePath && !seen.has(filePath)) files.push({ status: "A", path: filePath, originalPath: filePath });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { branch, baseRef, mergeBase, files };
}
exports.readBranchChanges = readBranchChanges;
exports.activate = context => {
  const vscode = require("vscode");
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const root = folder.uri.fsPath;
  const treeEvents = new vscode.EventEmitter();
  const decorationEvents = new vscode.EventEmitter();
  let snapshot;
  let refreshing;
  let disposed = false;
  const colors = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "added", T: "modified", U: "conflicting" };
  const labels = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", C: "Copied", T: "Modified", U: "Conflicting" };
  const uriFor = filePath => vscode.Uri.joinPath(folder.uri, ...filePath.split("/"));
  const provider = {
    onDidChangeTreeData: treeEvents.event,
    getChildren: element => element ? [] : (snapshot?.files || []),
    getTreeItem: file => {
      const uri = uriFor(file.path);
      const item = new vscode.TreeItem(path.basename(file.path));
      item.id = file.path;
      item.resourceUri = uri;
      item.description = path.dirname(file.path) === "." ? file.status : path.dirname(file.path) + " · " + file.status;
      item.tooltip = file.path + " · " + vscode.l10n.t(labels[file.status] || "Modified");
      item.iconPath = new vscode.ThemeIcon("file", new vscode.ThemeColor("gitDecoration." + (colors[file.status] || "modified") + "ResourceForeground"));
      item.contextValue = file.status === "D" ? "branchDeletedFile" : "branchFile";
      item.command = { command: "superset.branchChanges.openDiff", title: vscode.l10n.t("Open Changes"), arguments: [file] };
      return item;
    }
  };
  const view = vscode.window.createTreeView("superset.branchChanges", { treeDataProvider: provider, showCollapseAll: false });
  const output = vscode.window.createOutputChannel("Superset Branch Changes");
  async function refresh() {
    if (disposed) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const next = await readBranchChanges(root);
        if (disposed) return;
        view.description = next.baseRef;
        view.message = next.files.length ? undefined : vscode.l10n.t("No changes");
        if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
          snapshot = next;
          treeEvents.fire();
          decorationEvents.fire();
        }
      } catch (error) {
        if (disposed) return;
        snapshot = undefined;
        view.message = vscode.l10n.t("Unable to load branch changes. Check the Superset Branch Changes output.");
        output.appendLine(String(error));
        treeEvents.fire();
        decorationEvents.fire();
      }
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }
  const revisionUri = (filePath, revision) => uriFor(filePath).with({ scheme: "superset-branch", query: JSON.stringify({ path: filePath, revision }) });
  const revisionProvider = {
    provideTextDocumentContent: async uri => {
      const value = JSON.parse(uri.query);
      if (typeof value.path !== "string" || path.isAbsolute(value.path) || value.path.split("/").includes("..")) throw new Error("Invalid revision path");
      if (value.revision === "empty") return "";
      if (value.revision === "link" && typeof value.content === "string") return value.content;
      if (!/^[0-9a-f]{40,64}$/.test(value.revision)) throw new Error("Invalid revision");
      return git(root, ["show", "--no-ext-diff", "--no-textconv", value.revision + ":" + value.path]);
    }
  };
  async function openDiff(file) {
    if (!snapshot || !snapshot.files.includes(file)) return;
    try {
      const before = revisionUri(file.originalPath, file.status === "A" ? "empty" : snapshot.mergeBase);
      let after = file.status === "D" ? revisionUri(file.path, "empty") : uriFor(file.path);
      if (file.status !== "D") {
        const info = await lstat(path.join(root, file.path));
        if (info.isSymbolicLink()) {
          after = uriFor(file.path).with({ scheme: "superset-branch", query: JSON.stringify({ path: file.path, revision: "link", content: await readlink(path.join(root, file.path)) }) });
        }
      }
      await vscode.commands.executeCommand("vscode.diff", before, after, path.basename(file.path) + " · " + snapshot.baseRef, { preview: true });
    } catch (error) {
      output.appendLine(String(error));
      void vscode.window.showErrorMessage(vscode.l10n.t("Unable to open changes. Refresh the branch changes list and try again."));
    }
  }
  context.subscriptions.push(
    treeEvents, decorationEvents, view, output,
    vscode.workspace.registerTextDocumentContentProvider("superset-branch", revisionProvider),
    vscode.window.registerFileDecorationProvider({
      onDidChangeFileDecorations: decorationEvents.event,
      provideFileDecoration: uri => {
        const file = snapshot?.files.find(file => uriFor(file.path).toString() === uri.toString());
        if (!file) return;
        return { badge: file.status, tooltip: vscode.l10n.t(labels[file.status] || "Modified"), color: new vscode.ThemeColor("gitDecoration." + (colors[file.status] || "modified") + "ResourceForeground"), propagate: true };
      }
    }),
    vscode.commands.registerCommand("superset.branchChanges.refresh", refresh),
    vscode.commands.registerCommand("superset.branchChanges.openDiff", openDiff),
    vscode.commands.registerCommand("superset.branchChanges.openFile", file => {
      if (snapshot?.files.includes(file) && file.status !== "D") return vscode.commands.executeCommand("vscode.open", uriFor(file.path));
    }),
    vscode.workspace.onDidSaveTextDocument(() => void refresh()),
    vscode.window.onDidChangeWindowState(state => { if (state.focused) void refresh(); }),
    view.onDidChangeVisibility(state => { if (state.visible) void refresh(); })
  );
  const timer = setInterval(() => { if (vscode.window.state.focused) void refresh(); }, 5000);
  context.subscriptions.push({ dispose: () => { disposed = true; clearInterval(timer); } });
  void refresh();
  return { refresh, getSnapshot: () => snapshot, openDiff };
};
`;

export async function installBranchChangesExtension(options: {
	executable: string;
	extensionsDirectory: string;
	userDataDirectory: string;
	config: string;
	environment: NodeJS.ProcessEnv;
	signal?: AbortSignal;
}) {
	const translations = await getIdeExtensionTranslations();
	const manifest = {
		name: "branch-changes",
		publisher: "superset",
		version: "1.0.0",
		displayName: "Superset Branch Changes",
		l10n: "./l10n",
		engines: { vscode: "^1.90.0" },
		main: "./extension.cjs",
		activationEvents: ["onStartupFinished"],
		extensionKind: ["workspace"],
		capabilities: { untrustedWorkspaces: { supported: true } },
		contributes: {
			views: {
				explorer: [
					{
						id: "superset.branchChanges",
						name: "%Branch Changes%",
						visibility: "visible",
					},
				],
			},
			commands: [
				{
					command: "superset.branchChanges.refresh",
					title: "%Refresh%",
					icon: "$(refresh)",
				},
				{ command: "superset.branchChanges.openDiff", title: "%Open Changes%" },
				{
					command: "superset.branchChanges.openFile",
					title: "%Open File%",
					icon: "$(go-to-file)",
				},
			],
			menus: {
				"view/title": [
					{
						command: "superset.branchChanges.refresh",
						when: "view == superset.branchChanges",
						group: "navigation",
					},
				],
				"view/item/context": [
					{
						command: "superset.branchChanges.openFile",
						when: "view == superset.branchChanges && viewItem == branchFile",
						group: "inline",
					},
				],
				commandPalette: [
					{ command: "superset.branchChanges.openDiff", when: "false" },
					{ command: "superset.branchChanges.openFile", when: "false" },
				],
			},
		},
	};
	const digest = createHash("sha256")
		.update(BRANCH_CHANGES_SOURCE)
		.update(JSON.stringify(manifest))
		.update(JSON.stringify(translations))
		.digest("hex");
	manifest.version = `1.0.${Number.parseInt(digest.slice(0, 7), 16)}`;
	const files: Record<string, Uint8Array> = {
		"extension/extension.cjs": strToU8(BRANCH_CHANGES_SOURCE),
		"extension/package.json": strToU8(JSON.stringify(manifest)),
		"extension.vsixmanifest": strToU8(
			`<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="branch-changes" Version="${manifest.version}" Publisher="superset"/><DisplayName>Superset Branch Changes</DisplayName><Description xml:space="preserve">Superset Branch Changes</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`,
		),
		"[Content_Types].xml": strToU8(
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>',
		),
	};
	for (const { locale, messages } of translations) {
		const suffix = locale.toLowerCase();
		files[
			locale === "en"
				? "extension/package.nls.json"
				: `extension/package.nls.${suffix}.json`
		] = strToU8(JSON.stringify(messages));
		if (locale !== "en")
			files[`extension/l10n/bundle.l10n.${suffix}.json`] = strToU8(
				JSON.stringify(messages),
			);
	}
	const temporary = await mkdtemp(join(tmpdir(), "superset-branch-extension-"));
	try {
		const vsix = join(temporary, "branch-changes.vsix");
		await writeFile(vsix, zipSync(files));
		const environment = { ...options.environment };
		delete environment.ELECTRON_RUN_AS_NODE;
		const result = await promisify(execFile)(
			options.executable,
			[
				"--config",
				options.config,
				"--user-data-dir",
				options.userDataDirectory,
				"--extensions-dir",
				options.extensionsDirectory,
				"--install-extension",
				vsix,
				"--force",
			],
			{
				env: environment,
				timeout: 60_000,
				maxBuffer: 1024 * 1024,
				signal: options.signal,
			},
		);
		if (
			!result.stdout.includes("successfully installed") &&
			!result.stdout.includes("already installed")
		) {
			throw new Error(
				`Could not install IDE branch changes: ${result.stderr || result.stdout}`,
			);
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
