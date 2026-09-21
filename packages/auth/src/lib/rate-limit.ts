import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "../env";
import { localMode } from "../local-mode";

const redis = localMode
	? null
	: new Redis({
			url: env.KV_REST_API_URL,
			token: env.KV_REST_API_TOKEN,
		});

// 10 invitations per hour per user
export const invitationRateLimit = redis
	? new Ratelimit({
			redis,
			limiter: Ratelimit.slidingWindow(10, "1 h"),
			prefix: "ratelimit:invitation",
		})
	: {
			async limit(_identifier: string): Promise<{ success: boolean }> {
				throw new Error(
					"Email invitations require an independent hosted service.",
				);
			},
		};
