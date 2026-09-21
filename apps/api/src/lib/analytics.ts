import { PostHog } from "posthog-node";
import { env } from "@/env";

export const posthog = new PostHog(
	env.NEXT_PUBLIC_POSTHOG_KEY || "local-disabled",
	{
		disabled: process.env.SUPERESTSET_LOCAL === "1",
		host: env.NEXT_PUBLIC_POSTHOG_HOST,
		flushAt: 1,
		flushInterval: 0,
	},
);
