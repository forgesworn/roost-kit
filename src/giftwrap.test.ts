import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { getConversationKey, encrypt as nip44encrypt, decrypt as nip44decrypt } from 'nostr-tools/nip44'
import type { EventTemplate, Signer, SignedEvent } from './signer.js'
import { giftWrap, giftUnwrap, rawNip44Decrypt, WRAP_EXPIRY_SECONDS } from './giftwrap.js'

const nowSec = (): number => Math.floor(Date.now() / 1000)

// Ported from flock's `giftwrap.test.ts`, which built its signer via covey-kit's
// `makeLocalSigner` (not available to roost-kit). This stub reproduces
// LocalSigner's logic inline over `nostr-tools/pure`/`nip44`, per the task's
// "stub Signer built on nostr-tools/pure finalizeEvent" requirement.
function stubSigner(): Signer {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  return {
    pubkey,
    signEvent: (template: EventTemplate) =>
      Promise.resolve(finalizeEvent({ ...template, created_at: template.created_at ?? nowSec() }, sk) as unknown as SignedEvent),
    nip44Encrypt: (peerPubkey: string, plaintext: string) =>
      Promise.resolve(nip44encrypt(plaintext, getConversationKey(sk, peerPubkey))),
    nip44Decrypt: (peerPubkey: string, ciphertext: string) =>
      Promise.resolve(nip44decrypt(ciphertext, getConversationKey(sk, peerPubkey))),
  }
}

/** Stand-in for a shared group-inbox keypair (flock derives this deterministically
 *  in covey-kit's `keys.ts`, out of scope here — giftwrap.ts doesn't care how the
 *  recipient keypair was produced). */
function keypair(): { sk: Uint8Array; pk: string } {
  const sk = generateSecretKey()
  return { sk, pk: getPublicKey(sk) }
}

describe('gift-wrap-everything: signals via a shared inbox key', () => {
  it('hides sender + type from the relay; a holder of the inbox key recovers both (round-trip)', async () => {
    const sender = stubSigner()
    const inbox = keypair()
    const inner = { kind: 20_078, content: 'encrypted-beacon-blob', tags: [['t', 'beacon']] }
    const wrap = await giftWrap(sender, inbox.pk, inner)

    // What the relay sees:
    expect(wrap.kind).toBe(1059)
    expect(wrap.pubkey).not.toBe(sender.pubkey) // ephemeral sender, not the real one
    expect(wrap.tags.find((t) => t[0] === 'p')?.[1]).toBe(inbox.pk) // opaque inbox, not a member
    expect(JSON.stringify(wrap)).not.toContain('beacon') // the type is hidden

    // NIP-40 expiration ~16 days out from the (backdated) created_at.
    const exp = Number(wrap.tags.find((t) => t[0] === 'expiration')?.[1])
    expect(exp).toBe(wrap.created_at + WRAP_EXPIRY_SECONDS)

    // What a member (holding the inbox key) recovers — inner rumor exactly:
    const rumor = await giftUnwrap(rawNip44Decrypt(inbox.sk), wrap)
    expect(rumor?.pubkey).toBe(sender.pubkey) // real sender, inside the encryption
    expect(rumor?.tags).toEqual([['t', 'beacon']])
    expect(rumor?.content).toBe('encrypted-beacon-blob')
    expect(rumor?.kind).toBe(20_078)
  })

  it('a non-holder of the inbox key cannot unwrap', async () => {
    const sender = stubSigner()
    const inbox = keypair()
    const wrong = keypair()
    const wrap = await giftWrap(sender, inbox.pk, { kind: 20_078, content: 'x', tags: [] })
    expect(await giftUnwrap(rawNip44Decrypt(wrong.sk), wrap)).toBeNull()
  })
})

describe('NIP-40 retention bound (audit Slice 6)', () => {
  it('every wrap type expires the same uniform window after its backdated created_at', async () => {
    const inbox = keypair()
    const invitee = stubSigner()
    // Signal-, fences- and invite-style wraps: a per-type window would be a
    // type-tell, and deriving from real time would undo the created_at blur.
    const wraps = [
      await giftWrap(stubSigner(), inbox.pk, { kind: 20_078, content: 'beacon-blob', tags: [['t', 'beacon']] }),
      await giftWrap(stubSigner(), inbox.pk, { kind: 20_078, content: 'fences-blob', tags: [['t', 'fences']] }),
      await giftWrap(stubSigner(), invitee.pubkey, { kind: 24_078, content: 'invite-blob', tags: [] }),
    ]
    for (const wrap of wraps) {
      const exp = Number(wrap.tags.find((t) => t[0] === 'expiration')?.[1])
      expect(exp).toBe(wrap.created_at + WRAP_EXPIRY_SECONDS)
    }
  })

  it('the window clears the 2-day created_at randomisation with room for offline members', () => {
    expect(WRAP_EXPIRY_SECONDS).toBeGreaterThanOrEqual(14 * 86_400 + 172_800)
  })
})
