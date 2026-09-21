import { z } from "zod";
import { normalizeAuthorFilter } from "../normalizeAuthorFilter";

export const MAX_TEAM_MEMBERS = 20;
const teamMemberSchema = z.object({
	login: z
		.string()
		.transform(normalizeAuthorFilter)
		.pipe(z.string())
		.transform((login) => login.toLowerCase()),
	name: z.string().trim().max(100).optional(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export function normalizeTeamMembers(value: unknown): TeamMember[] {
	const entries = z.array(z.unknown()).safeParse(value).data ?? [];
	const members = new Map<string, TeamMember>();
	for (const entry of entries) {
		const parsed = teamMemberSchema.safeParse(entry);
		if (parsed.success && !members.has(parsed.data.login)) {
			members.set(parsed.data.login, parsed.data);
			if (members.size === MAX_TEAM_MEMBERS) break;
		}
	}
	return [...members.values()];
}

export function getTeamAuthors(members: readonly TeamMember[]): string | null {
	return members.map(({ login }) => login).join(",") || null;
}

export function isTeamAuthorFilter(
	value: string | null,
	members: readonly TeamMember[],
): boolean {
	if (members.length === 0 || !value) return false;
	const authors = new Set(value.toLowerCase().split(","));
	return (
		authors.size === members.length &&
		members.every(({ login }) => authors.has(login.toLowerCase()))
	);
}
