import { useFeaturePreferences } from "renderer/stores/feature-preferences";

export function usePagesEnabled() {
	return useFeaturePreferences((state) => state.pages);
}
