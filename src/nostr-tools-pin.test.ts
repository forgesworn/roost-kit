import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// nostr-tools >= 2.23.11 ships an idle-close path whose in-use counter is
// decremented by the internal <forced-ping> subscription without ever being
// incremented, so pools built with enablePing lose every live subscription
// (~29s x subs + 20s) and the relay is marked skip-reconnection. Publishing
// still works, which is why nothing else catches it. 2.23.9 predates the
// auto-close and also has the stricter anchored pubkey regex.
// Bump this pin only after confirming upstream has fixed the counter.
describe('nostr-tools pin', () => {
  it('stays on 2.23.9 until the upstream idle-close counter bug is fixed', () => {
    const { version } = JSON.parse(
      readFileSync(new URL('../node_modules/nostr-tools/package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(version).toBe('2.23.9')
  })
})
