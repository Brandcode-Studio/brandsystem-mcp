/**
 * Brandcode Studio package-signing public keys pinned in this release.
 *
 * Studio signs every pulled package with an Ed25519 key whose private half
 * lives only in the Studio production environment. A package signature is
 * accepted only when its keyId names a key in this list (or, for a
 * non-default staging Studio, in BRANDCODE_STUDIO_SIGNING_KEYS; see
 * signature.ts). Pinned keys verify regardless of which origin served the
 * package, which is what makes a signed approval portable.
 *
 * Entries:
 *   keyId      Must equal BRANDCODE_PACKAGE_SIGNING_KEY_ID on the Studio side.
 *   publicKey  Ed25519 public key, SPKI PEM or base64 SPKI DER.
 *   status     "active"  — the key Studio currently signs with.
 *              "retired" — no longer used for new signatures, kept so packages
 *                          signed before a rotation still verify.
 * A compromised key is deleted from this list outright (never "retired").
 *
 * Rotation follows docs/SIGNED-PACKAGES.md: add the new key as "active",
 * mark the previous one "retired", and release before Studio switches keys.
 */

export type SigningKeyStatus = "active" | "retired";

export interface PinnedSigningKey {
  keyId: string;
  publicKey: string;
  status: SigningKeyStatus;
}

export const PINNED_BRANDCODE_SIGNING_KEYS: readonly PinnedSigningKey[] = Object.freeze([
  {
    keyId: "studio-2026-10",
    publicKey: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAOoEEMgh9J0l4HxeIQWZgmYu0v0nZjNEj2S/gPS7ANrY=
-----END PUBLIC KEY-----`,
    status: "active",
  },
]);
