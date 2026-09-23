import { z } from "zod";

export const ideConnectionSchema = z.object({
	sessionId: z.uuid(),
	port: z.number().int().min(1).max(65535),
	password: z.string().min(32).max(256),
	folderPath: z.string().min(1),
});

export const idePrepareSchema = z.object({
	paneId: z.string().min(1),
	workspaceId: z.string().min(1),
	target: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("local") }),
		z.object({
			kind: z.literal("remote"),
			hostUrl: z.url().refine((value) => {
				const url = new URL(value);
				return (
					(url.protocol === "https:" || url.protocol === "http:") &&
					!url.username &&
					!url.password &&
					!url.search &&
					!url.hash
				);
			}),
		}),
	]),
	connection: ideConnectionSchema,
});

export type IdePrepare = z.infer<typeof idePrepareSchema>;
export type IdeView = { url: string; partition: string; sessionId: string };
