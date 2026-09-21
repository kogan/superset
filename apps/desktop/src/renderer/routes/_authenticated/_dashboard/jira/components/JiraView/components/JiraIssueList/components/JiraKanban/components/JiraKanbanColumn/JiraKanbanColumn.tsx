import { useDroppable } from "@dnd-kit/core";
import { useFormat } from "@superset/i18n/react";
import { Badge } from "@superset/ui/badge";
import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import type { StatusColumn } from "../../utils/groupIssuesByStatus";
export function JiraKanbanColumn({
	column,
	disabled,
	children,
}: {
	column: StatusColumn;
	disabled: boolean;
	children: ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled });
	const { formatNumber } = useFormat();
	return (
		<section
			ref={setNodeRef}
			aria-label={column.status}
			className={cn(
				"flex min-h-0 w-80 shrink-0 flex-col rounded-lg border bg-muted/20",
				isOver && "ring-2 ring-ring",
			)}
		>
			<header className="flex items-center gap-2 border-b px-3 py-3">
				<span
					aria-hidden="true"
					className={`size-2 shrink-0 rounded-full ${column.category === "indeterminate" ? "bg-blue-500" : column.category === "done" ? "bg-emerald-500" : "bg-muted-foreground"}`}
				/>
				<h2 className="min-w-0 flex-1 break-words text-sm font-medium">
					{column.status}
				</h2>
				<Badge variant="secondary">{formatNumber(column.issues.length)}</Badge>
			</header>
			<div className="min-h-16 flex-1 space-y-2 overflow-y-auto p-2">
				{children}
			</div>
		</section>
	);
}
