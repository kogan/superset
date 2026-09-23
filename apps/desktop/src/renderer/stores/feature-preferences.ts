import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const preferencesSchema = z.object({
	attentionInbox: z.boolean().catch(true),
	jira: z.boolean().catch(true),
	pullRequests: z.boolean().catch(true),
	pages: z.boolean().catch(true),
	fileContentSearch: z.boolean().catch(true),
	embeddedIde: z.boolean().catch(true),
});
type FeaturePreferences = z.infer<typeof preferencesSchema>;
type FeaturePreferencesState = FeaturePreferences & {
	setEnabled: (feature: keyof FeaturePreferences, enabled: boolean) => void;
};

export const useFeaturePreferences = create<FeaturePreferencesState>()(
	persist(
		(set) => ({
			...preferencesSchema.parse({}),
			setEnabled: (feature, enabled) => set({ [feature]: enabled }),
		}),
		{
			name: "superestset-feature-preferences",
			partialize: (state) => preferencesSchema.parse(state),
			merge: (persisted, current) => ({
				...current,
				...(preferencesSchema.safeParse(persisted).data ??
					preferencesSchema.parse({})),
			}),
		},
	),
);
