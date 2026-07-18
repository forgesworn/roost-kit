// Hex <-> bytes. Ported from flock's `app/src/store.ts` (`fromHex`/`toHex`
// one-liners) as a standalone util, since roost-kit has no `store.ts` of its
// own to borrow them from.

import { bytesToHex } from '@noble/hashes/utils.js'

export const fromHex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/.{1,2}/g) ?? [], (x) => parseInt(x, 16))

export const toHex = (b: Uint8Array): string => bytesToHex(b)
