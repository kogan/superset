import { expect, test } from "bun:test";
import { singleFlight } from "./singleFlight";

test("one API owner skips overlapping work and releases after completion/failure", async () => {
	let finish: (() => void) | undefined;
	const blocked = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const first = singleFlight("fixture-job", async () => {
		await blocked;
		return 42;
	});
	expect(await singleFlight("fixture-job", async () => 99)).toEqual({
		ran: false,
	});
	expect(await singleFlight("other-fixture-job", async () => 1)).toEqual({
		ran: true,
		result: 1,
	});
	finish?.();
	expect(await first).toEqual({ ran: true, result: 42 });
	await expect(
		singleFlight("fixture-job", async () => {
			throw new Error("fixture");
		}),
	).rejects.toThrow("fixture");
	expect(await singleFlight("fixture-job", async () => 2)).toEqual({
		ran: true,
		result: 2,
	});
});
