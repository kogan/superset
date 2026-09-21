import { Trans, useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { LuInbox } from "react-icons/lu";
import { useFeaturePreferences } from "renderer/stores/feature-preferences";

export function AttentionNavigation({
	collapsed = false,
}: {
	collapsed?: boolean;
}) {
	const { t } = useLingui();
	const enabled = useFeaturePreferences((state) => state.attentionInbox);
	const matchRoute = useMatchRoute();
	const active = Boolean(matchRoute({ to: "/attention", fuzzy: true }));
	if (!enabled) return null;
	const link = (
		<Link
			to="/attention"
			aria-label={t({ message: "Attention" })}
			aria-current={active ? "page" : undefined}
			className={cn(
				"flex items-center rounded-md transition-colors",
				collapsed ? "size-7 justify-center" : "h-7 w-full gap-2 px-2 text-sm",
				active
					? "bg-fill-selected text-foreground"
					: "text-muted-foreground hover:bg-fill-hover hover:text-foreground",
			)}
		>
			<LuInbox
				className={collapsed ? "size-3.5" : "size-4 shrink-0"}
				strokeWidth={1.5}
			/>
			{!collapsed && (
				<span>
					<Trans>Attention</Trans>
				</span>
			)}
		</Link>
	);
	if (!collapsed) return link;
	return (
		<Tooltip delayDuration={300}>
			<TooltipTrigger asChild>{link}</TooltipTrigger>
			<TooltipContent side="right">
				<Trans>Attention</Trans>
			</TooltipContent>
		</Tooltip>
	);
}
