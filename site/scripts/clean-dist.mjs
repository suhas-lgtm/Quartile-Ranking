// scripts/clean-dist.mjs — strip local data out of dist/ before a Cloudflare deploy.
//
// Vite copies public/ into dist/, and public/data holds the locally built data
// (including the password-protected Whitelist files). The live site must read
// data from Neon through functions/ instead, so none of it may be uploaded.
import { rmSync, readdirSync } from 'node:fs'

for (const name of ['data', 'data.staging', 'live']) {
  rmSync(new URL(`../dist/${name}`, import.meta.url), { recursive: true, force: true })
}
console.log('dist/ ready to deploy:', readdirSync(new URL('../dist', import.meta.url)).join(', '))
