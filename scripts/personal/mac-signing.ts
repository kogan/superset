export const MAC_RELEASE_CERTIFICATE =
	"3CAB8591B6DF300560E8ECC5697C2CC8CFCB9728";

export function macSigning(args: string[], requestedIdentity?: string) {
	const modes = ["--signed", "--self-signed", "--ad-hoc"].filter((flag) =>
		args.includes(flag),
	);
	if (modes.length > 1) throw new Error("Choose only one signing mode.");
	if (args.includes("--ad-hoc")) return { mode: "ad-hoc" } as const;
	const identity =
		requestedIdentity?.trim().toUpperCase() || MAC_RELEASE_CERTIFICATE;
	if (identity !== MAC_RELEASE_CERTIFICATE)
		throw new Error(
			"The signing identity must match MAC_RELEASE_CERTIFICATE. Changing it requires a planned manual reinstall for existing users.",
		);
	return {
		mode: args.includes("--signed") ? "developer-id" : "self-signed",
		identity,
	} as const;
}
