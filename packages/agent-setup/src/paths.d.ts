/**
 * Canonical Superset home directory resolution, shared by every process that
 * provisions or consumes ~/.superset artifacts (Electron main, host-service,
 * CLI). Resolved lazily because the desktop rewrites SUPERSET_HOME_DIR into
 * process.env during boot (dev-workspace builds use ~/.superset-<workspace>),
 * and headless hosts may not have it set at all.
 */
export declare function resolveSupersetHomeDir(): string;
/**
 * Node reads $HOME on every os.homedir() call on POSIX; bun reads it once at
 * startup. Reading it here keeps both runtimes the same.
 */
export declare function resolveUserHomeDir(): string;
export declare function getBinDir(): string;
export declare function getHooksDir(): string;
export declare function getZshDir(): string;
export declare function getBashDir(): string;
export declare function getOpenCodeConfigDir(): string;
export declare function getOpenCodePluginDir(): string;
//# sourceMappingURL=paths.d.ts.map