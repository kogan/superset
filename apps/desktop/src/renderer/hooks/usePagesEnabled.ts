import { FEATURE_FLAGS } from "@superset/shared/constants";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { env } from "renderer/env.renderer";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";

export function usePagesEnabled() {
	const enabled = useFeatureFlagEnabled(FEATURE_FLAGS.PAGES);
	const visible = useFeaturePreferences((state) => state.pages);
	if (!visible) return false;
	return window.App?.localEnvironment || env.NODE_ENV === "development"
		? true
		: enabled;
}
