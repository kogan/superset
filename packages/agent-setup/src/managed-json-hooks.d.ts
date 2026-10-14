/**
 * Shared merge/remove engine for agents whose global config is a JSON file
 * mapping event names to arrays of hook entries (Claude, Codex, Droid,
 * Mastra, Cursor, Gemini). A spec describes the parts that genuinely differ
 * per agent: where the file lives, where the event map sits, what entries we
 * register, and how to recognize/strip our own entries.
 */
export interface ManagedJsonHooksSpec<Entry> {
    /** File label for setup logs, e.g. "Claude settings.json". */
    fileLabel: string;
    /** Agent label for teardown logs, e.g. "Claude". */
    agentLabel: string;
    getFilePath(): string;
    /**
     * Key of the event→entries map on the root object, or null when the root
     * object itself is the event map (Mastra).
     */
    eventsContainerKey: string | null;
    /** Managed entries appended per event after stale ones are stripped. */
    desiredEntriesByEvent: Record<string, Entry[]>;
    /**
     * Strips Superset-managed content from one existing entry. Returns the
     * entry unchanged when it is user-owned, a cleaned copy when it mixed user
     * and managed inner hooks, or null when nothing user-owned remains.
     */
    cleanEntry(entry: Entry): Entry | null;
    /** Root defaults enforced on merge (e.g. Cursor's `version: 1`). */
    applyRootDefaults?(root: Record<string, unknown>): void;
    /** Whether teardown deletes the events container key once empty. */
    dropEmptyContainerOnRemove?: boolean;
}
/**
 * Merged config content: existing user entries preserved, stale managed
 * entries stripped everywhere (including events we no longer manage), and the
 * current managed entries appended per event. Returns null when the existing
 * file cannot be read as a JSON object — never clobber a file we can't parse.
 */
export declare function getManagedJsonHooksContent<Entry>(spec: ManagedJsonHooksSpec<Entry>): string | null;
export declare function ensureManagedJsonHooks<Entry>(spec: ManagedJsonHooksSpec<Entry>): void;
/**
 * Removes Superset-managed entries, preserving user entries byte-for-byte.
 * No-op when the file does not exist — teardown must never create files.
 */
export declare function removeManagedJsonHooks<Entry>(spec: ManagedJsonHooksSpec<Entry>): void;
/**
 * Entry cleaner for the nested definition shape shared by Claude, Codex, and
 * Droid: `{ matcher?, hooks: [{ type, command }] }`. Filters managed inner
 * hooks, preserving user hooks that share a definition with ours.
 */
export declare function cleanNestedHookDefinition<D extends {
    hooks?: Array<{
        command: string;
    }>;
}>(definition: D, isManagedCommand: (command: string) => boolean): D | null;
/**
 * Builds the desired one-entry-per-event map for the nested definition shape.
 */
export declare function buildNestedDesiredEntries<D>(events: Record<string, {
    matcher?: string;
}>, command: string): Record<string, D[]>;
//# sourceMappingURL=managed-json-hooks.d.ts.map