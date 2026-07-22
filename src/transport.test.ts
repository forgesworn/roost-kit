import { describe, it, expect, vi, beforeEach } from 'vitest'

const pool = vi.hoisted(() => ({ subscribes: 0, destroys: 0, nextEvents: [] as unknown[], publishResults: [] as Promise<unknown>[] }))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    subscribeMany(_relays: unknown, _filter: unknown, handlers: { onevent?: (e: unknown) => void; oneose?: () => void }): { close(): void } {
      pool.subscribes += 1
      const events = pool.nextEvents
      // Deliver asynchronously, as the real pool does (so `sub` is assigned first).
      queueMicrotask(() => { for (const e of events) handlers.onevent?.(e); handlers.oneose?.() })
      return { close: () => { /* noop */ } }
    }
    destroy(): void { pool.destroys += 1 }
    publish(): Promise<unknown>[] { return pool.publishResults }
  },
}))

import { deliveredCount, RELAY_TIMEOUT, subscribeGiftWraps, resetPool, fetchGiftWraps, publishSigned } from './transport.js'

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

describe('publishSigned', () => {
  const signed = { id: 'evt1', sig: 'sig1', kind: 1059 }

  beforeEach(() => { pool.publishResults = [] })

  it('resolves with the signed event once any relay accepts it', async () => {
    pool.publishResults = [Promise.resolve('')]
    await expect(publishSigned(['wss://r'], signed)).resolves.toBe(signed)
  })

  it('resolves when only some relays accept it in a mixed fan-out', async () => {
    pool.publishResults = [Promise.resolve('connection failure: ws://down.example'), Promise.resolve('')]
    await expect(publishSigned(['wss://down', 'wss://up'], signed)).resolves.toBe(signed)
  })

  it('throws when every relay rejects, fails to connect, or times out', async () => {
    pool.publishResults = [
      Promise.reject(new Error('blocked: pow required')),
      Promise.resolve('connection failure: ws://down.example'),
    ]
    await expect(publishSigned(['wss://r1', 'wss://r2'], signed)).rejects.toThrow('No relay accepted the event')
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

describe('fetchGiftWraps returns ALL candidates so junk cannot shadow the real one', () => {
  beforeEach(() => { pool.subscribes = 0; pool.destroys = 0; pool.nextEvents = [] })

  it('returns every match, newest-first — the caller tries each rather than trusting one pick', async () => {
    pool.nextEvents = [
      { id: 'real', pubkey: 'a', content: 'real-invite', created_at: 100 },
      { id: 'junk', pubkey: 'z', content: 'junk', created_at: 999 }, // attacker: created_at = now
      { id: 'mid', pubkey: 'b', content: 'other', created_at: 500 },
    ]
    const all = await fetchGiftWraps(['wss://r'], 'ptag')
    // All present, newest-first — so a caller can skip the undecryptable 'junk'
    // and still reach 'real', which a single max-created_at pick would have missed.
    expect(all.map((e) => e.id)).toEqual(['junk', 'mid', 'real'])
  })

  it('resolves an empty array when nothing matches', async () => {
    pool.nextEvents = []
    expect(await fetchGiftWraps(['wss://r'], 'ptag', 50)).toEqual([])
  })
})
