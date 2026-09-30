import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Avatar } from "../Avatar";

const OVERLAP_RATIO = 0.27;

export interface AvatarStackPerson {
	id: string;
	name: string;
	image?: string | null;
	isActive?: boolean;
}

interface AvatarStackProps {
	people: AvatarStackPerson[];
	size?: number;
	max?: number;
	/** Fill behind each avatar. Match the surface the stack sits on, or a faded avatar shows its neighbour through it. */
	surfaceClassName?: string;
	outlineClassName?: string;
	className?: string;
	/** Wraps each avatar, e.g. in its own hover card or link. */
	renderPerson?: (person: AvatarStackPerson, avatar: ReactNode) => ReactNode;
	/** Wraps the "+N" count, e.g. in a menu of the people it stands for. */
	renderOverflow?: (hidden: AvatarStackPerson[], count: ReactNode) => ReactNode;
}

function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? name;
}

export function AvatarStack({
	people,
	size = 16,
	max = 3,
	surfaceClassName = "bg-background",
	outlineClassName = "outline-muted-foreground/70",
	className,
	renderPerson,
	renderOverflow,
}: AvatarStackProps) {
	const shown = people.slice(0, max);
	const overflow = people.length - shown.length;
	const overlap = Math.round(size * OVERLAP_RATIO);

	return (
		<span className={cn("flex shrink-0 items-center gap-1", className)}>
			<span className="flex flex-row-reverse items-center">
				{[...shown].reverse().map((person, index) => {
					const isActive = person.isActive !== false;
					const avatar = (
						<Avatar
							fullName={firstName(person.name)}
							image={person.image}
							className={cn(
								"size-full [&_[data-slot=avatar-fallback]]:text-[length:inherit]",
								!isActive && "opacity-75",
							)}
						/>
					);
					return (
						<span
							key={person.id}
							className={cn(
								"relative shrink-0 rounded-full outline-solid",
								outlineClassName,
								surfaceClassName,
								isActive ? "outline-1" : "outline-[length:0.5px]",
							)}
							style={{
								width: size,
								height: size,
								fontSize: size / 2,
								marginInlineEnd: index > 0 ? -overlap : undefined,
							}}
						>
							{renderPerson ? renderPerson(person, avatar) : avatar}
						</span>
					);
				})}
			</span>
			{overflow > 0 &&
				(renderOverflow ? (
					renderOverflow(people.slice(max), `+${overflow}`)
				) : (
					<span className="text-[10px] tabular-nums text-muted-foreground">
						+{overflow}
					</span>
				))}
		</span>
	);
}
