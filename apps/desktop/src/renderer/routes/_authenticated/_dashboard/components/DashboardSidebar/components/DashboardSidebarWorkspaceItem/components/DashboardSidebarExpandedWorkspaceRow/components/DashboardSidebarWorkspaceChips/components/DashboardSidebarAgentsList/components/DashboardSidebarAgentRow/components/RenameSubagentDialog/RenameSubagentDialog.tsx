import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { useState } from "react";

interface RenameSubagentDialogProps {
	name: string;
	automaticName: string;
	onClose: () => void;
	onSave: (name: string) => Promise<void>;
}

export function RenameSubagentDialog({
	name,
	automaticName,
	onClose,
	onSave,
}: RenameSubagentDialogProps) {
	const { t } = useLingui();
	const [value, setValue] = useState(name);
	const [isSaving, setIsSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	const save = async (nextName: string) => {
		if (isSaving) return;
		setIsSaving(true);
		setFailed(false);
		try {
			await onSave(nextName);
			onClose();
		} catch {
			setFailed(true);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !isSaving) onClose();
			}}
		>
			<DialogContent
				className="max-w-[400px]"
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Rename subagent</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>Leave it empty to use the task name.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						void save(value);
					}}
				>
					<Input
						autoFocus
						value={value}
						maxLength={200}
						disabled={isSaving}
						placeholder={automaticName}
						onChange={(event) => setValue(event.target.value)}
						onFocus={(event) => event.target.select()}
						aria-label={t({ message: "Subagent name" })}
					/>
					{failed && (
						<p role="alert" className="text-sm text-destructive">
							<Trans>Could not rename subagent. Try again.</Trans>
						</p>
					)}
					<DialogFooter className="gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={isSaving}
							onClick={() => void save("")}
						>
							<Trans>Use automatic name</Trans>
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isSaving}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" size="sm" disabled={isSaving}>
							{isSaving ? <Trans>Saving...</Trans> : <Trans>Save</Trans>}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
