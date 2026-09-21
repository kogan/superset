import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createFeatureWorktreeScenario } from "../helpers/scenarios";

test.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
	"ports API discovers adopted-worktree servers and closes only the requested server",
	async () => {
		const scenario = await createFeatureWorktreeScenario();
		const child = spawn(
			"node",
			[
				"-e",
				'const s=require("net").createServer(); s.listen(0,"127.0.0.1",()=>console.log(s.address().port));',
			],
			{
				cwd: scenario.worktreePath,
				env: { PATH: process.env.PATH },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		try {
			const port = await new Promise<number>((resolve, reject) => {
				child.once("error", reject);
				child.stdout?.once("data", (data) =>
					resolve(Number(String(data).trim())),
				);
			});
			const { host, featureWorkspaceId, workspaceId } = scenario;
			const result = await host.trpc.ports.getAll.query({
				workspaceIds: [featureWorkspaceId],
			});
			const found = result.find((entry) => entry.port === port);
			expect(found).toMatchObject({
				workspaceId: featureWorkspaceId,
				pid: child.pid,
			});
			expect(
				await host.trpc.ports.getAll.query({ workspaceIds: [workspaceId] }),
			).toEqual([]);
			if (!found) throw new Error("Missing worktree server");
			const closed = await host.trpc.ports.kill.mutate({
				workspaceId: featureWorkspaceId,
				terminalId: found.terminalId,
				port,
			});
			expect(closed.success).toBe(true);
		} finally {
			child.kill();
			await scenario.dispose();
		}
	},
	30000,
);
