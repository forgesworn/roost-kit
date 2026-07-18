// Transport: Nostr relay publish/subscribe. (flock's `services.ts` also held a
// foreground-geolocation half — a sensor helper unrelated to Nostr transport —
// which does NOT come along into this kit.)

import { SimplePool } from 'nostr-tools/pool'

let pool: SimplePool | null = null
function getPool(): SimplePool {
  // enableReconnect: without it a single socket close (doze, network handover,
  // relay restart) permanently kills every open subscription — publishes recover
  // on the next ensureRelay, but nothing INCOMING ever arrives again until the
  // app is fully restarted. With it, nostr-tools re-fires open subs on reconnect
  // (with a since-catch-up so missed events replay). enablePing detects the
  // half-dead socket a suspended radio leaves behind, which never fires onclose.
  pool ??= new SimplePool({ enableReconnect: true, enablePing: true })
  return pool
}

// Per-relay publish deadline — a safety alert must not hang on one slow or dead
// relay when another may already have accepted it.
const PUBLISH_TIMEOUT_MS = 8000
/** Sentinel a publish resolves to when it outruns PUBLISH_TIMEOUT_MS. */
export const RELAY_TIMEOUT = '__flock_relay_timeout__'
// nostr-tools' SimplePool RESOLVES a publish with a "connection failure…" string
// (rather than rejecting) when a relay is unreachable — so a naive Promise.any
// would read an all-relays-down fan-out as a success. It must be excluded explicitly.
const CONNECTION_FAILURE = 'connection failure'

/** How many of a fan-out's settled publishes genuinely reached a relay — i.e. a
 *  relay accepted the event. Excludes rejections (relay refused the event),
 *  unreachable relays (the pool's "connection failure" resolution) and timeouts. */
export function deliveredCount(results: PromiseSettledResult<unknown>[]): number {
  return results.filter((r) => {
    if (r.status !== 'fulfilled') return false
    const v = String(r.value ?? '')
    return v !== RELAY_TIMEOUT && !v.startsWith(CONNECTION_FAILURE)
  }).length
}

/** Race a publish against a resolve-only timeout so one dead relay can't stall the fan-out. */
function withTimeout(p: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>((resolve) => { timer = setTimeout(() => resolve(RELAY_TIMEOUT), ms) })
  return Promise.race([Promise.resolve(p).finally(() => clearTimeout(timer)), timeout])
}

/** Fan a signed event out to every relay; succeed if ANY accepts, throw if none do
 *  — so callers surface a real "couldn't send" rather than a silent false success. */
async function fanOut(relays: readonly string[], signed: unknown): Promise<void> {
  const attempts = getPool().publish([...relays], signed as never).map((p) => withTimeout(p, PUBLISH_TIMEOUT_MS))
  const results = await Promise.allSettled(attempts)
  if (deliveredCount(results) === 0) throw new Error('No relay accepted the event')
}

/** Fan an already-signed event (e.g. a NIP-59 gift wrap) out to the relays. */
export async function publishSigned(relays: readonly string[], signed: { id: string; sig: string; [k: string]: unknown }) {
  await fanOut(relays, signed)
  return signed
}

/** One-shot "give me the newest matching event" fetch: resolves early once EOSE
 *  passes with a match in hand, otherwise waits the full timeout for slow
 *  relays. Shared by {@link fetchWordInvite} (by `#t` tag) and
 *  {@link fetchGiftWrap} (by `#p` tag) — the two one-shot lookups the
 *  word-invite flow's two hops need (covey-kit's `wordcode.ts`/`inbox.ts`). */
function fetchNewest<T extends { created_at: number }>(
  relays: readonly string[],
  filter: Record<string, unknown>,
  toResult: (e: { id: string; pubkey: string; content: string; created_at: number }) => T,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    let best: T | null = null
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      try { sub.close() } catch { /* already closed */ }
      clearTimeout(timer)
      resolve(best)
    }
    const timer = setTimeout(done, timeoutMs)
    const sub = getPool().subscribeMany([...relays], filter as never, {
      onevent: (e: { id: string; pubkey: string; content: string; created_at: number }) => {
        const r = toResult(e)
        if (!best || r.created_at > best.created_at) best = r
      },
      oneose: () => { if (best) done() },
    })
  })
}

/** One-shot fetch of a parked spoken-invite reference by its `#t` tag. Resolves
 *  the NEWEST match, or null if none arrives before the deadline. */
export function fetchWordInvite(
  relays: readonly string[],
  kind: number,
  tag: string,
  timeoutMs = 6000,
): Promise<{ id: string; content: string; created_at: number } | null> {
  return fetchNewest(
    relays,
    { kinds: [kind], '#t': [tag] },
    (e) => ({ id: e.id, content: e.content, created_at: e.created_at }),
    timeoutMs,
  )
}

/** One-shot fetch of a NIP-59 gift wrap (kind 1059) filed under a `#p` tag —
 *  the word-invite's second hop (the real invite, gift-wrapped to the one-time
 *  reference pubkey; see covey-kit's `inbox.ts`'s `readInviteViaRef`). Resolves
 *  the NEWEST match, or null if none arrives before the deadline. */
export function fetchGiftWrap(
  relays: readonly string[],
  pTag: string,
  timeoutMs = 6000,
): Promise<{ id: string; pubkey: string; content: string; created_at: number } | null> {
  return fetchNewest(
    relays,
    { kinds: [1059], '#p': [pTag] },
    (e) => ({ id: e.id, pubkey: e.pubkey, content: e.content, created_at: e.created_at }),
    timeoutMs,
  )
}

/** Subscribe to NIP-59 gift wraps (kind 1059) filed under a `#p` tag I own, across
 *  all relays. The tag is a derived inbox (signals) or a `personalInboxTag`
 *  (invites/reseeds) — never a bare npub. One subscribeMany call → the pool dedupes
 *  the same wrap arriving from several relays (per-call known-id set). Returns an
 *  unsubscribe fn. */
export function subscribeGiftWraps(
  relays: readonly string[],
  pTag: string,
  onEvent: (e: { id: string; pubkey: string; content: string; tags: string[][]; created_at: number }) => void,
): () => void {
  const sub = getPool().subscribeMany(
    [...relays],
    { kinds: [1059], '#p': [pTag] },
    { onevent: onEvent },
  )
  return () => sub.close()
}

/**
 * Fetch public kind:0 profiles for a set of pubkeys from the public profile
 * relays. One-shot-ish: stays open briefly to collect replies, then the caller
 * closes it. Returns an unsubscribe fn. (Privacy: this is the one place this
 * kit touches public relays — opt-in only, and only ever called if the app
 * decides to; the kit itself takes no position on when. See relays.ts's
 * `PROFILE_RELAYS` split for the private/public separation this relies on.)
 */
export function subscribeProfiles(
  relays: readonly string[],
  pubkeys: string[],
  onEvent: (e: { pubkey: string; content: string; created_at: number }) => void,
): () => void {
  if (!pubkeys.length) return () => { /* noop */ }
  const sub = getPool().subscribeMany(
    [...relays],
    { kinds: [0], authors: pubkeys },
    { onevent: onEvent },
  )
  return () => sub.close()
}
