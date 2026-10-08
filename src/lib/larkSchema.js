/**
 * Lark Base column names + value readers. Pure module (no Vite env) so Node scripts can import it too.
 */

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

/** Business trip header — flights / ground transport / hotels live in their own tables linked by «Trip» */
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
  proj: 'Project Code',
  note: 'Notes',
  co2Air: 'CO₂ flight (kg)',
  co2Ground: 'CO₂ ground (kg)',
  co2Hotel: 'CO₂ accommodation (kg)',
  co2Total: 'Total (kg CO₂e)',
}

/** Link column in every child table, pointing at the Trips table */
export const COL_TRIP_LINK = 'Trip'

export const FLIGHT_COLS = {
  title: 'Flight',
  trip: COL_TRIP_LINK,
  from: 'From',
  to: 'To',
  cabin: 'Cabin class',
  km: 'Distance (km)',
  legs: 'Number of flights',
  co2: 'CO₂ (kg)',
}

export const GROUND_COLS = {
  title: 'Transport',
  trip: COL_TRIP_LINK,
  type: 'Type',
  note: 'Note',
  count: 'Count',
  km: 'Distance (km)',
  liters: 'Fuel (liters)',
  ef: 'EF (kg CO₂e/km)',
  energyRate: 'Energy rate (kWh/km)',
  gridEF: 'Grid EF (kg CO₂e/kWh)',
  co2: 'CO₂ (kg)',
}

export const HOTEL_COLS = {
  title: 'Stay',
  trip: COL_TRIP_LINK,
  name: 'Name / location',
  type: 'Accommodation type',
  nights: 'Nights',
  rooms: 'Rooms',
  co2: 'CO₂ (kg)',
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

/**
 * Record ids from a Link cell. Lark has returned several shapes over time:
 * ["rec…"], { link_record_ids: [...] }, [{ record_ids: [...] }].
 * @param {unknown} v
 * @returns {string[]}
 */
export function readLinkIds(v) {
  if (!v) return []
  if (typeof v === 'string') return v.startsWith('rec') ? [v] : []
  if (Array.isArray(v)) return v.flatMap((x) => readLinkIds(x))
  if (typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v)
    if (Array.isArray(o.link_record_ids)) return o.link_record_ids.map(String)
    if (Array.isArray(o.record_ids)) return o.record_ids.map(String)
    if (typeof o.record_id === 'string') return [o.record_id]
  }
  return []
}
