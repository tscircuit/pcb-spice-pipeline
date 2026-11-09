import { rm } from 'node:fs/promises'

if (process.argv.includes('--clean')) await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true })
