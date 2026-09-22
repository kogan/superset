import { expect, test } from "bun:test";
import { isUnpackagedStandaloneRuntime } from "./auto-update-mode";

test("allows packaged standalone installs to use automatic updates", () => {
	expect(
		isUnpackagedStandaloneRuntime({ isStandalone: true, isPackaged: true }),
	).toBe(false);
	expect(
		isUnpackagedStandaloneRuntime({ isStandalone: true, isPackaged: false }),
	).toBe(true);
});
