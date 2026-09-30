import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../../db";
import * as schema from "../../db/schema";
import { terminalSessions } from "../../db/schema";
import { clearStrictShellEnvCache } from "../../terminal/clean-shell-env";
import { __setAccountShellForTesting } from "../../terminal/user-shell";
import { terminalAgentsRouter } from "../../trpc/router/terminal-agents/terminal-agents";
import type { HostServiceContext } from "../../types";
import { TerminalAgentStore } from "../store";

const directories: string[] = [];
const databases: Database[] = [];

afterEach(() => {
	__setAccountShellForTesting(undefined);
	clearStrictShellEnvCache();
	for (const db of databases.splice(0)) db.close();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function setup({
	agentId = "codex",
	authenticated = true,
}: {
	agentId?: "codex" | "claude";
	authenticated?: boolean;
} = {}) {
	const sqlite = new Database(":memory:");
	databases.push(sqlite);
	const db = drizzle(sqlite, { schema });
	migrate(db, {
		migrationsFolder: resolve(import.meta.dir, "../../../drizzle"),
	});
	db.insert(terminalSessions)
		.values({
			id: "terminal",
			originWorkspaceId: "workspace",
			status: "active",
			createdAt: Date.now(),
		})
		.run();
	const store = new TerminalAgentStore();
	const now = Date.now();
	store.recordEvent({
		workspaceId: "workspace",
		terminalId: "terminal",
		agentId,
		agentSessionId: "parent",
		eventType: "Start",
		occurredAt: now,
	});
	for (const subagentId of ["child-one", "child-two"]) {
		store.recordSubagentEvent({
			workspaceId: "workspace",
			terminalId: "terminal",
			subagentId,
			eventType: "SubagentStart",
			transcriptPath:
				"/captured/codex-home/sessions/2026/09/23/rollout-child.jsonl",
			occurredAt: now + 1,
		});
	}
	const broadcasts: string[] = [];
	const ctx = {
		db: db as unknown as HostDb,
		terminalAgentStore: store,
		isAuthenticated: authenticated,
		eventBus: {
			broadcastAgentBindingsChanged: (event: { workspaceId: string }) =>
				broadcasts.push(event.workspaceId),
		},
	} as unknown as HostServiceContext;
	return {
		caller: terminalAgentsRouter.createCaller(ctx),
		store,
		broadcasts,
		db,
	};
}

function installFixtureProxy() {
	const directory = mkdtempSync(join(tmpdir(), "superset-child-stop-router-"));
	directories.push(directory);
	const log = join(directory, "requests.jsonl");
	const shell = join(directory, "shell");
	writeFileSync(
		shell,
		`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(`__SUPERSET_SHELL_ENV__\nPATH=${directory}\nHOME=${directory}\n__SUPERSET_SHELL_ENV__`)});\n`,
		{ mode: 0o755 },
	);
	writeFileSync(
		join(directory, "codex"),
		`#!${process.execPath}
const {appendFileSync} = require("node:fs");
const {createInterface} = require("node:readline");
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(["app-server", "proxy"])) process.exit(2);
if (process.env.CODEX_HOME !== "/captured/codex-home") process.exit(3);
createInterface({input:process.stdin}).on("line", line => {
  appendFileSync(${JSON.stringify(log)}, line + "\\n");
  const request = JSON.parse(line);
  if (request.method === "initialized") return;
  const result = request.method === "thread/read" ? {thread:{id:request.params.threadId,parentThreadId:"parent",status:{type:"active"},turns:[{id:"turn-"+request.params.threadId,status:"inProgress"}]}} : {};
  process.stdout.write(JSON.stringify({id:request.id,result})+"\\n");
});
`,
		{ mode: 0o755 },
	);
	clearStrictShellEnvCache();
	__setAccountShellForTesting(shell);
	return () =>
		readFileSync(log, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
}

describe("subagent stop router", () => {
	it("keeps the main agent running after stopping every child", async () => {
		const requests = installFixtureProxy();
		const { caller, store, broadcasts } = setup();
		const parentBefore = store.get("terminal");
		for (const subagentId of ["child-one", "child-two"]) {
			const input = {
				workspaceId: "workspace",
				terminalId: "terminal",
				subagentId,
			};
			expect(await caller.subagentStopCapability(input)).toEqual({
				supported: true,
			});
			expect(await caller.stopSubagent(input)).toEqual({ subagentId });
			expect(store.getSubagent("terminal", subagentId)?.endedAt).toBeDefined();
		}
		const parentAfter = store.get("terminal");
		expect(parentAfter?.agentSessionId).toBe(parentBefore?.agentSessionId);
		expect(parentAfter?.lastEventAt).toBe(parentBefore?.lastEventAt);
		expect(parentAfter?.lastEventType).toBe("Start");
		expect(parentAfter?.endedAt).toBeUndefined();
		expect(parentAfter?.subagents).toBeUndefined();
		expect(broadcasts).toEqual(["workspace", "workspace"]);
		expect(
			requests()
				.filter((request) => request.method === "turn/interrupt")
				.map((request) => request.params),
		).toEqual([
			{ threadId: "child-one", turnId: "turn-child-one" },
			{ threadId: "child-two", turnId: "turn-child-two" },
		]);
	});

	it("rejects unauthenticated control requests", async () => {
		const { caller } = setup({ authenticated: false });
		const input = {
			workspaceId: "workspace",
			terminalId: "terminal",
			subagentId: "child-one",
		};
		await expect(caller.subagentStopCapability(input)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
		await expect(caller.stopSubagent(input)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("rejects workspace mismatch and unknown children without touching the parent", async () => {
		const { caller, store } = setup();
		const before = store.get("terminal");
		for (const input of [
			{
				workspaceId: "other-workspace",
				terminalId: "terminal",
				subagentId: "child-one",
			},
			{
				workspaceId: "workspace",
				terminalId: "other-terminal",
				subagentId: "child-one",
			},
			{
				workspaceId: "workspace",
				terminalId: "terminal",
				subagentId: "unknown-child",
			},
		]) {
			expect(await caller.subagentStopCapability(input)).toEqual({
				supported: false,
			});
			await expect(caller.stopSubagent(input)).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		}
		expect(store.get("terminal")).toEqual(before);
	});

	it("reports unsupported agent control without interrupting its terminal", async () => {
		const { caller, store } = setup({ agentId: "claude" });
		const before = store.get("terminal");
		const input = {
			workspaceId: "workspace",
			terminalId: "terminal",
			subagentId: "child-one",
		};
		expect(await caller.subagentStopCapability(input)).toEqual({
			supported: false,
		});
		await expect(caller.stopSubagent(input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(store.get("terminal")).toEqual(before);
	});
});
