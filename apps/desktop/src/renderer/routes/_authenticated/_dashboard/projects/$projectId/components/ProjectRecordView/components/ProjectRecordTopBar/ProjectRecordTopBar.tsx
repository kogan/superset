import { Trans } from "@lingui/react/macro";
import { LuChevronRight } from "react-icons/lu";
import { TaskProjectIcon } from "renderer/routes/_authenticated/_dashboard/components/TaskProjectIcon";

interface ProjectRecordTopBarProps {
	name: string;
	icon: string | null;
	color: string | null;
	onBack: () => void;
}

export function ProjectRecordTopBar({
	name,
	icon,
	color,
	onBack,
}: ProjectRecordTopBarProps) {
	return (
		<div className="flex h-12 shrink-0 items-center gap-2 pl-4 text-[13px]">
			<button
				type="button"
				onClick={onBack}
				className="text-muted-foreground hover:text-foreground"
			>
				<Trans>Projects</Trans>
			</button>
			<LuChevronRight className="size-3 text-muted-foreground" />
			<TaskProjectIcon icon={icon} color={color} />
			<span className="min-w-0 truncate">{name}</span>
			<div className="drag h-full min-w-0 flex-1" />
			<div className="drag h-full shrink-0 @min-[900px]:w-[372px] @min-[900px]:border-l @min-[900px]:border-border" />
		</div>
	);
}
