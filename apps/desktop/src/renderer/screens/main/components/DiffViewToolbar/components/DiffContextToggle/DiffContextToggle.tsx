import { Trans } from "@lingui/react/macro";
import { cn } from "@superset/ui/utils";
import { Eye, EyeOff } from "lucide-react";
import { useSettings } from "renderer/stores/settings";

export function DiffContextToggle() {
	const expandUnchanged = useSettings((state) => state.expandUnchanged);
	const updateSetting = useSettings((state) => state.update);

	return (
		<button
			type="button"
			onClick={() => updateSetting("expandUnchanged", !expandUnchanged)}
			aria-pressed={expandUnchanged}
			className={cn(
				"flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2 text-[11px] outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:text-foreground",
				expandUnchanged
					? "bg-secondary text-foreground"
					: "text-muted-foreground",
			)}
		>
			{expandUnchanged ? (
				<>
					<EyeOff className="size-3.5" aria-hidden="true" />
					<Trans>Hide unchanged regions</Trans>
				</>
			) : (
				<>
					<Eye className="size-3.5" aria-hidden="true" />
					<Trans>Show all lines</Trans>
				</>
			)}
		</button>
	);
}
