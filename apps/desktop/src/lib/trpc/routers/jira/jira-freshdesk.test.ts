import { expect, test } from "bun:test";
import { descriptionFreshdeskLinks, parseFreshdeskUrl } from "./jira-freshdesk";

test("recognizes current, legacy, and customer ticket URLs", () => {
	for (const prefix of ["a/", "helpdesk/", "support/", ""]) {
		expect(
			parseFreshdeskUrl(
				`https://team.freshdesk.com/${prefix}tickets/123?view=all#reply`,
			),
		).toEqual({
			url: `https://team.freshdesk.com/${prefix}tickets/123`,
			ticketId: "123",
		});
	}
});

test("extracts plain text, Jira wiki markup, and ADF links without duplicates", () => {
	const url = "https://team.freshdesk.com/a/tickets/123";
	expect(
		descriptionFreshdeskLinks({
			type: "doc",
			content: [
				{ type: "paragraph", text: `See [Freshdesk|${url}] or (${url}).` },
				{
					type: "text",
					marks: [{ type: "link", attrs: { href: `${url}?from=jira` } }],
				},
				{
					type: "inlineCard",
					attrs: { url: "https://team.freshdesk.com/a/tickets/456" },
				},
			],
		}),
	).toEqual(
		expect.arrayContaining([
			{ url, ticketId: "123" },
			{ url: "https://team.freshdesk.com/a/tickets/456", ticketId: "456" },
		]),
	);
	expect(
		descriptionFreshdeskLinks([url, `${url}/?from=jira`, url]),
	).toHaveLength(1);
});

test("rejects lookalike domains, credentials and non-HTTPS links", () => {
	for (const url of [
		"https://team.freshdesk.com.evil.test/a/tickets/1",
		"https://notfreshdesk.com/a/tickets/1",
		"https://user:pass@team.freshdesk.com/a/tickets/1",
		"http://team.freshdesk.com/a/tickets/1",
		"javascript:alert(1)",
		"not a URL",
	])
		expect(parseFreshdeskUrl(url)).toBeNull();
	expect(descriptionFreshdeskLinks(null)).toEqual([]);
});
