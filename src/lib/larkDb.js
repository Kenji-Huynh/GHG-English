/**
 * Lark Base (Bitable) as the app database — read all records, create / update / delete single records.
 *
 * Dev: proxy `/lark-open-api` (vite.config.js). Production: `/api/lark` (Vercel).
 */

import { LarkApiError, inferLarkStep, throwLarkError } from './larkError.js'

export * from './larkSchema.js'

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

const env = (/** @type {string} */ v) => String(v ?? '').trim()

export function larkConfig() {
  return {
    appId: env(import.meta.env.VITE_LARK_APP_ID),
    appSecret: env(import.meta.env.VITE_LARK_APP_SECRET),
    app: env(import.meta.env.VITE_LARK_BASE_APP_TOKEN),
    tables: {
      office: env(import.meta.env.VITE_LARK_TABLE_OFFICE),
      trips: env(import.meta.env.VITE_LARK_TABLE_TRIPS),
      flights: env(import.meta.env.VITE_LARK_TABLE_FLIGHTS),
      ground: env(import.meta.env.VITE_LARK_TABLE_GROUND),
      hotels: env(import.meta.env.VITE_LARK_TABLE_HOTELS),
      commute: env(import.meta.env.VITE_LARK_TABLE_COMMUTE),
    },
  }
}

export function isLarkConfigured() {
  const c = larkConfig()
  return !!(c.appId && c.appSecret && c.app && Object.values(c.tables).every(Boolean))
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

/** Empty values are omitted on create and cleared (null) on update. Arrays (Link cells) pass through. */
function cleanFields(fields, forUpdate) {
  /** @type {Record<string, string | string[] | null>} */
  const out = {}
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.map(String)
      else if (forUpdate) out[k] = null
      continue
    }
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

const BATCH = 500

/**
 * @param {string} tableId @param {Record<string, unknown>[]} list
 * @returns {Promise<Array<{ record_id: string, fields: Record<string, unknown> }>>}
 */
export async function batchCreateRecords(tableId, list) {
  const out = []
  for (let i = 0; i < list.length; i += BATCH) {
    const data = await api(`${recordsPath(tableId)}/batch_create`, {
      method: 'POST',
      body: { records: list.slice(i, i + BATCH).map((f) => ({ fields: cleanFields(f, false) })) },
      tableId,
    })
    out.push(...(data.records || []))
  }
  return out
}

/**
 * @param {string} tableId @param {Array<{ id: string, fields: Record<string, unknown> }>} list
 * @returns {Promise<Array<{ record_id: string, fields: Record<string, unknown> }>>}
 */
export async function batchUpdateRecords(tableId, list) {
  const out = []
  for (let i = 0; i < list.length; i += BATCH) {
    const data = await api(`${recordsPath(tableId)}/batch_update`, {
      method: 'POST',
      body: {
        records: list.slice(i, i + BATCH).map((r) => ({ record_id: r.id, fields: cleanFields(r.fields, true) })),
      },
      tableId,
    })
    out.push(...(data.records || []))
  }
  return out
}

/** @param {string} tableId @param {string[]} ids */
export async function batchDeleteRecords(tableId, ids) {
  for (let i = 0; i < ids.length; i += BATCH) {
    await api(`${recordsPath(tableId)}/batch_delete`, {
      method: 'POST',
      body: { records: ids.slice(i, i + BATCH) },
      tableId,
    })
  }
}
