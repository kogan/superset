import Stripe from "stripe";
import { env } from "./env";
import { localMode } from "./local-mode";

export const stripeClient = localMode
	? new Proxy(new Stripe("sk_test_local_disabled"), {
			get() {
				throw new Error("Billing is unavailable in the personal installation.");
			},
		})
	: new Stripe(env.STRIPE_SECRET_KEY);
