import { app, type Session, session } from "electron";
import log from "electron-log/main";
import { chainIsDistrusted } from "./emudhra-ca-distrust-rules";

// eMudhra intermediate CA key compromise (Oct 2026): anyone with the recovered
// emSign intermediate keys can forge a trusted cert for any host. On macOS/
// Windows Electron validates against the OS keychain, which keeps trusting
// `emSign ECC Root CA - G3` until the OS vendor removes it, and Chrome's CRLSet
// / Chrome Root Store updates never reach this app. This refuses any chain
// anchored in that root at the app level — version- and OS-independent, so it
// holds regardless of the Electron line; mirrors Node's own mitigation.
//
// Re-verify with the live test site (chains to the root):
//   https://testevg3.emsign.com/  — should fail to connect once this is active.
// The matching logic lives in ./emudhra-ca-distrust-rules (unit-tested).

function applyTo(targetSession: Session): void {
	targetSession.setCertificateVerifyProc((request, callback) => {
		if (chainIsDistrusted(request.certificate)) {
			log.warn(
				"[security] Blocked TLS chain anchored in distrusted emSign ECC Root CA - G3",
				{ hostname: request.hostname },
			);
			callback(-2); // reject
			return;
		}
		callback(-3); // defer to Chromium's default verification
	});
}

/**
 * Install the emSign G3 distrust on every Electron session — existing and
 * future (the auto-updater's defaultSession, the app partition, the in-app
 * browser, and dynamically created IDE partitions). Call once, early in main
 * startup, before any network use.
 */
export function installEmudhraCaDistrust(): void {
	app.on("session-created", applyTo);
	// The default session may already exist; apply explicitly once ready.
	// Idempotent with the event above.
	app
		.whenReady()
		.then(() => applyTo(session.defaultSession))
		.catch((error) => {
			log.error("[security] Failed to install emSign G3 distrust", error);
		});
}
