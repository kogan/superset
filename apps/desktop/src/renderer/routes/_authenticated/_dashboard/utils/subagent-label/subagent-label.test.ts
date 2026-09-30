import { expect, test } from "bun:test";
import { getSubagentLabel } from "./subagent-label";

test("custom names override task descriptions, then useful roles", () => {
	expect(
		getSubagentLabel({
			id: "child",
			agentType: "default",
			description: "Review payments",
			customName: "Checkout review",
		}),
	).toBe("Checkout review");
	expect(
		getSubagentLabel({
			id: "child",
			agentType: "default",
			description: "Review payments",
		}),
	).toBe("Review payments");
	expect(getSubagentLabel({ id: "child", agentType: "Explore" })).toBe(
		"Explore",
	);
});

test("unnamed subagents never display random identifier fragments", () => {
	for (const agentType of [
		undefined,
		"default",
		"general-purpose",
		"worker",
		"subagent",
	]) {
		expect(
			getSubagentLabel({
				id: "01a0bef7-7643-7363-8d0a-2ecfe716b372",
				agentType,
			}),
		).toBe("Subagent");
	}
	expect(getSubagentLabel({ id: "01a0bef7-7643-7363-8d0a-2ecfabcd1234" })).toBe(
		"Subagent",
	);
});
