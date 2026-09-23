import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { toast } from "@superset/ui/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";

export function IdeThemeSelect({
	hostUrl,
	workspaceId,
}: {
	hostUrl: string;
	workspaceId: string;
}) {
	const { t } = useLingui();
	const client = getHostServiceClientByUrl(hostUrl);
	const queryClient = useQueryClient();
	const queryKey = ["ide-theme", hostUrl, workspaceId];
	const theme = useQuery({
		queryKey,
		queryFn: () => client.ide.getTheme.query({ workspaceId }),
	});
	const changeTheme = useMutation({
		mutationFn: (value: "dark" | "light") =>
			client.ide.setTheme.mutate({ workspaceId, theme: value }),
		onSuccess: (value) => queryClient.setQueryData(queryKey, value),
		onError: (error) => toast.error(errorMessage(error)),
	});

	return (
		<Select
			value={theme.data?.theme ?? ""}
			disabled={theme.isPending || changeTheme.isPending}
			onValueChange={(value) => {
				if (value === "dark" || value === "light") changeTheme.mutate(value);
			}}
		>
			<SelectTrigger
				aria-label={t({ message: "Theme" })}
				className="h-6 w-24 gap-1 border-none text-xs shadow-none"
			>
				<SelectValue placeholder={t({ message: "Theme" })} />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="dark">
					<Trans>Dark</Trans>
				</SelectItem>
				<SelectItem value="light">
					<Trans>Light</Trans>
				</SelectItem>
			</SelectContent>
		</Select>
	);
}
