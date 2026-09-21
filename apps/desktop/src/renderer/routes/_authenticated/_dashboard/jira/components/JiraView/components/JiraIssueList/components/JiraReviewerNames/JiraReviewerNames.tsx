import { Trans } from "@lingui/react/macro";

export function JiraReviewerNames({
	names,
	loading,
}: {
	names: readonly string[] | undefined;
	loading: boolean;
}) {
	if (names === undefined) {
		return loading ? <Trans>Loading…</Trans> : <Trans>Unavailable</Trans>;
	}
	return names.length ? names.join(", ") : <Trans>Unassigned</Trans>;
}
