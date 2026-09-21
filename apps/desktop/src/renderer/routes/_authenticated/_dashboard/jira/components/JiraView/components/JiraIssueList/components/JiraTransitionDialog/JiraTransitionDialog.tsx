import { Trans } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { toast } from "@superset/ui/sonner";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { MovementState } from "../../hooks/useJiraMovement/movement";
export function JiraTransitionDialog({
	state,
	onCancel,
	onChoose,
}: {
	state: MovementState;
	onCancel: () => void;
	onChoose: (id: string) => void;
}) {
	const issue = state.kind === "idle" ? undefined : state.target.issue;
	return (
		<Dialog
			open={state.kind !== "idle"}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<DialogContent showCloseButton={state.kind !== "moving"}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Move issue</Trans>
					</DialogTitle>
					<DialogDescription>
						{issue?.key} {issue?.summary}
					</DialogDescription>
				</DialogHeader>
				{state.kind === "loading" && (
					<output>
						<Trans>Loading available moves…</Trans>
					</output>
				)}
				{state.kind === "moving" && (
					<output>
						<Trans>Moving issue…</Trans>
					</output>
				)}
				{state.kind === "error" && (
					<p role="alert" className="text-sm text-destructive">
						{errorMessage(state.error)}
					</p>
				)}
				{state.kind === "choosing" && (
					<div className="max-h-80 space-y-2 overflow-auto">
						{state.transitions.length === 0 && (
							<output className="text-sm text-muted-foreground">
								<Trans>
									No available moves. Open the issue in Jira to check its
									workflow.
								</Trans>
							</output>
						)}
						{state.transitions.map((transition) => (
							<div key={transition.id} className="rounded-md border p-3">
								<Button
									variant="outline"
									className="h-auto w-full justify-start whitespace-normal text-left"
									disabled={transition.requiredFields.length > 0}
									onClick={() => onChoose(transition.id)}
								>
									{transition.name} → {transition.status}
								</Button>
								{transition.requiredFields.length > 0 && (
									<p className="mt-2 text-xs text-muted-foreground">
										<Trans>This move requires fields in Jira.</Trans>
									</p>
								)}
							</div>
						))}
					</div>
				)}
				<DialogFooter>
					<Button
						variant="outline"
						disabled={state.kind === "moving"}
						onClick={onCancel}
					>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						disabled={state.kind === "moving" || !issue}
						onClick={() => {
							if (issue)
								void electronTrpcClient.external.openUrl
									.mutate(issue.url)
									.catch((error: unknown) => toast.error(errorMessage(error)));
						}}
					>
						<Trans>Open in Jira</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
