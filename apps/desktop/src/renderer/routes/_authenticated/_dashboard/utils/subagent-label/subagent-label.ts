import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import type { TerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";

export type SubagentDisplay = Pick<
	NonNullable<TerminalAgentBinding["subagents"]>[number],
	"id" | "agentType" | "description" | "customName"
>;

export function getSubagentLabel(subagent: SubagentDisplay): string {
	if (subagent.customName) return subagent.customName;
	if (subagent.description) return subagent.description;
	const role = subagent.agentType?.trim();
	if (
		role &&
		!/^(default|general[-_ ]purpose|worker|agent|subagent|root)$/i.test(role)
	) {
		return role.replace(/[_-]+/g, " ");
	}
	const shortId = subagent.id.slice(-8);
	return i18n._(msg({ message: `Task ${shortId}` }));
}
