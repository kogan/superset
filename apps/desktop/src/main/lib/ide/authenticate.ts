// Electron's session.fetch rejects manual redirects, so this exchange uses Node fetch.
export async function authenticateIde({
	origin,
	folderPath,
	password,
	fetch = globalThis.fetch,
}: {
	origin: string;
	folderPath: string;
	password: string;
	fetch?: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<Array<{ name: string; value: string }>> {
	const response = await fetch(`${origin}/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Origin: origin,
		},
		body: new URLSearchParams({ password }).toString(),
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	await response.body?.cancel();
	if (response.status !== 302)
		throw new Error("Could not authenticate the IDE");
	const cookies = response.headers.getSetCookie().map((header) => {
		const pair = header.split(";", 1)[0] ?? "";
		const separator = pair.indexOf("=");
		if (separator < 1)
			throw new Error("The IDE returned an invalid session cookie");
		return { name: pair.slice(0, separator), value: pair.slice(separator + 1) };
	});
	if (cookies.length === 0)
		throw new Error("The IDE did not provide a session cookie");

	const authenticated = await fetch(ideFolderUrl(origin, folderPath), {
		headers: {
			Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
		},
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
	});
	await authenticated.body?.cancel();
	if (authenticated.status !== 200) {
		throw new Error("The IDE did not accept its session cookie");
	}
	return cookies;
}

export function ideFolderUrl(origin: string, folderPath: string): string {
	const url = new URL(origin);
	url.searchParams.set("folder", folderPath);
	return url.toString();
}

export function isIdeOrigin(url: string, origin: string): boolean {
	try {
		return new URL(url).origin === origin;
	} catch {
		return false;
	}
}
