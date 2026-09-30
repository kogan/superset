import { Trans, useLingui } from "@lingui/react/macro";
import { useFormat } from "@superset/i18n/react";
import { resolveProjectIconUrl } from "renderer/hooks/host-projects/resolveProjectIconUrl";
import { CloudWorkspacePersonLink } from "renderer/routes/_authenticated/_dashboard/components/CloudWorkspacePersonLink";
import { EditableTitle } from "renderer/routes/_authenticated/_dashboard/components/EditableTitle";
import { ProjectThumbnail } from "renderer/routes/_authenticated/components/ProjectThumbnail";
import type { CloudWorkspaceRecord } from "../../../../types";

interface CloudWorkspaceRecordHeaderProps {
	workspace: Pick<
		CloudWorkspaceRecord,
		"name" | "createdAt" | "createdBy" | "repositories"
	>;
	now: Date;
	onOpenPerson: (userId: string) => void;
	onRename: (name: string) => void;
}

export function CloudWorkspaceRecordHeader({
	workspace,
	now,
	onOpenPerson,
	onRename,
}: CloudWorkspaceRecordHeaderProps) {
	const { t } = useLingui();
	const { formatCompactRelativeTime } = useFormat();
	const { createdBy: owner } = workspace;
	const primary = workspace.repositories[0]?.fullName ?? null;
	const repoOwner = primary?.split("/")[0];
	const createdAgo = formatCompactRelativeTime(workspace.createdAt, now);
	return (
		<div>
			<h1 className="m-0 flex items-start gap-2.5">
				{primary && (
					<ProjectThumbnail
						projectName={primary}
						iconUrl={resolveProjectIconUrl({
							icon: null,
							repoOwner: repoOwner || null,
						})}
						className="mt-1.5 size-[22px] shrink-0 rounded-md text-[11px]"
					/>
				)}
				<EditableTitle
					name={workspace.name}
					label={t({ message: "Workspace name" })}
					maxLength={200}
					onRename={onRename}
				/>
			</h1>
			<div className="mt-2 text-[13px] leading-6 text-muted-foreground">
				{owner ? (
					<span>
						<Trans>
							Created by{" "}
							<CloudWorkspacePersonLink person={owner} onOpen={onOpenPerson} />{" "}
							· {createdAgo}
						</Trans>
					</span>
				) : (
					<span>
						<Trans>Created {createdAgo}</Trans>
					</span>
				)}
			</div>
		</div>
	);
}
