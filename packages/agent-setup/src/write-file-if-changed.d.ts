/**
 * The inode a tmp-file + rename write to `filePath` must land on: the link's
 * target when it is a symlink, the path itself otherwise. rename never
 * follows the last path component, so a writer that skips this replaces a
 * user's link into a dotfiles repo with a regular file and the two copies
 * silently drift from then on. Resolving also keeps the temp file beside its
 * real target, so a link across filesystems still renames.
 *
 * ENOENT (absent, or a dangling link) and ELOOP (a cyclic link) leave no
 * inode to write through, so the path itself is the caller's to claim.
 */
export declare function resolveWriteTarget(filePath: string): string;
/**
 * Idempotent, atomic file write. Skips the write when content is unchanged
 * (callers rely on this to keep re-provisioning from churning mtimes), and
 * writes via temp-file + rename otherwise. Atomicity matters because several
 * provisioners can run concurrently on one machine (the desktop plus one CLI
 * host-service per org), and some targets are user-owned configs
 * (~/.claude/settings.json) where a torn write would break the user's agent
 * until they repair it by hand — the managed-hooks merge skips unparseable
 * files rather than rewriting them.
 *
 * Writes land on the symlink's target (see resolveWriteTarget), so a config
 * linked into a read-only store — Nix home-manager and friends — now fails
 * loudly instead of being flattened into a regular file that would break that
 * tool's next activation. Callers isolate setup actions, so the failure costs
 * this one config.
 */
export declare function writeFileIfChanged(filePath: string, content: string, mode: number): boolean;
//# sourceMappingURL=write-file-if-changed.d.ts.map