# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `giftWrap` takes an optional `expirySeconds`, defaulting to the unchanged
  `WRAP_EXPIRY_SECONDS` (16 days). **Purely additive: no existing caller changes
  behaviour by a single second.** On a relay that does not prune by age this
  window is the retention policy rather than a hygiene tag, and its right value
  differs per client — a community app whose members meet monthly needs longer
  than the gap between gatherings, while a safety or live-location app wants the
  shortest window that still delivers. Retuning the shared constant would have
  imposed one answer on all four consumers silently, at whatever moment each next
  bumped its pin.
- `MIN_WRAP_EXPIRY_SECONDS` (3 days), the floor `giftWrap` will accept. Below it
  a wrap can be published ALREADY EXPIRED: `created_at` is backdated up to 2 days
  and the expiry derives from that stamp, so `nostr-rs-relay` rejects the event
  at ingest with *"invalid: The event has already expired"* — which looks like a
  successful publish from the sending side and a message nobody receives.
  Refused with a `RangeError` rather than clamped, so a caller is never left
  believing a number this package overruled.

### Note for callers taking the new parameter

**One window per application, across every wrap type it sends.** A per-type
window is a type-tell: an observer who cannot read a wrap can still sort traffic
into kinds by expiry delta alone. `giftWrap` sees one call at a time and cannot
enforce this, so a caller choosing a custom window owes itself a test that every
path it wraps on passes the same one — including paths reaching this package
through another library.

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
