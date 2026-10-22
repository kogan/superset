/**
 * A pull request as the stack view needs it — the GitHub head/base branch
 * names are what chain the stack together.
 */
export interface StackPullRequest {
	number: number;
	title: string;
	/** Branch this PR merges FROM. */
	headRef: string;
	/** Branch this PR merges INTO — its parent in the stack. */
	baseRef: string;
	url: string;
	isDraft: boolean;
	/** GitHub PR state, lower-cased ("open" | "closed"). */
	state: string;
}

export interface StackNode extends StackPullRequest {
	/** The branch currently checked out in the worktree. */
	isCurrent: boolean;
}

/**
 * Build the stack for the checked-out branch: start at the PR whose head is
 * `currentHeadRef` and walk down `baseRef` pointers, so a chain of dependent
 * PRs (C → B → A → trunk) is returned tip-first — the current branch at
 * index 0, the PR nearest trunk last.
 *
 * Returns `[]` when the current branch has no PR. A length of 1 means the
 * branch targets trunk directly (not a stack); the view treats that as "no
 * stack". Trunk itself is not a node — it is wherever the walk runs off the
 * set of known PR heads.
 */
export function buildStack(
	prs: readonly StackPullRequest[],
	currentHeadRef: string,
): StackNode[] {
	const byHead = new Map<string, StackPullRequest>();
	for (const pr of prs) {
		// First writer wins: if two open PRs share a head branch, keep the
		// earliest so the walk stays deterministic.
		if (!byHead.has(pr.headRef)) byHead.set(pr.headRef, pr);
	}

	const start = byHead.get(currentHeadRef);
	if (!start) return [];

	const chain: StackNode[] = [];
	const seen = new Set<string>();
	let node: StackPullRequest | undefined = start;
	while (node && !seen.has(node.headRef)) {
		seen.add(node.headRef);
		chain.push({ ...node, isCurrent: node.headRef === currentHeadRef });
		node = byHead.get(node.baseRef);
	}
	return chain;
}
