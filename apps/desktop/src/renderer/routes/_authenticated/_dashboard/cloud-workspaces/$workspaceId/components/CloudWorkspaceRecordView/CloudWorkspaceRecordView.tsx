import { Trans } from "@lingui/react/macro";
import type { CloudTask } from "renderer/routes/_authenticated/_dashboard/components/CloudTaskRow";
import type { RecordLabel } from "renderer/routes/_authenticated/_dashboard/components/RecordLabels";
import { RecordSection } from "renderer/routes/_authenticated/_dashboard/components/RecordSection";
import type { CloudPullRequest } from "renderer/routes/_authenticated/_dashboard/hooks/useCloudPullRequests";
import type {
	CloudWorkspaceRecord,
	CloudWorkspaceRecordAttachment,
	CloudWorkspaceRecordPage,
	CloudWorkspaceRecordProject,
	CloudWorkspaceRecordSuggestion,
	CloudWorkspaceTimelineEntry,
} from "../../types";
import { CloudWorkspaceDescription } from "./components/CloudWorkspaceDescription";
import { CloudWorkspacePrompt } from "./components/CloudWorkspacePrompt";
import { CloudWorkspaceRecordHeader } from "./components/CloudWorkspaceRecordHeader";
import { CloudWorkspaceRecordSide } from "./components/CloudWorkspaceRecordSide";
import { CloudWorkspaceRecordTopBar } from "./components/CloudWorkspaceRecordTopBar";
import { CloudWorkspaceSuggestionsCard } from "./components/CloudWorkspaceSuggestionsCard";
import { CloudWorkspaceTimeline } from "./components/CloudWorkspaceTimeline";

interface CloudWorkspaceRecordViewProps {
	workspace: CloudWorkspaceRecord;
	tasks: CloudTask[];
	suggestions: CloudWorkspaceRecordSuggestion[];
	knownLabels: RecordLabel[];
	pullRequests: CloudPullRequest[];
	pages: CloudWorkspaceRecordPage[];
	projects: CloudWorkspaceRecordProject[];
	attachments: CloudWorkspaceRecordAttachment[];
	timeline: CloudWorkspaceTimelineEntry[];
	now: Date;
	canEditSharing: boolean;
	isGeneratingDescription: boolean;
	onBack: () => void;
	onOpenWorkspace: () => void;
	onOpenPerson: (userId: string) => void;
	onRename: (name: string) => void;
	onAddLabel: (name: string) => void;
	onRemoveLabel: (labelId: string) => void;
	onSetProject: (projectId: string | null) => void;
	onCreateProject: (name: string) => void;
	onOpenEnvironment: () => void;
	onOpenRepository: (fullName: string) => void;
	onOpenTask: (taskId: string) => void;
	onUnlinkTask: (taskId: string) => void;
	onAcceptSuggestion: (suggestionId: string) => void;
	onDismissSuggestion: (suggestionId: string) => void;
	onOpenPullRequest: (url: string) => void;
	onOpenPage: (pageId: string) => void;
	onOpenProject: (projectId: string) => void;
	onOpenLabel: (labelId: string) => void;
	onOpenAttachment: (attachmentId: string) => void;
	onDownloadAttachment: (attachmentId: string) => Promise<void>;
	onGenerateDescription: () => void;
	onSaveDescription: (description: string | null) => void;
	onSetVisibility: (
		visibility: CloudWorkspaceRecord["visibility"],
	) => Promise<unknown>;
	onCopyLink: () => void;
	onCopyId: () => void;
	onSaveAsEnvironment?: () => void;
	onDelete: () => void;
}

export function CloudWorkspaceRecordView({
	workspace,
	tasks,
	suggestions,
	knownLabels,
	pullRequests,
	pages,
	projects,
	attachments,
	timeline,
	now,
	canEditSharing,
	isGeneratingDescription,
	onBack,
	onOpenWorkspace,
	onOpenPerson,
	onRename,
	onAddLabel,
	onRemoveLabel,
	onSetProject,
	onCreateProject,
	onOpenEnvironment,
	onOpenRepository,
	onOpenTask,
	onUnlinkTask,
	onAcceptSuggestion,
	onDismissSuggestion,
	onOpenPullRequest,
	onOpenPage,
	onOpenProject,
	onOpenLabel,
	onOpenAttachment,
	onDownloadAttachment,
	onGenerateDescription,
	onSaveDescription,
	onSetVisibility,
	onCopyLink,
	onCopyId,
	onSaveAsEnvironment,
	onDelete,
}: CloudWorkspaceRecordViewProps) {
	return (
		<div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
			<div className="@container flex min-h-0 flex-1 flex-col">
				<CloudWorkspaceRecordTopBar
					workspaceId={workspace.id}
					name={workspace.name}
					archivedAt={workspace.deletedAt}
					people={workspace.presence}
					owner={workspace.createdBy}
					visibility={workspace.visibility}
					canEditSharing={canEditSharing}
					onSetVisibility={onSetVisibility}
					now={now}
					onBack={onBack}
					onOpenWorkspace={onOpenWorkspace}
					onOpenPerson={onOpenPerson}
					onCopyLink={onCopyLink}
					onCopyId={onCopyId}
					onSaveAsEnvironment={onSaveAsEnvironment}
					onDelete={onDelete}
				/>
				<div className="flex min-h-0 flex-1 flex-col overflow-auto @min-[900px]:flex-row @min-[900px]:overflow-hidden">
					<main className="min-w-0 flex-1 pt-5 pr-10 pb-10 pl-8 @min-[900px]:overflow-auto">
						<CloudWorkspaceRecordHeader
							workspace={workspace}
							now={now}
							onOpenPerson={onOpenPerson}
							onRename={onRename}
						/>
						<CloudWorkspaceSuggestionsCard
							suggestions={suggestions}
							onAccept={onAcceptSuggestion}
							onDismiss={onDismissSuggestion}
						/>
						{(workspace.prompt || attachments.length > 0) && (
							<RecordSection title={<Trans>Initial prompt</Trans>}>
								<CloudWorkspacePrompt
									prompt={workspace.prompt}
									attachments={attachments}
									onOpenAttachment={onOpenAttachment}
									onDownloadAttachment={onDownloadAttachment}
								/>
							</RecordSection>
						)}
						<RecordSection title={<Trans>Description</Trans>}>
							<CloudWorkspaceDescription
								key={workspace.id}
								description={workspace.description}
								canGenerate={
									workspace.status === "ready" && !workspace.deletedAt
								}
								isGenerating={isGeneratingDescription}
								onSave={onSaveDescription}
								onGenerate={onGenerateDescription}
							/>
						</RecordSection>
						<RecordSection title={<Trans>Activity</Trans>}>
							<CloudWorkspaceTimeline
								entries={timeline}
								environmentName={workspace.environmentName}
								now={now}
								onOpenTask={onOpenTask}
								onOpenPullRequest={onOpenPullRequest}
								onOpenPage={onOpenPage}
								onOpenProject={onOpenProject}
								onOpenLabel={onOpenLabel}
								onOpenEnvironment={onOpenEnvironment}
								onOpenPerson={onOpenPerson}
							/>
						</RecordSection>
					</main>
					<CloudWorkspaceRecordSide
						workspace={workspace}
						tasks={tasks}
						pullRequests={pullRequests}
						pages={pages}
						projects={projects}
						now={now}
						onOpenRepository={onOpenRepository}
						onOpenTask={onOpenTask}
						onUnlinkTask={onUnlinkTask}
						onOpenPullRequest={onOpenPullRequest}
						onOpenPage={onOpenPage}
						onOpenPerson={onOpenPerson}
						onSetProject={onSetProject}
						onCreateProject={onCreateProject}
						labels={workspace.labels}
						knownLabels={knownLabels}
						onAddLabel={onAddLabel}
						onRemoveLabel={onRemoveLabel}
						onOpenEnvironment={onOpenEnvironment}
					/>
				</div>
			</div>
		</div>
	);
}
