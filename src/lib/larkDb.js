/**
 * Lark Base (Bitable) as the app database — read all records, create / update / delete single records.
 *
 * Dev: proxy `/lark-open-api` (vite.config.js). Production: `/api/lark` (Vercel).
 */

import { LarkApiError, inferLarkStep, throwLarkError } from './larkError.js'
import { loadLarkSettings } from './larkSettings.js'

export const COL_PERIOD = 'Reporting Period'
export const COL_APP_DATA = 'App data (JSON)'

export const OFFICE_COLS = {
  period: COL_PERIOD,
  company: 'Company',
  equipment: 'Equipment',
  source: 'Emission Source',
  scope: 'Scope',
  unit: 'Unit',
  volume: 'Volume',
  ef: 'EF (kg CO₂e/unit)',
  efRef: 'EF Reference',
  total: 'Total GHG (tonnes CO₂e)',
}

export const TRIP_COLS = {
  period: COL_PERIOD,
  name: 'Full Name',
  empId: 'Emp ID',
  company: 'Company',
  dept: 'Department',
  trip: 'Trip Name',
  purpose: 'Purpose',
  from: 'From',
  to: 'To',
  dateFrom: 'Departure Date',
  dateTo: 'Return Date',
  co2Air: 'CO₂ flight (kg)',
  co2Ground: 'CO₂ ground (kg)',
  co2Hotel: 'CO₂ accommodation (kg)',
  co2Total: 'Total (kg CO₂e)',
  transportDetail: 'Transport details',
  hotelDetail: 'Accommodation details',
  appData: COL_APP_DATA,
}

export const COMMUTE_COLS = {
  period: COL_PERIOD,
  name: 'Full Name',
  empId: 'Emp ID',
  company: 'Company',
  dept: 'Department',
  vehicle: 'Vehicle',
  km: 'One-way km',
  days: 'Working days / Month',
  wfh: 'WFH (days/month)',
  carpool: 'Carpool (people)',
  co2: 'CO₂e (kg)',
  appData: COL_APP_DATA,
}

/** Lark codes meaning the tenant token is invalid / expired */
const TOKEN_EXPIRED_CODES = new Set([99991661, 99991663, 99991668, 99991677])

function isLocalBrowserHost() {
  if (typeof window === 'undefined') return import.meta.env.DEV
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.trycloudflare.com') || import.meta.env.DEV
}

/** Base URL: dev/tunnel = Vite proxy; production (Vercel) = /api/lark */
export function larkOpenApiPrefix() {
  const v = import.meta.env.VITE_LARK_API_BASE
  const custom = v != null ? String(v).trim().replace(/\/$/, '') : ''
  if (custom.startsWith('http://') || custom.startsWith('https://')) return custom
  if (custom && custom !== '/lark-open-api') return custom
  if (isLocalBrowserHost()) return '/lark-open-api'
  return '/api/lark'
}

export function larkConfig() {
  const s = loadLarkSettings()
  return {
    appId: s.appId.trim(),
    appSecret: s.appSecret.trim(),
    app: s.baseAppToken.trim(),
    tables: {
      office: s.tableOffice.trim(),
      trips: s.tableTrips.trim(),
      commute: s.tableCommute.trim(),
    },
  }
}

export function isLarkConfigured() {
  const c = larkConfig()
  return !!(c.appId && c.appSecret && c.app && c.tables.office && c.tables.trips && c.tables.commute)
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, token?: string }} [opts]
 */
async function rawFetch(path, opts = {}) {
  const prefix = larkOpenApiPrefix()
  const url = `${prefix}${path}`
  const method = opts.method || 'GET'
  const step = inferLarkStep(path, method)
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (err) {
    const original = err instanceof Error ? err.message : String(err)
    const message = import.meta.env.DEV
      ? 'Cannot reach the Lark proxy — keep "npm run dev" running and reload the page.'
      : 'Cannot reach /api/lark — check the Vercel deployment.'
    throw new LarkApiError(message, { step, url, method, apiPrefix: prefix, original })
  }
  const text = await res.text()
  /** @type {Record<string, any>} */
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  if (!res.ok && typeof json.code !== 'number') {
    throwLarkError(`HTTP ${res.status} from Lark proxy`, {
      step,
      url,
      method,
      httpStatus: res.status,
      apiPrefix: prefix,
      responseSnippet: text.trim().slice(0, 480),
    })
  }
  return { json, url, step, method, apiPrefix: prefix, status: res.status }
}

/** @type {{ value: string, expiresAt: number } | null} */
let tokenCache = null
/** @type {Promise<string> | null} */
let tokenInflight = null

async function getToken(force = false) {
  if (!force && tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value
  if (tokenInflight) return tokenInflight
  tokenInflight = (async () => {
    const c = larkConfig()
    const r = await rawFetch('/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      body: { app_id: c.appId, app_secret: c.appSecret },
    })
    if (r.json.code !== 0 || !r.json.tenant_access_token) {
      throwLarkError(String(r.json.msg || 'Lark rejected App ID / Secret'), {
        step: r.step,
        url: r.url,
        method: r.method,
        apiPrefix: r.apiPrefix,
        larkCode: r.json.code,
        larkMsg: String(r.json.msg || ''),
      })
    }
    const ttl = Number(r.json.expire) || 7200
    tokenCache = { value: r.json.tenant_access_token, expiresAt: Date.now() + (ttl - 120) * 1000 }
    return tokenCache.value
  })()
  try {
    return await tokenInflight
  } finally {
    tokenInflight = null
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, tableId?: string }} [opts]
 */
async function api(path, opts = {}) {
  let token = await getToken()
  let r = await rawFetch(path, { ...opts, token })
  if (TOKEN_EXPIRED_CODES.has(r.json.code)) {
    token = await getToken(true)
    r = await rawFetch(path, { ...opts, token })
  }
  if (r.json.code !== 0) {
    throwLarkError(String(r.json.msg || `Lark error ${r.json.code}`), {
      step: r.step,
      url: r.url,
      method: r.method,
      httpStatus: r.status,
      apiPrefix: r.apiPrefix,
      tableId: opts.tableId,
      larkCode: r.json.code,
      larkMsg: String(r.json.msg || ''),
    })
  }
  return r.json.data || {}
}

/** @param {string} tableId */
function recordsPath(tableId) {
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(larkConfig().app)}/tables/${encodeURIComponent(tableId)}/records`
}

/**
 * @param {string} tableId
 * @returns {Promise<Array<{ record_id: string, fields: Record<string, unknown> }>>}
 */
export async function listAllRecords(tableId) {
  const out = []
  let pageToken = ''
  for (let i = 0; i < 200; i++) {
    const qs = new URLSearchParams({ page_size: '500' })
    if (pageToken) qs.set('page_token', pageToken)
    const data = await api(`${recordsPath(tableId)}?${qs}`, { tableId })
    out.push(...(data.items || []))
    if (!data.has_more || !data.page_token) break
    pageToken = data.page_token
  }
  return out
}

/** Empty values are omitted on create and cleared (null) on update */
function cleanFields(fields, forUpdate) {
  /** @type {Record<string, string | null>} */
  const out = {}
  for (const [k, v] of Object.entries(fields)) {
    const s = v == null ? '' : String(v)
    if (s === '') {
      if (forUpdate) out[k] = null
    } else {
      out[k] = s
    }
  }
  return out
}

/** @param {string} tableId @param {Record<string, unknown>} fields */
export async function createRecord(tableId, fields) {
  const data = await api(recordsPath(tableId), {
    method: 'POST',
    body: { fields: cleanFields(fields, false) },
    tableId,
  })
  return data.record
}

/** @param {string} tableId @param {string} recordId @param {Record<string, unknown>} fields */
export async function updateRecord(tableId, recordId, fields) {
  const data = await api(`${recordsPath(tableId)}/${encodeURIComponent(recordId)}`, {
    method: 'PUT',
    body: { fields: cleanFields(fields, true) },
    tableId,
  })
  return data.record
}

/** @param {string} tableId @param {string} recordId */
export async function deleteRecord(tableId, recordId) {
  await api(`${recordsPath(tableId)}/${encodeURIComponent(recordId)}`, { method: 'DELETE', tableId })
}

/** Lark returns Text as string or rich-text segments, Select as string, numbers as number */
export function readText(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => readText(x)).join('').trim()
  if (typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v)
    if ('text' in o) return readText(o.text)
    if ('value' in o) return readText(o.value)
    if ('name' in o) return readText(o.name)
  }
  return ''
}

/** Accepts "1,234.5", "1.4937", and a lone decimal comma "1,4937" */
export function readNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let s = readText(v).replace(/\s/g, '')
  if (!s) return 0
  if (s.includes(',') && !s.includes('.') && /^-?\d+,\d+$/.test(s) && !/^-?\d{1,3},\d{3}$/.test(s)) {
    s = s.replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

/** @param {unknown} v */
export function readJson(v) {
  const s = readText(v)
  if (!s) return {}
  try {
    const o = JSON.parse(s)
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}
