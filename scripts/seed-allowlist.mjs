#!/usr/bin/env node
// Seed or update the PK allowlist in Vercel KV.
// Usage:
//   node scripts/seed-allowlist.mjs               # uses current KV value or bundled seed as source
//   node scripts/seed-allowlist.mjs domains.json  # uses domains from JSON file (array or {list:[]})
//
// Requirements:
//   - KV_REST_API_URL and KV_REST_API_TOKEN must be set (from Vercel KV integration)
//   - Optionally, ADMIN_TOKEN is NOT required here since we write directly via KV SDK
//
import { kv } from '@vercel/kv'
import fs from 'node:fs'
import path from 'node:path'

function normalizeHost(h = '') {
  return String(h)
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
}

async function getSeedFromLib() {
  try {
    // Pull whatever the app would currently use (KV if present, else seed)
    const mod = await import('../lib/pkAllowlist.js')
    const meta = await mod.getPkAllowlistMeta()
    return Array.isArray(meta?.list) ? meta.list : []
  } catch {
    return []
  }
}

function loadFromArg(fileArg) {
  if (!fileArg) return null
  const p = path.resolve(process.cwd(), fileArg)
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)
  const raw = fs.readFileSync(p, 'utf8')
  const data = JSON.parse(raw)
  const arr = Array.isArray(data) ? data : data?.list
  if (!Array.isArray(arr)) throw new Error('Input must be an array or {"list": []}')
  return arr
}

async function main() {
  const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    console.error('Missing KV envs. Set KV_REST_API_URL and KV_REST_API_TOKEN from Vercel KV.')
    process.exit(1)
  }

  const arg = process.argv[2]
  let inputList = null
  if (arg) {
    inputList = loadFromArg(arg)
  } else {
    inputList = await getSeedFromLib()
  }

  const list = Array.from(new Set((inputList || []).map(normalizeHost).filter(Boolean)))
  if (!list.length) {
    console.error('No domains to write. Provide a JSON file or ensure the seed is available.')
    process.exit(1)
  }
  if (list.length > 500) {
    console.error('Refusing to write more than 500 domains. Trim your list.')
    process.exit(1)
  }

  await kv.set('pk:allowlist', list)
  console.log(`Wrote pk:allowlist with ${list.length} domains.`)
}

main().catch((err) => {
  console.error('Failed to seed allowlist:', err?.message || err)
  process.exit(1)
})
