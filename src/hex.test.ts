import { describe, it, expect } from 'vitest'
import { fromHex, toHex } from './hex.js'

describe('hex', () => {
  it('round-trips bytes through hex', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xa1, 0xff])
    expect(toHex(bytes)).toBe('000fa1ff')
    expect(fromHex('000fa1ff')).toEqual(bytes)
  })

  it('accepts upper- and lower-case hex', () => {
    expect(fromHex('AbCd')).toEqual(new Uint8Array([0xab, 0xcd]))
  })

  it('throws on malformed hex instead of silently producing wrong bytes', () => {
    // A non-hex char used to coerce to 0 and an odd length used to truncate — both
    // yielded silently-wrong key bytes and undiagnosable non-delivery.
    expect(() => fromHex('abc')).toThrow(/hex/i) // odd length
    expect(() => fromHex('zz')).toThrow(/hex/i) // non-hex
    expect(() => fromHex('00gg')).toThrow(/hex/i)
  })

  it('treats the empty string as zero bytes', () => {
    expect(fromHex('')).toEqual(new Uint8Array([]))
  })
})
