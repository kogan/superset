import { Resend } from "resend";
import { env } from "../env";
import { localMode } from "../local-mode";

export const resend = localMode
	? new Proxy(new Resend("re_local_disabled"), {
			get() {
				throw new Error(
					"Email delivery requires an independent hosted service.",
				);
			},
		})
	: new Resend(env.RESEND_API_KEY);
