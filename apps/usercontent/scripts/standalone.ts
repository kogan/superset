import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import {
	handleLocalObjectRequest,
	LocalObjectStore,
	type ObjectRange,
	ObjectRangeError,
} from "../../../packages/trpc/src/lib/local-objects";
import type { UsercontentEnv } from "../src/env";
import { app } from "../src/index";

type StandaloneOptions = {
	dataDir: string;
	secret: string;
	hostname?: string;
	port?: number;
	usercontentUrl?: string;
	staticUrl?: string;
	appUrl?: string;
	frameAncestors?: string;
};

type RunningStandaloneServer = {
	origin: string;
	close(): Promise<void>;
	fetch(request: Request): Promise<Response>;
};

type IpcReadyMessage = {
	type: "ready";
	origin: string;
};

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_ADVERTISED_HOSTNAME = "frame.usercontent.localhost";

function rangeFromWorkerRange(
	range: R2Range | undefined,
): ObjectRange | undefined {
	if (!range) return undefined;
	if ("suffix" in range) return { suffix: range.suffix };
	return {
		offset: range.offset ?? 0,
		...(range.length !== undefined ? { length: range.length } : {}),
	};
}

function createEnv({
	store,
	secret,
	origin,
	appUrl,
	frameAncestors,
}: {
	store: LocalObjectStore;
	secret: string;
	origin: string;
	appUrl: string;
	frameAncestors: string;
}): UsercontentEnv {
	return {
		USERCONTENT_URL: origin,
		MEDIA_URL: origin,
		APP_URL: appUrl,
		FRAME_ANCESTORS: frameAncestors,
		USERCONTENT_TOKEN_SECRET: secret,
		PRIVATE: {
			async get(key, options) {
				try {
					return await store.get({
						bucket: "private",
						key,
						range: rangeFromWorkerRange(options?.range),
					});
				} catch (error) {
					if (error instanceof ObjectRangeError) throw error;
					throw error;
				}
			},
		},
	};
}

async function responseToNode(
	response: Response,
	target: ServerResponse,
): Promise<void> {
	target.writeHead(
		response.status,
		Object.fromEntries(response.headers.entries()),
	);
	if (!response.body) {
		target.end();
		return;
	}
	await new Promise<void>((resolve, reject) => {
		Readable.fromWeb(response.body)
			.on("error", reject)
			.on("end", resolve)
			.pipe(target);
	});
}

function requestFromNode(request: IncomingMessage): Request {
	const host = request.headers.host ?? `${DEFAULT_HOSTNAME}:0`;
	const url = new URL(request.url ?? "/", `http://${host}`);
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers)) {
		if (Array.isArray(value)) {
			for (const entry of value) headers.append(key, entry);
		} else if (value !== undefined) {
			headers.set(key, value);
		}
	}
	const method = request.method ?? "GET";
	if (method === "GET" || method === "HEAD") {
		return new Request(url, { method, headers });
	}
	const init: RequestInit & { duplex: "half" } = {
		method,
		headers,
		body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
		duplex: "half",
	};
	return new Request(url, init);
}

function ipcReady(origin: string): void {
	const message: IpcReadyMessage = { type: "ready", origin };
	process.send?.(message);
}

function advertisedHostname(usercontentUrl: string | undefined): string {
	if (!usercontentUrl) return DEFAULT_ADVERTISED_HOSTNAME;
	const parsed = new URL(usercontentUrl);
	if (parsed.hostname === DEFAULT_HOSTNAME) return DEFAULT_ADVERTISED_HOSTNAME;
	return parsed.hostname;
}

export async function startStandaloneUsercontentServer(
	options: StandaloneOptions,
): Promise<RunningStandaloneServer> {
	const hostname = options.hostname ?? DEFAULT_HOSTNAME;
	const port = options.port ?? 0;
	const store = new LocalObjectStore(options.dataDir);
	const advertisedHost = advertisedHostname(options.usercontentUrl);
	let origin = `http://${advertisedHost}:${port}`;
	let appUrl = options.appUrl ?? origin;
	let frameAncestors = options.frameAncestors ?? `${origin} file:`;

	const fetch = async (request: Request): Promise<Response> => {
		const objectResponse = await handleLocalObjectRequest({
			request,
			store,
			secret: options.secret,
		});
		if (objectResponse) return objectResponse;
		return app.fetch(
			request,
			createEnv({
				store,
				secret: options.secret,
				origin,
				appUrl,
				frameAncestors,
			}),
		);
	};

	const server = createServer((incoming, outgoing) => {
		void fetch(requestFromNode(incoming))
			.then((response) => responseToNode(response, outgoing))
			.catch((error: unknown) => {
				if (!outgoing.headersSent) {
					outgoing.writeHead(500, { "Cache-Control": "no-store" });
				}
				outgoing.end("Internal server error");
				console.error("[usercontent] request failed", error);
			});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, hostname, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Standalone usercontent server did not bind a TCP port");
	}
	origin = `http://${advertisedHost}:${address.port}`;
	appUrl = options.appUrl ?? origin;
	frameAncestors = options.frameAncestors ?? `${origin} file:`;

	const close = async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	};

	return { origin, close, fetch };
}

async function main(): Promise<void> {
	const dataDir = process.env.SUPERESTSET_DATA_DIR;
	const secret = process.env.USERCONTENT_TOKEN_SECRET;
	if (!dataDir || !secret) {
		throw new Error(
			"SUPERESTSET_DATA_DIR and USERCONTENT_TOKEN_SECRET are required",
		);
	}
	const running = await startStandaloneUsercontentServer({
		dataDir,
		secret,
		hostname: process.env.HOSTNAME ?? DEFAULT_HOSTNAME,
		port: Number(process.env.PORT ?? 0),
		usercontentUrl: process.env.USERCONTENT_URL,
		staticUrl: process.env.STATIC_URL,
		appUrl: process.env.APP_URL,
		frameAncestors: process.env.FRAME_ANCESTORS,
	});
	ipcReady(running.origin);

	let closing = false;
	const shutdown = () => {
		if (closing) return;
		closing = true;
		void running.close().finally(() => process.exit(0));
	};
	process.on("message", (message) => {
		if (message === "shutdown") shutdown();
	});
	process.on("disconnect", shutdown);
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

function isEntrypoint(): boolean {
	const script = process.argv[1] ?? "";
	return /(?:standalone\.(?:ts|js|cjs)|content\.cjs)$/.test(script);
}

if (isEntrypoint()) {
	void main().catch((error: unknown) => {
		console.error("[usercontent] failed to start", error);
		process.exit(1);
	});
}
