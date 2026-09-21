import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { useId, useState } from "react";
import { LuGitPullRequest } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";

export function JiraGithubScope({ scope }: { scope?: string }) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<string | null>(null);
	const id = useId();
	const utils = electronTrpc.useUtils();
	const save = electronTrpc.jira.setGithubScope.useMutation({
		onSuccess: async (preferences) => {
			utils.jira.getPreferences.setData(undefined, preferences);
			await utils.jira.listPullRequests.invalidate();
			setOpen(false);
			setDraft(null);
		},
	});
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm">
					<LuGitPullRequest className="size-3.5" />
					{scope ?? <Trans>PR source</Trans>}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80">
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate(draft ?? scope ?? "");
					}}
				>
					<Label htmlFor={id}>
						<Trans>GitHub organization or repository</Trans>
					</Label>
					<Input
						id={id}
						value={draft ?? scope ?? ""}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={t({ message: "owner/repository" })}
						required
					/>
					<p className="text-xs text-muted-foreground">
						<Trans>
							Uses your GitHub CLI login to match Jira keys in PR titles and
							descriptions.
						</Trans>
					</p>
					{save.isError && (
						<p role="alert" className="text-xs text-destructive">
							{errorMessage(save.error)}
						</p>
					)}
					<Button type="submit" size="sm" disabled={save.isPending}>
						<Trans>Save</Trans>
					</Button>
				</form>
			</PopoverContent>
		</Popover>
	);
}
