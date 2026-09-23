import { afterEach, expect, mock, test } from "bun:test";

const closeGuest = mock(async (_input: { paneId: string }) => true);
const release = mock(async () => {});
mock.module("renderer/lib/trpc-client", () => ({
	electronTrpcClient: {
		ide: { close: { mutate: closeGuest }, release: { mutate: release } },
	},
}));
mock.module("renderer/lib/pointer-passthrough", () => ({
	pointerPassthrough: {},
}));

const { ideRuntimeRegistry: registry } = await import("./ideRuntimeRegistry");

afterEach(async () => {
	await registry.close("clean");
	await registry.close("dirty");
	closeGuest.mockReset();
	release.mockClear();
});

async function openViews() {
	for (const paneId of ["clean", "dirty"]) {
		await registry.open(paneId, async () => ({
			url: "http://127.0.0.1:1234",
			partition: paneId,
			sessionId: paneId,
		}));
	}
	return {
		clean: registry.getState("clean"),
		dirty: registry.getState("dirty"),
	};
}

test("a veto restores earlier closed views without releasing sessions or the dirty view", async () => {
	const before = await openViews();
	closeGuest.mockImplementation(async ({ paneId }) => paneId !== "dirty");
	expect(await registry.canCloseAll(["clean", "dirty"])).toBe(false);
	expect(registry.getState("clean")).toEqual(before.clean);
	expect(registry.getState("clean")).not.toBe(before.clean);
	expect(registry.getState("dirty")).toBe(before.dirty);
	expect(release).not.toHaveBeenCalled();
});

test("an IPC failure also restores earlier views", async () => {
	const before = await openViews();
	closeGuest.mockImplementation(async ({ paneId }) => {
		if (paneId === "dirty") throw new Error("Disconnected");
		return true;
	});
	await expect(registry.canCloseAll(["clean", "dirty"])).rejects.toThrow(
		"Disconnected",
	);
	expect(registry.getState("clean")).not.toBe(before.clean);
	expect(registry.getState("clean")).toEqual(before.clean);
	expect(release).not.toHaveBeenCalled();
});

test("a successful group close does not recreate its views", async () => {
	const before = await openViews();
	closeGuest.mockImplementation(async () => true);
	expect(await registry.canCloseAll(["clean", "dirty"])).toBe(true);
	expect(registry.getState("clean")).toBe(before.clean);
	expect(registry.getState("dirty")).toBe(before.dirty);
});

test("file requests queue before mount and duplicate effects cannot dispatch twice", async () => {
	const first = { filePath: "/first.ts", position: { line: 3, column: 7 } };
	const second = { filePath: "/second.ts" };
	registry.queueFile("clean", first);
	registry.queueFile("clean", second);
	const opened: string[] = [];
	const pending = Promise.withResolvers<void>();
	const open = registry.openNextFile("clean", async (request) => {
		opened.push(request.filePath);
		await pending.promise;
	});
	await registry.openNextFile("clean", async () => {
		throw new Error("Duplicate effect dispatched a request");
	});
	expect(registry.getPendingFile("clean")).toEqual(first);
	pending.resolve();
	await open;
	expect(registry.getPendingFile("clean")).toEqual(second);
	await registry.openNextFile("clean", async (request) => {
		opened.push(request.filePath);
	});
	expect(opened).toEqual(["/first.ts", "/second.ts"]);
	expect(registry.getPendingFile("clean")).toBeNull();
});

test("closing before mount or during a file open drops transient requests", async () => {
	registry.queueFile("clean", { filePath: "/first.ts" });
	const pending = Promise.withResolvers<void>();
	const open = registry.openNextFile("clean", async () => pending.promise);
	await registry.close("clean");
	expect(registry.getPendingFile("clean")).toBeNull();
	pending.resolve();
	await open;
	expect(registry.getPendingFile("clean")).toBeNull();
});

test("an open-file failure leaves the IDE view and later requests intact", async () => {
	await openViews();
	const before = registry.getState("clean");
	registry.queueFile("clean", { filePath: "/missing.ts" });
	const second = { filePath: "/valid.ts" };
	registry.queueFile("clean", second);
	await expect(
		registry.openNextFile("clean", async () => {
			throw new Error("File not found");
		}),
	).rejects.toThrow("File not found");
	expect(registry.getState("clean")).toBe(before);
	expect(registry.getPendingFile("clean")).toEqual(second);
});

test("repeated requests receive distinct snapshots and a stopped IDE restarts on file navigation", async () => {
	await registry.stop("clean");
	const request = { filePath: "/same.ts", position: { line: 42 } };
	registry.queueFile("clean", request);
	expect(registry.getState("clean").status).toBe("idle");
	const first = registry.getPendingFile("clean");
	registry.queueFile("clean", request);
	await registry.openNextFile("clean", async () => {});
	expect(registry.getPendingFile("clean")).toEqual(first);
	expect(registry.getPendingFile("clean")).not.toBe(first);
});
