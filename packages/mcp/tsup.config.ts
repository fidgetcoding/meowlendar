import { defineConfig } from 'tsup'

// npx-installable bundles, one self-contained file per bin. The three @poolendar/* workspace
// packages are inlined so the published tarball carries no `workspace:*`
// dependencies (which are unresolvable outside the monorepo). The MCP SDK stays
// external — it's a real, published npm dependency installed alongside.
export default defineConfig({
  entry: ['src/index.ts', 'src/vault-cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  splitting: false,
  clean: true,
  dts: false,
  sourcemap: false,
  noExternal: [/^@poolendar\//],
  external: ['@modelcontextprotocol/sdk'],
  banner: { js: '#!/usr/bin/env node' },
})
