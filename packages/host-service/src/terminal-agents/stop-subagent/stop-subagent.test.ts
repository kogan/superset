import { afterEach, describe, expect, it } from "bun:test";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCodexWrapperExecLine } from "../../../../agent-setup/src/agent-wrappers-claude-codex-opencode";
import {
	buildDefaultAccountResolver,
	buildWrapperScript,
} from "../../../../agent-setup/src/agent-wrappers-common";
import type { TerminalAgentBinding, TerminalSubagent } from "../types";
import {
	controlSubagent,
	getSubagentStopTarget,
	type SubagentStopTarget,
} from "./stop-subagent";

const fixture = `
const { appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
const threads = JSON.parse(process.env.TEST_THREADS);
const lines = createInterface({input: process.stdin});
lines.on("line", line => {
  const request = JSON.parse(line);
  appendFileSync(process.env.TEST_REQUESTS, line + "\\n");
  if (process.env.TEST_MODE === "timeout") return;
  if (request.method === "initialized") return;
  if (process.env.TEST_MODE === "exit") process.exit(1);
  if (process.env.TEST_MODE === "invalid") return process.stdout.write("invalid json\\n");
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({id: request.id, method: "unexpected/request", params: {}}) + "\\n");
    process.stdout.write(JSON.stringify({method: "unrelated/notification", params: {}}) + "\\n");
  }
  if (request.method === "turn/interrupt" && process.env.TEST_MODE === "reject-interrupt") {
    process.stdout.write(JSON.stringify({id: request.id, error: {code: -32602, message: "Turn changed"}}) + "\\n");
    return;
  }
  const result = request.method === "thread/read" ? {thread: threads[request.params.threadId]} : {};
  const response = JSON.stringify({id: request.id, result}) + "\\n";
  process.stdout.write(response.slice(0, 8));
  setTimeout(() => process.stdout.write(response.slice(8)), 1);
});
if (process.env.TEST_MODE === "ignore-eof") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
`;

type FixtureThread = {
	id: string;
	parentThreadId: string | null;
	status: { type: string };
	turns: Array<{ id: string; status: string }>;
};

const target: SubagentStopTarget = {
	parentThreadId: "parent-thread",
	childThreadId: "child-thread",
	codexHome: "/captured/codex-home",
};

function childThread(overrides: Partial<FixtureThread> = {}): FixtureThread {
	return {
		id: target.childThreadId,
		parentThreadId: target.parentThreadId,
		status: { type: "active" },
		turns: [
			{ id: "previous-turn", status: "completed" },
			{ id: "child-active-turn", status: "inProgress" },
		],
		...overrides,
	};
}

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fakeProxy(threads: Record<string, FixtureThread>, mode = "normal") {
	const directory = mkdtempSync(join(tmpdir(), "superset-child-stop-"));
	directories.push(directory);
	const requestFile = join(directory, "requests.jsonl");
	const children: ChildProcessWithoutNullStreams[] = [];
	return {
		children,
		spawnProxy: (env: NodeJS.ProcessEnv) => {
			expect(env.CODEX_HOME).toBe(target.codexHome);
			const child = spawn(process.execPath, ["-e", fixture], {
				env: {
					...env,
					TEST_THREADS: JSON.stringify(threads),
					TEST_REQUESTS: requestFile,
					TEST_MODE: mode,
				},
				stdio: "pipe",
			});
			children.push(child);
			return child;
		},
		requests: (): Array<{
			method: string;
			params?: { threadId?: string; turnId?: string; includeTurns?: boolean };
		}> => {
			try {
				return readFileSync(requestFile, "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line));
			} catch {
				return [];
			}
		},
	};
}

describe("Codex subagent stop", () => {
	it("does not pass parent terminal identity or TUI recording state to its proxy", async () => {
		const proxy = fakeProxy({ [target.childThreadId]: childThread() });
		const inherited = {
			SUPERSET_TERMINAL_ID: "parent-terminal",
			SUPERSET_TAB_ID: "parent-tab",
			SUPERSET_PANE_ID: "parent-pane",
			SUPERSET_HOME_DIR: "/parent/superset-home",
			SUPERSET_AGENT_ID: "codex",
			SUPERSET_AGENT_LAUNCH_ID: "parent-launch",
			SUPERSET_ACCOUNT_ATTRIBUTION_TOKEN: "parent-attribution",
			CODEX_TUI_RECORD_SESSION: "1",
			CODEX_TUI_SESSION_LOG_PATH: "/parent/session-log.jsonl",
		};
		await controlSubagent(target, {
			mode: "probe",
			env: { ...process.env, ...inherited },
			isStillCurrent: () => true,
			spawnProxy: (env) => {
				for (const key of Object.keys(inherited))
					expect(env[key]).toBeUndefined();
				expect(env.CODEX_HOME).toBe(target.codexHome);
				return proxy.spawnProxy(env);
			},
		});
	});

	it("keeps a managed Codex wrapper from reporting parent lifecycle or changing accounts", async () => {
		const root = mkdtempSync(join(tmpdir(), "superset-proxy-wrapper-"));
		directories.push(root);
		const home = join(root, ".superset");
		const wrappers = join(home, "bin");
		const realBin = join(root, "real-bin");
		const otherAccount = join(root, "other-account");
		const hooks = join(home, "hooks");
		for (const directory of [
			wrappers,
			realBin,
			otherAccount,
			hooks,
			join(home, "state"),
		])
			mkdirSync(directory, { recursive: true });
		const notifyLog = join(root, "notify.log");
		const environmentLog = join(root, "environment.json");
		const notify = join(hooks, "superestset-notify.sh");
		writeFileSync(
			notify,
			`#!/bin/bash\nprintf '%s\\n' "$1" >> '${notifyLog}'\n`,
			{ mode: 0o755 },
		);
		writeFileSync(join(home, "state", "default-codex-home"), otherAccount);
		writeFileSync(
			join(wrappers, "codex"),
			buildWrapperScript("codex", buildCodexWrapperExecLine(notify), {
				agentId: "codex",
				beforeLaunch: buildDefaultAccountResolver(
					"CODEX_HOME",
					"default-codex-home",
					"SUPERSET_AMBIENT_CODEX_HOME",
				),
			}),
			{ mode: 0o755 },
		);
		writeFileSync(
			join(realBin, "codex"),
			`#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(environmentLog)},JSON.stringify({codexHome:process.env.CODEX_HOME,terminalId:process.env.SUPERSET_TERMINAL_ID,tabId:process.env.SUPERSET_TAB_ID,tuiLog:process.env.CODEX_TUI_SESSION_LOG_PATH}));\n${fixture}`,
			{ mode: 0o755 },
		);
		await controlSubagent(target, {
			mode: "probe",
			isStillCurrent: () => true,
			env: {
				...process.env,
				HOME: root,
				PATH: `${wrappers}:${realBin}:${process.env.PATH ?? ""}`,
				SUPERSET_HOME_DIR: home,
				SUPERSET_TERMINAL_ID: "parent-terminal",
				SUPERSET_TAB_ID: "parent-tab",
				SUPERSET_PANE_ID: "parent-pane",
				SUPERSET_AGENT_ID: "",
				SUPERSET_DEFAULT_CODEX_HOME: target.codexHome,
				TEST_THREADS: JSON.stringify({ [target.childThreadId]: childThread() }),
				TEST_REQUESTS: join(root, "requests.jsonl"),
			},
		});
		expect(JSON.parse(readFileSync(environmentLog, "utf8"))).toEqual({
			codexHome: target.codexHome,
		});
		expect(existsSync(notifyLog)).toBe(false);
	});

	it("interrupts only the verified child's active turn over JSONL and closes its proxy", async () => {
		const proxy = fakeProxy({ [target.childThreadId]: childThread() });
		await controlSubagent(target, {
			mode: "stop",
			env: process.env,
			isStillCurrent: () => true,
			spawnProxy: proxy.spawnProxy,
		});
		expect(proxy.requests().map((request) => request.method)).toEqual([
			"initialize",
			"initialized",
			"thread/read",
			"turn/interrupt",
		]);
		expect(proxy.requests().at(-1)?.params).toEqual({
			threadId: target.childThreadId,
			turnId: "child-active-turn",
		});
		expect(proxy.children[0]?.exitCode).not.toBeNull();
	});

	it("allows a nested child only after following its ancestry to the bound parent", async () => {
		const proxy = fakeProxy({
			[target.childThreadId]: childThread({ parentThreadId: "middle-thread" }),
			"middle-thread": childThread({ id: "middle-thread", turns: [] }),
		});
		await controlSubagent(target, {
			mode: "stop",
			env: process.env,
			isStillCurrent: () => true,
			spawnProxy: proxy.spawnProxy,
		});
		expect(
			proxy
				.requests()
				.filter((request) => request.method === "thread/read")
				.map((request) => request.params),
		).toEqual([
			{ threadId: target.childThreadId, includeTurns: true },
			{ threadId: "middle-thread", includeTurns: false },
		]);
		expect(
			proxy
				.requests()
				.filter((request) => request.method === "turn/interrupt")
				.map((request) => request.params?.threadId),
		).toEqual([target.childThreadId]);
	});

	it("probes without interrupting or resuming any thread", async () => {
		const proxy = fakeProxy({ [target.childThreadId]: childThread() });
		await controlSubagent(target, {
			mode: "probe",
			env: process.env,
			isStillCurrent: () => true,
			spawnProxy: proxy.spawnProxy,
		});
		expect(proxy.requests().map((request) => request.method)).toEqual([
			"initialize",
			"initialized",
			"thread/read",
		]);
	});

	it("rejects ancestry ending in a different parent", async () => {
		const proxy = fakeProxy({
			[target.childThreadId]: childThread({ parentThreadId: "other-parent" }),
			"other-parent": childThread({
				id: "other-parent",
				parentThreadId: null,
				turns: [],
			}),
		});
		await expect(
			controlSubagent(target, {
				mode: "stop",
				env: process.env,
				isStillCurrent: () => true,
				spawnProxy: proxy.spawnProxy,
			}),
		).rejects.toThrow("does not belong");
		expect(
			proxy.requests().some((request) => request.method === "turn/interrupt"),
		).toBe(false);
	});

	for (const [name, child] of Object.entries({
		"unrelated child": childThread({ parentThreadId: null }),
		cycle: childThread({ parentThreadId: target.childThreadId }),
		"wrong thread response": childThread({ id: "another-thread" }),
		"idle child": childThread({ status: { type: "idle" } }),
		"unloaded child": childThread({ status: { type: "notLoaded" } }),
		"completed child": childThread({
			turns: [{ id: "done", status: "completed" }],
		}),
		"blank active turn": childThread({
			turns: [{ id: " ", status: "inProgress" }],
		}),
		"ambiguous active turn": childThread({
			turns: [
				{ id: "one", status: "inProgress" },
				{ id: "two", status: "inProgress" },
			],
		}),
	})) {
		it(`refuses ${name} without sending an interrupt`, async () => {
			const proxy = fakeProxy({ [target.childThreadId]: child });
			await expect(
				controlSubagent(target, {
					mode: "stop",
					env: process.env,
					isStillCurrent: () => true,
					spawnProxy: proxy.spawnProxy,
				}),
			).rejects.toThrow();
			expect(
				proxy.requests().some((request) => request.method === "turn/interrupt"),
			).toBe(false);
			expect(proxy.children[0]?.exitCode).not.toBeNull();
		});
	}

	it("refuses to target the main agent", async () => {
		const proxy = fakeProxy({ [target.childThreadId]: childThread() });
		await expect(
			controlSubagent(
				{ ...target, childThreadId: target.parentThreadId },
				{
					mode: "stop",
					env: process.env,
					isStillCurrent: () => true,
					spawnProxy: proxy.spawnProxy,
				},
			),
		).rejects.toThrow("parent agent");
		expect(
			proxy.requests().some((request) => request.method === "turn/interrupt"),
		).toBe(false);
	});

	it("refuses a stale binding after asynchronous validation", async () => {
		const proxy = fakeProxy({ [target.childThreadId]: childThread() });
		await expect(
			controlSubagent(target, {
				mode: "stop",
				env: process.env,
				isStillCurrent: () => false,
				spawnProxy: proxy.spawnProxy,
			}),
		).rejects.toThrow("session has changed");
		expect(
			proxy.requests().some((request) => request.method === "turn/interrupt"),
		).toBe(false);
	});

	it("does not retry with a blank turn or interrupt the parent when a turn races to completion", async () => {
		const proxy = fakeProxy(
			{ [target.childThreadId]: childThread() },
			"reject-interrupt",
		);
		await expect(
			controlSubagent(target, {
				mode: "stop",
				env: process.env,
				isStillCurrent: () => true,
				spawnProxy: proxy.spawnProxy,
			}),
		).rejects.toThrow("rejected");
		expect(
			proxy
				.requests()
				.filter((request) => request.method === "turn/interrupt")
				.map((request) => request.params),
		).toEqual([
			{ threadId: target.childThreadId, turnId: "child-active-turn" },
		]);
	});

	for (const mode of ["timeout", "exit", "invalid"]) {
		it(`closes the proxy after ${mode}`, async () => {
			const proxy = fakeProxy({ [target.childThreadId]: childThread() }, mode);
			await expect(
				controlSubagent(target, {
					mode: "stop",
					env: process.env,
					isStillCurrent: () => true,
					spawnProxy: proxy.spawnProxy,
					timeoutMs: 200,
				}),
			).rejects.toThrow();
			expect(
				proxy.requests().some((request) => request.method === "turn/interrupt"),
			).toBe(false);
			expect(
				proxy.children[0]?.exitCode !== null ||
					proxy.children[0]?.signalCode !== null,
			).toBe(true);
		});
	}

	it("kills only its own unresponsive proxy when closing", async () => {
		const proxy = fakeProxy(
			{ [target.childThreadId]: childThread() },
			"ignore-eof",
		);
		await controlSubagent(target, {
			mode: "stop",
			env: process.env,
			isStillCurrent: () => true,
			spawnProxy: proxy.spawnProxy,
		});
		expect(proxy.children[0]?.signalCode).toBe("SIGKILL");
		expect(
			proxy
				.requests()
				.filter((request) => request.method === "turn/interrupt")
				.map((request) => request.params?.threadId),
		).toEqual([target.childThreadId]);
	});

	it("fails safely when Codex is not installed", async () => {
		await expect(
			controlSubagent(target, {
				mode: "stop",
				env: process.env,
				isStillCurrent: () => true,
				spawnProxy: () =>
					spawn("/nonexistent/superset-codex-control-test", [], {
						stdio: "pipe",
					}),
			}),
		).rejects.toThrow("unavailable");
	});
});

describe("subagent control target", () => {
	const binding: TerminalAgentBinding = {
		terminalId: "terminal",
		workspaceId: "workspace",
		agentId: "codex",
		agentSessionId: target.parentThreadId,
		startedAt: 1,
		lastEventAt: 2,
		lastEventType: "Start",
	};
	const subagent: TerminalSubagent = {
		id: target.childThreadId,
		startedAt: 2,
		lastEventAt: 3,
		transcriptPath: `${target.codexHome}/sessions/2026/09/23/rollout-child.jsonl`,
	};

	it("uses the captured transcript home instead of the currently selected account", () => {
		expect(getSubagentStopTarget(binding, subagent)).toEqual(target);
	});

	it("uses a captured account directory and the child's session ID", () => {
		expect(
			getSubagentStopTarget(
				{
					...binding,
					account: {
						agent: "codex",
						selection: "/profile",
						directory: target.codexHome,
						credentialKind: "subscription",
						identity: "id",
					},
				},
				{
					...subagent,
					id: "display-id",
					sessionId: target.childThreadId,
					transcriptPath: undefined,
				},
			),
		).toEqual(target);
	});

	it("refuses unsupported, ended, parent, or unattributed sessions", () => {
		expect(
			getSubagentStopTarget({ ...binding, agentId: "claude" }, subagent),
		).toBeUndefined();
		expect(
			getSubagentStopTarget({ ...binding, endedAt: 4 }, subagent),
		).toBeUndefined();
		expect(
			getSubagentStopTarget(binding, { ...subagent, endedAt: 4 }),
		).toBeUndefined();
		expect(
			getSubagentStopTarget(binding, {
				...subagent,
				sessionId: binding.agentSessionId,
			}),
		).toBeUndefined();
		expect(
			getSubagentStopTarget(binding, {
				...subagent,
				transcriptPath: undefined,
			}),
		).toBeUndefined();
		expect(
			getSubagentStopTarget(binding, {
				...subagent,
				transcriptPath: "relative/sessions/2026/09/23/rollout.jsonl",
			}),
		).toBeUndefined();
	});
});
