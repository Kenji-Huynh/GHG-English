/**
 * Build the GHG tables in an (empty) Lark Base and write the new IDs into .env.local.
 * Usage: node scripts/lark-setup-base.mjs <base URL or app token>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env.local')
const LARK = 'https://open.larksuite.com'

const COMPANIES = ['ECS', 'LEONG LEE', 'MLOG', 'SPEC HUB', 'SUNNY AUTO', 'TREE MARINE']

/** Holds nested data (flight legs, transports, hotels…) the web app needs to re-open a record for editing */
const APP_DATA = 'App data (JSON)'

const text = (name) => ({ field_name: name, type: 1 })
const companyField = {
  field_name: 'Company',
  type: 3,
  property: { options: COMPANIES.map((name) => ({ name })) },
}
const idField = {
  field_name: 'ID',
  type: 1005,
  property: { auto_serial: { type: 'auto_increment_number' } },
}

const TABLES = [
  {
    envKey: 'VITE_LARK_TABLE_OFFICE',
    name: 'Office (Scope 1 & 2)',
    fields: [
      text('Reporting Period'),
      companyField,
      text('Equipment'),
      text('Emission Source'),
      text('Scope'),
      text('Unit'),
      text('Volume'),
      text('EF (kg CO₂e/unit)'),
      text('EF Reference'),
      text('Total GHG (tonnes CO₂e)'),
    ],
  },
  {
    envKey: 'VITE_LARK_TABLE_TRIPS',
    name: 'Employees (Scope 3)',
    fields: [
      text('Reporting Period'),
      text('Full Name'),
      text('Emp ID'),
      companyField,
      text('Department'),
      text('Trip Name'),
      text('Purpose'),
      text('From'),
      text('To'),
      text('Departure Date'),
      text('Return Date'),
      text('CO₂ flight (kg)'),
      text('CO₂ ground (kg)'),
      text('CO₂ accommodation (kg)'),
      text('Total (kg CO₂e)'),
      text('Transport details'),
      text('Accommodation details'),
      text(APP_DATA),
    ],
    hidden: [APP_DATA],
  },
  {
    envKey: 'VITE_LARK_TABLE_COMMUTE',
    name: 'Daily Commute',
    fields: [
      text('Reporting Period'),
      text('Full Name'),
      text('Emp ID'),
      companyField,
      text('Department'),
      text('Vehicle'),
      text('One-way km'),
      text('Working days / Month'),
      text('WFH (days/month)'),
      text('Carpool (people)'),
      text('CO₂e (kg)'),
      text(APP_DATA),
    ],
    hidden: [APP_DATA],
  },
]

/** @returns {{ kind: 'base' | 'wiki', token: string }} */
function parseLink(arg) {
  const s = String(arg || '').trim()
  const wiki = s.match(/\/wiki\/([A-Za-z0-9]+)/)
  if (wiki) return { kind: 'wiki', token: wiki[1] }
  const base = s.match(/\/base\/([A-Za-z0-9]+)/)
  if (base) return { kind: 'base', token: base[1] }
  if (/^[A-Za-z0-9]{10,}$/.test(s)) return { kind: 'base', token: s }
  throw new Error('Pass the Base URL (…/base/XXXX… or …/wiki/XXXX…) or its app token')
}

async function resolveAppToken(link, token) {
  if (link.kind === 'base') return link.token
  const j = await lark(`/open-apis/wiki/v2/spaces/get_node?token=${link.token}`, 'GET', token)
  if (j.code !== 0) {
    throw new Error(
      `Cannot read Wiki node: ${j.msg} (${j.code}). Give the app access to this Wiki page and enable the wiki:wiki:readonly scope, or use a standalone Base.`,
    )
  }
  const node = j.data?.node
  if (node?.obj_type !== 'bitable') throw new Error(`This Wiki page is a "${node?.obj_type}", not a Base`)
  console.log(`Wiki page resolved to Base app token ${node.obj_token}`)
  return node.obj_token
}

function readEnv() {
  const raw = readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return { raw, env }
}

function writeEnv(raw, updates) {
  let out = raw
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, 'm')
    out = re.test(out) ? out.replace(re, `${k}=${v}`) : `${out.replace(/\s*$/, '')}\n${k}=${v}\n`
  }
  writeFileSync(envPath, out, 'utf8')
}

async function lark(path, method, token, body) {
  const res = await fetch(`${LARK}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listTables(token, app) {
  const j = await lark(`/open-apis/bitable/v1/apps/${app}/tables?page_size=100`, 'GET', token)
  if (j.code !== 0) throw new Error(`Cannot read Base: ${j.msg} (${j.code})`)
  return j.data?.items || []
}

async function listFields(token, app, tableId) {
  const j = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${tableId}/fields?page_size=100`, 'GET', token)
  if (j.code !== 0) throw new Error(`List fields: ${j.msg} (${j.code})`)
  return j.data?.items || []
}

async function createTable(token, app, spec) {
  const withId = [idField, ...spec.fields]
  let j = await lark(`/open-apis/bitable/v1/apps/${app}/tables`, 'POST', token, {
    table: { name: spec.name, default_view_name: 'Grid', fields: withId },
  })
  if (j.code === 0) return j.data.table_id
  console.log(`  (ID as primary column rejected: ${j.msg} — retrying with ID added afterwards)`)
  j = await lark(`/open-apis/bitable/v1/apps/${app}/tables`, 'POST', token, {
    table: { name: spec.name, default_view_name: 'Grid', fields: spec.fields },
  })
  if (j.code !== 0) throw new Error(`Create table "${spec.name}": ${j.msg} (${j.code})`)
  const tableId = j.data.table_id
  await sleep(300)
  const f = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${tableId}/fields`, 'POST', token, idField)
  if (f.code !== 0) console.log(`  WARN: could not add ID column: ${f.msg}`)
  return tableId
}

async function ensureFields(token, app, tableId, spec) {
  const have = new Set((await listFields(token, app, tableId)).map((f) => f.field_name))
  for (const f of [idField, ...spec.fields]) {
    if (have.has(f.field_name)) continue
    const j = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${tableId}/fields`, 'POST', token, f)
    console.log(j.code === 0 ? `  + added column "${f.field_name}"` : `  WARN: "${f.field_name}": ${j.msg}`)
    await sleep(200)
  }
}

/** Hide technical columns in every grid view (best effort) */
async function hideFields(token, app, tableId, spec) {
  if (!spec.hidden?.length) return
  const fields = await listFields(token, app, tableId)
  const ids = fields.filter((f) => spec.hidden.includes(f.field_name)).map((f) => f.field_id)
  if (!ids.length) return
  const vj = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${tableId}/views?page_size=100`, 'GET', token)
  if (vj.code !== 0) {
    console.log(`  WARN: could not list views: ${vj.msg}`)
    return
  }
  for (const v of vj.data?.items || []) {
    if (v.view_type !== 'grid') continue
    const cur = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${tableId}/views/${v.view_id}`, 'GET', token)
    const hidden = new Set(cur.data?.view?.property?.hidden_fields || [])
    if (ids.every((id) => hidden.has(id))) continue
    for (const id of ids) hidden.add(id)
    const j = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${tableId}/views/${v.view_id}`, 'PATCH', token, {
      property: { hidden_fields: [...hidden] },
    })
    console.log(
      j.code === 0
        ? `  ~ hid ${spec.hidden.join(', ')} in view "${v.view_name}"`
        : `  WARN: could not hide columns in "${v.view_name}": ${j.msg}`,
    )
  }
}

async function tableIsBlank(token, app, tableId) {
  const j = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${tableId}/records?page_size=100`, 'GET', token)
  if (j.code !== 0) return false
  if (j.data?.has_more) return false
  return (j.data?.items || []).every((r) =>
    Object.values(r.fields || {}).every((v) => v == null || v === '' || (Array.isArray(v) && v.length === 0)),
  )
}

async function main() {
  const link = parseLink(process.argv[2])
  const { raw, env } = readEnv()

  const tj = await lark('/open-apis/auth/v3/tenant_access_token/internal', 'POST', null, {
    app_id: env.VITE_LARK_APP_ID,
    app_secret: env.VITE_LARK_APP_SECRET,
  })
  if (tj.code !== 0) throw new Error(`Token: ${tj.msg} (${tj.code})`)
  const token = tj.tenant_access_token
  console.log('Token OK')
  const app = await resolveAppToken(link, token)

  const before = await listTables(token, app)
  console.log(`Base reachable — ${before.length} existing table(s): ${before.map((t) => t.name).join(', ') || '(none)'}`)

  const updates = { VITE_LARK_BASE_APP_TOKEN: app }
  const ours = new Set()

  for (const spec of TABLES) {
    const existing = before.find((t) => t.name === spec.name)
    let tableId
    if (existing) {
      tableId = existing.table_id
      console.log(`\n"${spec.name}" already exists (${tableId}) — checking columns`)
      await ensureFields(token, app, tableId, spec)
    } else {
      console.log(`\nCreating "${spec.name}"…`)
      tableId = await createTable(token, app, spec)
      console.log(`  ✓ created ${tableId}`)
    }
    await hideFields(token, app, tableId, spec)
    ours.add(tableId)
    updates[spec.envKey] = tableId
    await sleep(300)
  }

  for (const t of before) {
    if (ours.has(t.table_id)) continue
    if (await tableIsBlank(token, app, t.table_id)) {
      const j = await lark(`/open-apis/bitable/v1/apps/${app}/tables/${t.table_id}`, 'DELETE', token)
      console.log(j.code === 0 ? `\nRemoved empty default table "${t.name}"` : `\nWARN: could not remove "${t.name}": ${j.msg}`)
    } else {
      console.log(`\nKept "${t.name}" (has data)`)
    }
  }

  writeEnv(raw, updates)
  console.log('\n.env.local updated:')
  for (const [k, v] of Object.entries(updates)) console.log(`  ${k}=${v}`)
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
