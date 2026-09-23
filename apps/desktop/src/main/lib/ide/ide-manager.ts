import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { TRPCError } from "@trpc/server";
import { type BrowserWindow, session, webContents } from "electron";
import type { IdePrepare, IdeView } from "shared/ide-types";
import { portForwardId } from "shared/types";
import {
	isOAuthAuthorizationUrl,
	markBrowserPanePopup,
} from "../browser/popup-window";
import { portForwardManager } from "../port-forward";
import { safeOpenExternal } from "../safe-url";
import { authenticateIde, ideFolderUrl, isIdeOrigin } from "./authenticate";
import { isNativeClipboardShortcut } from "./clipboard-shortcuts";

interface IdeEntry {
	workspaceId: string;
	host: string;
	sessionId: string;
	partition: string;
	guestSession: Electron.Session;
	forwardClientId: string;
	prepared: Promise<IdeView>;
	origin: string | null;
	guest: Electron.WebContents | null;
	detachGuest: (() => void) | null;
	closePending: Promise<boolean> | null;
}

interface WindowEntries {
	panes: Map<string, IdeEntry>;
	detach: () => void;
}

export class IdeManager {
	private readonly windows = new Map<number, WindowEntries>();
	private readonly focusEvents = new EventEmitter<Record<string, []>>();
	private closing = Promise.resolve();
	private readonly groupCloseChecks = new Map<
		number | "app",
		Promise<boolean>
	>();

	canCloseWindow(window: BrowserWindow): Promise<boolean> {
		return this.checkGroupClose(window.id);
	}

	canCloseApp(): Promise<boolean> {
		return this.checkGroupClose("app");
	}

	private enqueueClose<T>(operation: () => Promise<T>): Promise<T> {
		const pending = this.closing.then(operation);
		this.closing = pending.then(
			() => {},
			() => {},
		);
		return pending;
	}

	private checkGroupClose(key: number | "app"): Promise<boolean> {
		const current = this.groupCloseChecks.get(key);
		if (current) return current;
		const pending = this.enqueueClose(async () => {
			const windows =
				key === "app" ? [...this.windows.values()] : [this.windows.get(key)];
			const checked: Array<{ guest: Electron.WebContents; url: string }> = [];
			let allowed = false;
			try {
				for (const window of windows) {
					for (const entry of window?.panes.values() ?? []) {
						const guest = entry.guest;
						if (!guest || guest.isDestroyed()) continue;
						const url = guest.getURL();
						if (!(await this.dispatchBeforeUnload(guest))) return false;
						checked.push({ guest, url });
					}
				}
				allowed = true;
				return true;
			} finally {
				if (!allowed) {
					// A clean workbench disconnects during beforeunload. Restore it if
					// another editor vetoes the window/app close.
					await Promise.allSettled(
						checked.map(({ guest, url }) =>
							guest.isDestroyed() ? Promise.resolve() : guest.loadURL(url),
						),
					);
				}
			}
		}).finally(() => this.groupCloseChecks.delete(key));
		this.groupCloseChecks.set(key, pending);
		return pending;
	}

	private async dispatchBeforeUnload(
		guest: Electron.WebContents,
	): Promise<boolean> {
		if (guest.isDestroyed()) return true;
		// Electron closes webview guests even after will-prevent-unload fires.
		// Dispatch the cancelable lifecycle event before invoking native close.
		const prevented: unknown = await guest.executeJavaScript(`(() => {
			const event = new Event("beforeunload", { cancelable: true });
			window.dispatchEvent(event);
			return event.defaultPrevented;
		})()`);
		return guest.isDestroyed() || prevented === false;
	}

	onFocus(
		window: BrowserWindow,
		paneId: string,
		listener: () => void,
	): () => void {
		const channel = `${window.id}:${paneId}`;
		const unsubscribe = () => {
			this.focusEvents.off(channel, listener);
			window.off("closed", unsubscribe);
		};
		this.focusEvents.on(channel, listener);
		window.once("closed", unsubscribe);
		return unsubscribe;
	}

	prepare(window: BrowserWindow, input: IdePrepare): Promise<IdeView> {
		const entries = this.forWindow(window);
		const previous = entries.panes.get(input.paneId);
		const host = input.target.kind === "local" ? "local" : input.target.hostUrl;
		if (previous) {
			if (
				previous.workspaceId !== input.workspaceId ||
				previous.host !== host
			) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "IDE pane belongs to another workspace",
				});
			}
			if (previous.sessionId === input.connection.sessionId)
				return previous.prepared;
			if (previous.guest && !previous.guest.isDestroyed()) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Close the previous IDE view before reconnecting",
				});
			}
			void this.remove(entries, input.paneId, previous);
		}

		const partition = `superset-ide-${randomUUID()}`;
		const entry: IdeEntry = {
			workspaceId: input.workspaceId,
			host,
			sessionId: input.connection.sessionId,
			partition,
			guestSession: session.fromPartition(partition, { cache: false }),
			forwardClientId: `ide:${window.id}:${randomUUID()}`,
			prepared: Promise.resolve({
				url: "",
				partition,
				sessionId: input.connection.sessionId,
			}),
			origin: null,
			guest: null,
			detachGuest: null,
			closePending: null,
		};
		entries.panes.set(input.paneId, entry);
		entry.prepared = this.prepareEntry(entry, input)
			.then((view) => {
				if (entries.panes.get(input.paneId) !== entry || window.isDestroyed()) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "IDE pane was closed while connecting",
					});
				}
				return view;
			})
			.catch(async (error: unknown) => {
				await this.remove(entries, input.paneId, entry);
				if (error instanceof TRPCError) throw error;
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message: "Could not connect to the IDE. Try opening it again.",
				});
			});
		return entry.prepared;
	}

	async release(window: BrowserWindow, paneId: string): Promise<void> {
		const entries = this.windows.get(window.id);
		const entry = entries?.panes.get(paneId);
		if (entries && entry) await this.remove(entries, paneId, entry);
	}

	async close(window: BrowserWindow, paneId: string): Promise<boolean> {
		const entry = this.windows.get(window.id)?.panes.get(paneId);
		const guest = entry?.guest;
		if (!entry || !guest || guest.isDestroyed()) return true;
		if (entry.closePending) return entry.closePending;
		const pending = this.enqueueClose(async () => {
			if (!(await this.dispatchBeforeUnload(guest))) return false;
			if (guest.isDestroyed()) return true;
			return new Promise<boolean>((resolve) => {
				guest.once("destroyed", () => resolve(true));
				guest.close();
			});
		});
		entry.closePending = pending;
		try {
			return await pending;
		} finally {
			entry.closePending = null;
		}
	}

	register(window: BrowserWindow, paneId: string, webContentsId: number): void {
		const entry = this.windows.get(window.id)?.panes.get(paneId);
		const guest = webContents.fromId(webContentsId);
		if (
			!entry ||
			!guest ||
			guest.isDestroyed() ||
			!entry.origin ||
			guest.hostWebContents !== window.webContents ||
			guest.session !== entry.guestSession ||
			!isIdeOrigin(guest.getURL(), entry.origin)
		) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "IDE view does not belong to this window and pane",
			});
		}
		if (entry.guest === guest) return;
		if (entry.guest && !entry.guest.isDestroyed()) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "IDE pane already has a view",
			});
		}
		entry.detachGuest?.();
		entry.guest = guest;
		entry.detachGuest = this.protectGuest(guest, entry.origin, () => {
			this.focusEvents.emit(`${window.id}:${paneId}`);
		});
	}

	private async prepareEntry(
		entry: IdeEntry,
		input: IdePrepare,
	): Promise<IdeView> {
		let port = input.connection.port;
		if (input.target.kind === "remote") {
			const target = {
				hostUrl: input.target.hostUrl,
				workspaceId: input.workspaceId,
				remotePort: port,
			};
			const forwards = await portForwardManager.sync({
				clientId: entry.forwardClientId,
				hostUrl: target.hostUrl,
				workspaceId: target.workspaceId,
				ports: [port],
			});
			let forward = forwards.find((item) => item.id === portForwardId(target));
			if (forward?.status.state === "busy") {
				forward =
					(await portForwardManager.retryEphemeral(forward.id)) ?? undefined;
			}
			if (forward?.status.state !== "active")
				throw new Error("IDE forwarding is unavailable");
			port = forward.status.localPort;
		}
		const origin = `http://127.0.0.1:${port}`;
		const cookies = await authenticateIde({
			origin,
			folderPath: input.connection.folderPath,
			password: input.connection.password,
		});
		for (const cookie of cookies) {
			await entry.guestSession.cookies.set({
				url: origin,
				...cookie,
				path: "/",
				httpOnly: true,
				sameSite: "lax",
			});
		}
		entry.origin = origin;
		return {
			url: ideFolderUrl(origin, input.connection.folderPath),
			partition: entry.partition,
			sessionId: entry.sessionId,
		};
	}

	private forWindow(window: BrowserWindow): WindowEntries {
		const windowId = window.id;
		const existing = this.windows.get(windowId);
		if (existing) return existing;
		const ownerContents = window.webContents;
		const onAttach = (
			event: Electron.Event,
			preferences: Electron.WebPreferences,
			params: Record<string, string>,
		) => {
			if (!params.partition?.startsWith("superset-ide-")) return;
			const entry = [...entries.panes.values()].find(
				(value) => value.partition === params.partition,
			);
			if (!entry?.origin || !isIdeOrigin(params.src ?? "", entry.origin)) {
				event.preventDefault();
				return;
			}
			delete preferences.preload;
			preferences.nodeIntegration = false;
			preferences.nodeIntegrationInSubFrames = false;
			preferences.contextIsolation = true;
			preferences.sandbox = true;
			preferences.webSecurity = true;
		};
		const onAttached = (
			_event: Electron.Event,
			guest: Electron.WebContents,
		) => {
			const match = [...entries.panes].find(
				([, value]) => value.guestSession === guest.session,
			);
			if (!match) return;
			const [paneId, entry] = match;
			if (!entry.origin) return;
			if (entry.guest && !entry.guest.isDestroyed()) {
				guest.close();
				return;
			}
			entry.guest = guest;
			entry.detachGuest = this.protectGuest(guest, entry.origin, () => {
				this.focusEvents.emit(`${windowId}:${paneId}`);
			});
		};
		const onClosed = () => {
			for (const [paneId, entry] of entries.panes)
				void this.remove(entries, paneId, entry);
			entries.detach();
			this.windows.delete(windowId);
		};
		const entries: WindowEntries = {
			panes: new Map(),
			detach: () => {
				if (!ownerContents.isDestroyed()) {
					ownerContents.off("will-attach-webview", onAttach);
					ownerContents.off("did-attach-webview", onAttached);
					ownerContents.off("render-process-gone", onClosed);
				}
				window.off("closed", onClosed);
			},
		};
		ownerContents.on("will-attach-webview", onAttach);
		ownerContents.on("did-attach-webview", onAttached);
		ownerContents.once("render-process-gone", onClosed);
		window.once("closed", onClosed);
		this.windows.set(windowId, entries);
		return entries;
	}

	private protectGuest(
		guest: Electron.WebContents,
		origin: string,
		onFocus: () => void,
	): () => void {
		guest.setIgnoreMenuShortcuts(true);
		const onInput = (event: Electron.Event, input: Electron.Input) => {
			const nativeClipboard = isNativeClipboardShortcut(input);
			guest.setIgnoreMenuShortcuts(!nativeClipboard);
			if (!nativeClipboard || input.type !== "keyDown") return;
			const key = input.key.toLowerCase();
			if (process.platform !== "darwin" && key !== "v") return;
			event.preventDefault();
			switch (key) {
				case "c":
					guest.copy();
					break;
				case "x":
					guest.cut();
					break;
				case "v":
					guest.paste();
					break;
			}
		};
		guest.on("before-input-event", onInput);
		let stopped = false;
		let generation = 0;
		const watchFocus = async (current: number): Promise<void> => {
			while (!stopped && generation === current && !guest.isDestroyed()) {
				try {
					await guest.executeJavaScript(`new Promise((resolve) => {
						const focused = () => {
							document.removeEventListener("pointerdown", focused, true);
							window.removeEventListener("focus", focused);
							resolve();
						};
						document.addEventListener("pointerdown", focused, true);
						window.addEventListener("focus", focused);
					})`);
				} catch {
					return;
				}
				if (!stopped && generation === current && !guest.isDestroyed())
					onFocus();
			}
		};
		const onReady = () => {
			generation += 1;
			void watchFocus(generation);
		};
		guest.on("dom-ready", onReady);
		const onNavigate = (event: Electron.Event, url: string) => {
			if (isIdeOrigin(url, origin)) return;
			event.preventDefault();
			void safeOpenExternal(url);
		};
		guest.on("will-navigate", onNavigate);
		guest.on("will-redirect", onNavigate);
		guest.setWindowOpenHandler((details) => {
			if (
				isIdeOrigin(details.url, origin) ||
				(details.url.startsWith("https:") &&
					isOAuthAuthorizationUrl(details.url))
			) {
				return {
					action: "allow",
					outlivesOpener: false,
					overrideBrowserWindowOptions: {
						webPreferences: {
							nodeIntegration: false,
							contextIsolation: true,
							sandbox: true,
						},
					},
				};
			}
			void safeOpenExternal(details.url);
			return { action: "deny" };
		});
		const onCreated = (popup: BrowserWindow) => {
			markBrowserPanePopup(popup.webContents);
			const onPopupNavigate = (event: Electron.Event, url: string) => {
				if (isIdeOrigin(url, origin) || url.startsWith("https:")) return;
				event.preventDefault();
				void safeOpenExternal(url);
			};
			popup.webContents.on("will-navigate", onPopupNavigate);
			popup.webContents.on("will-redirect", onPopupNavigate);
			popup.webContents.setWindowOpenHandler(({ url }) => {
				void safeOpenExternal(url);
				return { action: "deny" };
			});
		};
		guest.on("did-create-window", onCreated);
		return () => {
			stopped = true;
			if (guest.isDestroyed()) return;
			guest.off("dom-ready", onReady);
			guest.off("before-input-event", onInput);
			guest.off("will-navigate", onNavigate);
			guest.off("will-redirect", onNavigate);
			guest.off("did-create-window", onCreated);
		};
	}

	private async remove(
		entries: WindowEntries,
		paneId: string,
		entry: IdeEntry,
	): Promise<void> {
		if (entries.panes.get(paneId) === entry) entries.panes.delete(paneId);
		if (entry.guest && !entry.guest.isDestroyed() && entry.detachGuest) {
			entry.guest.once("destroyed", entry.detachGuest);
		} else {
			entry.detachGuest?.();
		}
		await Promise.allSettled([
			portForwardManager.releaseClient(entry.forwardClientId),
			entry.guestSession.clearStorageData(),
		]);
	}
}

export const ideManager = new IdeManager();
