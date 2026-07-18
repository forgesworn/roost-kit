import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { decrypt as nip44Decrypt, encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44'
import type { EventTemplate, SignedEvent, Signer } from '../../src/signer.js'
import { deliveredCount, RELAY_TIMEOUT } from '../../src/transport.js'
import { giftUnwrap, giftWrap, rawNip44Decrypt, WRAP_EXPIRY_SECONDS } from '../../src/giftwrap.js'

interface CompatibilityVectors {
  nip59: {
    senderSecret: string
    senderPublic: string
    inboxSecret: string
    inboxPublic: string
    wrongSecret: string
    inner: { kind: number; content: string; tags: string[][]; created_at: number }
    expected: {
      wrapKind: number
      routeTag: string
      expirationDelta: number
      rumorKind: number
      rumorContent: string
      rumorTags: string[][]
      rumorCreatedAt: number
      rumorPubkey: string
      wrongKeyResult: null
    }
  }
  fanout: Array<{
    name: string
    settled: Array<{ status: 'fulfilled'; value: unknown } | { status: 'rejected'; reason: unknown }>
    delivered: number
  }>
}

const vectorsPath = fileURLToPath(new URL('./vectors.json', import.meta.url))
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as CompatibilityVectors

function secret(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function signerFromSecret(secretHex: string): Signer {
  const sk = secret(secretHex)
  const pubkey = getPublicKey(sk)
  return {
    pubkey,
    signEvent: (template: EventTemplate) =>
      Promise.resolve(finalizeEvent(template, sk) as unknown as SignedEvent),
    nip44Encrypt: (peerPubkey: string, plaintext: string) =>
      Promise.resolve(nip44Encrypt(plaintext, getConversationKey(sk, peerPubkey))),
    nip44Decrypt: (peerPubkey: string, ciphertext: string) =>
      Promise.resolve(nip44Decrypt(ciphertext, getConversationKey(sk, peerPubkey))),
  }
}

describe('Roost public compatibility vectors v1', () => {
  it('preserves NIP-59 routing, expiry and rumor recovery', async () => {
    const vector = vectors.nip59
    const sender = signerFromSecret(vector.senderSecret)
    const inboxSecret = secret(vector.inboxSecret)

    expect(sender.pubkey).toBe(vector.senderPublic)
    expect(getPublicKey(inboxSecret)).toBe(vector.inboxPublic)

    const wrap = await giftWrap(sender, vector.inboxPublic, vector.inner)
    const expiration = Number(wrap.tags.find((tag) => tag[0] === 'expiration')?.[1])

    expect(wrap.kind).toBe(vector.expected.wrapKind)
    expect(wrap.tags.find((tag) => tag[0] === 'p')?.[1]).toBe(vector.expected.routeTag)
    expect(expiration - wrap.created_at).toBe(vector.expected.expirationDelta)
    expect(WRAP_EXPIRY_SECONDS).toBe(vector.expected.expirationDelta)
    expect(wrap.pubkey).not.toBe(vector.senderPublic)
    expect(JSON.stringify(wrap)).not.toContain(vector.inner.content)

    const rumor = await giftUnwrap(rawNip44Decrypt(inboxSecret), wrap)
    expect(rumor).toMatchObject({
      kind: vector.expected.rumorKind,
      content: vector.expected.rumorContent,
      tags: vector.expected.rumorTags,
      created_at: vector.expected.rumorCreatedAt,
      pubkey: vector.expected.rumorPubkey,
    })
  })

  it('preserves null-on-decrypt-failure behaviour', async () => {
    const vector = vectors.nip59
    const wrap = await giftWrap(signerFromSecret(vector.senderSecret), vector.inboxPublic, vector.inner)
    const result = await giftUnwrap(rawNip44Decrypt(secret(vector.wrongSecret)), wrap)
    expect(result).toBe(vector.expected.wrongKeyResult)
  })

  it('preserves relay fan-out delivery accounting', () => {
    for (const vector of vectors.fanout) {
      const settled = vector.settled.map((item): PromiseSettledResult<unknown> =>
        item.status === 'fulfilled'
          ? { status: 'fulfilled', value: item.value === '__flock_relay_timeout__' ? RELAY_TIMEOUT : item.value }
          : { status: 'rejected', reason: item.reason },
      )
      expect(deliveredCount(settled), vector.name).toBe(vector.delivered)
    }
  })
})
