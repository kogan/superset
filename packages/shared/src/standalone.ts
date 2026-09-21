/** Public identity and launcher-owned configuration for the personal Mac app. */
export const FORK = {
	name: "superset++",
	storageName: "SuperestSet",
	bundleId: "com.deexi333.superestset",
	protocol: "superestset",
	repository: "https://github.com/kogan/superset",
	releases: "https://github.com/kogan/superset/releases",
} as const;

export interface LocalServiceOrigins {
	apiOrigin: string;
	contentOrigin: string;
}

export function publicLocalEnvironment({
	apiOrigin,
	contentOrigin,
}: LocalServiceOrigins) {
	return {
		NEXT_PUBLIC_API_URL: apiOrigin,
		NEXT_PUBLIC_WEB_URL: apiOrigin,
		NEXT_PUBLIC_ADMIN_URL: apiOrigin,
		NEXT_PUBLIC_MARKETING_URL: FORK.repository,
		NEXT_PUBLIC_DOCS_URL: `${FORK.repository}#readme`,
		NEXT_PUBLIC_ROOT_DOMAIN: "superestset.local",
		NEXT_PUBLIC_DESKTOP_URL: "superestset://app",
		NEXT_PUBLIC_COOKIE_DOMAIN: "127.0.0.1",
		NEXT_PUBLIC_STREAMS_URL: apiOrigin,
		STREAMS_URL: apiOrigin,
		RELAY_URL: apiOrigin,
		REALTIME_URL: apiOrigin,
		USERCONTENT_URL: contentOrigin,
		STATIC_URL: contentOrigin,
		R2_ENDPOINT: contentOrigin,
		NEXT_PUBLIC_POSTHOG_KEY: "",
		NEXT_PUBLIC_POSTHOG_HOST: apiOrigin,
		SENTRY_DSN_DESKTOP: "",
		SENTRY_DSN_HOST_SERVICE: "",
	};
}
