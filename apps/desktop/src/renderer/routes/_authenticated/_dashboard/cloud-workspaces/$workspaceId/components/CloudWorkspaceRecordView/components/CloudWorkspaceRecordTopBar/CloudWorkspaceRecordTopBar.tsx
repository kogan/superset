import { Trans, useLingui } from "@lingui/react/macro";
import { useFormat } from "@superset/i18n/react";
import { Button } from "@superset/ui/button";
import { ButtonGroup } from "@superset/ui/button-group";
import { LuArrowRight, LuChevronRight, LuHash, LuLink } from "react-icons/lu";
import type { CloudWorkspaceRow } from "renderer/hooks/useCloudWorkspaces";
import {
	ACTIVE_WITHIN_MS,
	CloudWorkspacePresenceStack,
} from "renderer/routes/_authenticated/_dashboard/components/CloudWorkspacePresenceStack";
import { CloudWorkspaceShareButton } from "renderer/routes/_authenticated/_dashboard/components/CloudWorkspaceShareButton";
import { RecordIconButton } from "renderer/routes/_authenticated/_dashboard/components/RecordIconButton";
import { CloudWorkspaceRecordMenu } from "./components/CloudWorkspaceRecordMenu";

interface CloudWorkspaceRecordTopBarProps {
	workspaceId: string;
	name: string;
	archivedAt: Date | null;
	people: CloudWorkspaceRow["presence"];
	owner: CloudWorkspaceRow["createdBy"];
	visibility: CloudWorkspaceRow["visibility"];
	canEditSharing: boolean;
	now: Date;
	onBack: () => void;
	onOpenWorkspace: () => void;
	onOpenPerson: (userId: string) => void;
	onSetVisibility: (
		visibility: CloudWorkspaceRow["visibility"],
	) => Promise<unknown>;
	onCopyLink: () => void;
	onCopyId: () => void;
	onSaveAsEnvironment?: () => void;
	onDelete: () => void;
}

export function CloudWorkspaceRecordTopBar({
	workspaceId,
	name,
	archivedAt,
	people,
	owner,
	visibility,
	canEditSharing,
	now,
	onBack,
	onOpenWorkspace,
	onOpenPerson,
	onSetVisibility,
	onCopyLink,
	onCopyId,
	onSaveAsEnvironment,
	onDelete,
}: CloudWorkspaceRecordTopBarProps) {
	const { t } = useLingui();
	const { formatCompactRelativeTime } = useFormat();
	return (
		<div className="flex h-12 shrink-0 items-center gap-2 pl-4 text-[13px]">
			<button
				type="button"
				onClick={onBack}
				className="text-muted-foreground hover:text-foreground"
			>
				<Trans>Workspaces</Trans>
			</button>
			<LuChevronRight className="size-3 text-muted-foreground" />
			<span className="min-w-0 truncate">{name}</span>
			<div className="drag h-full min-w-0 flex-1" />
			<div className="flex h-full shrink-0 items-center justify-end gap-3 pr-4 @min-[900px]:w-[372px] @min-[900px]:border-l @min-[900px]:border-border">
				<CloudWorkspacePresenceStack
					people={people}
					now={now}
					activeWithinMs={archivedAt ? 0 : ACTIVE_WITHIN_MS}
					onOpenPerson={onOpenPerson}
				/>
				<ButtonGroup>
					{!archivedAt && (
						<CloudWorkspaceShareButton
							workspaceId={workspaceId}
							owner={owner}
							visibility={visibility}
							canEdit={canEditSharing}
							iconOnly
							onSetVisibility={onSetVisibility}
						/>
					)}
					<RecordIconButton
						label={t({ message: "Copy link" })}
						onClick={onCopyLink}
					>
						<LuLink className="size-3.5" />
					</RecordIconButton>
					<RecordIconButton
						label={t({ message: "Copy Workspace ID" })}
						onClick={onCopyId}
					>
						<LuHash className="size-3.5" />
					</RecordIconButton>
					{!archivedAt && (
						<CloudWorkspaceRecordMenu
							onSaveAsEnvironment={onSaveAsEnvironment}
							onDelete={onDelete}
						/>
					)}
				</ButtonGroup>
				{archivedAt ? (
					<span className="text-xs text-muted-foreground">
						<Trans>
							Archived · {formatCompactRelativeTime(archivedAt, now)}
						</Trans>
					</span>
				) : (
					<Button variant="outline" size="sm" onClick={onOpenWorkspace}>
						<Trans>Go to workspace</Trans>
						<LuArrowRight className="size-3.5" />
					</Button>
				)}
			</div>
		</div>
	);
}
