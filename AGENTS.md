# AGENTS.md: roost-kit

Instructions in this file apply to the entire repository.

## Project Summary

Nostr transport primitives for private circles: NIP-59 gift wraps, relay fan-out, rotating inboxes, and a pre-signed offline outbox. Extracted from Flock for reuse by other ForgeSworn clients. Framework-free: owns no storage, UI, environment configuration, relay defaults, or identity keys; callers inject those concerns. ESM-only package (`"type": "module"`), requires Node.js 22+.

## Commands

```bash
npm install            # install dependencies
npm run build           # compile TypeScript into dist/
npm test                # run the Vitest suite
npm run test:watch      # run tests in watch mode
npm run typecheck       # type-check without emitting
npm run prepublishOnly  # pre-publish gate (typecheck + test + build); runs automatically before npm publish
```

There is no separate lint script.

## Repository Structure

- `src/signer.ts`: `Signer`/`SignedEvent`/`EventTemplate` contract (interfaces only, no implementation)
- `src/hex.ts`: `fromHex`/`toHex` byte-to-hex helpers
- `src/giftwrap.ts`: NIP-59 gift wrap/unwrap, NIP-40 expiry
- `src/rotation.ts`: rotating inbox seed scheduling for ongoing circles
- `src/relays.ts`: caller-owned relay policy (private/onion/profile sets, fail-loud Tor routing)
- `src/transport.ts`: relay pool, publish fan-out, fetch/subscribe
- `src/outbox.ts`: pre-signed offline outbox
- `src/index.ts`: barrel re-export
- `compatibility/v1/`: public fixtures freezing the wire contract (NIP-59 envelope semantics, expiry, wrong-key failure, relay fan-out accounting) for Flock and other cross-repository consumers
- `dist/`: build output (generated)

## Exports

Single entry point, `@forgesworn/roost-kit` (no subpaths).

- Signer contract: `Signer`, `SignedEvent`, `EventTemplate`
- NIP-59 gift wraps: `giftWrap`, `giftUnwrap`, `rawNip44Decrypt`, `WRAP_EXPIRY_SECONDS`
- Relay policy: `createRelayConfig`, `parseRelayList`, `isKnownNoLogRelay`, `unknownRelays`, `torRouteReady`, `effectiveRelays`, `resolveRelays`
- Relay fan-out and transport: `publishSigned`, `deliveredCount`, `RELAY_TIMEOUT`, `fetchGiftWraps`, `fetchWordInvites`, `subscribeGiftWraps`, `subscribeProfiles`, `resetPool` (plus deprecated single-result wrappers `fetchGiftWrap`, `fetchWordInvite`)
- Rotating inboxes: `rotationDue`, `refreshDue`, `ROTATION_PERIOD_SEC`, `ROTATION_STAGGER_SEC`, `ROTATION_REFRESH_SEC`
- Offline outbox: `createOutbox`
- Hex utilities: `fromHex`, `toHex`

## Coding Conventions

- British English spelling in identifiers and prose: `licence`, `colour`, `behaviour`, `organise`
- Minimal, vetted runtime dependencies (`@noble/hashes`, `nostr-tools`): do not add framework, DOM, storage, or environment-access dependencies
- Keep `src/` framework-free and silent: no DOM access, storage access, environment reads, console output, baked-in relay defaults, or unsigned offline queue entries
- NIP-44 encryption throughout (never the deprecated NIP-04); NIP-59 gift wraps (kind 1059) with NIP-40 `expiration` tags for the wire envelope, via `nostr-tools`
- Prefer TDD when changing behaviour: add or update a failing test first, then implement
- Keep changes minimal and consistent with the existing module layout
- Maintain ESM-compatible imports/exports (`.js` extensions on relative imports)
- Git: commit messages use `type: description` format. Do not include `Co-Authored-By` lines

## Working Guidelines

- Do not edit generated output in `dist/` by hand unless the user explicitly asks for it
- Treat relays as untrusted: do not add baked-in relay defaults, endorsed relay lists, or a silent Tor-to-clearnet fallback
- The `compatibility/v1` fixtures freeze a cross-repository wire contract: change them only for a deliberate, versioned protocol change
- Prefer targeted tests for the area being changed before broader validation
- Update documentation (`README.md`, `llms.txt`) when public API or behaviour changes

## Release Notes

Pre-1.0 and not yet published to npm. `v0.1.0` has a git tag and `CHANGELOG.md` entry, but `@forgesworn/roost-kit` is not on the npm registry yet; downstream consumers pin an immutable Git commit (see README `Install`).

Unlike sibling packages such as geohash-kit, there is no forgesworn/anvil-based release workflow wired up yet. `.github/workflows/ci.yml` runs `typecheck`, `test`, `build`, and `npm pack --dry-run` on every push and pull request: that is the only automation currently in place.

Current release flow (manual):

1. Bump `package.json` version by hand (e.g. `0.1.0` to `0.2.0`)
2. Add a `CHANGELOG.md` entry under the new version heading
3. Commit (`chore: release 0.2.0`), push main
4. Tag the commit (`git tag v0.2.0 && git push --tags`) and create a GitHub Release
5. `npm publish` by hand once the package is ready to go live on the registry

Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`. Tests, typecheck, and build should all pass before release-related changes are considered complete.

Semver rules of thumb:

| Change | Bump |
|---|---|
| Bug fix, no API change | Patch (0.1.x) |
| New feature, backwards compatible | Minor (0.x.0) |
| Breaking API change | Major (once at 1.0.0+) |
| Tooling, docs, refactor with no behaviour change | Patch or none |
