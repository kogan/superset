import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useState } from "react";
import { useProjectQueryTargets } from "renderer/routes/_authenticated/_dashboard/hooks/useProjectQueryTargets";
import { usePullRequestsFilterStore } from "renderer/routes/_authenticated/_dashboard/pull-requests/stores/pullRequestsFilterStore";
import { TeamMembersDialog } from "renderer/routes/_authenticated/components/TeamMembersDialog";

export function PullRequestTeamSettings() {
	const members = usePullRequestsFilterStore((state) => state.teamMembers);
	const setTeamMembers = usePullRequestsFilterStore(
		(state) => state.setTeamMembers,
	);
	const { targets } = useProjectQueryTargets([]);
	const [editing, setEditing] = useState(false);
	return (
		<section className="mb-6 rounded-lg border p-5">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-sm font-medium">
						<Trans>My team</Trans>
					</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						<Trans>
							Choose up to 20 people for your My team PR filter. Saved on this
							Mac.
						</Trans>
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
					<Trans>Edit team</Trans>
				</Button>
			</div>
			{members.length ? (
				<ul className="mt-3 flex flex-wrap gap-2">
					{members.map(({ login, name }) => (
						<li
							key={login}
							title={name}
							className="rounded-md bg-muted px-2 py-1 text-xs"
						>
							@{login}
						</li>
					))}
				</ul>
			) : (
				<p className="mt-3 text-sm text-muted-foreground">
					<Trans>No team members yet.</Trans>
				</p>
			)}
			{editing && (
				<TeamMembersDialog
					members={members}
					projectTargets={targets}
					onClose={() => setEditing(false)}
					onSave={(next) => {
						setTeamMembers(next);
						setEditing(false);
					}}
				/>
			)}
		</section>
	);
}
