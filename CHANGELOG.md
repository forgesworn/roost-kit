# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-18

Initial release of `@forgesworn/roost-kit` — Nostr transport primitives for
private circles, extracted from Flock for reuse by Fledgling and other
clients.

### Added

- Transport extraction from Flock: signer types, NIP-59 gift wrapping,
  relay fan-out, and rotating inbox schedules.
- A pre-signed offline outbox.
- Public `compatibility/v1` fixtures freezing NIP-59 envelope semantics,
  expiry, wrong-key failure, and relay fan-out accounting for
  cross-repository consumers.

### Fixed

- Escaped wire ids, joined-announce roster healing, fresh-only safety
  notifications, and an outbox race condition.

[0.1.0]: https://github.com/forgesworn/roost-kit/releases/tag/v0.1.0
