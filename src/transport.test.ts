import { describe, it, expect, vi, beforeEach } from 'vitest'

const pool = vi.hoisted(() => ({ subscribes: 0, destroys: 0 }))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    subscribeMany(): { close(): void } {
      pool.subscribes += 1
      return { close: () => { /* noop */ } }
    }
    destroy(): void { pool.destroys += 1 }
    publish(): unknown[] { return [] }
  },
}))

import { deliveredCount, RELAY_TIMEOUT, subscribeGiftWraps, resetPool } from './transport.js'

// Ported from flock's `services.test.ts` — transport half only. The
// `currentPosition` describe block there exercised the geolocation half of
// `services.ts`, which was not ported into this kit (see transport.ts header).

const ok = (v: unknown): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value: v })
const rej = (r: unknown): PromiseSettledResult<unknown> => ({ status: 'rejected', reason: r })

describe('deliveredCount', () => {
  it('counts a plain fulfilled publish (relay accepted) as delivered', () => {
    expect(deliveredCount([ok(''), ok('accepted')])).toBe(2)
  })

  it('does NOT count a "connection failure" resolution — the pool resolves (not rejects) when a relay is unreachable', () => {
    expect(deliveredCount([ok('connection failure: ws://down.example')])).toBe(0)
  })

  it('does NOT count our timeout sentinel', () => {
    expect(deliveredCount([ok(RELAY_TIMEOUT)])).toBe(0)
  })

  it('does NOT count a rejected publish (relay refused the event)', () => {
    expect(deliveredCount([rej(new Error('blocked: pow required'))])).toBe(0)
  })

  it('counts only the relay that genuinely accepted, in a mixed fan-out', () => {
    expect(deliveredCount([ok(''), ok('connection failure: x'), rej('nope'), ok(RELAY_TIMEOUT)])).toBe(1)
  })

  it('treats an empty/undefined fulfilled value as accepted (relays often ack with no reason)', () => {
    expect(deliveredCount([ok(undefined), ok(null)])).toBe(2)
  })
})

describe('resilient subscriptions survive resetPool', () => {
  beforeEach(() => { pool.subscribes = 0; pool.destroys = 0 })

  it('rebuilds a live subscription on the fresh pool after resetPool', () => {
    const unsub = subscribeGiftWraps(['wss://r'], 'ptag', () => { /* noop */ })
    expect(pool.subscribes).toBe(1)

    resetPool()
    expect(pool.destroys).toBe(1)
    expect(pool.subscribes).toBe(2) // re-opened on the fresh pool, not orphaned

    // After the caller unsubscribes, a further reset must NOT re-open it.
    unsub()
    resetPool()
    expect(pool.subscribes).toBe(2)
  })

  it('never rebuilds a subscription the caller already closed', () => {
    const unsub = subscribeGiftWraps(['wss://r'], 'ptag', () => { /* noop */ })
    unsub()
    resetPool()
    expect(pool.subscribes).toBe(1) // no rebuild for a closed subscription
  })
})
