import { createFileRoute } from "@tanstack/react-router";
import { Redirect } from "renderer/components/Redirect";
import { usePluginsEnabled } from "renderer/hooks/usePluginsEnabled";
import { PluginsView } from "./components/PluginsView";

export const Route = createFileRoute("/_authenticated/_dashboard/plugins/")({
	component: PluginsPage,
});

function PluginsPage() {
	const isEnabled = usePluginsEnabled();
	if (isEnabled === undefined) return null;
	if (!isEnabled) return <Redirect to="/v2-workspaces" />;

	return <PluginsView />;
}
