import { randomUUID } from "node:crypto";
import { db } from "@superset/db/client";
import {
	members,
	organizations,
	sessions,
	subscriptions,
	teamMembers,
	teams,
	users,
} from "@superset/db/schema";
import { seedDefaultStatuses } from "@superset/db/seed-default-statuses";
import { and, asc, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";

const settingsSchema = z.object({
	SUPERESTSET_LOCAL: z.literal("1"),
	SUPERESTSET_API_ORIGIN: z.url().refine((value) => {
		const origin = new URL(value);
		return (
			origin.protocol === "http:" &&
			["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
		);
	}, "Personal authentication requires a loopback API origin"),
	BETTER_AUTH_SECRET: z.string().min(32),
	SUPERESTSET_LOCAL_USER_ID: z.uuid().optional(),
	SUPERESTSET_LOCAL_USER_NAME: z.string().trim().min(1).default("Personal"),
});
const SESSION_AGENT = "superestset-local";

type LocalSession = {
	token: string;
	expiresAt: string;
	organizationIds: string[];
};
declare global {
	var __superestsetLocalBootstrap: Promise<LocalSession> | undefined;
}

export async function bootstrapLocalAccount(): Promise<LocalSession> {
	globalThis.__superestsetLocalBootstrap ??= createLocalSession();
	const pending = globalThis.__superestsetLocalBootstrap;
	try {
		return await pending;
	} finally {
		if (globalThis.__superestsetLocalBootstrap === pending)
			globalThis.__superestsetLocalBootstrap = undefined;
	}
}

async function createLocalSession(): Promise<LocalSession> {
	const settings = settingsSchema.parse(process.env);
	const identity = await db.transaction(async (tx) => {
		const candidates = await tx.query.users.findMany({
			where: settings.SUPERESTSET_LOCAL_USER_ID
				? eq(users.id, settings.SUPERESTSET_LOCAL_USER_ID)
				: and(isNull(users.deletedAt), isNull(users.deletionRequestedAt)),
			orderBy: [asc(users.createdAt), asc(users.id)],
		});
		let user = settings.SUPERESTSET_LOCAL_USER_ID
			? candidates[0]
			: (candidates.find(
					(candidate) => candidate.email === "local@superestset.local",
				) ?? (candidates.length === 1 ? candidates[0] : undefined));
		if (settings.SUPERESTSET_LOCAL_USER_ID && !user)
			throw new Error("The selected imported local user does not exist.");
		if (!user && candidates.length > 0)
			throw new Error(
				"Imported metadata has multiple users. Select SUPERESTSET_LOCAL_USER_ID before starting.",
			);
		if (!user) {
			[user] = await tx
				.insert(users)
				.values({
					name: settings.SUPERESTSET_LOCAL_USER_NAME,
					email: "local@superestset.local",
					emailVerified: true,
					onboardedAt: new Date(),
				})
				.returning();
		}
		if (!user || user.deletedAt || user.deletionRequestedAt)
			throw new Error("The selected local user is unavailable.");
		let memberships = await tx.query.members.findMany({
			where: eq(members.userId, user.id),
			orderBy: [asc(members.createdAt), asc(members.id)],
		});
		if (memberships.length === 0) {
			const organizationId = randomUUID();
			await tx.insert(organizations).values({
				id: organizationId,
				name: "Personal",
				slug: `personal-${organizationId}`,
			});
			memberships = await tx
				.insert(members)
				.values({ organizationId, userId: user.id, role: "owner" })
				.returning();
		}
		const organizationIds = [
			...new Set(memberships.map((member) => member.organizationId)),
		];
		for (const organizationId of organizationIds) {
			let team = await tx.query.teams.findFirst({
				where: eq(teams.organizationId, organizationId),
				orderBy: asc(teams.createdAt),
			});
			if (!team)
				[team] = await tx
					.insert(teams)
					.values({ organizationId, name: "Default Team", slug: "DEFAULT" })
					.returning();
			if (!team) throw new Error("Failed to create the local team.");
			await tx
				.insert(teamMembers)
				.values({ organizationId, teamId: team.id, userId: user.id })
				.onConflictDoNothing();
			await seedDefaultStatuses(organizationId, tx);
			const entitlement = await tx.query.subscriptions.findFirst({
				where: and(
					eq(subscriptions.referenceId, organizationId),
					inArray(subscriptions.status, ["active", "trialing", "past_due"]),
				),
			});
			if (!entitlement)
				await tx.insert(subscriptions).values({
					referenceId: organizationId,
					plan: "enterprise",
					status: "active",
					seats: 1,
				});
		}
		const activeOrganizationId =
			organizationIds.find((id) => id === user.lastActiveOrganizationId) ??
			organizationIds[0];
		if (!activeOrganizationId)
			throw new Error("Local user has no organization.");
		await tx
			.update(users)
			.set({
				onboardedAt: user.onboardedAt ?? new Date(),
				lastActiveOrganizationId: activeOrganizationId,
			})
			.where(eq(users.id, user.id));
		return { userId: user.id, organizationIds, activeOrganizationId };
	});
	await db
		.delete(sessions)
		.where(
			and(
				eq(sessions.userId, identity.userId),
				eq(sessions.userAgent, SESSION_AGENT),
				lt(sessions.expiresAt, new Date()),
			),
		);
	const session = await db.query.sessions.findFirst({
		where: and(
			eq(sessions.userId, identity.userId),
			eq(sessions.userAgent, SESSION_AGENT),
			gt(sessions.expiresAt, new Date(Date.now() + 86_400_000)),
		),
		orderBy: desc(sessions.createdAt),
	});
	if (!session) {
		const { auth } = await import("./server");
		const context = await auth.$context;
		const created = await context.internalAdapter.createSession(
			identity.userId,
			false,
			{
				activeOrganizationId: identity.activeOrganizationId,
				userAgent: SESSION_AGENT,
			},
		);
		return {
			token: created.token,
			expiresAt: created.expiresAt.toISOString(),
			organizationIds: identity.organizationIds,
		};
	}
	if (!identity.organizationIds.includes(session.activeOrganizationId ?? "")) {
		await db
			.update(sessions)
			.set({ activeOrganizationId: identity.activeOrganizationId })
			.where(eq(sessions.id, session.id));
	}
	return {
		token: session.token,
		expiresAt: session.expiresAt.toISOString(),
		organizationIds: identity.organizationIds,
	};
}
