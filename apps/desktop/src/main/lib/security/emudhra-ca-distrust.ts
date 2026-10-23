import { app, type Certificate, type Session, session } from "electron";
import log from "electron-log/main";

// eMudhra intermediate CA key compromise (Oct 2026): eight emSign intermediate
// CA keys were recoverable (generated with insufficient randomness) and all
// chain to `emSign ECC Root CA - G3`. Chrome/Firefox distrusted that root;
// Chrome delivers the distrust via CRLSet + Chrome Root Store component updates,
// which this app never receives, and on macOS/Windows Electron validates against
// the OS keychain — so the root stays trusted here until the OS vendor removes
// it. This refuses any TLS chain anchored in that root, at the app level, so the
// fix holds regardless of Electron version or OS trust-store timing. Mirrors
// Node's own mitigation ("reject chains containing the blocked keys").
//
// Re-verify with the live test site (chains to the root):
//   https://testevg3.emsign.com/  — should fail to connect once this is active.

/** Common Name of the distrusted root. Appears in the chain only as the
 *  `issuerName` of the top intermediate — the root anchor itself is not among
 *  the certificates Electron exposes to the verify proc. */
const DISTRUSTED_ROOT_CN = "emSign ECC Root CA - G3";

/** SHA-256 fingerprints (Electron `sha256/<base64>` form) of compromised emSign
 *  intermediates, as an explicit belt-and-suspenders block alongside the
 *  name-based rule. Captured from the live chain; extend with the full published
 *  set if ever needed. */
const BLOCKED_FINGERPRINTS = new Set<string>([
	"sha256/QF35bRXXWJi0iSw5uKhYGbQPiFXmI571ZfBLn5YEQAM=", // EM EV TLS CA - G3A-1
	"sha256/MJQCV5IDmmivblU2hkEL2rfA1KNrkITLpkIC411uu90=", // emSign Root TLS CA - G3
]);

/**
 * Walk the presented certificate chain and report whether it is anchored in the
 * distrusted emSign ECC Root CA - G3 hierarchy. Exported for unit testing.
 */
export function chainIsDistrusted(leaf: Certificate | undefined): boolean {
	const seen = new Set<string>();
	let cert: Certificate | undefined = leaf;
	// Chains are short; the `seen` guard also terminates the self-signed top
	// (where `issuerCert === cert`).
	while (cert && !seen.has(cert.fingerprint)) {
		seen.add(cert.fingerprint);
		if (BLOCKED_FINGERPRINTS.has(cert.fingerprint)) return true;
		if (
			cert.subjectName?.includes(DISTRUSTED_ROOT_CN) ||
			cert.issuerName?.includes(DISTRUSTED_ROOT_CN)
		) {
			return true;
		}
		cert = cert.issuerCert;
	}
	return false;
}

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
