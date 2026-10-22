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
 * Build the full stack that CONTAINS the checked-out branch, so switching the
 * worktree between branches moves the "you are here" marker without dropping
 * the PRs above it. From the PR whose head is `currentHeadRef` we walk UP to
 * the tip (the PR nothing else is built on), then DOWN its `baseRef` chain to
 * trunk, returning tip-first — tip at index 0, the PR nearest trunk last, and
 * `isCurrent` on whichever node is the checked-out branch.
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
	// headRef → PR; baseRef → the PR built on top of it (its child). First
	// writer wins on collisions so the walk is deterministic.
	const byHead = new Map<string, StackPullRequest>();
	const byBase = new Map<string, StackPullRequest>();
	for (const pr of prs) {
		if (!byHead.has(pr.headRef)) byHead.set(pr.headRef, pr);
		if (!byBase.has(pr.baseRef)) byBase.set(pr.baseRef, pr);
	}

	const start = byHead.get(currentHeadRef);
	if (!start) return [];

	// Walk up to the tip (the PR nothing else bases on).
	let tip = start;
	const upSeen = new Set<string>([tip.headRef]);
	for (;;) {
		const child = byBase.get(tip.headRef);
		if (!child || upSeen.has(child.headRef)) break;
		upSeen.add(child.headRef);
		tip = child;
	}

	// Walk down from the tip to trunk.
	const chain: StackNode[] = [];
	const seen = new Set<string>();
	let node: StackPullRequest | undefined = tip;
	while (node && !seen.has(node.headRef)) {
		seen.add(node.headRef);
		chain.push({ ...node, isCurrent: node.headRef === currentHeadRef });
		node = byHead.get(node.baseRef);
	}
	return chain;
}
