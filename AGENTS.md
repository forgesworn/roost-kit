# AGENTS.md — roost-kit

Instructions in this file apply to the entire repository.

## Project Summary

- Nostr transport primitives for private circles: NIP-59 gift wraps, relay fan-out, rotating inboxes, and a pre-signed offline outbox.
- Extracted from Flock for reuse by Fledgling and other clients. Framework-free — owns no storage, UI, environment configuration, relay defaults, or identity keys; callers inject those concerns.
- ESM-only package (`"type": "module"`).
- Requires Node.js 22+.

## Key Commands

- `npm run build` — compile TypeScript into `dist/`
- `npm test` — run the Vitest suite
- `npm run test:watch` — run tests in watch mode
- `npm run typecheck` — TypeScript type-check without emitting
- `npm run prepublishOnly` — the pre-publish gate (`typecheck` + `test` + `build`); runs automatically before `npm publish`, not something you normally invoke by hand

## Repository Structure

- `src/signer.ts` — `Signer`/`SignedEvent`/`EventTemplate` contract (interfaces only; no implementation)
- `src/hex.ts` — `fromHex`/`toHex` byte↔hex helpers
- `src/giftwrap.ts` — NIP-59 gift wrap/unwrap, NIP-40 expiry
- `src/rotation.ts` — rotating inbox seed scheduling for ongoing circles
- `src/relays.ts` — caller-owned relay policy (private/onion/profile sets, fail-loud Tor routing)
- `src/transport.ts` — relay pool, publish fan-out, fetch/subscribe
- `src/outbox.ts` — pre-signed offline outbox
- `src/index.ts` — barrel re-export
- `compatibility/v1/` — public fixtures freezing the wire contract (NIP-59 envelope semantics, expiry, wrong-key failure, relay fan-out accounting) for Flock/Fledgling and other cross-repository consumers
- `dist/` — build output (generated)

## Coding Conventions

- Use British English spelling in identifiers and prose: `licence`, `colour`, `behaviour`, `organise`.
- Runtime dependencies are minimal and vetted (`@noble/hashes`, `nostr-tools`) — do not add framework, DOM, storage, or environment-access dependencies.
- Keep `src/` framework-free and silent: no DOM access, storage access, environment reads, console output, baked-in relay defaults, or unsigned offline queue entries.
- Uses NIP-59 gift wraps (kind 1059) with NIP-40 `expiration` tags for the wire envelope; encryption is always NIP-44 (never the deprecated NIP-04), via `nostr-tools`.
- Prefer TDD when changing behaviour: add or update a failing test first, then implement.
- Keep changes minimal and consistent with the existing module layout.
- Maintain ESM-compatible imports/exports (`.js` extensions on relative imports).

## Working Guidelines

- Do not edit generated output in `dist/` by hand unless the user explicitly asks for it.
- Treat relays as untrusted: do not add baked-in relay defaults, endorsed relay lists, or a silent Tor-to-clearnet fallback.
- The `compatibility/v1` fixtures freeze a cross-repository wire contract — change them only for a deliberate, versioned protocol change.
- Prefer targeted tests for the area being changed before broader validation.
- Update documentation (`README.md`, `llms.txt`) when public API or behaviour changes.

## Release Notes

- Use conventional commit prefixes: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- Pre-1.0 and not yet published to npm — see `CLAUDE.md` for the current release process. Until it is published, downstream consumers pin an immutable Git commit.
- Tests, typecheck, and build should all pass before release-related changes are considered complete.
