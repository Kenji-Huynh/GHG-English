/**
 * Business-trip child rows (flight legs, ground transport, hotel stays) ↔ Lark records.
 * Pure module — shared by the web app and Node scripts.
 */

import {
  calcFlightLegsCO2,
  calcOtherTransportsCO2,
  calcHotelStaysCO2,
  calcEmployeeTrip,
} from './calculations.js'
import {
  CABIN_OPTIONS,
  HOTEL_OPTIONS,
  TRIP_TRANSPORT_TYPES,
  EV_DEFAULT_ENERGY_RATE,
  EV_GRID_EF,
} from './constants.js'
import { FLIGHT_COLS as F, GROUND_COLS as G, HOTEL_COLS as H, readText, readNumber, readLinkIds } from './larkSchema.js'

const shortLabel = (/** @type {string} */ l) => l.split(' (')[0]
const norm = (/** @type {unknown} */ s) => String(s ?? '').trim().toLowerCase()

/** @param {Record<string, any>} l */
export const isFilledLeg = (l) => Number(l.km) > 0 || !!String(l.from || '').trim() || !!String(l.to || '').trim()
/** @param {Record<string, any>} s */
export const isFilledSegment = (s) => Number(s.km) > 0 || Number(s.liters) > 0
/** @param {Record<string, any>} h */
export const isFilledStay = (h) => Number(h.nights) > 0

/* ───────────── Flight legs ───────────── */

/** @param {Record<string, any>} l */
export function legTitle(l) {
  return `${l.from || '?'} → ${l.to || '?'}`
}

/** @param {Record<string, any>} l @param {string} tripId */
export function legToFields(l, tripId) {
  const cabin = CABIN_OPTIONS.find((c) => c.value === Number(l.cabin))?.label ?? l.cabinLabel ?? 'Economy'
  return {
    [F.title]: legTitle(l),
    [F.trip]: [tripId],
    [F.from]: l.from || '',
    [F.to]: l.to || '',
    [F.cabin]: cabin,
    [F.km]: Number(l.km) || '',
    [F.legs]: Number(l.legs) || 1,
    [F.co2]: calcFlightLegsCO2([l]),
  }
}

/** @param {{ record_id: string, fields: Record<string, unknown> }} rec */
export function legFromRecord(rec) {
  const f = rec.fields || {}
  const cabinText = readText(f[F.cabin])
  const cabin = CABIN_OPTIONS.find((c) => norm(c.label) === norm(cabinText)) ?? CABIN_OPTIONS[0]
  const leg = {
    id: rec.record_id,
    from: readText(f[F.from]),
    to: readText(f[F.to]),
    km: readNumber(f[F.km]),
    legs: readNumber(f[F.legs]) || 1,
    cabin: cabin.value,
    cabinLabel: cabin.label,
  }
  return { tripId: readLinkIds(f[F.trip])[0] || '', row: leg, stored: { title: readText(f[F.title]), co2: readText(f[F.co2]) } }
}

/* ───────────── Ground transport ───────────── */

/** @param {string} type */
function transportLabel(type) {
  const t = TRIP_TRANSPORT_TYPES.find((x) => x.value === type)
  return t ? shortLabel(t.label) : 'Other'
}

/** @param {Record<string, any>} s */
export function segmentTitle(s) {
  const n = Math.max(1, Number(s.count) || 1)
  const qty = s.type === 'fuel' ? `${Number(s.liters) || 0} L` : `${Number(s.km) || 0} km`
  return `${transportLabel(s.type)}${s.note ? ` — ${s.note}` : ''}: ${qty} × ${n}`
}

/** @param {Record<string, any>} s @param {string} tripId */
export function segmentToFields(s, tripId) {
  const usesEf = s.type === 'car' || s.type === 'ground'
  const isEv = s.type === 'ev'
  return {
    [G.title]: segmentTitle(s),
    [G.trip]: [tripId],
    [G.type]: transportLabel(s.type),
    [G.note]: s.note || '',
    [G.count]: Math.max(1, Number(s.count) || 1),
    [G.km]: Number(s.km) || '',
    [G.liters]: Number(s.liters) || '',
    [G.ef]: usesEf ? Number(s.ef ?? 0.192) : '',
    [G.energyRate]: isEv ? Number(s.energyRate ?? EV_DEFAULT_ENERGY_RATE) : '',
    [G.gridEF]: isEv ? Number(s.gridEF ?? EV_GRID_EF) : '',
    [G.co2]: calcOtherTransportsCO2([s]),
  }
}

/** @param {{ record_id: string, fields: Record<string, unknown> }} rec */
export function segmentFromRecord(rec) {
  const f = rec.fields || {}
  const typeText = norm(readText(f[G.type]))
  const type =
    TRIP_TRANSPORT_TYPES.find((t) => norm(t.value) === typeText || norm(shortLabel(t.label)) === typeText || norm(t.label) === typeText)
      ?.value ?? 'ground'
  const seg = {
    id: rec.record_id,
    type,
    note: readText(f[G.note]),
    count: readNumber(f[G.count]) || 1,
    km: readNumber(f[G.km]),
    liters: readNumber(f[G.liters]),
    ef: readText(f[G.ef]) ? readNumber(f[G.ef]) : 0.192,
    energyRate: readText(f[G.energyRate]) ? readNumber(f[G.energyRate]) : EV_DEFAULT_ENERGY_RATE,
    gridEF: readText(f[G.gridEF]) ? readNumber(f[G.gridEF]) : EV_GRID_EF,
  }
  return { tripId: readLinkIds(f[G.trip])[0] || '', row: seg, stored: { title: readText(f[G.title]), co2: readText(f[G.co2]) } }
}

/* ───────────── Hotel stays ───────────── */

/** @param {number} value */
function hotelLabel(value) {
  const h = HOTEL_OPTIONS.find((x) => x.value === Number(value))
  return h ? shortLabel(h.label) : `${value} kg/night`
}

/** @param {Record<string, any>} h */
export function stayTitle(h) {
  const nights = Number(h.nights) || 0
  const rooms = Math.max(1, Number(h.rooms) || 1)
  return `${h.note || hotelLabel(h.hotelType)}: ${nights} night${nights === 1 ? '' : 's'} × ${rooms} room${rooms === 1 ? '' : 's'}`
}

/** @param {Record<string, any>} h @param {string} tripId */
export function stayToFields(h, tripId) {
  return {
    [H.title]: stayTitle(h),
    [H.trip]: [tripId],
    [H.name]: h.note || '',
    [H.type]: hotelLabel(h.hotelType),
    [H.nights]: Number(h.nights) || '',
    [H.rooms]: Math.max(1, Number(h.rooms) || 1),
    [H.co2]: calcHotelStaysCO2([h]),
  }
}

/** @param {{ record_id: string, fields: Record<string, unknown> }} rec */
export function stayFromRecord(rec) {
  const f = rec.fields || {}
  const typeText = norm(readText(f[H.type]))
  const opt =
    HOTEL_OPTIONS.find((x) => norm(shortLabel(x.label)) === typeText || norm(x.label) === typeText) ?? HOTEL_OPTIONS[2]
  const stay = {
    id: rec.record_id,
    hotelType: opt.value,
    nights: readNumber(f[H.nights]),
    rooms: readNumber(f[H.rooms]) || 1,
    note: readText(f[H.name]),
  }
  return { tripId: readLinkIds(f[H.trip])[0] || '', row: stay, stored: { title: readText(f[H.title]), co2: readText(f[H.co2]) } }
}

/* ───────────── Trip totals ───────────── */

/** @param {{ flightLegs: any[], otherTransports: any[], hotelStays: any[] }} t */
export function tripTotals(t) {
  const r = calcEmployeeTrip(t.flightLegs, t.otherTransports, t.hotelStays)
  return { co2Air: r.airCO2, co2Ground: r.groundCO2, co2Hotel: r.hotelCO2, co2Total: r.total }
}
