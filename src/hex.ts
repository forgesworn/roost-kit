// Hex <-> bytes. Ported from flock's `app/src/store.ts` (`fromHex`/`toHex`
// one-liners) as a standalone util, since roost-kit has no `store.ts` of its
// own to borrow them from.

import { bytesToHex } from '@noble/hashes/utils.js'

export const fromHex = (h: string): Uint8Array => {
  // Validate before parsing: a non-hex char yields NaN (coerced to 0) and an
  // odd length mis-parses the final nibble, so silently-wrong key bytes would
  // produce the wrong NIP-44 conversation key and total, undiagnosable non-
  // delivery. Fail loudly on malformed input instead.
  if (h.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(h)) {
    throw new Error('fromHex: expected an even-length hexadecimal string')
  }
  return Uint8Array.from(h.match(/.{1,2}/g) ?? [], (x) => parseInt(x, 16))
}

export const toHex = (b: Uint8Array): string => bytesToHex(b)
