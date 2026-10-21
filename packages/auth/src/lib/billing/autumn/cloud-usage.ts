import type { getAutumnCustomer } from "./customer";
import { BOX_GB_MINUTES_FEATURE_ID } from "./features";

export interface CloudUsage {
	includedGbMinutes: number | null;
	usedGbMinutes: number;
	overageGbMinutes: number;
	resetsAt: string | null;
}

type Balances = Awaited<ReturnType<typeof getAutumnCustomer>>["balances"];

export function cloudUsageFromBalances(balances: Balances): CloudUsage | null {
	const balance = balances[BOX_GB_MINUTES_FEATURE_ID];
	if (!balance) return null;
	return {
		includedGbMinutes: balance.unlimited ? null : balance.granted,
		usedGbMinutes: balance.usage,
		overageGbMinutes: balance.unlimited
			? 0
			: Math.max(0, balance.usage - balance.granted),
		resetsAt: balance.nextResetAt
			? new Date(balance.nextResetAt).toISOString()
			: null,
	};
}
