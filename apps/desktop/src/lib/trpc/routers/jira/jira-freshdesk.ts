import { z } from "zod";

export type JiraFreshdeskLink = {
	url: string;
	ticketId: string | null;
};

export function parseFreshdeskUrl(value: string): JiraFreshdeskLink | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (
		url.protocol !== "https:" ||
		!url.hostname.endsWith(".freshdesk.com") ||
		url.username ||
		url.password ||
		url.port
	)
		return null;
	const ticket = url.pathname.match(
		/^\/(?:a\/|helpdesk\/|support\/)?tickets\/([1-9]\d*)(?:\/|$)/,
	);
	if (ticket) {
		url.pathname = ticket[0].replace(/\/$/, "");
		url.search = "";
		url.hash = "";
	}
	return { url: url.href, ticketId: ticket?.[1] ?? null };
}

export function descriptionFreshdeskLinks(
	description: unknown,
): JiraFreshdeskLink[] {
	const links = new Map<string, JiraFreshdeskLink>();
	const pending: unknown[] = [description];
	while (pending.length > 0) {
		const node = pending.pop();
		if (typeof node === "string") {
			for (const match of node.matchAll(/https:\/\/[^\s<>"'[\]{}|]+/gi)) {
				const link = parseFreshdeskUrl(match[0].replace(/[),.;!?]+$/, ""));
				if (link) links.set(link.url, link);
			}
		} else if (Array.isArray(node)) pending.push(...node);
		else {
			const record = z.record(z.string(), z.unknown()).safeParse(node);
			if (record.success) pending.push(...Object.values(record.data));
		}
	}
	return [...links.values()];
}
