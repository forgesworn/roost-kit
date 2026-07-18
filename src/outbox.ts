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
      const snapshot = items
      const snapshotLen = snapshot.length
      for (const item of snapshot) {
        try { await publish(item.relays, item.event); sent++ } catch { still.push(item) }
      }
      // `items` may have been reassigned by a concurrent enqueue() while the
      // loop above was awaiting a publish — items.slice(snapshotLen) is
      // exactly what landed since the snapshot. Keep those alongside
      // whatever from the snapshot itself failed to send (`still`), rather
      // than `items = still`, which would silently drop any enqueue that
      // raced this flush.
      items = [...still, ...items.slice(snapshotLen)]
      persist()
      return { sent, dropped, remaining: items.length }
    },
  }
}
export type Outbox = ReturnType<typeof createOutbox>
