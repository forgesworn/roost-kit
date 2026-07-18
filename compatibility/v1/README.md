# Roost compatibility vectors v1

These public fixtures freeze the wire-visible contract consumed by Flock and
Fledgling: NIP-59 envelope shape and recovery, the uniform NIP-40 expiry window,
wrong-key failure, and relay fan-out accounting.

NIP-59 deliberately uses a fresh ephemeral key and randomised timestamps, so
the outer event bytes must not be golden snapshots. The fixture instead fixes
the input key material and inner rumor, then asserts the stable observable
contract. Change these vectors only for a deliberate, versioned protocol
change.

Run them with the normal provider gate:

```sh
npm test
npm run typecheck
npm run build
```
