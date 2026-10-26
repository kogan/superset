import { describe, expect, test } from "bun:test";
import type { Certificate } from "electron";
import { chainIsDistrusted } from "./emudhra-ca-distrust-rules";

// Minimal Certificate-shaped nodes; only the fields the walk reads are set.
type Node = {
	fingerprint: string;
	subjectName?: string;
	issuerName?: string;
	issuerCert?: Node;
};

function chain(...nodes: Node[]): Certificate {
	for (let i = 0; i < nodes.length - 1; i++) nodes[i].issuerCert = nodes[i + 1];
	// Top is self-signed in a real chain; mirror that to prove termination.
	const top = nodes[nodes.length - 1];
	top.issuerCert = top;
	return nodes[0] as unknown as Certificate;
}

describe("chainIsDistrusted", () => {
	// The real emSign G3 chain as Electron exposes it (root anchor absent; it
	// appears only as the top intermediate's issuerName). Captured from the live
	// test site https://testevg3.emsign.com/.
	test("blocks the live emSign ECC Root CA - G3 chain", () => {
		expect(
			chainIsDistrusted(
				chain(
					{
						fingerprint: "sha256/leafXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX=",
						subjectName: "testevg3.emsign.com",
						issuerName: "EM EV TLS CA - G3A-1",
					},
					{
						fingerprint: "sha256/QF35bRXXWJi0iSw5uKhYGbQPiFXmI571ZfBLn5YEQAM=",
						subjectName: "EM EV TLS CA - G3A-1",
						issuerName: "emSign Root TLS CA - G3",
					},
					{
						fingerprint: "sha256/MJQCV5IDmmivblU2hkEL2rfA1KNrkITLpkIC411uu90=",
						subjectName: "emSign Root TLS CA - G3",
						issuerName: "emSign ECC Root CA - G3",
					},
				),
			),
		).toBe(true);
	});

	test("blocks by issuerName even when fingerprints are unknown", () => {
		expect(
			chainIsDistrusted(
				chain(
					{
						fingerprint: "sha256/unknownLeaf000000000000000000000000000000000=",
						subjectName: "victim.example",
						issuerName: "Some Future emSign Intermediate",
					},
					{
						fingerprint: "sha256/unknownInt0000000000000000000000000000000000=",
						subjectName: "Some Future emSign Intermediate",
						issuerName: "emSign ECC Root CA - G3",
					},
				),
			),
		).toBe(true);
	});

	test("blocks by compromised intermediate fingerprint regardless of names", () => {
		expect(
			chainIsDistrusted(
				chain({
					fingerprint: "sha256/QF35bRXXWJi0iSw5uKhYGbQPiFXmI571ZfBLn5YEQAM=",
					subjectName: "renamed",
					issuerName: "renamed-root",
				}),
			),
		).toBe(true);
	});

	test("allows a normal, unrelated chain (DigiCert-style)", () => {
		expect(
			chainIsDistrusted(
				chain(
					{
						fingerprint: "sha256/github0000000000000000000000000000000000000=",
						subjectName: "github.com",
						issuerName: "Sectigo ECC Domain Validation Secure Server CA",
					},
					{
						fingerprint: "sha256/sectigo000000000000000000000000000000000000=",
						subjectName: "Sectigo ECC Domain Validation Secure Server CA",
						issuerName: "USERTrust ECC Certification Authority",
					},
					{
						fingerprint: "sha256/usertrust00000000000000000000000000000000000=",
						subjectName: "USERTrust ECC Certification Authority",
						issuerName: "USERTrust ECC Certification Authority",
					},
				),
			),
		).toBe(false);
	});

	test("terminates on a self-signed top and returns false", () => {
		expect(
			chainIsDistrusted(
				chain({
					fingerprint: "sha256/selfsigned0000000000000000000000000000000000=",
					subjectName: "Internal Root",
					issuerName: "Internal Root",
				}),
			),
		).toBe(false);
	});

	test("handles a missing certificate", () => {
		expect(chainIsDistrusted(undefined)).toBe(false);
	});
});
