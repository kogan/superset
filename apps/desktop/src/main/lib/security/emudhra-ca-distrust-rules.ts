import type { Certificate } from "electron";

// eMudhra intermediate CA key compromise (Oct 2026): eight emSign intermediate
// CA keys were recoverable (insufficient randomness) and all chain to
// `emSign ECC Root CA - G3`. This module decides whether a presented chain is
// anchored in that distrusted hierarchy. Pure and electron-runtime-free (the
// `Certificate` import is type-only), so it is unit-testable outside Electron.

/** Common Name of the distrusted root. In a verify-proc chain it appears only
 *  as the top intermediate's `issuerName` — Electron does not expose the root
 *  anchor itself. */
export const DISTRUSTED_ROOT_CN = "emSign ECC Root CA - G3";

/** SHA-256 fingerprints (Electron `sha256/<base64>` form) of compromised emSign
 *  intermediates, as an explicit block alongside the name-based rule. Captured
 *  from the live chain; extend with the full published set if ever needed. */
export const BLOCKED_FINGERPRINTS = new Set<string>([
	"sha256/QF35bRXXWJi0iSw5uKhYGbQPiFXmI571ZfBLn5YEQAM=", // EM EV TLS CA - G3A-1
	"sha256/MJQCV5IDmmivblU2hkEL2rfA1KNrkITLpkIC411uu90=", // emSign Root TLS CA - G3
]);

/**
 * Walk the presented certificate chain and report whether it is anchored in the
 * distrusted emSign ECC Root CA - G3 hierarchy.
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
