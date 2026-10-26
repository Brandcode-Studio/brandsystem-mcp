# Signed brand packages

Brandcode Studio (UCS, www.brandcode.studio) can sign every brand package it
serves from `GET /api/brand/hosted/:slug/pull` with an Ed25519 key. The local
MCP verifies that signature against public keys pinned in this package before
a package's `approval: "production_approved"` declaration can be conferred.

Both sides use Node's built-in `crypto`. Neither adds a dependency.

## Threat model

| Threat | Origin trust (#118) | Signature |
| --- | --- | --- |
| Agent or user points the connector at `https://evil.example` | Blocks it: approval from untrusted origins is ignored | Blocks it: evil.example cannot produce a valid signature |
| DNS hijack, mis-issued TLS certificate, compromised CDN or hosting edge serving brandcode.studio | **Does not block it**: the response really does come from the "trusted" origin | Blocks it: the attacker does not hold the private key |
| Package edited on disk after the pull (`.brand/brandcode-package.json`) | Detected through the stored package digest | Detected through the stored digest and an independent signature check (`brand_audit` → "Provenance: Studio package signature") |
| Package copied out of band (zip, git, email) to another machine | Cannot be judged, because the origin is unknown | Verifiable: copy `brandcode-package.json` and `brandcode-package.sig.json` together |
| Studio private key leaked | Not applicable | **Not protected.** Remove the key from `signing-keys.ts` and release (see Rotation) |
| Studio itself serves a wrong approval (compromised app or bad admin action) | Not protected | Not protected: the signature only proves that Studio said it |
| Local machine compromise (attacker edits `signing-keys.ts` or env) | Not protected | Not protected |

In short, origin trust proves where the bytes came from, as far as DNS, TLS and
the host can be trusted. A signature proves that the Studio key holder approved
exactly these bytes, wherever they came from.

Neither check widens the existing rule that a Studio approval is applied only
to a `.brand/` with no locally extracted content (website extraction and so on).

## Wire format

The pull response carries `signature` next to `package`, never inside it:

```json
{
  "contractVersion": "...",
  "package": { "...": "the signed body" },
  "signature": {
    "alg": "Ed25519",
    "keyId": "studio-2026-10",
    "digest": "sha256:<64 hex>",
    "sig": "<base64 Ed25519 signature>",
    "signedAt": "2026-10-25T12:00:00.000Z"
  }
}
```

- `digest` is the sha256 of the canonical JSON of `package`: object keys sorted
  recursively with the default JS sort, `undefined`-valued keys dropped, arrays
  kept in order, and primitives written with `JSON.stringify`. The MCP side is
  `src/lib/package-digest.ts` (`canonicalJson`, `computePackageDigest`), the
  same function that binds approvals to a package. The UCS side is
  `app/tools/lib/brand-package-signing.ts`, which first round-trips the payload
  through `JSON.stringify`/`JSON.parse` so its digest matches what the client
  parses off the wire.
- `sig` signs these UTF-8 bytes, joined by `\n`:
  `brandcode-package-signature/v1`, `keyId`, `signedAt`, `digest`. Every field
  is therefore authenticated, and the context line keeps the key from signing
  anything else.
- Both repos pin the same test vector, which includes the package, canonical
  string, digest, signed message, public key and signature:
  `test/connectors/fixtures/package-signature-vector.json` (MCP) and
  `tests/studio/fixtures/brand-package-signature-vector.json` (UCS). If the
  two files diverge, canonicalization has drifted.

The connector writes the signature beside the package as
`.brand/brandcode-package.sig.json`. A later unsigned pull removes it.

## Approval policy (MCP)

| Package | Result |
| --- | --- |
| Signed; signature verifies against a known key; digest matches | Approval may be conferred from **any** origin (it is portable). `approval.json` records `signature_key_id`. |
| Signed, but invalid: tampered body, wrong key, unknown `keyId`, malformed, or unsupported `alg` | Never conferred, even from the trusted origin. Reported as `signature_invalid`. |
| Unsigned, `BRANDCODE_REQUIRE_SIGNED_APPROVAL` off (the current default) | Today's behavior: conferred only from a trusted origin. |
| Unsigned, `BRANDCODE_REQUIRE_SIGNED_APPROVAL=true` | Refused: `unsigned_refused`. Existing unsigned approvals also stop resolving. |

At every compile, a signed approval resolves only while the stored signature
still verifies for the same `keyId` over the same digest. Removing or editing
the signature file, editing the package, or unpinning the key demotes the
brand to `provisional_extracted`.

`brand_brandcode_connect` and `brand_brandcode_sync` return
`package_signature.status` as `signed/verified`, `signed/invalid` (with a
`reason`) or `unsigned`. `brand_audit` adds a "Provenance: Studio package
signature" finding whenever a pulled package is on disk.

## Key format

- **UCS (private key)**:
  - `BRANDCODE_PACKAGE_SIGNING_PRIVATE_KEY`: Ed25519 PKCS8, either as PEM
    (literal `\n` escapes are accepted) or as base64 DER.
  - `BRANDCODE_PACKAGE_SIGNING_KEY_ID`: the key ID, matching
    `[A-Za-z0-9._:-]{1,128}`.

  If either variable is absent or invalid, UCS serves packages unsigned, the
  same as before. Key material is never logged.
- **MCP (public keys)**: `src/connectors/brandcode/signing-keys.ts` holds
  `PINNED_BRANDCODE_SIGNING_KEYS`, a list of
  `{ keyId, publicKey, status: "active" | "retired" }`. `publicKey` is an SPKI
  PEM or base64 SPKI DER. Pinned keys verify packages from any origin.
- **Staging or local Studios only**: `BRANDCODE_STUDIO_SIGNING_KEYS` is a JSON
  array of `{ origin, keyId, publicKey, status? }`. An env key verifies only
  packages served by its own origin. Entries that name a default origin
  (`https://www.brandcode.studio`, `https://brandcode.studio`) are ignored, as
  are entries whose `keyId` collides with a pinned key. The env can never stand
  in for the production keys.

## Rotation

1. Generate a new keypair with a new `keyId` (see Provisioning, step 1).
2. Add the new public key to `signing-keys.ts` as `status: "active"`, and set
   the previous key to `status: "retired"`. Retired keys still verify, so
   packages signed before the rotation keep resolving. Release the MCP.
3. Swap the UCS env vars (`…_PRIVATE_KEY`, `…_KEY_ID`) to the new key and
   redeploy UCS. From then on, every pull is signed with the new key, which
   re-signs any package the next time it is pulled.
4. After a grace period, once users have re-synced, delete the retired entry.

**Compromised key:** delete its entry from `signing-keys.ts` immediately (do
not mark it retired) and release the MCP. Then rotate UCS to a fresh key.
Approvals that rested on the removed key demote at the next compile, and users
must re-sync to get a package signed with the new key.

## Provisioning (coordinator)

Run these steps in order.

1. **Generate the keypair** on a trusted machine. Do not commit the private
   key.

   ```bash
   node -e '
   const { generateKeyPairSync } = require("node:crypto");
   const { publicKey, privateKey } = generateKeyPairSync("ed25519");
   const keyId = "studio-" + new Date().toISOString().slice(0, 7);
   console.log("KEY_ID=" + keyId);
   console.log("PRIVATE_KEY_B64=" + privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"));
   console.log("PUBLIC_KEY_PEM=\n" + publicKey.export({ format: "pem", type: "spki" }));
   '
   ```

2. **Store the private key in UCS (Vercel, Production only)**:

   ```bash
   cd /path/to/UCS
   printf %s "<PRIVATE_KEY_B64>" | vercel env add BRANDCODE_PACKAGE_SIGNING_PRIVATE_KEY production --sensitive
   printf %s "<KEY_ID>"          | vercel env add BRANDCODE_PACKAGE_SIGNING_KEY_ID production
   ```

   Then delete the private key from the terminal scrollback or any scratch
   file.

3. **Pin the public key in the MCP.** In
   `src/connectors/brandcode/signing-keys.ts`:

   ```ts
   export const PINNED_BRANDCODE_SIGNING_KEYS: readonly PinnedSigningKey[] = Object.freeze([
     {
       keyId: "<KEY_ID>",
       publicKey: `-----BEGIN PUBLIC KEY-----
   <base64 line from PUBLIC_KEY_PEM>
   -----END PUBLIC KEY-----`,
       status: "active",
     },
   ]);
   ```

   Update the "ships with an empty pinned key list" assertion in
   `test/connectors/brandcode-signature.test.ts`, then open the PR. Do not
   release it yet.

4. **Deploy UCS first.** Redeploy production so the new env vars take effect.
   Then check that a pull carries a signature:

   ```bash
   curl -s https://www.brandcode.studio/api/brand/hosted/<public-slug>/pull | jq '.signature | {alg,keyId,digest}'
   ```

   Released MCP versions ignore the extra field. A build that includes this
   change but has an **empty** key list treats signed packages as
   `signed/invalid (unknown_key)` and refuses their approval. Do not release
   such a build after step 4.

5. **Release the MCP** that contains the pinned key (merge the PR from step 3
   and run the normal release chain). Then check end to end with
   `brand_brandcode_connect` on a test directory. Expect
   `package_signature.status: "signed/verified"` and, for an approved package,
   `approval_outcome: "conferred"`.

6. **Later, require signatures.** Once every supported Studio signs its
   packages and users have upgraded, set `REQUIRE_SIGNED_APPROVAL_DEFAULT =
   true` in `src/connectors/brandcode/signature.ts` and release. Operators can
   opt in earlier with `BRANDCODE_REQUIRE_SIGNED_APPROVAL=true`.
