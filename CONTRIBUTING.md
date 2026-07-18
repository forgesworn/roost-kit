# Contributing

Use Node 22 or newer. Install with `npm ci`, then run `npm run typecheck`,
`npm test`, and `npm run build` before opening a change.

Keep `src/` framework-free and silent. Do not add DOM access, storage access,
environment reads, console output, baked-in relay defaults, or unsigned offline
queue entries. Use conventional commit prefixes such as `feat:`, `fix:`,
`docs:`, and `chore:`.
