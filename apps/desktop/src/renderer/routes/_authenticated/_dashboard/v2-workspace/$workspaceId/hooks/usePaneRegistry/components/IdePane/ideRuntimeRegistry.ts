import { pointerPassthrough } from "renderer/lib/pointer-passthrough";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { IdeView } from "shared/ide-types";
import type { FilePosition } from "../../../../types";

export interface IdeFileRequest {
	filePath: string;
	position?: FilePosition;
}

type IdeState =
	| { status: "idle" }
	| { status: "stopped" }
	| { status: "loading" }
	| { status: "ready"; view: IdeView }
	| { status: "error"; error: Error };

interface IdeEntry {
	state: IdeState;
	webview: Electron.WebviewTag | null;
	placeholder: HTMLElement | null;
	disposeLayout: (() => void) | null;
	disposeGuest: (() => void) | null;
}

const IDLE: IdeState = { status: "idle" };

class IdeRuntimeRegistry {
	private entries = new Map<string, IdeEntry>();
	private listeners = new Map<string, Set<() => void>>();
	private fileRequests = new Map<
		string,
		Array<{ request: IdeFileRequest; opening: boolean }>
	>();

	queueFile(paneId: string, request: IdeFileRequest): void {
		const requests = this.fileRequests.get(paneId) ?? [];
		requests.push({ request: { ...request }, opening: false });
		this.fileRequests.set(paneId, requests);
		const entry = this.entries.get(paneId);
		if (entry?.state.status === "stopped") entry.state = IDLE;
		this.notify(paneId);
	}

	getPendingFile(paneId: string): IdeFileRequest | null {
		return this.fileRequests.get(paneId)?.[0]?.request ?? null;
	}

	async openNextFile(
		paneId: string,
		openFile: (request: IdeFileRequest) => Promise<void>,
	): Promise<void> {
		const pending = this.fileRequests.get(paneId)?.[0];
		if (!pending || pending.opening) return;
		pending.opening = true;
		try {
			await openFile(pending.request);
			if (this.fileRequests.get(paneId)?.[0] === pending) {
				const entry = this.entries.get(paneId);
				if (entry?.placeholder) entry.webview?.focus();
			}
		} finally {
			const requests = this.fileRequests.get(paneId);
			if (requests?.[0] === pending) {
				requests.shift();
				if (requests.length === 0) this.fileRequests.delete(paneId);
				this.notify(paneId);
			}
		}
	}

	subscribe(paneId: string, listener: () => void): () => void {
		let listeners = this.listeners.get(paneId);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(paneId, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.listeners.delete(paneId);
		};
	}

	getState(paneId: string): IdeState {
		return this.entries.get(paneId)?.state ?? IDLE;
	}

	private notify(paneId: string): void {
		for (const listener of this.listeners.get(paneId) ?? []) listener();
	}

	async open(
		paneId: string,
		connect: (isCurrent: () => boolean) => Promise<IdeView | null>,
	): Promise<void> {
		const previous = this.entries.get(paneId);
		if (
			previous?.state.status === "ready" ||
			previous?.state.status === "loading"
		)
			return;
		this.detach(paneId);
		previous?.disposeGuest?.();
		previous?.webview?.remove();
		const entry: IdeEntry = {
			state: { status: "loading" },
			webview: null,
			placeholder: null,
			disposeLayout: null,
			disposeGuest: null,
		};
		this.entries.set(paneId, entry);
		this.notify(paneId);
		try {
			const view = await connect(() => this.entries.get(paneId) === entry);
			if (!view || this.entries.get(paneId) !== entry) return;
			entry.state = { status: "ready", view };
		} catch (error) {
			if (this.entries.get(paneId) !== entry) return;
			entry.state = {
				status: "error",
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
		this.notify(paneId);
	}

	attach(paneId: string, placeholder: HTMLElement, onFocus: () => void): void {
		const entry = this.entries.get(paneId);
		if (!entry || entry.state.status !== "ready") return;
		this.detach(paneId);
		if (!entry.webview) {
			const view = entry.state.view;
			const webview = document.createElement("webview") as Electron.WebviewTag;
			webview.setAttribute("partition", view.partition);
			webview.setAttribute("allowpopups", "");
			webview.setAttribute(
				"webpreferences",
				"contextIsolation=yes,nodeIntegration=no,sandbox=yes",
			);
			webview.setAttribute("aria-label", "IDE");
			Object.assign(webview.style, {
				position: "fixed",
				border: "none",
				margin: "0",
				padding: "0",
				visibility: "hidden",
				zIndex: "0",
			});
			const fail = (error: Error) => {
				if (this.entries.get(paneId) !== entry) return;
				this.detach(paneId);
				entry.state = { status: "error", error };
				this.notify(paneId);
			};
			const onReady = () => {
				void electronTrpcClient.ide.register
					.mutate({
						paneId,
						webContentsId: webview.getWebContentsId(),
					})
					.catch(fail);
			};
			const onFailed = (event: Electron.DidFailLoadEvent) => {
				if (event.isMainFrame && event.errorCode !== -3)
					fail(new Error(event.errorDescription));
			};
			const onGone = () => fail(new Error("The IDE view closed unexpectedly."));
			webview.addEventListener("dom-ready", onReady);
			webview.addEventListener("did-fail-load", onFailed);
			webview.addEventListener("render-process-gone", onGone);
			entry.disposeGuest = () => {
				webview.removeEventListener("dom-ready", onReady);
				webview.removeEventListener("did-fail-load", onFailed);
				webview.removeEventListener("render-process-gone", onGone);
			};
			entry.webview = webview;
			webview.src = view.url;
			document.body.appendChild(webview);
		}
		entry.placeholder = placeholder;
		const webview = entry.webview;
		const layout = () => {
			const rect = placeholder.getBoundingClientRect();
			Object.assign(webview.style, {
				top: `${rect.top}px`,
				left: `${rect.left}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`,
				visibility: rect.width > 0 && rect.height > 0 ? "visible" : "hidden",
				pointerEvents: pointerPassthrough.active ? "none" : "auto",
			});
		};
		const observer = new ResizeObserver(layout);
		observer.observe(placeholder);
		window.addEventListener("resize", layout);
		window.addEventListener("scroll", layout, true);
		const unsubscribe = pointerPassthrough.subscribe(layout);
		const focusSubscription = electronTrpcClient.ide.onFocus.subscribe(
			{ paneId },
			{ onData: onFocus },
		);
		entry.disposeLayout = () => {
			observer.disconnect();
			window.removeEventListener("resize", layout);
			window.removeEventListener("scroll", layout, true);
			unsubscribe();
			focusSubscription.unsubscribe();
		};
		layout();
	}

	detach(paneId: string): void {
		const entry = this.entries.get(paneId);
		if (!entry) return;
		entry.disposeLayout?.();
		entry.disposeLayout = null;
		entry.placeholder = null;
		if (entry.webview) entry.webview.style.visibility = "hidden";
	}

	async canClose(paneId: string): Promise<boolean> {
		return electronTrpcClient.ide.close.mutate({ paneId });
	}

	async canCloseAll(paneIds: Iterable<string>): Promise<boolean> {
		const closed: string[] = [];
		let allowed = false;
		try {
			for (const paneId of paneIds) {
				if (!(await this.canClose(paneId))) return false;
				closed.push(paneId);
			}
			allowed = true;
			return true;
		} finally {
			// Electron's beforeunload check closes clean guests. If a later guest
			// vetoes the group close, restore those views using their live sessions.
			if (!allowed) {
				for (const paneId of closed) {
					const entry = this.entries.get(paneId);
					if (!entry || entry.state.status !== "ready") continue;
					this.detach(paneId);
					entry.disposeGuest?.();
					entry.webview?.remove();
					entry.webview = null;
					entry.disposeGuest = null;
					entry.state = { ...entry.state };
					this.notify(paneId);
				}
			}
		}
	}

	async close(paneId: string): Promise<void> {
		this.fileRequests.delete(paneId);
		const entry = this.entries.get(paneId);
		if (!entry) {
			this.notify(paneId);
			return;
		}
		this.detach(paneId);
		entry.disposeGuest?.();
		entry.webview?.remove();
		this.entries.delete(paneId);
		this.notify(paneId);
		await electronTrpcClient.ide.release.mutate({ paneId });
	}

	async stop(paneId: string): Promise<void> {
		await this.close(paneId);
		this.entries.set(paneId, {
			state: { status: "stopped" },
			webview: null,
			placeholder: null,
			disposeLayout: null,
			disposeGuest: null,
		});
		this.notify(paneId);
	}
}

export const ideRuntimeRegistry = new IdeRuntimeRegistry();
