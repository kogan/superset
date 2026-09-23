import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { IdeUnavailableError } from "../../../runtime/ide/code-server-runtime";
import { IdeWorkspaceUnavailableError } from "../../../runtime/ide/ide";
import { IdeFileError } from "../../../runtime/ide/open-file";
import { protectedProcedure, router } from "../../index";

const workspaceInput = z.object({ workspaceId: z.string().min(1) });

export const ideRouter = router({
	getTheme: protectedProcedure
		.input(workspaceInput)
		.query(async ({ ctx, input }) => {
			try {
				return await ctx.runtime.ide.getTheme(input.workspaceId);
			} catch (error) {
				if (error instanceof IdeWorkspaceUnavailableError)
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				throw error;
			}
		}),
	setTheme: protectedProcedure
		.input(workspaceInput.extend({ theme: z.enum(["dark", "light"]) }))
		.mutation(async ({ ctx, input }) => {
			try {
				return await ctx.runtime.ide.setTheme(input.workspaceId, input.theme);
			} catch (error) {
				if (error instanceof IdeWorkspaceUnavailableError)
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				throw error;
			}
		}),
	openFile: protectedProcedure
		.input(
			workspaceInput.extend({
				path: z.string().min(1).max(8192),
				line: z.number().int().positive().optional(),
				column: z.number().int().positive().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await ctx.runtime.ide.openFile(input.workspaceId, input);
			} catch (error) {
				if (error instanceof IdeFileError)
					throw new TRPCError({ code: error.code, message: error.message });
				if (error instanceof IdeWorkspaceUnavailableError)
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				if (error instanceof IdeUnavailableError)
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: error.message,
					});
				throw error;
			}
		}),
	start: protectedProcedure
		.input(workspaceInput)
		.mutation(async ({ ctx, input }) => {
			try {
				return await ctx.runtime.ide.start(input.workspaceId);
			} catch (error) {
				if (error instanceof IdeWorkspaceUnavailableError) {
					throw new TRPCError({ code: "NOT_FOUND", message: error.message });
				}
				if (error instanceof IdeUnavailableError) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: error.message,
					});
				}
				throw error;
			}
		}),
	stop: protectedProcedure
		.input(workspaceInput)
		.mutation(async ({ ctx, input }) => {
			await ctx.runtime.ide.stop(input.workspaceId);
		}),
});
