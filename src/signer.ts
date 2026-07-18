// Signer — the one signing/encryption seam.
//
// Interfaces only: the wire/transport contract every gift-wrapped event is
// signed and NIP-44 encrypted through. Implementations (LocalSigner, a
// signet-login-backed signer, ...) are NOT part of this kit — they live with
// whoever owns key custody (covey-kit ships LocalSigner). This lets the
// transport layer (giftwrap.ts, transport.ts) depend only on the shape of a
// signer, never on how or where the key is held.
//
// Renamed from flock's `FlockSigner` — same three members.

export interface SignedEvent {
  id: string
  pubkey: string
  kind: number
  created_at: number
  tags: string[][]
  content: string
  sig: string
}

export interface EventTemplate {
  kind: number
  content: string
  tags: string[][]
  created_at?: number
}

/** Unified signer — anything that can produce a SignedEvent and do NIP-44. */
export interface Signer {
  readonly pubkey: string
  signEvent(template: EventTemplate): Promise<SignedEvent>
  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string>
}
