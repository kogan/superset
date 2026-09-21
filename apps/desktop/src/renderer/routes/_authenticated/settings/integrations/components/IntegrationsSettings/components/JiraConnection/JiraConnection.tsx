import { Trans, useLingui } from "@lingui/react/macro";
import { errorMessage } from "@superset/i18n/errors";
import { Badge } from "@superset/ui/badge";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { JiraConnectInput } from "lib/trpc/routers/jira/jira-schema";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { SiJira } from "react-icons/si";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { clearJiraIssueQueries } from "renderer/routes/_authenticated/_dashboard/jira/utils/clearJiraIssueQueries";
import { JiraBoardPicker } from "renderer/routes/_authenticated/components/JiraBoardPicker";
import { JiraGithubScope } from "renderer/routes/_authenticated/components/JiraGithubScope";
import { HighlightText } from "renderer/routes/_authenticated/settings/components/HighlightText";
import { useSettingsSearchQuery } from "renderer/stores/settings-state";

export function JiraConnection() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	const utils = electronTrpc.useUtils();
	const connection = electronTrpc.jira.getConnection.useQuery(undefined, {
		retry: false,
	});
	const preferences = electronTrpc.jira.getPreferences.useQuery();
	const [serverUrl, setServerUrl] = useState<string | null>(null);
	const [selectedKind, setSelectedKind] = useState<
		JiraConnectInput["kind"] | null
	>(null);
	const [accountEmail, setAccountEmail] = useState<string | null>(null);
	const [pending, setPending] = useState<"connect" | "disconnect" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const tokenInput = useRef<HTMLInputElement | null>(null);
	const mounted = useRef(true);
	const searchQuery = useSettingsSearchQuery();
	const urlId = useId();
	const tokenId = useId();
	const kindId = useId();
	const emailId = useId();
	const connectionData = connection.data;
	const isConnected = connectionData?.status === "connected";
	const settings =
		isConnected && preferences.data?.baseUrl === connectionData.baseUrl
			? preferences.data
			: undefined;
	const baseUrl =
		serverUrl ??
		(isConnected ? connectionData.baseUrl : (preferences.data?.baseUrl ?? ""));
	const kind =
		selectedKind ?? (isConnected ? connectionData.kind : "cloud-api-token");
	const email =
		accountEmail ??
		(isConnected && connectionData.kind !== "pat" ? connectionData.email : "");
	const isBusy = pending !== null;
	const setTokenInput = useCallback((input: HTMLInputElement | null) => {
		if (tokenInput.current && tokenInput.current !== input)
			tokenInput.current.value = "";
		tokenInput.current = input;
	}, []);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const connect = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (isBusy || !tokenInput.current) return;
		const credentials: JiraConnectInput =
			kind === "pat"
				? { kind, baseUrl, token: tokenInput.current.value }
				: { kind, baseUrl, email, token: tokenInput.current.value };
		tokenInput.current.value = "";
		setPending("connect");
		setError(null);
		try {
			await clearJiraIssueQueries(queryClient);
			const connected =
				await electronTrpcClient.jira.connect.mutate(credentials);
			await clearJiraIssueQueries(queryClient);
			await utils.jira.getConnection.cancel();
			utils.jira.getConnection.setData(undefined, connected);
			if (mounted.current) {
				setServerUrl(null);
				setSelectedKind(null);
				setAccountEmail(null);
			}
		} catch (error) {
			if (mounted.current) setError(errorMessage(error));
		} finally {
			credentials.token = "";
			if (tokenInput.current) tokenInput.current.value = "";
			if (mounted.current) setPending(null);
		}
	};

	const disconnect = async () => {
		if (isBusy) return;
		if (tokenInput.current) tokenInput.current.value = "";
		setPending("disconnect");
		setError(null);
		try {
			await clearJiraIssueQueries(queryClient);
			await electronTrpcClient.jira.disconnect.mutate();
			await clearJiraIssueQueries(queryClient);
			await utils.jira.getConnection.cancel();
			utils.jira.getConnection.setData(undefined, { status: "disconnected" });
			if (mounted.current) {
				setServerUrl(null);
				setSelectedKind(null);
				setAccountEmail(null);
			}
		} catch (error) {
			if (mounted.current) setError(errorMessage(error));
		} finally {
			if (mounted.current) setPending(null);
		}
	};

	return (
		<section
			className="mb-6 rounded-lg border p-5"
			aria-busy={isBusy || connection.isFetching}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex items-start gap-3">
					<SiJira className="mt-0.5 size-5 shrink-0" />
					<div>
						<h3 className="text-sm font-medium">
							<HighlightText
								text={t({ message: "Jira" })}
								query={searchQuery}
							/>
						</h3>
						<p className="mt-1 text-xs text-muted-foreground">
							<Trans>Your Jira connection is stored on this device.</Trans>
						</p>
					</div>
				</div>
				<Badge variant="secondary">
					{isConnected ? (
						<Trans>Connected</Trans>
					) : (
						<Trans>Not connected</Trans>
					)}
				</Badge>
			</div>
			{connection.isPending ? (
				<output className="mt-5 block text-sm text-muted-foreground">
					<Trans>Loading…</Trans>
				</output>
			) : (
				<>
					{isConnected && (
						<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
							<div className="min-w-0 text-xs">
								<p>
									<Trans>Connected as</Trans>{" "}
									<span className="font-medium">
										{connectionData.displayName}
									</span>
								</p>
								<p className="mt-1 break-all text-muted-foreground select-text">
									{connectionData.baseUrl}
								</p>
							</div>
							<div className="flex shrink-0 gap-2">
								<Button variant="outline" size="sm" asChild>
									<Link to="/jira">
										<Trans>Open Jira</Trans>
									</Link>
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={isBusy}
									onClick={() => void disconnect()}
								>
									<Trans>Disconnect</Trans>
								</Button>
							</div>
						</div>
					)}
					{isConnected && (
						<div className="mt-4 flex flex-wrap items-center gap-3">
							<JiraBoardPicker
								board={settings?.teamBoard}
								onSelect={() => {
									void utils.jira.listIssues.invalidate();
								}}
							/>
							<JiraGithubScope scope={settings?.githubScope} />
						</div>
					)}
					{connection.isError && (
						<div className="mt-4 flex items-center gap-3 text-sm" role="alert">
							<p className="flex-1 text-destructive">
								{errorMessage(connection.error)}
							</p>
							<Button
								variant="outline"
								size="sm"
								disabled={connection.isFetching}
								onClick={() => void connection.refetch()}
							>
								<Trans>Retry</Trans>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={isBusy}
								onClick={() => void disconnect()}
							>
								<Trans>Disconnect</Trans>
							</Button>
						</div>
					)}
					<form
						onSubmit={(event) => void connect(event)}
						className="mt-5 space-y-4"
					>
						<div className="space-y-2">
							<Label htmlFor={urlId}>
								<Trans>Jira server URL</Trans>
							</Label>
							<Input
								id={urlId}
								name="jira-server"
								type="url"
								value={baseUrl}
								onChange={(event) => setServerUrl(event.target.value)}
								placeholder="https://jira.example.com"
								disabled={isBusy}
								autoComplete="url"
								spellCheck={false}
								required
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor={kindId}>
								<Trans>Authentication method</Trans>
							</Label>
							<Select
								value={kind}
								disabled={isBusy}
								onValueChange={(value) => {
									if (
										value === "pat" ||
										value === "cloud-api-token" ||
										value === "cloud-scoped-token"
									) {
										setSelectedKind(value);
										if (tokenInput.current) tokenInput.current.value = "";
										setError(null);
									}
								}}
							>
								<SelectTrigger id={kindId}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="cloud-api-token">
										<Trans>API token</Trans>
									</SelectItem>
									<SelectItem value="cloud-scoped-token">
										<Trans>API token with scopes</Trans>
									</SelectItem>
									<SelectItem value="pat">
										<Trans>Personal access token</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{kind !== "pat" && (
							<div className="space-y-2">
								<Label htmlFor={emailId}>
									<Trans>Email address</Trans>
								</Label>
								<Input
									id={emailId}
									name="jira-email"
									type="email"
									value={email}
									onChange={(event) => setAccountEmail(event.target.value)}
									disabled={isBusy}
									autoComplete="username"
									spellCheck={false}
									required
								/>
								<p className="text-xs text-muted-foreground">
									<Trans>
										Use the email address of the Atlassian account that created
										the token.
									</Trans>
								</p>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor={tokenId}>
								{kind === "pat" ? (
									<Trans>Personal access token</Trans>
								) : (
									<Trans>API token</Trans>
								)}
							</Label>
							<Input
								ref={setTokenInput}
								id={tokenId}
								name="jira-token"
								type="password"
								disabled={isBusy}
								autoComplete="off"
								spellCheck={false}
								required
							/>
						</div>
						{error && (
							<p className="text-sm text-destructive select-text" role="alert">
								{error}
							</p>
						)}
						<Button type="submit" size="sm" disabled={isBusy}>
							{pending === "connect" ? (
								<Trans>Connecting…</Trans>
							) : isConnected ? (
								<Trans>Reconnect</Trans>
							) : (
								<Trans>Connect</Trans>
							)}
						</Button>
					</form>
				</>
			)}
		</section>
	);
}
