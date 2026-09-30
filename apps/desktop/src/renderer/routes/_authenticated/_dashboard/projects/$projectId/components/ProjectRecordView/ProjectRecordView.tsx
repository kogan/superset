import { Trans } from "@lingui/react/macro";
import { Tabs, TabsList, TabsTrigger } from "@superset/ui/tabs";
import type { CloudWorkspaceListItem } from "renderer/routes/_authenticated/_dashboard/components/CloudWorkspacesList/components/CloudWorkspaceListRow";
import { DescriptionEditor } from "renderer/routes/_authenticated/_dashboard/components/DescriptionEditor";
import type {
	ProjectRecord,
	ProjectRecordChanges,
	ProjectTab,
} from "../../types";
import { ProjectProgressTab } from "./components/ProjectProgressTab";
import { ProjectRecordHeader } from "./components/ProjectRecordHeader";
import { ProjectRecordSide } from "./components/ProjectRecordSide";
import { ProjectRecordTopBar } from "./components/ProjectRecordTopBar";

interface ProjectRecordViewProps {
	project: ProjectRecord;
	tab: ProjectTab;
	now: Date;
	people: { id: string; name: string; image: string | null }[];
	onInvite?: () => void;
	onTabChange: (tab: ProjectTab) => void;
	onBack: () => void;
	onChange: (changes: ProjectRecordChanges) => void;
	onAddTask: (task: { id: string; slug: string; title: string }) => void;
	onOpenTask: (taskId: string) => void;
	onOpenWorkspace: (workspaceId: string) => void;
	workspaceItems: CloudWorkspaceListItem[];
	onOpenPullRequest: (url: string) => void;
	onOpenRepo: (fullName: string) => void;
	onSetInSidebar: (workspaceId: string, inSidebar: boolean) => void;
}

export function ProjectRecordView({
	project,
	tab,
	now,
	people,
	onInvite,
	onTabChange,
	onBack,
	onChange,
	onAddTask,
	onOpenTask,
	onOpenWorkspace,
	workspaceItems,
	onOpenPullRequest,
	onOpenRepo,
	onSetInSidebar,
}: ProjectRecordViewProps) {
	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
			<div className="@container flex min-h-0 flex-1 flex-col">
				<ProjectRecordTopBar
					name={project.name}
					icon={project.icon}
					color={project.color}
					onBack={onBack}
				/>
				<div className="flex min-h-0 flex-1 flex-col overflow-auto @min-[900px]:flex-row @min-[900px]:overflow-hidden">
					<main className="min-w-0 flex-1 pt-5 pr-10 pb-10 pl-8 @min-[900px]:overflow-auto">
						<ProjectRecordHeader project={project} onChange={onChange} />
						<Tabs
							value={tab}
							onValueChange={(value) => onTabChange(value as ProjectTab)}
							className="mt-6"
						>
							<TabsList className="h-8">
								<TabsTrigger value="overview" className="px-3 text-xs">
									<Trans>Overview</Trans>
								</TabsTrigger>
								<TabsTrigger value="progress" className="px-3 text-xs">
									<Trans>Progress</Trans>
								</TabsTrigger>
							</TabsList>
						</Tabs>
						<div className="mt-6 max-w-[760px]">
							{tab === "overview" ? (
								<DescriptionEditor
									allowAttachments
									key={project.id}
									description={project.description}
									onSave={(description) => onChange({ description })}
								/>
							) : (
								<ProjectProgressTab
									project={project}
									now={now}
									onAddTask={onAddTask}
									onOpenTask={onOpenTask}
									onOpenWorkspace={onOpenWorkspace}
									workspaceItems={workspaceItems}
									onOpenPullRequest={onOpenPullRequest}
									onOpenRepo={onOpenRepo}
									onSetInSidebar={onSetInSidebar}
								/>
							)}
						</div>
					</main>
					<ProjectRecordSide
						project={project}
						people={people}
						onInvite={onInvite}
						onChange={onChange}
					/>
				</div>
			</div>
		</div>
	);
}
