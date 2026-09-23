import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { ideManager } from "main/lib/ide/ide-manager";
import { idePrepareSchema } from "shared/ide-types";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const paneInput = z.object({ paneId: z.string().min(1) });
const windowProcedure = publicProcedure.use(({ ctx, next }) => {
	if (!ctx.senderWindow || ctx.senderWindow.isDestroyed()) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "IDE requests require an application window",
		});
	}
	return next({ ctx: { senderWindow: ctx.senderWindow } });
});

export const createIdeRouter = () =>
	router({
		onFocus: windowProcedure
			.input(paneInput)
			.subscription(({ ctx, input }) =>
				observable<void>((emit) =>
					ideManager.onFocus(ctx.senderWindow, input.paneId, () =>
						emit.next(undefined),
					),
				),
			),
		prepare: windowProcedure
			.input(idePrepareSchema)
			.mutation(({ ctx, input }) =>
				ideManager.prepare(ctx.senderWindow, input),
			),
		release: windowProcedure
			.input(paneInput)
			.mutation(({ ctx, input }) =>
				ideManager.release(ctx.senderWindow, input.paneId),
			),
		close: windowProcedure
			.input(paneInput)
			.mutation(({ ctx, input }) =>
				ideManager.close(ctx.senderWindow, input.paneId),
			),
		register: windowProcedure
			.input(paneInput.extend({ webContentsId: z.number().int().positive() }))
			.mutation(({ ctx, input }) =>
				ideManager.register(
					ctx.senderWindow,
					input.paneId,
					input.webContentsId,
				),
			),
	});
