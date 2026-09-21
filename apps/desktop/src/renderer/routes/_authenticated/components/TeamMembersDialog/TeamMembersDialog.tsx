import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@superset/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { useId, useState } from "react";
import { HiCheck, HiPlus, HiXMark } from "react-icons/hi2";
import type { ProjectQueryTarget } from "renderer/routes/_authenticated/_dashboard/hooks/useProjectQueryTargets";
import { normalizeAuthorFilter } from "renderer/routes/_authenticated/_dashboard/pull-requests/utils/normalizeAuthorFilter";
import {
	MAX_TEAM_MEMBERS,
	normalizeTeamMembers,
	type TeamMember,
} from "renderer/routes/_authenticated/_dashboard/pull-requests/utils/pullRequestTeam";
import { useRepositoryContributors } from "renderer/routes/_authenticated/hooks/useRepositoryContributors";

interface TeamMembersDialogProps {
	members: readonly TeamMember[];
	projectTargets: ProjectQueryTarget[];
	onSave: (members: TeamMember[]) => void;
	onClose: () => void;
}

export function TeamMembersDialog({
	members,
	projectTargets,
	onSave,
	onClose,
}: TeamMembersDialogProps) {
	const { t } = useLingui();
	const repositoryId = useId();
	const [draft, setDraft] = useState(() => [...members]);
	const [search, setSearch] = useState("");
	const [projectId, setProjectId] = useState<string>();
	const target =
		projectTargets.find((project) => project.projectId === projectId) ??
		projectTargets.find((project) => project.hostUrl);
	const {
		data: contributors,
		isLoading,
		error,
	} = useRepositoryContributors(target, true);
	const selected = new Set(draft.map(({ login }) => login.toLowerCase()));
	const candidates = new Map<string, TeamMember>();
	for (const member of [...draft, ...(contributors ?? [])]) {
		const login = normalizeAuthorFilter(member.login)?.toLowerCase();
		if (login && !candidates.has(login))
			candidates.set(login, { ...member, login });
	}
	const query = search.trim().replace(/^@/, "").toLowerCase();
	const filtered = [...candidates.values()].filter(
		(member) =>
			member.login.includes(query) ||
			member.name?.toLowerCase().includes(query),
	);
	const normalizedSearch = normalizeAuthorFilter(search)?.toLowerCase();
	const showCustomOption =
		normalizedSearch && !candidates.has(normalizedSearch);
	const toggle = (member: TeamMember) => {
		setDraft((current) =>
			selected.has(member.login)
				? current.filter(({ login }) => login !== member.login)
				: normalizeTeamMembers([...current, member]),
		);
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Edit team</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Choose up to 20 people for your My team PR filter. Saved on this
							Mac.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					<div className="text-sm font-medium">
						<Trans>Team members</Trans>
					</div>
					{draft.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							<Trans>No team members yet.</Trans>
						</p>
					) : (
						<ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
							{draft.map(({ login, name }) => (
								<li
									key={login}
									className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
									title={name}
								>
									<span>@{login}</span>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="size-5"
										aria-label={t({ message: `Remove @${login}` })}
										onClick={() =>
											setDraft((current) =>
												current.filter((member) => member.login !== login),
											)
										}
									>
										<HiXMark className="size-3" />
									</Button>
								</li>
							))}
						</ul>
					)}
					{projectTargets.length > 0 && (
						<div className="flex items-center gap-3">
							<Label htmlFor={repositoryId}>
								<Trans>Repository</Trans>
							</Label>
							<Select
								value={target?.projectId ?? ""}
								onValueChange={setProjectId}
							>
								<SelectTrigger id={repositoryId} className="min-w-0 flex-1">
									<SelectValue
										placeholder={t({ message: "Select repository" })}
									/>
								</SelectTrigger>
								<SelectContent>
									{projectTargets.map((project) => (
										<SelectItem
											key={project.projectId}
											value={project.projectId}
											disabled={!project.hostUrl}
										>
											{project.projectName}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					<Command shouldFilter={false} className="h-auto rounded-md border">
						<CommandInput
							autoFocus
							value={search}
							onValueChange={setSearch}
							placeholder={t({
								message: "Search contributors or enter a username…",
							})}
						/>
						<CommandList className="max-h-48">
							{isLoading && (
								<p className="px-3 py-2 text-sm text-muted-foreground">
									<Trans>Loading contributors…</Trans>
								</p>
							)}
							<CommandGroup>
								{filtered.map((member) => (
									<CommandItem
										key={member.login}
										value={member.login}
										aria-label={member.login}
										aria-checked={selected.has(member.login)}
										disabled={
											!selected.has(member.login) &&
											draft.length >= MAX_TEAM_MEMBERS
										}
										onSelect={() => toggle(member)}
									>
										<span className="min-w-0 flex-1 truncate">
											{member.name
												? `${member.name} (@${member.login})`
												: `@${member.login}`}
										</span>
										{selected.has(member.login) && (
											<HiCheck className="size-4 shrink-0" />
										)}
									</CommandItem>
								))}
								{showCustomOption && normalizedSearch && (
									<CommandItem
										value={`add:${normalizedSearch}`}
										disabled={draft.length >= MAX_TEAM_MEMBERS}
										onSelect={() => {
											toggle({ login: normalizedSearch });
											setSearch("");
										}}
									>
										<HiPlus className="size-4" />
										<Trans>Add @{normalizedSearch}</Trans>
									</CommandItem>
								)}
							</CommandGroup>
							{error && (
								<p className="px-3 py-2 text-sm text-muted-foreground">
									<Trans>
										Couldn't load contributors — type a username instead.
									</Trans>
								</p>
							)}
							{!isLoading &&
								!error &&
								filtered.length === 0 &&
								!showCustomOption && (
									<CommandEmpty>
										{search.trim() && !normalizedSearch ? (
											<Trans>Enter a valid GitHub username.</Trans>
										) : (
											<Trans>No contributors found.</Trans>
										)}
									</CommandEmpty>
								)}
						</CommandList>
					</Command>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button onClick={() => onSave(draft)}>
						<Trans>Save</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
