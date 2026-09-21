import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { Checkbox } from "@superset/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Label } from "@superset/ui/label";
import type { JiraColumnLayout } from "lib/trpc/routers/jira/jira-schema";
import { useId, useState } from "react";
import { LuArrowLeft, LuArrowRight } from "react-icons/lu";
import { applyColumnLayout, mergeColumnLayout } from "../../utils/columnLayout";
import type { StatusColumn } from "../JiraKanban/utils/groupIssuesByStatus";

export function JiraColumnsDialog({
	columns,
	layout,
	isSaving,
	onSave,
	onClose,
}: {
	columns: StatusColumn[];
	layout: JiraColumnLayout;
	isSaving: boolean;
	onSave: (layout: JiraColumnLayout) => void;
	onClose: () => void;
}) {
	const { t } = useLingui();
	const id = useId();
	const [draft, setDraft] = useState(layout);
	const rows = applyColumnLayout(columns, draft);
	const update = (next: JiraColumnLayout) =>
		setDraft(mergeColumnLayout(next, draft));
	const move = (index: number, direction: -1 | 1) => {
		const next = rows.map(({ key, visible }) => ({ key, visible }));
		const [column] = next.splice(index, 1);
		if (column) next.splice(index + direction, 0, column);
		update(next);
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !isSaving) onClose();
			}}
		>
			<DialogContent className="sm:max-w-md" showCloseButton={!isSaving}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Columns</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Choose which columns appear and use the arrows to set their
							left-to-right order.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<ul className="max-h-[50vh] space-y-1 overflow-y-auto">
					{rows.map(({ key, status: name, visible }, index) => (
						<li
							key={key}
							className="flex items-center gap-3 rounded-md border px-3 py-2"
						>
							<Checkbox
								id={`${id}-${index}`}
								checked={visible}
								disabled={isSaving}
								onCheckedChange={(checked) =>
									update(
										rows.map((column) => ({
											key: column.key,
											visible:
												column.key === key ? checked === true : column.visible,
										})),
									)
								}
							/>
							<Label
								htmlFor={`${id}-${index}`}
								className="min-w-0 flex-1 break-words"
							>
								{name}
							</Label>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t({ message: `Move ${name} left` })}
								disabled={isSaving || index === 0}
								onClick={() => move(index, -1)}
							>
								<LuArrowLeft className="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t({ message: `Move ${name} right` })}
								disabled={isSaving || index === rows.length - 1}
								onClick={() => move(index, 1)}
							>
								<LuArrowRight className="size-4" />
							</Button>
						</li>
					))}
				</ul>
				<DialogFooter>
					<Button
						variant="ghost"
						className="sm:mr-auto"
						disabled={isSaving}
						onClick={() => setDraft([])}
					>
						<Trans>Restore defaults</Trans>
					</Button>
					<Button variant="outline" disabled={isSaving} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button disabled={isSaving} onClick={() => onSave(draft)}>
						{isSaving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
