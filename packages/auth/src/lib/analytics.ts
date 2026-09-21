import { PostHog } from "posthog-node";

import { env } from "../env";
import { localMode } from "../local-mode";

// Singleton — every server-side capture in this package goes through it.
// flushAt: 1, flushInterval: 0 mirrors packages/trpc and apps/api so events
// survive short-lived processes (Vercel functions, edge handlers). The request
// timeout is bounded because this client is awaited inside request handlers
// (signup, Stripe webhooks) where a slow PostHog must not stall the caller.
export const posthog = new PostHog(
	localMode ? "local-disabled" : env.NEXT_PUBLIC_POSTHOG_KEY,
	{
		disabled: localMode,
		host: env.NEXT_PUBLIC_POSTHOG_HOST,
		flushAt: 1,
		flushInterval: 0,
		requestTimeout: 3000,
	},
);
