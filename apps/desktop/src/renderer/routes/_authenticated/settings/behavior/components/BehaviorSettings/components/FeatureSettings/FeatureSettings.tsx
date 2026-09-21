import { Trans, useLingui } from "@lingui/react/macro";
import { Label } from "@superset/ui/label";
import { Switch } from "@superset/ui/switch";
import { HighlightText } from "renderer/routes/_authenticated/settings/components/HighlightText";
import {
	isItemVisible,
	SETTING_ITEM_ID,
	type SettingItemId,
} from "renderer/routes/_authenticated/settings/utils/settings-search";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";
import { useSettingsSearchQuery } from "renderer/stores/settings-state";
import { useWorkspaceAgentsRowStore } from "renderer/stores/workspace-agents-row";

export function FeatureSettings({
	visibleItems,
}: {
	visibleItems?: SettingItemId[] | null;
}) {
	const { t } = useLingui();
	const searchQuery = useSettingsSearchQuery();
	const preferences = useFeaturePreferences();
	const agentsEnabled = useWorkspaceAgentsRowStore((state) => state.enabled);
	const setAgentsEnabled = useWorkspaceAgentsRowStore(
		(state) => state.setEnabled,
	);
	const items = [
		{
			id: SETTING_ITEM_ID.BEHAVIOR_FEATURE_ATTENTION,
			label: t({ message: "Attention inbox" }),
			enabled: preferences.attentionInbox,
			setEnabled: (enabled: boolean) =>
				preferences.setEnabled("attentionInbox", enabled),
		},
		{
			id: SETTING_ITEM_ID.BEHAVIOR_FEATURE_JIRA,
			label: t({ message: "Jira" }),
			enabled: preferences.jira,
			setEnabled: (enabled: boolean) => preferences.setEnabled("jira", enabled),
		},
		{
			id: SETTING_ITEM_ID.BEHAVIOR_FEATURE_PULL_REQUESTS,
			label: t({ message: "Pull requests" }),
			enabled: preferences.pullRequests,
			setEnabled: (enabled: boolean) =>
				preferences.setEnabled("pullRequests", enabled),
		},
		{
			id: SETTING_ITEM_ID.BEHAVIOR_FEATURE_PAGES,
			label: t({ message: "Pages" }),
			enabled: preferences.pages,
			setEnabled: (enabled: boolean) =>
				preferences.setEnabled("pages", enabled),
		},
		{
			id: SETTING_ITEM_ID.BEHAVIOR_WORKSPACE_AGENTS,
			label: t({ message: "Workspace agents" }),
			enabled: agentsEnabled,
			setEnabled: setAgentsEnabled,
		},
		{
			id: SETTING_ITEM_ID.BEHAVIOR_FEATURE_CONTENT_SEARCH,
			label: t({ message: "Search file contents" }),
			enabled: preferences.fileContentSearch,
			setEnabled: (enabled: boolean) =>
				preferences.setEnabled("fileContentSearch", enabled),
		},
	].filter((item) => isItemVisible(item.id, visibleItems));
	if (items.length === 0) return null;
	return (
		<section
			className="mb-8 space-y-4 border-b pb-6"
			aria-labelledby="feature-settings-title"
		>
			<div>
				<h3 id="feature-settings-title" className="text-base font-medium">
					<Trans>Features</Trans>
				</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					<Trans>
						Choose which features appear in the app. Changes apply immediately.
					</Trans>
				</p>
			</div>
			{items.map((item) => (
				<div key={item.id} className="flex items-center justify-between gap-6">
					<Label htmlFor={item.id} className="text-sm font-medium">
						<HighlightText text={item.label} query={searchQuery} />
					</Label>
					<Switch
						id={item.id}
						checked={item.enabled}
						onCheckedChange={item.setEnabled}
					/>
				</div>
			))}
		</section>
	);
}
