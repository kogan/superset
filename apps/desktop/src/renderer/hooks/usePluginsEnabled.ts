import { FEATURE_FLAGS } from "@superset/shared/constants";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { env } from "renderer/env.renderer";

export function usePluginsEnabled() {
	const enabled = useFeatureFlagEnabled(FEATURE_FLAGS.PLUGINS);
	return window.App?.localEnvironment || env.NODE_ENV === "development"
		? true
		: enabled;
}
