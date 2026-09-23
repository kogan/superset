import { expect, test } from "bun:test";
import { isNativeClipboardShortcut } from "./clipboard-shortcuts";

const plain = {
	key: "v",
	meta: false,
	control: false,
	alt: false,
	shift: false,
};

test("allows native clipboard roles with the platform command modifier", () => {
	for (const key of ["c", "X", "v"]) {
		expect(
			isNativeClipboardShortcut({ ...plain, key, meta: true }, "darwin"),
		).toBe(true);
		expect(
			isNativeClipboardShortcut({ ...plain, key, control: true }, "linux"),
		).toBe(true);
		expect(
			isNativeClipboardShortcut({ ...plain, key, control: true }, "win32"),
		).toBe(true);
	}
});

test("keeps IDE commands, alternate paste, and macOS terminal Ctrl+C inside the guest", () => {
	for (const key of ["a", "z", "w", "p", "s", "F5"]) {
		expect(
			isNativeClipboardShortcut({ ...plain, key, meta: true }, "darwin"),
		).toBe(false);
	}
	expect(
		isNativeClipboardShortcut({ ...plain, meta: true, shift: true }, "darwin"),
	).toBe(false);
	expect(
		isNativeClipboardShortcut({ ...plain, meta: true, alt: true }, "darwin"),
	).toBe(false);
	expect(
		isNativeClipboardShortcut({ ...plain, key: "c", control: true }, "darwin"),
	).toBe(false);
	expect(isNativeClipboardShortcut({ ...plain, meta: true }, "win32")).toBe(
		false,
	);
	expect(isNativeClipboardShortcut(plain, "darwin")).toBe(false);
});
