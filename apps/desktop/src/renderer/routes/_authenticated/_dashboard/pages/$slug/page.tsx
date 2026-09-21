import { createFileRoute } from "@tanstack/react-router";
import { Redirect } from "renderer/components/Redirect";
import { usePagesEnabled } from "renderer/hooks/usePagesEnabled";
import { PageDetailView } from "./components/PageDetailView";

export const Route = createFileRoute("/_authenticated/_dashboard/pages/$slug/")(
	{ component: PageDetailPage },
);

function PageDetailPage() {
	const { slug } = Route.useParams();
	const isEnabled = usePagesEnabled();

	if (isEnabled === undefined) return null;
	if (!isEnabled) return <Redirect to="/v2-workspaces" />;

	return <PageDetailView key={slug} slug={slug} />;
}
