import { Trans } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";
import { AttentionContent } from "./components/AttentionContent";

export function AttentionView() {
	const enabled = useFeaturePreferences((state) => state.attentionInbox);
	const setEnabled = useFeaturePreferences((state) => state.setEnabled);
	if (enabled) return <AttentionContent />;
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
			<h1 className="text-lg font-semibold">
				<Trans>Attention inbox is turned off</Trans>
			</h1>
			<Button onClick={() => setEnabled("attentionInbox", true)}>
				<Trans>Enable attention inbox</Trans>
			</Button>
		</div>
	);
}
