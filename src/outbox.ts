import type { SignedEvent } from './signer.js'

export interface OutboxItem { event: SignedEvent; relays: readonly string[]; queuedAt: number; expiresAt?: number }
export interface OutboxStore { load(): OutboxItem[]; save(items: OutboxItem[]): void }

/** Pre-signed offline queue: safety-path events are signed at emit time and queued
 *  when publishing fails; flush() retries in order, drops expired, keeps failures. */
export function createOutbox(store: OutboxStore) {
  let items = store.load()
  const persist = () => store.save(items)
  return {
    size: () => items.length,
    enqueue(event: SignedEvent, relays: readonly string[], nowSec: number): void {
      const expTag = event.tags.find((t) => t[0] === 'expiration')
      const expiresAt = expTag ? Number(expTag[1]) || undefined : undefined
      items = [...items, { event, relays, queuedAt: nowSec, expiresAt }]
      persist()
    },
    prune(nowSec: number): number {
      const before = items.length
      items = items.filter((i) => i.expiresAt === undefined || i.expiresAt > nowSec)
      persist()
      return before - items.length
    },
    async flush(publish: (relays: readonly string[], e: SignedEvent) => Promise<unknown>, nowSec: number):
      Promise<{ sent: number; dropped: number; remaining: number }> {
      const dropped = this.prune(nowSec)
      let sent = 0
      const still: OutboxItem[] = []
      for (const item of items) {
        try { await publish(item.relays, item.event); sent++ } catch { still.push(item) }
      }
      items = still
      persist()
      return { sent, dropped, remaining: items.length }
    },
  }
}
export type Outbox = ReturnType<typeof createOutbox>
