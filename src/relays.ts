// Relay sets — adopted from pallasite/src/credits.ts, applied with a privacy split.
//
// This kit's threat model treats relays as untrusted (same discipline flock's
// own threat model documents for the sibling ecosystem), so the two sets are
// used for DIFFERENT purposes:
//
//   PRIVATE_RELAYS  — our own, no-log relay(s). ALL sensitive traffic goes here
//                     (location beacons, alerts, check-ins, group state,
//                     gift-wrapped invites). Now that "gift-wrap-everything" has
//                     landed, every signal is an opaque kind:1059 to a rotating
//                     inbox, so this set may hold MORE THAN ONE relay and traffic
//                     is fanned out across them for delivery redundancy (a single
//                     relay is a single point of failure for a safety alert).
//                     Keep these to relays trusted not to log — adding a public
//                     relay still exposes timing + IP to that operator, opaque or
//                     not. (≈ pallasite EXPERIMENTAL_RELAYS.)
//
//   PROFILE_RELAYS  — the broad public set, used ONLY for reading public kind:0
//                     profiles (names/avatars), which are public anyway.
//                     (≈ pallasite DEFAULT_RELAYS.)
//
// Unlike flock, this kit ships NO baked-in relay defaults and reads no
// `import.meta.env` — the two env-derived constants become an injectable
// factory the caller (the app) calls once at boot with its own config.

/** Build the kit's relay sets from caller-supplied config. No defaults are
 *  baked in — an omitted list is simply empty; the app owns its boot config. */
export function createRelayConfig(opts: { privateRelays?: string[]; onionRelays?: string[]; profileRelays?: string[] } = {}): {
  PRIVATE_RELAYS: readonly string[]
  ONION_RELAYS: readonly string[]
  PROFILE_RELAYS: readonly string[]
} {
  return {
    PRIVATE_RELAYS: opts.privateRelays ?? [],
    ONION_RELAYS: opts.onionRelays ?? [],
    PROFILE_RELAYS: opts.profileRelays ?? [],
  }
}

const WS_URL = /^wss?:\/\//i

/** Trim, keep only ws(s):// URLs, and dedupe (first occurrence wins). */
function cleanRelays(list: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const url = String(raw ?? '').trim()
    if (!WS_URL.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

/** Parse a user-entered relay list (settings textarea) into a clean set — split on
 *  newlines, commas or whitespace so a pasted list works however it is formatted. */
export function parseRelayList(text: string): string[] {
  return cleanRelays(String(text ?? '').split(/[\s,]+/))
}

/** Whether a relay URL is one of the pre-vetted, trusted-not-to-log set. Anything
 *  else is unknown — added at the user's own risk (audit F5: the settings
 *  textarea used to accept and save any relay with no warning at all).
 *
 *  Takes `privateRelays` explicitly (the kit has no baked-in PRIVATE_RELAYS
 *  constant to close over — see `createRelayConfig`). */
export function isKnownNoLogRelay(url: string, privateRelays: readonly string[]): boolean {
  return privateRelays.includes(url)
}

/** The entries in `list` that fall outside the vetted set, in order — empty when
 *  every relay is known. Drives the honest warning in Settings (F5). */
export function unknownRelays(list: readonly string[], privateRelays: readonly string[]): string[] {
  return list.filter((r) => !isKnownNoLogRelay(r, privateRelays))
}

/** Whether the Tor route is actually usable right now: the toggle is on, at
 *  least one `.onion` relay is configured, AND Orbot's SOCKS proxy was
 *  detected reachable (native shell only; a PWA can never satisfy this, by
 *  design — Web has no way to reach a local SOCKS proxy or resolve a `.onion`
 *  address). */
export function torRouteReady(opts: { torEnabled: boolean; onionRelays: readonly string[]; orbotDetected: boolean }): boolean {
  return opts.torEnabled && opts.onionRelays.length > 0 && opts.orbotDetected
}

/** The relay set to actually use, given the Tor toggle.
 *
 *  FAIL LOUD by design: the toggle is off by default, and when it is off this
 *  returns `clearnetRelays` completely unchanged — every existing user and
 *  every e2e flow is byte-for-byte unaffected. But once a user opts in, a
 *  route that ISN'T ready (no `.onion` relay configured yet, or Orbot isn't
 *  detected) must never silently fall back to clearnet — that would leak
 *  exactly the IP the toggle exists to hide, and worse, do it invisibly. So
 *  this throws instead, surfacing an actionable error the caller can show. */
export function effectiveRelays(opts: {
  clearnetRelays: readonly string[]
  onionRelays: readonly string[]
  torEnabled: boolean
  orbotDetected: boolean
}): string[] {
  if (!opts.torEnabled) return [...opts.clearnetRelays]
  if (!torRouteReady(opts)) {
    throw new Error(
      opts.onionRelays.length === 0
        ? "Tor routing is on, but no .onion relay is set up yet — turn it off, or wait for one."
        : "Tor routing is on, but Orbot wasn't detected — open Orbot and make sure it's running, or turn this off.",
    )
  }
  return [...opts.onionRelays]
}

/** The effective relay set from persisted state: prefer a saved `relayUrls` list,
 *  migrate a legacy single `relayUrl`, and always return a non-empty, cleaned set
 *  (falling back to `privateRelays` when nothing usable is saved).
 *
 *  Takes `privateRelays` explicitly as its fallback default — the kit has no
 *  baked-in PRIVATE_RELAYS constant (see `createRelayConfig`). */
export function resolveRelays(privateRelays: readonly string[], saved?: { relayUrls?: unknown; relayUrl?: unknown }): string[] {
  const urls = saved?.relayUrls
  const legacy = saved?.relayUrl
  const candidates: readonly unknown[] =
    Array.isArray(urls) && urls.length ? urls
      : typeof legacy === 'string' ? [legacy]
        : privateRelays
  const cleaned = cleanRelays(candidates)
  return cleaned.length ? cleaned : [...privateRelays]
}
