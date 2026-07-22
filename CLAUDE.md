# CLAUDE.md — roost-kit

Nostr transport primitives for private circles: NIP-59 gift wraps, relay fan-out, rotating inboxes, and a pre-signed offline outbox.

## Commands

- `npm run build` — compile TypeScript to dist/
- `npm test` — run all tests (vitest)
- `npm run test:watch` — watch mode
- `npm run typecheck` — type-check without emitting

## Structure

- `src/signer.ts` — `Signer`/`SignedEvent`/`EventTemplate` contract (interfaces only)
- `src/hex.ts` — `fromHex`/`toHex` byte↔hex helpers
- `src/giftwrap.ts` — NIP-59 gift wrap/unwrap, NIP-40 expiry
- `src/rotation.ts` — rotating inbox seed scheduling
- `src/relays.ts` — caller-owned relay policy, fail-loud Tor routing
- `src/transport.ts` — relay pool, publish fan-out, fetch/subscribe
- `src/outbox.ts` — pre-signed offline outbox
- `src/index.ts` — barrel re-export
- `compatibility/v1/` — public fixtures freezing the wire contract for cross-repository consumers (Flock and others)

## Exports

Single entry point — `@forgesworn/roost-kit` (no subpaths).

- Signer contract — `Signer`, `SignedEvent`, `EventTemplate`
- NIP-59 gift wraps — `giftWrap`, `giftUnwrap`, `rawNip44Decrypt`, `WRAP_EXPIRY_SECONDS`
- Relay policy — `createRelayConfig`, `parseRelayList`, `isKnownNoLogRelay`, `unknownRelays`, `torRouteReady`, `effectiveRelays`, `resolveRelays`
- Relay fan-out & transport — `publishSigned`, `deliveredCount`, `RELAY_TIMEOUT`, `fetchGiftWraps`, `fetchWordInvites`, `subscribeGiftWraps`, `subscribeProfiles`, `resetPool` (plus deprecated single-result wrappers `fetchGiftWrap`, `fetchWordInvite`)
- Rotating inboxes — `rotationDue`, `refreshDue`, `ROTATION_PERIOD_SEC`, `ROTATION_STAGGER_SEC`, `ROTATION_REFRESH_SEC`
- Offline outbox — `createOutbox`
- Hex utilities — `fromHex`, `toHex`

## Conventions

- **British English** — licence, colour, behaviour, organise
- **Minimal, vetted dependencies** — `@noble/hashes` and `nostr-tools` only; no framework, DOM, storage, or environment-access deps
- **ESM-only** — `"type": "module"` in package.json, Node.js 22+
- **NIP-44** encryption throughout (never the deprecated NIP-04); **NIP-59** gift wraps with **NIP-40** `expiration` tags
- **TDD** — write failing test first, then implement
- **Git:** commit messages use `type: description` format
- **Git:** Do NOT include `Co-Authored-By` lines in commits

## Release & Versioning

Pre-1.0 and **not yet published to npm**. `v0.1.0` has a git tag and `CHANGELOG.md` entry, but `@forgesworn/roost-kit` is not on the npm registry yet — downstream consumers pin an immutable Git commit (see README `Install`).

Unlike sibling packages such as geohash-kit, there is no [forgesworn/anvil](https://github.com/forgesworn/anvil)-based release workflow wired up yet. `.github/workflows/ci.yml` runs `typecheck`, `test`, `build`, and `npm pack --dry-run` on every push and pull request — that is the only automation currently in place.

Current release flow (manual):

1. Bump `package.json` version by hand (e.g. `0.1.0` → `0.2.0`)
2. Add a `CHANGELOG.md` entry under the new version heading
3. Commit (`chore: release 0.2.0`), push main
4. Tag the commit (`git tag v0.2.0 && git push --tags`) and create a GitHub Release
5. `npm publish` by hand once the package is ready to go live on the registry

Semver rules of thumb:

| Change | Bump |
|---|---|
| Bug fix, no API change | Patch (0.1.x) |
| New feature, backwards compatible | Minor (0.x.0) |
| Breaking API change | Major (once at 1.0.0+) |
| Tooling, docs, refactor with no behaviour change | Patch or none |
