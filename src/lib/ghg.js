import { writable, derived, get } from 'svelte/store'
import * as DB from './db.js'
import { EMISSION_SOURCES, COMMUTE_VEHICLES } from './constants.js'
import { ALL_COMPANIES, matchesCompany, normalizeCompany } from './companies.js'
import { calcCommute, formatHotelStaysDetail, formatTripTransportDetail } from './calculations.js'
import {
  OFFICE_COLS as O,
  TRIP_COLS as T,
  COMMUTE_COLS as M,
  larkConfig,
  isLarkConfigured,
  listAllRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  readText,
  readNumber,
  readJson,
} from './larkDb.js'

const now = new Date()
const POLL_MS = 5000

/** @param {number} m @param {number} y */
export function periodKey(m, y) {
  return `${y}-${String(m).padStart(2, '0')}`
}

/** Value of the «Reporting Period» column, e.g. Month 6 - 2026 */
export function periodLabel(m, y) {
  return `Month ${m} - ${y}`
}

/** «Month 6 - 2026» / «Tháng 6 - 2026» / «2026-06» → 2026-06 (empty if unrecognised) */
export function parsePeriodLabel(text) {
  const s = String(text ?? '').trim()
  let m = s.match(/(?:month|tháng)\s*(\d{1,2})\s*[-/]\s*(\d{4})/i)
  if (m) return periodKey(Number(m[1]), Number(m[2]))
  m = s.match(/^(\d{4})-(\d{1,2})$/)
  if (m) return periodKey(Number(m[2]), Number(m[1]))
  return ''
}

export const currentMonth = writable(now.getMonth() + 1)
export const currentYear = writable(now.getFullYear())
export const activePage = writable(
  /** @type {'dashboard'|'office'|'employee'|'commute'|'close'} */ ('dashboard'),
)
export const selectedCompany = writable(ALL_COMPANIES)
export const dashboardMode = writable(/** @type {'month'|'year'} */ ('month'))

/** @param {'dashboard'|'office'|'employee'|'commute'|'close'} p */
export function setActivePage(p) {
  activePage.set(p)
}

/** @param {number} m @param {number} y */
export function setPeriod(m, y) {
  currentMonth.set(m)
  currentYear.set(y)
}

export function shiftPeriod(delta) {
  let m = get(currentMonth) + delta
  let y = get(currentYear)
  if (m > 12) {
    m = 1
    y++
  }
  if (m < 1) {
    m = 12
    y--
  }
  setPeriod(m, y)
}

export function currentPK() {
  return periodKey(get(currentMonth), get(currentYear))
}

function currentPeriodText() {
  return periodLabel(get(currentMonth), get(currentYear))
}

/* ───────────── Data from Lark (all periods) ───────────── */

export const allEquip = writable(/** @type {any[]} */ ([]))
export const allTrips = writable(/** @type {any[]} */ ([]))
export const allCommute = writable(/** @type {any[]} */ ([]))

const currentPkStore = derived([currentMonth, currentYear], ([$m, $y]) => periodKey($m, $y))

export const equipRows = derived([allEquip, currentPkStore], ([$a, $pk]) => $a.filter((r) => r.pk === $pk))
export const empTrips = derived([allTrips, currentPkStore], ([$a, $pk]) => $a.filter((r) => r.pk === $pk))
export const commuteList = derived([allCommute, currentPkStore], ([$a, $pk]) => $a.filter((r) => r.pk === $pk))

export const periodKeys = derived([allEquip, allTrips, allCommute, currentPkStore], ([$e, $t, $c, $pk]) => {
  const all = new Set([$pk])
  for (const r of [...$e, ...$t, ...$c]) if (r.pk) all.add(r.pk)
  return [...all].sort()
})

/** @typedef {{ state: 'idle'|'loading'|'ok'|'error', lastSync: number, error: unknown }} SyncStatus */
export const syncStatus = writable(/** @type {SyncStatus} */ ({ state: 'idle', lastSync: 0, error: null }))

export const offSettings = writable(/** @type {{ company?: string, location?: string }} */ (DB.load('ghg-offsettings') || {}))

export function setCompanyLocation(company, location) {
  offSettings.update((o) => ({ ...o, company, location }))
  DB.save('ghg-offsettings', get(offSettings))
}

/** @param {unknown} v */
function normText(v) {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const round1 = (n) => Math.round(n * 10) / 10

/** @param {number} n */
function formatTotalTonnes(n) {
  return String(+n.toFixed(6))
}

/* ───────────── Record ↔ row mapping ───────────── */

/** @param {{ record_id: string, fields: Record<string, unknown> }} rec */
function officeFromRecord(rec) {
  const f = rec.fields || {}
  const period = readText(f[O.period])
  const source = readText(f[O.source])
  const src = EMISSION_SOURCES.find((s) => s.label === source)
  const scope = readNumber(f[O.scope]) || src?.scope || 1
  return {
    id: rec.record_id,
    pk: parsePeriodLabel(period),
    period,
    company: normalizeCompany(readText(f[O.company])) || readText(f[O.company]),
    equipment: readText(f[O.equipment]),
    source,
    scope: scope === 2 ? 2 : 1,
    unit: readText(f[O.unit]) || src?.unit || '',
    volume: readNumber(f[O.volume]),
    ef: readNumber(f[O.ef]),
    efRef: readText(f[O.efRef]),
    totalText: readText(f[O.total]),
  }
}

/** @param {Record<string, any>} row @param {string} period */
function officeToFields(row, period) {
  const tot = row.volume && row.ef ? (row.volume * row.ef) / 1000 : 0
  return {
    [O.period]: period,
    [O.company]: normalizeCompany(row.company) || row.company || '',
    [O.equipment]: row.equipment || '',
    [O.source]: row.source || '',
    [O.scope]: row.scope ?? '',
    [O.unit]: row.unit || '',
    [O.volume]: row.volume || '',
    [O.ef]: row.ef || '',
    [O.efRef]: row.efRef || '',
    [O.total]: tot ? formatTotalTonnes(tot) : '',
  }
}

/** @param {{ record_id: string, fields: Record<string, unknown> }} rec */
function tripFromRecord(rec) {
  const f = rec.fields || {}
  const d = readJson(f[T.appData])
  const period = readText(f[T.period])
  const co2Air = readNumber(f[T.co2Air])
  const co2Ground = readNumber(f[T.co2Ground])
  const co2Hotel = readNumber(f[T.co2Hotel])
  const co2Total = readText(f[T.co2Total]) ? readNumber(f[T.co2Total]) : round1(co2Air + co2Ground + co2Hotel)
  return {
    flightLegs: Array.isArray(d.flightLegs) ? d.flightLegs : [],
    otherTransports: Array.isArray(d.otherTransports) ? d.otherTransports : [],
    hotelStays: Array.isArray(d.hotelStays) ? d.hotelStays : [],
    proj: d.proj ?? '',
    note: d.note ?? '',
    id: rec.record_id,
    pk: parsePeriodLabel(period),
    period,
    name: readText(f[T.name]),
    empId: readText(f[T.empId]),
    company: normalizeCompany(readText(f[T.company])) || readText(f[T.company]),
    dept: readText(f[T.dept]),
    trip: readText(f[T.trip]),
    purpose: readText(f[T.purpose]),
    from: readText(f[T.from]),
    to: readText(f[T.to]),
    dateFrom: readText(f[T.dateFrom]),
    dateTo: readText(f[T.dateTo]),
    co2Air,
    co2Ground,
    co2Hotel,
    co2Total,
  }
}

/** @param {Record<string, any>} entry @param {string} period */
function tripToFields(entry, period) {
  return {
    [T.period]: period,
    [T.name]: entry.name || '',
    [T.empId]: entry.empId || '',
    [T.company]: normalizeCompany(entry.company) || entry.company || '',
    [T.dept]: entry.dept || '',
    [T.trip]: entry.trip || '',
    [T.purpose]: entry.purpose || '',
    [T.from]: entry.from || '',
    [T.to]: entry.to || '',
    [T.dateFrom]: entry.dateFrom || '',
    [T.dateTo]: entry.dateTo || '',
    [T.co2Air]: entry.co2Air ?? '',
    [T.co2Ground]: entry.co2Ground ?? '',
    [T.co2Hotel]: entry.co2Hotel ?? '',
    [T.co2Total]: entry.co2Total ?? '',
    [T.transportDetail]: formatTripTransportDetail(entry),
    [T.hotelDetail]: formatHotelStaysDetail(entry),
    [T.appData]: JSON.stringify({
      flightLegs: entry.flightLegs || [],
      otherTransports: entry.otherTransports || [],
      hotelStays: entry.hotelStays || [],
      proj: entry.proj || '',
      note: entry.note || '',
    }),
  }
}

/** @param {string} label @returns {number | null} null when the vehicle name is not recognised */
function vehicleEf(label) {
  const v = normText(label)
  if (!v) return null
  const hit = COMMUTE_VEHICLES.find((x) => normText(x.label.split(' (')[0]) === v || normText(x.label) === v)
  return hit ? hit.value : null
}

/** @param {{ record_id: string, fields: Record<string, unknown> }} rec */
function commuteFromRecord(rec) {
  const f = rec.fields || {}
  const d = readJson(f[M.appData])
  const period = readText(f[M.period])
  const vehicle = readText(f[M.vehicle])
  const days = readText(f[M.days]) ? readNumber(f[M.days]) : 22
  const wfh = readNumber(f[M.wfh])
  const ef = vehicleEf(vehicle) ?? (Number(d.ef) || 0)
  const km = readNumber(f[M.km])
  const months = Number(d.months) || 1
  const carpool = readNumber(f[M.carpool]) || 1
  return {
    id: rec.record_id,
    pk: parsePeriodLabel(period),
    period,
    name: readText(f[M.name]),
    empId: readText(f[M.empId]),
    company: normalizeCompany(readText(f[M.company])) || readText(f[M.company]),
    dept: readText(f[M.dept]),
    vehicle,
    ef,
    km,
    days,
    wfh,
    months,
    carpool,
    effectiveDays: Math.max(0, days - wfh),
    co2: calcCommute(ef, km, days, months, wfh, carpool),
    co2Text: readText(f[M.co2]),
  }
}

/** @param {Record<string, any>} entry @param {string} period */
function commuteToFields(entry, period) {
  return {
    [M.period]: period,
    [M.name]: entry.name || '',
    [M.empId]: entry.empId || '',
    [M.company]: normalizeCompany(entry.company) || entry.company || '',
    [M.dept]: entry.dept || '',
    [M.vehicle]: entry.vehicle || '',
    [M.km]: entry.km ?? '',
    [M.days]: entry.days ?? '',
    [M.wfh]: entry.wfh ?? '',
    [M.carpool]: entry.carpool ?? '',
    [M.co2]: entry.co2 ?? '',
    [M.appData]: JSON.stringify({ ef: entry.ef ?? 0, months: entry.months ?? 1 }),
  }
}

/* ───────────── Live sync engine ───────────── */

let writeSeq = 0
let pendingWrites = 0
/** @type {Promise<void> | null} */
let refreshing = null
/** Records whose stored total is being corrected */
const fixingTotals = new Set()

/** @template R @param {() => Promise<R>} fn @returns {Promise<R>} */
async function runWrite(fn) {
  pendingWrites++
  writeSeq++
  try {
    return await fn()
  } finally {
    pendingWrites--
    writeSeq++
  }
}

/** @param {import('svelte/store').Writable<any[]>} store @param {any} row */
function upsertLocal(store, row) {
  store.update((list) => {
    const i = list.findIndex((x) => x.id === row.id)
    if (i < 0) return [...list, row]
    const copy = [...list]
    copy[i] = row
    return copy
  })
}

/** @param {import('svelte/store').Writable<any[]>} store @param {string} id */
function removeLocal(store, id) {
  store.update((list) => list.filter((x) => x.id !== id))
}

/** Keep «Total GHG» in Lark consistent when Volume / EF were edited directly in Lark */
function fixOfficeTotals(rows) {
  const table = larkConfig().tables.office
  for (const r of rows) {
    if (!r.volume || !r.ef || fixingTotals.has(r.id)) continue
    const want = formatTotalTonnes((r.volume * r.ef) / 1000)
    if (r.totalText === want) continue
    fixingTotals.add(r.id)
    runWrite(() => updateRecord(table, r.id, { [O.total]: want }))
      .then(() => upsertLocal(allEquip, { ...r, totalText: want }))
      .catch((e) => console.warn('[Lark] could not update total', r.id, e))
      .finally(() => fixingTotals.delete(r.id))
  }
}

/** Same for «CO₂e (kg)» when km / days / WFH / carpool / vehicle were edited in Lark */
function fixCommuteTotals(rows) {
  const table = larkConfig().tables.commute
  for (const r of rows) {
    if (fixingTotals.has(r.id)) continue
    const want = String(r.co2)
    if (r.co2Text === want || (!r.co2Text && !r.co2)) continue
    fixingTotals.add(r.id)
    runWrite(() => updateRecord(table, r.id, { [M.co2]: want }))
      .then(() => upsertLocal(allCommute, { ...r, co2Text: want }))
      .catch((e) => console.warn('[Lark] could not update commute CO₂e', r.id, e))
      .finally(() => fixingTotals.delete(r.id))
  }
}

export async function refreshFromLark() {
  if (!isLarkConfigured()) {
    syncStatus.set({
      state: 'error',
      lastSync: 0,
      error: new Error('Lark is not configured — set VITE_LARK_* in .env.local'),
    })
    return
  }
  if (refreshing) return refreshing
  refreshing = (async () => {
    const seq = writeSeq
    syncStatus.update((s) => (s.lastSync ? s : { ...s, state: 'loading' }))
    try {
      const { tables } = larkConfig()
      const [o, t, c] = await Promise.all([
        listAllRecords(tables.office),
        listAllRecords(tables.trips),
        listAllRecords(tables.commute),
      ])
      if (seq !== writeSeq || pendingWrites > 0) return
      const office = o.map(officeFromRecord)
      const commute = c.map(commuteFromRecord)
      allEquip.set(office)
      allTrips.set(t.map(tripFromRecord))
      allCommute.set(commute)
      syncStatus.set({ state: 'ok', lastSync: Date.now(), error: null })
      fixOfficeTotals(office)
      fixCommuteTotals(commute)
    } catch (e) {
      syncStatus.update((s) => ({ ...s, state: 'error', error: e }))
    }
  })()
  try {
    await refreshing
  } finally {
    refreshing = null
  }
}

/** Initial load + poll Lark every few seconds while the tab is visible. Returns a stop function. */
export function startLiveSync() {
  refreshFromLark()
  const tick = () => {
    if (document.visibilityState === 'visible') refreshFromLark()
  }
  const timer = setInterval(tick, POLL_MS)
  document.addEventListener('visibilitychange', tick)
  window.addEventListener('focus', tick)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', tick)
    window.removeEventListener('focus', tick)
  }
}

/* ───────────── Office: local drafts → Lark records ───────────── */

const DRAFTS_KEY = 'ghg-equip-drafts'

/** Unsaved rows in the input section; `recordId` set when editing an existing Lark record */
export const equipDrafts = writable(/** @type {any[]} */ (DB.load(DRAFTS_KEY) || []))
equipDrafts.subscribe((v) => DB.save(DRAFTS_KEY, v))

export const equipDraftRows = derived([equipDrafts, currentPkStore], ([$d, $pk]) => $d.filter((r) => r.pk === $pk))

/** @param {string} company */
export function addEquipDraft(company) {
  equipDrafts.update((rows) => [
    ...rows,
    {
      id: `draft-${Date.now()}`,
      recordId: '',
      pk: currentPK(),
      period: currentPeriodText(),
      source: '',
      equipment: '',
      unit: '',
      ef: 0,
      efRef: '',
      volume: 0,
      scope: 1,
      company,
    },
  ])
}

/** @param {string} id @param {string} key @param {unknown} val */
export function updateEquipDraft(id, key, val) {
  equipDrafts.update((rows) => rows.map((r) => (r.id === id ? { ...r, [key]: val } : r)))
}

/** @param {string} id @param {string} label */
export function selectDraftSource(id, label) {
  const src = EMISSION_SOURCES.find((s) => s.label === label)
  equipDrafts.update((rows) =>
    rows.map((r) => {
      if (r.id !== id) return r
      const next = { ...r, source: label }
      if (src?.ef) next.ef = src.ef
      if (src?.unit) next.unit = src.unit
      if (src?.ref) next.efRef = src.ref
      if (src?.scope !== undefined) next.scope = src.scope
      return next
    }),
  )
}

/** @param {string} id */
export function removeEquipDraft(id) {
  equipDrafts.update((rows) => rows.filter((r) => r.id !== id))
}

/** Copy a Lark record into the input section for editing (returns false if already being edited) */
export function editEquipRecord(row) {
  if (get(equipDrafts).some((d) => d.recordId === row.id)) return false
  equipDrafts.update((rows) => [
    ...rows,
    {
      id: `draft-${Date.now()}`,
      recordId: row.id,
      pk: row.pk,
      period: row.period,
      source: row.source,
      equipment: row.equipment,
      unit: row.unit,
      ef: row.ef,
      efRef: row.efRef,
      volume: row.volume,
      scope: row.scope,
      company: row.company,
    },
  ])
  return true
}

/** Create or update the Lark record for a draft, then drop the draft */
export async function saveEquipDraft(id) {
  const draft = get(equipDrafts).find((r) => r.id === id)
  if (!draft) return
  const table = larkConfig().tables.office
  const fields = officeToFields(draft, draft.period || currentPeriodText())
  const rec = await runWrite(() =>
    draft.recordId ? updateRecord(table, draft.recordId, fields) : createRecord(table, fields),
  )
  upsertLocal(allEquip, officeFromRecord(rec))
  removeEquipDraft(id)
  refreshFromLark()
}

/** @param {string} id Lark record id */
export async function deleteEquipRecord(id) {
  await runWrite(() => deleteRecord(larkConfig().tables.office, id))
  removeLocal(allEquip, id)
  equipDrafts.update((rows) => rows.filter((r) => r.recordId !== id))
  refreshFromLark()
}

/* ───────────── Business trips ───────────── */

/** @param {Record<string, unknown>} entry */
function empTripSignature(entry) {
  return [
    normText(entry.empId),
    normText(entry.trip),
    normText(entry.dateFrom),
    normText(entry.dateTo),
    normText(entry.from),
    normText(entry.to),
  ].join('|')
}

/** @param {Record<string, any>} entry @returns {Promise<boolean>} false when a duplicate exists */
export async function addEmpTrip(entry) {
  const sig = empTripSignature(entry)
  if (get(empTrips).some((x) => empTripSignature(x) === sig)) return false
  const rec = await runWrite(() => createRecord(larkConfig().tables.trips, tripToFields(entry, currentPeriodText())))
  upsertLocal(allTrips, tripFromRecord(rec))
  refreshFromLark()
  return true
}

/** @param {string} id @param {Record<string, any>} entry @returns {Promise<boolean>} */
export async function updateEmpTripById(id, entry) {
  const sig = empTripSignature(entry)
  if (get(empTrips).some((x) => x.id !== id && empTripSignature(x) === sig)) return false
  const existing = get(allTrips).find((x) => x.id === id)
  const period = existing?.period || currentPeriodText()
  const rec = await runWrite(() => updateRecord(larkConfig().tables.trips, id, tripToFields(entry, period)))
  upsertLocal(allTrips, tripFromRecord(rec))
  refreshFromLark()
  return true
}

/** @param {string} id */
export async function deleteEmpTripById(id) {
  await runWrite(() => deleteRecord(larkConfig().tables.trips, id))
  removeLocal(allTrips, id)
  refreshFromLark()
}

/* ───────────── Commute ───────────── */

/**
 * Update the given record, or the current-period row with the same Emp ID, otherwise create.
 * @param {Record<string, any>} entry @param {string | null} editingId
 */
export async function upsertCommute(entry, editingId) {
  const table = larkConfig().tables.commute
  const target =
    (editingId && get(allCommute).find((c) => c.id === editingId)) ||
    get(commuteList).find((c) => normText(c.empId) === normText(entry.empId))
  const rec = await runWrite(() =>
    target
      ? updateRecord(table, target.id, commuteToFields(entry, target.period || currentPeriodText()))
      : createRecord(table, commuteToFields(entry, currentPeriodText())),
  )
  upsertLocal(allCommute, commuteFromRecord(rec))
  refreshFromLark()
  return { updated: !!target }
}

/** @param {string} id */
export async function deleteCommuteById(id) {
  await runWrite(() => deleteRecord(larkConfig().tables.commute, id))
  removeLocal(allCommute, id)
  refreshFromLark()
}

/* ───────────── Dashboard ───────────── */

/**
 * @param {any[]} equip
 * @param {any[]} trips
 * @param {any[]} commute
 * @param {string} companyFilter
 */
export function computeDashData(equip, trips, commute, companyFilter = '') {
  const rep = equip.filter((r) => matchesCompany(r.company, companyFilter))
  const t = trips.filter((x) => matchesCompany(x.company, companyFilter))
  const c = commute.filter((x) => matchesCompany(x.company, companyFilter))

  const s1 = rep
    .filter((r) => r.scope === 1)
    .reduce((s, r) => s + (r.volume && r.ef ? (r.volume * r.ef) / 1000 : 0), 0)
  const s2 = rep
    .filter((r) => r.scope === 2)
    .reduce((s, r) => s + (r.volume && r.ef ? (r.volume * r.ef) / 1000 : 0), 0)
  const s3Trip = t.reduce((s, x) => s + (x.co2Total || 0) / 1000, 0)
  const s3Comm = c.reduce((s, x) => s + (x.co2 || 0) / 1000, 0)
  const s3 = s3Trip + s3Comm
  const total = s1 + s2 + s3
  const fmt = (n) => n.toFixed(3)

  const sources = [
    ['Fuel Combustion (S1)', s1, '#C0392B'],
    ['Electricity & steam (S2)', s2, '#B85C00'],
    ['Business travel (S3.6)', s3Trip, '#1B4F8A'],
    ['Daily commute (S3.7)', s3Comm, '#1A6B3C'],
  ].filter((x) => x[1] > 0)
  const maxS = Math.max(...sources.map((s) => s[1]), 0.001)

  const allItems = [
    ...rep
      .filter((r) => r.volume && r.ef)
      .map((r) => ({ label: r.equipment || r.source || 'Equipment', val: (r.volume * r.ef) / 1000 })),
    ...t.map((x) => ({ label: `${x.trip} (${x.name})`, val: x.co2Total / 1000 })),
    ...c.map((x) => ({ label: `Commute: ${x.name}`, val: x.co2 / 1000 })),
  ]
    .sort((a, b) => b.val - a.val)
    .slice(0, 6)
  const maxA = Math.max(...allItems.map((a) => a.val), 0.001)

  const deptMap = {}
  for (const x of t) {
    const d = x.dept || 'Other'
    deptMap[d] = (deptMap[d] || 0) + (x.co2Total || 0) / 1000
  }
  for (const x of c) {
    const d = x.dept || 'Other'
    deptMap[d] = (deptMap[d] || 0) + (x.co2 || 0) / 1000
  }
  const deptArr = Object.entries(deptMap).sort((a, b) => b[1] - a[1])
  const maxD = Math.max(...deptArr.map((d) => d[1]), 0.001)

  const offItems = rep
    .filter((r) => r.volume && r.ef)
    .map((r) => ({
      label: r.equipment || r.source || '—',
      val: (r.volume * r.ef) / 1000,
      scope: r.scope,
    }))
  const maxO = Math.max(...offItems.map((o) => o.val), 0.001)

  return {
    total: fmt(total),
    s1: fmt(s1),
    s2: fmt(s2),
    s3: fmt(s3),
    sources,
    maxS,
    totalTon: total,
    allItems,
    maxA,
    deptArr,
    maxD,
    offItems,
    maxO,
  }
}

/** Dashboard for the current month + company filter */
export const dash = derived(
  [equipRows, empTrips, commuteList, selectedCompany],
  ([$e, $t, $c, $co]) => computeDashData($e, $t, $c, $co),
)

/** Dashboard for every month of the selected year */
export const dashYear = derived(
  [allEquip, allTrips, allCommute, currentYear, selectedCompany],
  ([$e, $t, $c, $y, $co]) => {
    const prefix = `${$y}-`
    const inYear = (r) => r.pk.startsWith(prefix)
    const monthly = []
    for (let m = 1; m <= 12; m++) {
      const pk = periodKey(m, $y)
      const atPk = (r) => r.pk === pk
      const d = computeDashData($e.filter(atPk), $t.filter(atPk), $c.filter(atPk), $co)
      monthly.push({ month: m, pk, total: d.totalTon, label: periodLabel(m, $y) })
    }
    const agg = computeDashData($e.filter(inYear), $t.filter(inYear), $c.filter(inYear), $co)
    const maxM = Math.max(...monthly.map((x) => x.total), 0.001)
    return { ...agg, monthly, maxM, year: $y }
  },
)
