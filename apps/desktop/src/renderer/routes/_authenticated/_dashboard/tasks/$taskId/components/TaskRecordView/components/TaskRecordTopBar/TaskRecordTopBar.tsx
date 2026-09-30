import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { ButtonGroup } from "@superset/ui/button-group";
import { LuArrowRight, LuChevronRight, LuHash, LuLink } from "react-icons/lu";
import { RecordIconButton } from "renderer/routes/_authenticated/_dashboard/components/RecordIconButton";
import { RunInWorkspacePopoverV2 } from "../../../../../components/RunInWorkspacePopoverV2";
import { TaskRecordMenu } from "./components/TaskRecordMenu";

interface TaskRecordTopBarProps {
	task: {
		id: string;
		slug: string;
		title: string;
		description: string | null;
		branch: string | null;
	};
	onBack: () => void;
	onCopyLink: () => void;
	onCopyId: () => void;
	onOpenExternal?: () => void;
	onDelete: () => void;
}

export function TaskRecordTopBar({
	task,
	onBack,
	onCopyLink,
	onCopyId,
	onOpenExternal,
	onDelete,
}: TaskRecordTopBarProps) {
	const { t } = useLingui();
	return (
		<div className="flex h-12 shrink-0 items-center gap-2 pl-4 text-[13px]">
			<button
				type="button"
				onClick={onBack}
				className="text-muted-foreground hover:text-foreground"
			>
				<Trans>Tasks</Trans>
			</button>
			<LuChevronRight className="size-3 text-muted-foreground" />
			<span className="min-w-0 truncate tabular-nums">{task.slug}</span>
			<div className="drag h-full min-w-0 flex-1" />
			<div className="flex h-full shrink-0 items-center justify-end gap-3 pr-4 @min-[900px]:w-[372px] @min-[900px]:border-l @min-[900px]:border-border">
				<ButtonGroup>
					<RecordIconButton
						label={t({ message: "Copy link" })}
						onClick={onCopyLink}
					>
						<LuLink className="size-3.5" />
					</RecordIconButton>
					<RecordIconButton
						label={t({ message: "Copy task ID" })}
						onClick={onCopyId}
					>
						<LuHash className="size-3.5" />
					</RecordIconButton>
					<TaskRecordMenu onOpenExternal={onOpenExternal} onDelete={onDelete} />
				</ButtonGroup>
				<RunInWorkspacePopoverV2
					tasks={[task]}
					onComplete={() => {}}
					align="end"
					trigger={
						<Button variant="outline" size="sm">
							<Trans>Create workspace</Trans>
							<LuArrowRight className="size-3.5" />
						</Button>
					}
				/>
			</div>
		</div>
	);
}
