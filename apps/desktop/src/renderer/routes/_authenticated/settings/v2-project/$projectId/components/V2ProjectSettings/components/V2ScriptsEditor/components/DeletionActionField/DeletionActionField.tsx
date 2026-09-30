import { Trans, useLingui } from "@lingui/react/macro";
import {
	deletionSkillAgentSchema,
	type WorktreeDeletionAction,
} from "@superset/shared/worktree-deletion";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Textarea } from "@superset/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

export function DeletionActionField({
	hostUrl,
	projectId,
	action,
	onChange,
	children,
}: {
	hostUrl: string;
	projectId: string;
	action: WorktreeDeletionAction;
	onChange: (action: WorktreeDeletionAction) => void;
	children: ReactNode;
}) {
	const { t } = useLingui();
	const agent = action.type === "skill" ? action.agent : "claude";
	const skills = useQuery({
		queryKey: ["host-config", "deletion-skills", hostUrl, projectId, agent],
		queryFn: () =>
			getHostServiceClientByUrl(hostUrl).config.listDeletionSkills.query({
				projectId,
				agent,
			}),
		enabled: action.type === "skill",
	});
	return (
		<div className="space-y-3">
			<Select
				value={action.type}
				onValueChange={(value) =>
					onChange(
						value === "skill"
							? { type: "skill", agent: "claude", name: null, instructions: "" }
							: { type: "command" },
					)
				}
			>
				<SelectTrigger aria-label={t({ message: "Action type" })}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="command">
						<Trans>Command</Trans>
					</SelectItem>
					<SelectItem value="skill">
						<Trans>Skill</Trans>
					</SelectItem>
				</SelectContent>
			</Select>
			{action.type === "command" ? (
				children
			) : (
				<>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<Label htmlFor="deletion-skill-agent">
								<Trans>Agent</Trans>
							</Label>
							<Select
								value={action.agent}
								onValueChange={(value) =>
									onChange({
										...action,
										agent: deletionSkillAgentSchema.parse(value),
										name: null,
									})
								}
							>
								<SelectTrigger id="deletion-skill-agent">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="claude">Claude</SelectItem>
									<SelectItem value="codex">Codex</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<Label htmlFor="deletion-skill-name">
								<Trans>Skill</Trans>
							</Label>
							<Select
								value={action.name ?? ""}
								onValueChange={(name) => onChange({ ...action, name })}
							>
								<SelectTrigger id="deletion-skill-name">
									<SelectValue placeholder={t({ message: "Select a skill" })} />
								</SelectTrigger>
								<SelectContent>
									{action.name &&
										!skills.data?.some(
											(skill) => skill.name === action.name,
										) && (
											<SelectItem value={action.name}>{action.name}</SelectItem>
										)}
									{skills.data?.map((skill) => (
										<SelectItem key={skill.name} value={skill.name}>
											{skill.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					{skills.isLoading && (
						<p className="text-xs text-muted-foreground">
							<Trans>Loading…</Trans>
						</p>
					)}
					{skills.isError && (
						<p role="alert" className="text-xs text-destructive">
							{skills.error.message}
						</p>
					)}
					{skills.isSuccess && skills.data.length === 0 && (
						<p className="text-xs text-muted-foreground">
							<Trans>No skills found</Trans>
						</p>
					)}
					<div className="space-y-1">
						<Label htmlFor="deletion-skill-instructions">
							<Trans>Instructions</Trans>
						</Label>
						<Textarea
							id="deletion-skill-instructions"
							value={action.instructions}
							onChange={(event) =>
								onChange({ ...action, instructions: event.target.value })
							}
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						<Trans>
							Runs before deletion using a copy of the latest session for this
							agent, when available. Skills have up to 10 minutes to finish.
						</Trans>
					</p>
				</>
			)}
		</div>
	);
}
