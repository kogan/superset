import { createFileRoute } from "@tanstack/react-router";
import { AttentionView } from "./components/AttentionView";

export const Route = createFileRoute("/_authenticated/_dashboard/attention/")({
	component: AttentionView,
});
