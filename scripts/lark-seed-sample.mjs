/**
 * Insert sample data into Lark Base (5 Office rows, 5 business trips with several flights / transports).
 * Uses the same formulas and column format as the web app, so every row can be opened with Edit.
 *
 *   node scripts/lark-seed-sample.mjs            → create sample rows (period = current month)
 *   node scripts/lark-seed-sample.mjs "Month 9 - 2026"
 *   node scripts/lark-seed-sample.mjs --delete   → remove the rows created by the last run
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMISSION_SOURCES } from '../src/lib/constants.js'
import { TRIP_COLS as T } from '../src/lib/larkSchema.js'
import { legToFields, segmentToFields, stayToFields, tripTotals } from '../src/lib/tripChildren.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const idsPath = resolve(root, 'scripts/.sample-ids.local')
const LARK = 'https://open.larksuite.com'

function readEnv() {
  const env = {}
  for (const line of readFileSync(resolve(root, '.env.local'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return env
}

const env = readEnv()
const app = env.VITE_LARK_BASE_APP_TOKEN
const TABLE = {
  office: env.VITE_LARK_TABLE_OFFICE,
  trips: env.VITE_LARK_TABLE_TRIPS,
  flights: env.VITE_LARK_TABLE_FLIGHTS,
  ground: env.VITE_LARK_TABLE_GROUND,
  hotels: env.VITE_LARK_TABLE_HOTELS,
}

let token = ''
async function lark(path, method = 'GET', body) {
  const res = await fetch(`${LARK}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await res.json()
  if (j.code !== 0) throw new Error(`${method} ${path}: ${j.msg} (${j.code})`)
  return j
}

const records = (t) => `/open-apis/bitable/v1/apps/${app}/tables/${t}/records`
const str = (fields) =>
  Object.fromEntries(
    Object.entries(fields)
      .filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => [k, Array.isArray(v) ? v : String(v)]),
  )
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

/* ───────────── Sample data ───────────── */

const OFFICE = [
  { company: 'ECS', equipment: 'Backup generator 250 kVA', source: 'Diesel (generator)', volume: 320 },
  { company: 'MLOG', equipment: 'Company delivery van fleet', source: 'Petrol (motor vehicles)', volume: 1450 },
  { company: 'SUNNY AUTO', equipment: 'Canteen kitchen stoves', source: 'LPG Gas (cooking/boiler)', volume: 180 },
  { company: 'TREE MARINE', equipment: 'Central air conditioning (refill)', source: 'R-410A (refrigerant leakage)', volume: 2.5 },
  { company: 'LEONG LEE', equipment: 'Head office building', source: 'Grid electricity (Vietnam)', volume: 18500 },
]

const leg = (from, to, km, cabin = 'Economy', legs = 1) => {
  const c = { Economy: 0.133, 'Prem. Economy': 0.2, Business: 0.266, First: 0.532 }[cabin]
  return { id: uid(), from, to, km, legs, cabin: c, cabinLabel: cabin }
}
const seg = (type, opts) => ({ id: uid(), type, km: 0, ef: 0.192, liters: 0, count: 1, note: '', energyRate: 0.18, gridEF: 0.4937, ...opts })
const hotel = (stars, nights, note = '', rooms = 1) => ({ id: uid(), hotelType: stars, nights, rooms, note })

const TRIPS = [
  {
    name: 'Nguyen Van An', empId: 'ECS-1021', company: 'ECS', dept: 'Sales & Business Development',
    trip: 'Singapore client roadshow', purpose: 'Client meeting / negotiation', from: 'Ho Chi Minh City', to: 'Singapore',
    days: [3, 6], proj: 'PRJ-2026-SG01',
    flightLegs: [leg('SGN', 'SIN', 1100), leg('SIN', 'SGN', 1100)],
    otherTransports: [seg('grab', { km: 18, count: 4, note: 'Grab airport + client visits' }), seg('train', { km: 12, count: 6, note: 'MRT' })],
    hotelStays: [hotel(28, 3, 'Marina Bay area hotel')],
  },
  {
    name: 'Tran Thi Bich', empId: 'MLOG-2045', company: 'MLOG', dept: 'Operations & Production',
    trip: 'Northern warehouse inspection', purpose: 'Project inspection', from: 'Ho Chi Minh City', to: 'Hai Phong',
    days: [8, 11], proj: 'PRJ-2026-HP03',
    flightLegs: [leg('SGN', 'HPH', 1150), leg('HPH', 'SGN', 1150)],
    otherTransports: [
      seg('car', { km: 120, ef: 0.245, count: 2, note: 'SUV Hai Phong ↔ Hanoi' }),
      seg('fuel', { liters: 35, count: 3, note: 'Fuel refills' }),
      seg('grab', { km: 25, count: 2, note: 'Taxi to port' }),
    ],
    hotelStays: [hotel(20, 2, 'Hai Phong 3-star'), hotel(10, 1, 'Company guesthouse Hanoi')],
  },
  {
    name: 'Le Minh Chau', empId: 'SH-3310', company: 'SPEC HUB', dept: 'Executive Management',
    trip: 'Tokyo industry conference', purpose: 'Conference / seminar', from: 'Hanoi', to: 'Tokyo',
    days: [12, 17], proj: 'PRJ-2026-JP02',
    flightLegs: [leg('HAN', 'NRT', 3650, 'Business'), leg('NRT', 'KIX', 400), leg('KIX', 'HAN', 3300, 'Business')],
    otherTransports: [seg('train', { km: 60, count: 2, note: 'Narita Express' }), seg('train', { km: 500, count: 1, note: 'Shinkansen Tokyo → Osaka' })],
    hotelStays: [hotel(38, 3, 'Tokyo 5-star'), hotel(28, 2, 'Osaka 4-star')],
  },
  {
    name: 'Pham Quoc Dung', empId: 'SA-4102', company: 'SUNNY AUTO', dept: 'Marketing',
    trip: 'Mekong dealer tour (EV)', purpose: 'Client meeting / negotiation', from: 'Ho Chi Minh City', to: 'Can Tho',
    days: [14, 16], proj: 'PRJ-2026-MK05',
    flightLegs: [],
    otherTransports: [
      seg('ev', { km: 170, count: 2, note: 'VinFast EV HCMC ↔ Can Tho', energyRate: 0.18 }),
      seg('ev', { km: 60, count: 3, note: 'EV dealer visits Can Tho', energyRate: 0.16 }),
      seg('grab', { km: 8, count: 2, note: 'Grab in town' }),
    ],
    hotelStays: [hotel(20, 2, 'Can Tho riverside hotel')],
  },
  {
    name: 'Hoang Thu Ha', empId: 'TM-5207', company: 'TREE MARINE', dept: 'Human Resources',
    trip: 'Da Nang internal training', purpose: 'Internal training', from: 'Ho Chi Minh City', to: 'Da Nang',
    days: [20, 23], proj: 'PRJ-2026-DN04',
    flightLegs: [leg('SGN', 'DAD', 610), leg('DAD', 'SGN', 610)],
    otherTransports: [seg('car', { km: 30, ef: 0.192, count: 2, note: 'Sedan airport transfer' }), seg('ground', { km: 25, ef: 0.027, count: 2, note: 'Coach to Hoi An' })],
    hotelStays: [hotel(28, 2, 'Da Nang beach hotel'), hotel(12, 1, 'Hoi An homestay')],
  },
]

/* ───────────── Field builders (same format as src/lib/ghg.js) ───────────── */

function officeFields(row, period) {
  const src = EMISSION_SOURCES.find((s) => s.label === row.source)
  const total = (row.volume * src.ef) / 1000
  return str({
    'Reporting Period': period,
    Company: row.company,
    Equipment: row.equipment,
    'Emission Source': src.label,
    Scope: src.scope,
    Unit: src.unit,
    Volume: row.volume,
    'EF (kg CO₂e/unit)': src.ef,
    'EF Reference': src.ref,
    'Total GHG (tonnes CO₂e)': +total.toFixed(6),
  })
}

function tripFields(t, period, y, m) {
  const r = tripTotals(t)
  const date = (d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return {
    totals: r,
    fields: str({
      [T.period]: period,
      [T.name]: t.name,
      [T.empId]: t.empId,
      [T.company]: t.company,
      [T.dept]: t.dept,
      [T.trip]: t.trip,
      [T.purpose]: t.purpose,
      [T.from]: t.from,
      [T.to]: t.to,
      [T.dateFrom]: date(t.days[0]),
      [T.dateTo]: date(t.days[1]),
      [T.proj]: t.proj,
      [T.note]: 'Sample data',
      [T.co2Air]: r.co2Air,
      [T.co2Ground]: r.co2Ground,
      [T.co2Hotel]: r.co2Hotel,
      [T.co2Total]: r.co2Total,
    }),
  }
}

/** Create the flight / transport / hotel rows linked to a trip */
async function createChildren(t, tripId, created) {
  const groups = [
    ['flights', t.flightLegs, legToFields],
    ['ground', t.otherTransports, segmentToFields],
    ['hotels', t.hotelStays, stayToFields],
  ]
  for (const [kind, rows, toFields] of groups) {
    if (!rows.length) continue
    const j = await lark(`${records(TABLE[kind])}/batch_create`, 'POST', {
      records: rows.map((r) => ({ fields: str(toFields(r, tripId)) })),
    })
    created[kind].push(...j.data.records.map((r) => r.record_id))
  }
}

/* ───────────── Main ───────────── */

async function main() {
  const tj = await lark('/open-apis/auth/v3/tenant_access_token/internal', 'POST', {
    app_id: env.VITE_LARK_APP_ID,
    app_secret: env.VITE_LARK_APP_SECRET,
  })
  token = tj.tenant_access_token

  if (process.argv[2] === '--delete') {
    if (!existsSync(idsPath)) return console.log('Nothing to delete (no previous sample run found).')
    const ids = JSON.parse(readFileSync(idsPath, 'utf8'))
    for (const [kind, list] of Object.entries(ids)) {
      for (const id of list) {
        try {
          await lark(`${records(TABLE[kind])}/${id}`, 'DELETE')
          console.log(`  - deleted ${kind} ${id}`)
        } catch (e) {
          console.log(`  ! ${kind} ${id}: ${e.message}`)
        }
      }
    }
    unlinkSync(idsPath)
    return console.log('Sample data removed.')
  }

  const now = new Date()
  const period = process.argv[2] || `Month ${now.getMonth() + 1} - ${now.getFullYear()}`
  const pm = period.match(/Month\s+(\d{1,2})\s*-\s*(\d{4})/i)
  if (!pm) throw new Error('Period must look like "Month 10 - 2026"')
  const [m, y] = [Number(pm[1]), Number(pm[2])]
  console.log(`Reporting Period: ${period}\n`)

  const created = { office: [], trips: [], flights: [], ground: [], hotels: [] }

  console.log('Office (Scope 1 & 2)')
  for (const row of OFFICE) {
    const fields = officeFields(row, period)
    const j = await lark(records(TABLE.office), 'POST', { fields })
    created.office.push(j.data.record.record_id)
    console.log(`  + [Scope ${fields.Scope}] ${row.company.padEnd(11)} ${row.source.padEnd(30)} ${fields['Total GHG (tonnes CO₂e)']} t`)
  }

  console.log('\nEmployees (Scope 3)')
  for (const t of TRIPS) {
    const { fields, totals } = tripFields(t, period, y, m)
    const j = await lark(records(TABLE.trips), 'POST', { fields })
    const tripId = j.data.record.record_id
    created.trips.push(tripId)
    await createChildren(t, tripId, created)
    console.log(
      `  + ${t.company.padEnd(11)} ${t.trip.padEnd(32)} ${t.flightLegs.length} flights, ${t.otherTransports.length} transports, ${t.hotelStays.length} hotels → ${totals.co2Total} kg`,
    )
  }

  writeFileSync(idsPath, JSON.stringify(created, null, 2))
  console.log('\nDone. Remove later with: node scripts/lark-seed-sample.mjs --delete')
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
