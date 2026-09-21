const issues = [
	["LOCAL-1", "Verify the worktree file browser", "In Progress", "indeterminate"],
	["LOCAL-2", "Review surrounding diff context", "To Do", "new"],
	["LOCAL-3", "Connect the company Jira server", "To Do", "new"],
].map(([key, summary, status, category], index) => ({
	id: String(index + 1),
	key,
	fields: {
		summary,
		status: { name: status, statusCategory: { key: category } },
		project: { name: "Local verification" },
		priority: { name: "Medium" },
		updated: "2026-09-17T08:00:00.000+0000",
	},
}));

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		const authorized = request.headers.get("authorization") ===
			"Bearer superestset-local-fixture";
		console.log(JSON.stringify({ path: url.pathname, authorized,
			jql: url.searchParams.get("jql"), startAt: url.searchParams.get("startAt") }));
		if (!authorized) return Response.json({ error: "Fixture authorization failed" }, { status: 401 });
		if (url.pathname === "/jira/rest/api/2/myself") {
			return Response.json({ displayName: "Local test account", active: true });
		}
		if (url.pathname === "/jira/rest/api/2/search") {
			const startAt = Number(url.searchParams.get("startAt") || 0);
			const selected = url.searchParams.get("jql")?.includes('= "In Progress"')
				? issues.filter(issue => issue.fields.status.statusCategory.key === "indeterminate")
				: issues;
			return Response.json({ startAt, total: selected.length,
				issues: selected.slice(startAt, startAt + 2) });
		}
		return new Response("Not found", { status: 404 });
	},
});
console.log(JSON.stringify({ baseUrl: `http://127.0.0.1:${server.port}/jira` }));
