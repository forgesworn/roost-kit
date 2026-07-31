// NIP-59 gift wrap — the metadata-hiding envelope used for BOTH private invites
// and (gift-wrap-everything) every live signal.
//
// A wrapped event is `kind:1059` from a throwaway key, p-tagged to a recipient.
// The relay sees only that. Inside: a seal (kind:13) signed by the sender's real
// signer, holding the rumor (real sender + kind + content). Decryption needs the
// recipient's key — a member's real key for invites, or the shared group-inbox
// key for signals.
//
// Because a wrap is self-contained, opaque, encrypted bytes, it can travel over
// ANY transport — a Nostr relay today, a LoRa mesh (Meshtastic/MeshCore) later.

import { finalizeEvent, generateSecretKey, getEventHash, verifyEvent } from 'nostr-tools/pure'
import { getConversationKey, encrypt as nip44encrypt, decrypt as nip44decrypt } from 'nostr-tools/nip44'
import type { Signer, SignedEvent } from './signer.js'

const nowSec = (): number => Math.floor(Date.now() / 1000)
// NIP-59: randomise created_at up to 2 days in the past to blur timing.
const wrapTime = (): number => nowSec() - Math.floor(Math.random() * 172_800)

// NIP-40: every wrap expires this long after its created_at, bounding how far
// back a future key compromise can decrypt relay-stored history. ONE window for
// all wrap types (a per-type window would be a type-tell), derived from the
// already-backdated created_at (real time would undo the timing blur) — so the
// tag carries zero information beyond created_at itself. 16 days clears the
// 2-day backdating while leaving ~2 weeks for offline members to catch up.
export const WRAP_EXPIRY_SECONDS = 16 * 86_400

/**
 * The floor `giftWrap` will accept for a caller-chosen window.
 *
 * NOT ARBITRARY, AND NOT STYLE. `created_at` is randomised up to 2 days into the
 * past, and the expiry is derived from that backdated stamp — so a window at or
 * below 172_800 seconds can produce a wrap that is ALREADY EXPIRED THE MOMENT IT
 * IS PUBLISHED. That is not a theoretical failure: a relay running
 * `nostr-rs-relay` rejects such an event at ingest with *"invalid: The event has
 * already expired"*, and a client would see a successful publish call, no error
 * it could act on, and a message nobody ever receives.
 *
 * Three days leaves a real margin over the 2-day blur rather than sitting on its
 * edge, where a single unlucky randomisation is the difference between delivery
 * and silence.
 */
export const MIN_WRAP_EXPIRY_SECONDS = 3 * 86_400

export interface InnerEvent { kind: number; content: string; tags: string[][]; created_at?: number }
export interface Rumor { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; id?: string }

/** Gift-wrap an inner event to a recipient pubkey. Seal signed by the signer
 *  (real key), wrap signed by a throwaway key. Hides sender, kind, and tags.
 *
 *  `routeTag` is the `#p` value the relay files the wrap under; it defaults to
 *  `recipientPk`. Encryption is ALWAYS to `recipientPk`, so decryption is
 *  unaffected — pass a derived tag (e.g. `personalInboxTag`) to keep a real npub
 *  off the wire while still delivering to that recipient.
 *
 *  `expirySeconds` is the NIP-40 window, defaulting to {@link WRAP_EXPIRY_SECONDS}.
 *
 *  ── WHY THIS IS A PARAMETER AND NOT A RETUNED CONSTANT ────────────────────
 *
 *  The window is not a hygiene tag. On a relay that does not prune by age it is
 *  THE RETENTION POLICY — the only thing that removes a client's own traffic —
 *  so its right value depends on the client, and the clients differ sharply. A
 *  community app whose members meet MONTHLY needs a window longer than the gap
 *  between two gatherings, or everything sent after one meet expires before the
 *  next. A safety or live-location app wants the opposite: the shortest window
 *  that still delivers, because its traffic is the most sensitive there is.
 *
 *  Changing the shared constant would have imposed one of those answers on all
 *  four consumers of this package silently, at whatever moment each next bumped
 *  its pin. So the default is left exactly where it was and a caller opts in.
 *
 *  ── THE INVARIANT A CALLER INHERITS BY TAKING THIS PARAMETER ──────────────
 *
 *  ONE WINDOW PER APPLICATION, ACROSS EVERY WRAP TYPE IT SENDS. A per-type
 *  window is a TYPE-TELL: an observer who cannot read a wrap can still sort an
 *  app's traffic into kinds by the expiry delta alone, which is exactly the
 *  metadata this envelope exists to hide. This function cannot enforce that —
 *  it sees one call at a time — so a caller passing a custom window owes itself
 *  a test that every path it wraps on passes the SAME one, including paths that
 *  reach this package through another library. */
export async function giftWrap(
  signer: Signer,
  recipientPk: string,
  inner: InnerEvent,
  routeTag: string = recipientPk,
  expirySeconds: number = WRAP_EXPIRY_SECONDS,
): Promise<SignedEvent> {
  // Refused rather than clamped, and loudly. A silently-corrected window would
  // leave the caller believing a number this function had already overruled —
  // and the failure it prevents (a wrap born expired, accepted by the caller's
  // publish path, rejected at the relay's door) is invisible from the sending
  // side, which is precisely why it must not be smoothed over here.
  if (!Number.isFinite(expirySeconds) || expirySeconds < MIN_WRAP_EXPIRY_SECONDS) {
    throw new RangeError(
      `giftWrap: expirySeconds must be a finite number >= ${MIN_WRAP_EXPIRY_SECONDS} ` +
        `(created_at is backdated up to 172800s, so a shorter window can publish an already-expired wrap); got ${expirySeconds}`,
    )
  }
  const rumor: Rumor = {
    pubkey: signer.pubkey,
    created_at: inner.created_at ?? nowSec(),
    kind: inner.kind,
    tags: inner.tags,
    content: inner.content,
  }
  const rumorWithId = { ...rumor, id: getEventHash(rumor) }
  const sealContent = await signer.nip44Encrypt(recipientPk, JSON.stringify(rumorWithId))
  const seal = await signer.signEvent({ kind: 13, content: sealContent, tags: [], created_at: wrapTime() })
  const ephSk = generateSecretKey()
  const wrapContent = nip44encrypt(JSON.stringify(seal), getConversationKey(ephSk, recipientPk))
  const created_at = wrapTime()
  return finalizeEvent(
    { kind: 1059, content: wrapContent, tags: [['p', routeTag], ['expiration', String(created_at + expirySeconds)]], created_at },
    ephSk,
  ) as unknown as SignedEvent
}

/** Unwrap a gift wrap with a nip44-decrypt function. Returns the rumor or null. */
export async function giftUnwrap(
  decrypt: (peerPk: string, ciphertext: string) => Promise<string> | string,
  wrap: { pubkey: string; content: string },
): Promise<Rumor | null> {
  try {
    const seal = JSON.parse(await decrypt(wrap.pubkey, wrap.content)) as SignedEvent
    // Authenticate the sender before trusting anything inside. The seal (kind:13)
    // is signed by the sender's REAL key, but the group-inbox channel decrypts
    // with a secret EVERY member holds — so without verifying the seal's
    // signature, any member (or anyone who ever saw an invite) could craft a seal
    // naming a victim's pubkey and forge a signal as them. verifyEvent proves
    // seal.pubkey actually signed the seal; requiring rumor.pubkey === seal.pubkey
    // (NIP-59) then binds the claimed author to that proven signer. A legitimate
    // wrap always satisfies both (giftWrap signs the seal with the rumor author's
    // key), so this rejects only forged/tampered wraps.
    if (!verifyEvent(seal)) return null
    const rumor = JSON.parse(await decrypt(seal.pubkey, seal.content)) as Rumor
    if (rumor.pubkey !== seal.pubkey) return null
    // The rumor's `id` rode inside the decrypted JSON, so a sender could set it to
    // anything — two distinct messages sharing one id (to defeat dedup) or one
    // message under many ids. Recompute it from the content so any consumer that
    // keys dedup / threading on rumor.id can trust it is content-bound.
    rumor.id = getEventHash({
      pubkey: rumor.pubkey,
      created_at: rumor.created_at,
      kind: rumor.kind,
      tags: rumor.tags,
      content: rumor.content,
    })
    return rumor
  } catch {
    return null
  }
}

/** A nip44 decrypt closure for a raw secret key (the shared group-inbox key). */
export function rawNip44Decrypt(skBytes: Uint8Array): (peerPk: string, ciphertext: string) => string {
  return (peerPk, ciphertext) => nip44decrypt(ciphertext, getConversationKey(skBytes, peerPk))
}
