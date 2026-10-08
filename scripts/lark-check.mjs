/**
 * Read-only Lark Base health check: token, tables, column names/types vs what the app sends.
 * Usage: node scripts/lark-check.mjs
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LARK = 'https://open.larksuite.com'

const TYPE_NAMES = {
  1: 'Text',
  2: 'Number',
  3: 'SingleSelect',
  4: 'MultiSelect',
  5: 'Date',
  7: 'Checkbox',
  11: 'User',
  13: 'Phone',
  15: 'Url',
  17: 'Attachment',
  18: 'Link',
  20: 'Formula',
  21: 'DuplexLink',
  1001: 'CreatedTime',
  1002: 'ModifiedTime',
  1005: 'AutoNumber',
}

/** Text and SingleSelect accept the string values the app sends */
const STRING_SAFE_TYPES = new Set([1, 3])

const PERIOD = 'Reporting Period'
const EXPECTED = {
  Office: [
    PERIOD,
    'Company',
    'Equipment',
    'Emission Source',
    'Scope',
    'Unit',
    'Volume',
    'EF (kg CO₂e/unit)',
    'EF Reference',
    'Total GHG (tonnes CO₂e)',
  ],
  Trips: [
    PERIOD,
    'Company',
    'Full Name',
    'Emp ID',
    'Department',
    'Trip Name',
    'Purpose',
    'From',
    'To',
    'Departure Date',
    'Return Date',
    'CO₂ flight (kg)',
    'CO₂ ground (kg)',
    'CO₂ accommodation (kg)',
    'Total (kg CO₂e)',
    'Transport details',
    'Accommodation details',
    'App data (JSON)',
  ],
  Commute: [
    PERIOD,
    'Company',
    'Full Name',
    'Emp ID',
    'Department',
    'Vehicle',
    'One-way km',
    'Working days / Month',
    'WFH (days/month)',
    'Carpool (people)',
    'CO₂e (kg)',
    'App data (JSON)',
  ],
}

function loadEnvLocal() {
  const env = {}
  for (const line of readFileSync(resolve(root, '.env.local'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}

async function larkJson(path, opts = {}, token) {
  const res = await fetch(`${LARK}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  return { status: res.status, json: await res.json() }
}

async function main() {
  const env = loadEnvLocal()
  const appToken = env.VITE_LARK_BASE_APP_TOKEN
  const tables = {
    Office: env.VITE_LARK_TABLE_OFFICE,
    Trips: env.VITE_LARK_TABLE_TRIPS,
    Commute: env.VITE_LARK_TABLE_COMMUTE,
  }
  let problems = 0
  let warnings = 0

  console.log('== Env ==')
  for (const k of [
    'VITE_LARK_APP_ID',
    'VITE_LARK_APP_SECRET',
    'VITE_LARK_BASE_APP_TOKEN',
    'VITE_LARK_TABLE_OFFICE',
    'VITE_LARK_TABLE_TRIPS',
    'VITE_LARK_TABLE_COMMUTE',
    'VITE_LARK_TABLE_CLOSE',
    'VITE_LARK_API_BASE',
  ]) {
    console.log(`  ${k}: ${env[k] ? 'set' : '(empty)'}`)
  }

  console.log('\n== Token ==')
  const { json: tj } = await larkJson('/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: JSON.stringify({ app_id: env.VITE_LARK_APP_ID, app_secret: env.VITE_LARK_APP_SECRET }),
  })
  if (tj.code !== 0) {
    console.log(`  FAIL: ${tj.msg} (${tj.code})`)
    process.exit(1)
  }
  const token = tj.tenant_access_token
  console.log(`  OK (expires in ${tj.expire}s)`)

  console.log('\n== Base tables ==')
  const { json: lt } = await larkJson(
    `/open-apis/bitable/v1/apps/${appToken}/tables?page_size=100`,
    { method: 'GET' },
    token,
  )
  if (lt.code !== 0) {
    console.log(`  FAIL: ${lt.msg} (${lt.code})`)
    process.exit(1)
  }
  const onBase = new Map((lt.data?.items || []).map((t) => [t.table_id, t.name]))
  for (const [id, name] of onBase) console.log(`  ${name} (${id})`)

  for (const [label, tableId] of Object.entries(tables)) {
    console.log(`\n== ${label} (${tableId || 'no id'}) ==`)
    if (!tableId) {
      console.log('  WARN: no table id in .env.local — this table will not be synced')
      warnings++
      continue
    }
    if (!onBase.has(tableId)) {
      console.log('  FAIL: table id not found in Base')
      problems++
      continue
    }

    const { json: fj } = await larkJson(
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`,
      { method: 'GET' },
      token,
    )
    if (fj.code !== 0) {
      console.log(`  FAIL listing fields: ${fj.msg} (${fj.code})`)
      problems++
      continue
    }
    const fields = new Map((fj.data?.items || []).map((f) => [f.field_name, f]))

    for (const name of EXPECTED[label]) {
      const f = fields.get(name)
      if (!f) {
        const optional = name === 'Transport details' || name === 'Accommodation details'
        console.log(`  ${optional ? 'WARN' : 'MISSING'}: "${name}" not on Base${optional ? ' (optional)' : ''}`)
        if (optional) warnings++
        else problems++
        continue
      }
      if (!STRING_SAFE_TYPES.has(f.type)) {
        console.log(`  TYPE: "${name}" is ${TYPE_NAMES[f.type] || f.type} — app sends text, write may fail`)
        problems++
      }
    }
    const extra = [...fields.keys()].filter((n) => n !== 'ID' && !EXPECTED[label].includes(n))
    if (extra.length) console.log(`  Extra columns on Base (ignored by app): ${extra.join(', ')}`)

    const { json: rj } = await larkJson(
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=1`,
      { method: 'GET' },
      token,
    )
    if (rj.code !== 0) {
      console.log(`  FAIL reading records (dedup check): ${rj.msg} (${rj.code})`)
      problems++
    } else {
      console.log(`  Read records OK — total ${rj.data?.total ?? '?'} rows`)
    }
  }

  console.log(`\n== Result: ${problems} problem(s), ${warnings} warning(s) ==`)
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
