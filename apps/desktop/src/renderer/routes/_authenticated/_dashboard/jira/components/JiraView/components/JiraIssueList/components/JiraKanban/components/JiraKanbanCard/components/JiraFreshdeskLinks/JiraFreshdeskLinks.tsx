import { Trans } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { toast } from "@superset/ui/sonner";
import type { JiraFreshdeskLink } from "lib/trpc/routers/jira/jira-freshdesk";
import { LuArrowUpRight, LuTicket } from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";

export function JiraFreshdeskLinks({ links }: { links: JiraFreshdeskLink[] }) {
	if (links.length === 0) return null;
	return (
		<div className="mt-3 flex flex-wrap gap-2">
			{links.map((link) => (
				<a
					key={link.url}
					href={link.url}
					title={link.url}
					className="inline-flex max-w-full items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-xs text-teal-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-teal-300"
					onClick={(event) => {
						event.preventDefault();
						void electronTrpcClient.external.openUrl
							.mutate(link.url)
							.catch((error: unknown) => toast.error(errorMessage(error)));
					}}
				>
					<LuTicket aria-hidden="true" className="size-3 shrink-0" />
					<Trans>Freshdesk</Trans>
					{link.ticketId && ` #${link.ticketId}`}
					<LuArrowUpRight aria-hidden="true" className="size-3 shrink-0" />
				</a>
			))}
		</div>
	);
}
