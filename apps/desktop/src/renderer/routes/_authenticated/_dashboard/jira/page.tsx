import { createFileRoute } from "@tanstack/react-router";
import { JiraView } from "./components/JiraView";

export const Route = createFileRoute("/_authenticated/_dashboard/jira/")({
	component: JiraView,
});
