import type { CloudWorkspaceRow } from "renderer/hooks/useCloudWorkspaces";
import { sortByLastAgentMessage } from "renderer/routes/_authenticated/_dashboard/utils/buildCloudSidebar";

type GroupedWorkspace = Pick<
	CloudWorkspaceRow,
	"id" | "createdBy" | "presence" | "agentStatusAt" | "createdAt"
>;
type Person = NonNullable<CloudWorkspaceRow["createdBy"]>;

export type CloudWorkspaceSort = "activity" | "created";

interface CloudWorkspaceGroup<Workspace extends GroupedWorkspace> {
	person: Person | null;
	workspaces: Workspace[];
}

type SortableWorkspace = Pick<CloudWorkspaceRow, "agentStatusAt" | "createdAt">;

export interface CloudWorkspacePeriod {
	unit: "day" | "week" | "month" | "year";
	count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const sortedAt = (workspace: SortableWorkspace, sort: CloudWorkspaceSort) =>
	sort === "created"
		? workspace.createdAt
		: (workspace.agentStatusAt ?? workspace.createdAt);

const localMidnight = (date: Date) =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

function periodOf(date: Date, now: Date): CloudWorkspacePeriod {
	const days = Math.max(
		0,
		Math.round((localMidnight(now) - localMidnight(date)) / DAY_MS),
	);
	if (days < 7) return { unit: "day", count: days };
	if (days < 30) return { unit: "week", count: Math.floor(days / 7) };
	if (days < 365) return { unit: "month", count: Math.floor(days / 30) };
	return { unit: "year", count: Math.floor(days / 365) };
}

export function groupCloudWorkspacesByTime<
	Workspace extends SortableWorkspace,
>({
	workspaces,
	now,
	sort,
}: {
	workspaces: Workspace[];
	now: Date;
	sort: CloudWorkspaceSort;
}): { period: CloudWorkspacePeriod; workspaces: Workspace[] }[] {
	const groups = new Map<
		string,
		{ period: CloudWorkspacePeriod; workspaces: Workspace[] }
	>();
	for (const workspace of sortCloudWorkspaces(workspaces, sort)) {
		const period = periodOf(sortedAt(workspace, sort), now);
		const key = `${period.unit}:${period.count}`;
		const group = groups.get(key) ?? { period, workspaces: [] };
		group.workspaces.push(workspace);
		groups.set(key, group);
	}
	return [...groups.values()];
}

export function sortCloudWorkspaces<Workspace extends SortableWorkspace>(
	workspaces: Workspace[],
	sort: CloudWorkspaceSort,
): Workspace[] {
	return sort === "created"
		? [...workspaces].sort(
				(left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
			)
		: sortByLastAgentMessage(workspaces);
}

export function groupCloudWorkspaces<Workspace extends GroupedWorkspace>({
	workspaces,
	userId,
	now,
	activeWithinMs,
	sort = "activity",
}: {
	workspaces: Workspace[];
	userId: string | null;
	now: Date;
	activeWithinMs: number;
	sort?: CloudWorkspaceSort;
}): CloudWorkspaceGroup<Workspace>[] {
	const groups = new Map<string, CloudWorkspaceGroup<Workspace>>();
	const ordered = sortCloudWorkspaces(workspaces, sort);
	for (const workspace of ordered) {
		const inItNow = workspace.presence.find(
			(person) => now.getTime() - person.lastSeenAt.getTime() < activeWithinMs,
		);
		const person: Person | null = inItNow
			? { userId: inItNow.userId, name: inItNow.name, image: inItNow.image }
			: workspace.createdBy;
		const key = person?.userId ?? "";
		const group = groups.get(key) ?? { person, workspaces: [] };
		group.workspaces.push(workspace);
		groups.set(key, group);
	}
	return [...groups.values()].sort((left, right) => {
		if (left.person?.userId === userId) return -1;
		if (right.person?.userId === userId) return 1;
		if (!left.person) return 1;
		if (!right.person) return -1;
		return left.person.name.localeCompare(right.person.name);
	});
}
