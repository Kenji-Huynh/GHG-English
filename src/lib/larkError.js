/**
 * Lỗi Lark có chi tiết — hiển thị trong modal / console (F12).
 */

/** @typedef {{
 *   step?: string
 *   url?: string
 *   method?: string
 *   httpStatus?: number
 *   larkCode?: number | string
 *   larkMsg?: string
 *   tableId?: string
 *   apiPrefix?: string
 *   responseSnippet?: string
 *   original?: string
 *   at?: string
 *   sentFields?: string[]
 *   missingOnBase?: string[]
 *   fieldsOnBase?: string[]
 * }} LarkErrorDetails */

/** @type {LarkErrorDetails | null} */
let lastLarkErrorDetails = null

export function getLastLarkErrorDetails() {
  return lastLarkErrorDetails
}

export class LarkApiError extends Error {
  /** @param {string} message @param {LarkErrorDetails} [details] */
  constructor(message, details = {}) {
    super(message)
    this.name = 'LarkApiError'
    /** @type {LarkErrorDetails} */
    this.details = { at: new Date().toISOString(), ...details }
    lastLarkErrorDetails = this.details
    console.error('[Lark sync]', message, this.details)
  }
}

/** @param {string} path @param {string} [method] */
export function inferLarkStep(path, method = 'GET') {
  if (path.includes('tenant_access_token')) return 'Get token (App ID / Secret)'
  if (path.includes('/records')) {
    if (path.includes('/batch_update')) return 'Update records'
    if (path.includes('/batch_delete')) return 'Delete records'
    if (method === 'POST') return 'Create record'
    if (method === 'PUT') return 'Update record'
    if (method === 'DELETE') return 'Delete record'
    return 'Read records'
  }
  return 'Call Lark Open API'
}

/** @param {unknown} text @param {number} [max] */
function snippet(text, max = 480) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

/** @param {string} message @param {LarkErrorDetails} details */
export function throwLarkError(message, details) {
  throw new LarkApiError(message, details)
}

/** @param {unknown} err @param {string} url @param {LarkErrorDetails} extra */
export function throwLarkNetworkError(err, url, extra = {}) {
  const original = err instanceof Error ? err.message : String(err)
  const msg = /failed to fetch/i.test(original)
    ? 'Cannot connect to Lark proxy server (Failed to fetch)'
    : original
  throw new LarkApiError(msg, { ...extra, url, original, step: extra.step || 'Network connection' })
}

/** @param {LarkApiError | Error} err */
export function isLarkApiError(err) {
  return err instanceof LarkApiError
}

/** @param {unknown} err */
export function formatLarkErrorReport(err) {
  const e = err instanceof Error ? err : new Error(String(err))
  const d = isLarkApiError(err) ? err.details : lastLarkErrorDetails
  const lines = [`■ ${e.message}`]
  if (d) {
    if (d.step) lines.push(`Step: ${d.step}`)
    if (d.apiPrefix) lines.push(`API prefix: ${d.apiPrefix}`)
    if (d.method && d.url) lines.push(`${d.method} ${d.url}`)
    else if (d.url) lines.push(`URL: ${d.url}`)
    if (d.httpStatus != null) lines.push(`HTTP: ${d.httpStatus}`)
    if (d.larkCode != null) lines.push(`Lark code: ${d.larkCode}`)
    if (d.larkMsg) lines.push(`Lark msg: ${d.larkMsg}`)
    if (d.tableId) lines.push(`Table ID: ${d.tableId}`)
    if (d.missingOnBase?.length) {
      lines.push(`App sent columns but Base is MISSING / wrong name (${d.missingOnBase.length}):`)
      for (const name of d.missingOnBase) lines.push(`  • ${name}`)
    }
    if (d.sentFields?.length) lines.push(`App is sending: ${d.sentFields.join(' | ')}`)
    if (d.fieldsOnBase?.length) lines.push(`Base has: ${d.fieldsOnBase.join(' | ')}`)
    if (d.original && d.original !== e.message) lines.push(`Original error: ${d.original}`)
    if (d.responseSnippet) lines.push(`Response: ${d.responseSnippet}`)
    if (d.at) lines.push(`Time: ${d.at}`)
  }
  lines.push('', 'Open F12 → Console to see the full object.')
  return lines.join('\n')
}

/** @param {string} s */
function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** @param {unknown} err */
export function larkErrorHtml(err) {
  const report = formatLarkErrorReport(err)
  return `<pre class="lark-error-pre">${esc(report)}</pre>`
}
