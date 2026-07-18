import { describe, it, expect, beforeEach } from 'vitest'
import { createOutbox, type OutboxItem, type OutboxStore } from './outbox.js'
import type { SignedEvent } from './signer.js'

describe('outbox', () => {
  let store: OutboxStore & { data: OutboxItem[] }
  let outbox: ReturnType<typeof createOutbox>

  beforeEach(() => {
    // In-memory store stub
    const data: OutboxItem[] = []
    store = {
      data,
      load: () => data,
      save: (items) => {
        data.length = 0
        data.push(...items)
      },
    }
    outbox = createOutbox(store)
  })

  const stubEvent = (tags: string[][] = []): SignedEvent => ({
    id: 'test-id',
    pubkey: 'test-pubkey',
    kind: 20078,
    created_at: 1000,
    tags,
    content: 'test',
    sig: 'test-sig',
  })

  describe('enqueue', () => {
    it('persists items to store', () => {
      const event = stubEvent()
      outbox.enqueue(event, ['relay1'], 1000)
      expect(store.data).toHaveLength(1)
      expect(store.data[0].event).toBe(event)
      expect(store.data[0].relays).toEqual(['relay1'])
      expect(store.data[0].queuedAt).toBe(1000)
    })

    it('captures expiration tag as expiresAt', () => {
      const event = stubEvent([['expiration', '2000']])
      outbox.enqueue(event, [], 1000)
      expect(store.data[0].expiresAt).toBe(2000)
    })

    it('handles missing expiration tag', () => {
      const event = stubEvent()
      outbox.enqueue(event, [], 1000)
      expect(store.data[0].expiresAt).toBeUndefined()
    })

    it('handles invalid expiration tag value', () => {
      const event = stubEvent([['expiration', 'invalid']])
      outbox.enqueue(event, [], 1000)
      expect(store.data[0].expiresAt).toBeUndefined()
    })

    it('size() returns correct count', () => {
      outbox.enqueue(stubEvent(), ['relay1'], 1000)
      outbox.enqueue(stubEvent(), ['relay2'], 1001)
      expect(outbox.size()).toBe(2)
    })
  })

  describe('prune', () => {
    it('drops expired items only', () => {
      outbox.enqueue(stubEvent([['expiration', '1500']]), [], 1000)
      outbox.enqueue(stubEvent([['expiration', '2000']]), [], 1000)
      outbox.enqueue(stubEvent(), [], 1000) // no expiration
      expect(outbox.size()).toBe(3)

      const dropped = outbox.prune(1800)
      expect(dropped).toBe(1) // only first one expired
      expect(outbox.size()).toBe(2)
      expect(store.data[0].expiresAt).toBe(2000)
    })

    it('keeps non-expired items', () => {
      const event = stubEvent([['expiration', '2000']])
      outbox.enqueue(event, [], 1000)
      const dropped = outbox.prune(1000)
      expect(dropped).toBe(0)
      expect(outbox.size()).toBe(1)
    })

    it('persists after pruning', () => {
      outbox.enqueue(stubEvent([['expiration', '1500']]), [], 1000)
      outbox.enqueue(stubEvent(), [], 1000)
      outbox.prune(1800)
      const reloaded = createOutbox(store)
      expect(reloaded.size()).toBe(1)
    })
  })

  describe('flush', () => {
    it('sends items in order and tracks call order', async () => {
      const callOrder: number[] = []
      const publish = async (relays: readonly string[], event: SignedEvent) => {
        const idx = parseInt(event.id.split('-')[1])
        callOrder.push(idx)
      }

      outbox.enqueue({ ...stubEvent(), id: 'event-0' }, ['relay1'], 1000)
      outbox.enqueue({ ...stubEvent(), id: 'event-1' }, ['relay2'], 1001)
      outbox.enqueue({ ...stubEvent(), id: 'event-2' }, ['relay3'], 1002)

      const result = await outbox.flush(publish, 1100)
      expect(callOrder).toEqual([0, 1, 2])
    })

    it('drops expired items before sending', async () => {
      let sendCount = 0
      const publish = async () => {
        sendCount++
      }

      outbox.enqueue(stubEvent([['expiration', '1050']]), [], 1000)
      outbox.enqueue(stubEvent(), [], 1000)
      outbox.enqueue(stubEvent([['expiration', '2000']]), [], 1000)

      const result = await outbox.flush(publish, 1100)
      expect(result.dropped).toBe(1)
      expect(sendCount).toBe(2)
    })

    it('keeps failed items', async () => {
      const publish = async (relays: readonly string[], event: SignedEvent) => {
        if (event.id === 'fail') throw new Error('publish failed')
      }

      outbox.enqueue({ ...stubEvent(), id: 'ok' }, [], 1000)
      outbox.enqueue({ ...stubEvent(), id: 'fail' }, [], 1000)
      outbox.enqueue({ ...stubEvent(), id: 'ok2' }, [], 1000)

      const result = await outbox.flush(publish, 1100)
      expect(result.sent).toBe(2)
      expect(result.remaining).toBe(1)
      expect(store.data).toHaveLength(1)
      expect(store.data[0].event.id).toBe('fail')
    })

    it('returns exact counts', async () => {
      const publish = async (relays: readonly string[], event: SignedEvent) => {
        if (event.id === 'fail') throw new Error('fail')
      }

      outbox.enqueue(stubEvent([['expiration', '1050']]), [], 1000)
      outbox.enqueue({ ...stubEvent(), id: 'fail' }, [], 1000)
      outbox.enqueue(stubEvent(), [], 1000)

      const result = await outbox.flush(publish, 1100)
      expect(result.dropped).toBe(1)
      expect(result.sent).toBe(1)
      expect(result.remaining).toBe(1)
    })

    it('empties queue on all-success', async () => {
      const publish = async () => {}

      outbox.enqueue(stubEvent(), [], 1000)
      outbox.enqueue(stubEvent(), [], 1000)

      const result = await outbox.flush(publish, 1100)
      expect(result.sent).toBe(2)
      expect(result.dropped).toBe(0)
      expect(result.remaining).toBe(0)
      expect(outbox.size()).toBe(0)
    })

    it('passes correct relays to publish', async () => {
      const relaysCapture: readonly string[][] = []
      const publish = async (relays: readonly string[]) => {
        relaysCapture.push(relays)
      }

      outbox.enqueue(stubEvent(), ['relay-a', 'relay-b'], 1000)
      outbox.enqueue(stubEvent(), ['relay-c'], 1000)

      await outbox.flush(publish, 1100)
      expect(relaysCapture).toEqual([
        ['relay-a', 'relay-b'],
        ['relay-c'],
      ])
    })

    it('preserves an item enqueued DURING a slow publish, instead of dropping it (concurrent enqueue/flush race)', async () => {
      // A deferred gate: the 'slow' item's publish doesn't resolve until the
      // test explicitly releases it, giving the test a window to enqueue a
      // NEW item while flush() is still mid-loop (e.g. another circle's
      // publish landing concurrently, or a fresh beacon queued because this
      // one relay attempt is still in flight).
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => { release = resolve })
      const publish = async (relays: readonly string[], event: SignedEvent) => {
        if (event.id === 'slow') await gate
      }

      outbox.enqueue({ ...stubEvent(), id: 'slow' }, ['relay1'], 1000)

      const flushPromise = outbox.flush(publish, 1100)
      // flush() is now suspended awaiting `gate` inside publish('slow', …) —
      // JS being single-threaded, this line only runs because that await
      // yielded control back here.
      outbox.enqueue({ ...stubEvent(), id: 'concurrent' }, ['relay2'], 1050)
      release?.()

      const result = await flushPromise
      expect(result.sent).toBe(1)
      expect(result.remaining).toBe(1)
      expect(store.data.map((i) => i.event.id)).toEqual(['concurrent'])
    })
  })
})
