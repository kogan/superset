export declare function setAgentSetupTemplatesDir(dir: string): void;
export declare function getAgentSetupTemplatesDir(): string;
export declare function getTemplatePath(name: string): string;
/**
 * The repo's Claude Code plugin (skills + commands). The desktop and the CLI
 * copy it alone to templates/plugin; the sandbox tarball carries it inside the
 * marketplace tree instead, and running from TS source performs no copy.
 */
export declare function getBundledPluginDir(): string;
/**
 * Every installable first-party tree. Only the sandbox tarball overlays it at
 * templates/plugins — the desktop and the CLI ship `superset` alone — so
 * outside host-service this falls back to the repo and exists only from source.
 */
export declare function getBundledMarketplaceDir(): string;
/**
 * Default port of the desktop's v1 localhost notifications server, baked into
 * hook scripts as the v1 fallback endpoint. Kept overridable via the same env
 * var the desktop uses so dev workspaces stay isolated.
 */
export declare function getV1NotificationsPort(): number;
//# sourceMappingURL=config.d.ts.map