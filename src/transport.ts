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

/** Tear the shared relay pool down so the NEXT getPool() builds a fresh one with
 *  brand-new WebSocket connections. A pool's sockets can go silently stale on
 *  mobile — TCP still ESTABLISHED, but publishes stop landing and subscriptions
 *  stop delivering, and neither enablePing nor re-issuing REQs on the SAME pool
 *  recovers it; only reconnecting does. `destroy()` closes every open connection
 *  first, so this is the recovery a caller reaches for when it suspects a dead
 *  pool (app resumed, user opened a read surface, periodic failsafe). */
/** Live subscriptions, so resetPool can rebuild them on the fresh pool. */
const liveSubscriptions = new Set<() => void>()

export function resetPool(): void {
  pool?.destroy()
  pool = null
  // Rebuild every live subscription on the fresh pool. destroy() closed them all,
  // so without this resetPool would silently stop INCOMING delivery — the exact
  // symptom it exists to cure. Each rebuild re-registers itself.
  const rebuilds = [...liveSubscriptions]
  liveSubscriptions.clear()
  for (const rebuild of rebuilds) rebuild()
}

/** Open a pool subscription that SURVIVES resetPool: it re-opens on the fresh pool
 *  automatically, so a consumer's staleness-recovery reset never orphans it. The
 *  returned unsubscribe deregisters it (no rebuild after the caller is done). */
function resilientSubscribe<E>(
  relays: readonly string[],
  filter: Record<string, unknown>,
  onEvent: (e: E) => void,
): () => void {
  const open = (): { close(): void } =>
    getPool().subscribeMany([...relays], filter as never, { onevent: onEvent as (e: unknown) => void }) as { close(): void }
  let sub = open()
  const rebuild = (): void => {
    sub = open()
    liveSubscriptions.add(rebuild)
  }
  liveSubscriptions.add(rebuild)
  return () => {
    liveSubscriptions.delete(rebuild)
    try { sub.close() } catch { /* already closed */ }
  }
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
/** Collect ALL matching events, newest-first. Callers must try candidates rather
 *  than trust a single pick: a gift wrap's created_at is randomised up to 2 days
 *  into the past (metadata-hiding), so "highest created_at" is NOT "most recent" —
 *  and anyone who knows the tag can publish a junk event with created_at=now to
 *  shadow the real one. Newest-first is only a hint; try each until one is valid. */
function fetchAllMatching<T extends { created_at: number }>(
  relays: readonly string[],
  filter: Record<string, unknown>,
  toResult: (e: { id: string; pubkey: string; content: string; created_at: number }) => T,
  timeoutMs: number,
): Promise<T[]> {
  return new Promise((resolve) => {
    const results: T[] = []
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      try { sub.close() } catch { /* already closed */ }
      clearTimeout(timer)
      resolve([...results].sort((a, b) => b.created_at - a.created_at))
    }
    const timer = setTimeout(done, timeoutMs)
    const sub = getPool().subscribeMany([...relays], filter as never, {
      onevent: (e: { id: string; pubkey: string; content: string; created_at: number }) => { results.push(toResult(e)) },
      oneose: () => { if (results.length) done() },
    })
  })
}

/** Fetch EVERY parked spoken-invite reference under a `#t` tag, newest-first — the
 *  caller decodes each until one is valid, so a junk event under the (low-entropy,
 *  guessable) word-code tag cannot shadow the real reference. */
export function fetchWordInvites(
  relays: readonly string[],
  kind: number,
  tag: string,
  timeoutMs = 6000,
): Promise<{ id: string; content: string; created_at: number }[]> {
  return fetchAllMatching(
    relays,
    { kinds: [kind], '#t': [tag] },
    (e) => ({ id: e.id, content: e.content, created_at: e.created_at }),
    timeoutMs,
  )
}

/** Fetch EVERY NIP-59 gift wrap (kind 1059) filed under a `#p` tag, newest-first —
 *  the word-invite's second hop (the real invite, gift-wrapped to the one-time
 *  reference pubkey; see covey-kit's `inbox.ts`'s `readInviteViaRef`). The caller
 *  tries to unwrap each, so a junk wrap cannot shadow the real invite and the
 *  randomised wrap created_at cannot mis-order two valid invites. */
export function fetchGiftWraps(
  relays: readonly string[],
  pTag: string,
  timeoutMs = 6000,
): Promise<{ id: string; pubkey: string; content: string; created_at: number }[]> {
  return fetchAllMatching(
    relays,
    { kinds: [1059], '#p': [pTag] },
    (e) => ({ id: e.id, pubkey: e.pubkey, content: e.content, created_at: e.created_at }),
    timeoutMs,
  )
}

/** @deprecated Prefer {@link fetchWordInvite}s — a single max-created_at pick can be
 *  shadowed by junk and mis-orders two valid references (randomised created_at). */
export function fetchWordInvite(
  relays: readonly string[],
  kind: number,
  tag: string,
  timeoutMs = 6000,
): Promise<{ id: string; content: string; created_at: number } | null> {
  return fetchWordInvites(relays, kind, tag, timeoutMs).then((r) => r[0] ?? null)
}

/** @deprecated Prefer {@link fetchGiftWraps} — a single max-created_at pick can be
 *  shadowed by junk and mis-orders two valid invites (randomised created_at). */
export function fetchGiftWrap(
  relays: readonly string[],
  pTag: string,
  timeoutMs = 6000,
): Promise<{ id: string; pubkey: string; content: string; created_at: number } | null> {
  return fetchGiftWraps(relays, pTag, timeoutMs).then((r) => r[0] ?? null)
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
  return resilientSubscribe(relays, { kinds: [1059], '#p': [pTag] }, onEvent)
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
  return resilientSubscribe(relays, { kinds: [0], authors: pubkeys }, onEvent)
}
