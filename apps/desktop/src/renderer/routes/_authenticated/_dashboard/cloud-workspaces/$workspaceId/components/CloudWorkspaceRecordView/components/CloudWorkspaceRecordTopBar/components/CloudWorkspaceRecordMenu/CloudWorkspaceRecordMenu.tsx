import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { LuBox, LuEllipsis, LuTrash2 } from "react-icons/lu";

interface CloudWorkspaceRecordMenuProps {
	onSaveAsEnvironment?: () => void;
	onDelete: () => void;
}

export function CloudWorkspaceRecordMenu({
	onSaveAsEnvironment,
	onDelete,
}: CloudWorkspaceRecordMenuProps) {
	const { t } = useLingui();
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					size="icon-sm"
					variant="outline"
					aria-label={t({ message: "More actions" })}
					className="text-muted-foreground hover:text-foreground"
				>
					<LuEllipsis className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-40">
				{onSaveAsEnvironment && (
					<>
						<DropdownMenuItem onSelect={onSaveAsEnvironment}>
							<LuBox className="size-4" />
							<Trans>Save as environment</Trans>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem variant="destructive" onSelect={onDelete}>
					<LuTrash2 className="size-4" />
					<Trans>Delete</Trans>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
