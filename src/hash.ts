import { sha256 as digest } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export const sha256 = (value: string | Uint8Array): string => bytesToHex(digest(value))
