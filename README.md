# @forgesworn/roost-kit

Nostr transport primitives for private circles: signer types, NIP-59 gift
wrapping, relay fan-out, rotating inbox schedules, and a pre-signed offline
outbox.

This package was extracted from Flock for reuse by Fledgling and other clients.
It is framework-free and owns no storage, UI, environment configuration, relay
defaults, or identity keys. Callers inject those concerns.

## Install

```bash
npm install @forgesworn/roost-kit
```

ESM-only, Node 22 or newer.

Until the package is published to npm, consumers should pin an immutable Git
commit:

```json
{
  "dependencies": {
    "@forgesworn/roost-kit": "git+https://github.com/forgesworn/roost-kit.git#<commit>"
  }
}
```

## Main surfaces

- `giftWrap`, `giftUnwrap`, `rawNip44Decrypt` for NIP-59 envelopes.
- `publishSigned`, `subscribeGiftWraps`, `fetchGiftWrap` and
  `fetchWordInvite` for relay transport.
- `createRelayConfig`, `resolveRelays`, `effectiveRelays` for caller-owned
  relay policy, including fail-loud Tor routing.
- `rotationDue`, `refreshDue` for rotating inbox scheduling.
- `createOutbox` for retrying already-signed events without losing items
  enqueued during an in-flight flush.

## Security boundary

Relays are untrusted. Roost does not choose or endorse relay URLs, persist
secrets, or silently fall back from Tor to clearnet. The caller must validate
its trust policy, protect signer material, supply durable outbox storage, and
render delivery failures honestly.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The library is MIT licensed.
