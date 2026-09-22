export function isUnpackagedStandaloneRuntime({
	isPackaged,
	isStandalone,
}: {
	isPackaged: boolean;
	isStandalone: boolean;
}): boolean {
	return isStandalone && !isPackaged;
}
