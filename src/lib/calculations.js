import { CABIN_OPTIONS, EMP_GROUND, EV_DEFAULT_ENERGY_RATE, EV_GRID_EF, HOTEL_OPTIONS } from './constants.js'

/**
 * @param {Array<{ km?: number, legs?: number, cabin?: number }>} legs
 */
export function calcFlightLegsCO2(legs) {
  let airCO2 = 0
  for (const l of legs || []) {
    airCO2 += Number(l.km || 0) * Number(l.legs || 1) * Number(l.cabin ?? 0.133)
  }
  return Math.round(airCO2 * 10) / 10
}

/**
 * @param {Array<{ type?: string, km?: number, ef?: number, liters?: number, count?: number, groundEF?: number, energyRate?: number, gridEF?: number }>} segments
 */
export function calcOtherTransportsCO2(segments) {
  let total = 0
  for (const s of segments || []) {
    const n = Math.max(1, Number(s.count) || 1)
    const t = s.type || 'ground'
    if (t === 'fuel') {
      total += Number(s.liters || 0) * 2.31 * n
    } else if (t === 'grab') {
      total += Number(s.km || 0) * 0.192 * n
    } else if (t === 'ev') {
      const km = Number(s.km || 0)
      const rate = Number(s.energyRate ?? EV_DEFAULT_ENERGY_RATE)
      const grid = Number(s.gridEF ?? EV_GRID_EF)
      total += km * rate * grid * n
    } else if (t === 'ground' || t === 'car') {
      const ef = Number(s.ef ?? s.groundEF ?? 0.192)
      if (Number(s.liters || 0) > 0) total += Number(s.liters) * 2.31 * n
      else total += Number(s.km || 0) * ef * n
    } else if (t === 'train') {
      total += Number(s.km || 0) * 0.041 * n
    }
  }
  return Math.round(total * 10) / 10
}

/**
 * @param {Array<{ hotelType?: number, nights?: number, rooms?: number }>} stays
 */
export function calcHotelStaysCO2(stays) {
  let total = 0
  for (const h of stays || []) {
    const ef = Number(h.hotelType ?? HOTEL_OPTIONS[2].value)
    const nights = Number(h.nights || 0)
    const rooms = Math.max(1, Number(h.rooms) || 1)
    total += nights * rooms * ef
  }
  return Math.round(total * 10) / 10
}

/**
 * @param {Array<{ km?: number, legs?: number, cabin?: number }>} legs
 * @param {Array<Record<string, unknown>>} otherTransports
 * @param {Array<{ hotelType?: number, nights?: number, rooms?: number }>} hotelStays
 */
export function calcEmployeeTrip(legs, otherTransports, hotelStays) {
  const airCO2 = calcFlightLegsCO2(legs)
  const groundCO2 = calcOtherTransportsCO2(otherTransports)
  const hotelCO2 = calcHotelStaysCO2(hotelStays)
  const total = Math.round((airCO2 + groundCO2 + hotelCO2) * 10) / 10
  return { airCO2, groundCO2, hotelCO2, total }
}

/** @returns {{ id: string, hotelType: number, nights: number, rooms: number, note: string }} */
export function newHotelStay() {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    hotelType: HOTEL_OPTIONS[2].value,
    nights: 0,
    rooms: 1,
    note: '',
  }
}

/** Gộp dữ liệu cũ (1 khách sạn) thành mảng */
export function migrateTripHotels(trip) {
  if (trip.hotelStays?.length) return trip.hotelStays
  const nights = Number(trip.nights || 0)
  if (nights <= 0 && !trip.hotelLabel) return []
  const label = String(trip.hotelLabel || '')
  const match = HOTEL_OPTIONS.find((h) => label.includes(h.label.split(' (')[0]))
  return [
    {
      id: `hotel-${trip.id}`,
      hotelType: match?.value ?? HOTEL_OPTIONS[2].value,
      nights,
      rooms: Number(trip.rooms) || 1,
      note: label && !label.includes('sao') ? label : '',
    },
  ]
}

/** @param {Record<string, unknown>} trip */
export function formatHotelStaysDetail(trip) {
  const stays = migrateTripHotels(trip)
  if (!stays.length) return ''
  return stays
    .map((h) => {
      const label =
        HOTEL_OPTIONS.find((x) => x.value === Number(h.hotelType))?.label.split(' (')[0] ?? 'KS'
      const place = h.note ? String(h.note).trim() : label
      return `${place}: ${h.nights}n×${h.rooms || 1}r (${label})`
    })
    .join('; ')
}

/** Gộp dữ liệu cũ (1 xe + lít) thành mảng phương tiện */
export function migrateTripTransports(trip) {
  if (trip.otherTransports?.length) return trip.otherTransports
  const out = []
  const fuel = Number(trip.fuel || 0)
  const km = Number(trip.groundKm || 0)
  if (fuel > 0) {
    out.push({
      id: `fuel-${trip.id}`,
      type: 'fuel',
      liters: fuel,
      count: 1,
      note: trip.groundType ? String(trip.groundType) : 'Fuel refill',
    })
  } else if (km > 0) {
    const g = EMP_GROUND.find((x) => String(trip.groundType || '').includes(x.label.split(' (')[0]))
    out.push({
      id: `ground-${trip.id}`,
      type: 'ground',
      km,
      ef: g?.value ?? 0.192,
      count: 1,
      note: trip.groundType || 'Ground vehicle',
    })
  }
  return out
}

/** @param {Record<string, unknown>} trip */
export function formatTripTransportDetail(trip) {
  const segs = migrateTripTransports(trip)
  if (!segs.length) return ''
  return segs
    .map((s) => {
      const n = Math.max(1, Number(s.count) || 1)
      const parts = [s.note || s.type]
      if (s.liters) parts.push(`${s.liters}L`)
      if (s.km) parts.push(`${s.km}km`)
      return `${parts.join(' ')}×${n}`
    })
    .join('; ')
}

export function defaultCabinLabel(ef) {
  const o = CABIN_OPTIONS.find((c) => c.value === ef)
  return o?.label ?? 'Economy'
}

/** @returns {{ id: string, type: string, km: number, ef: number, liters: number, count: number, note: string, energyRate: number, gridEF: number }} */
export function newTransportSegment() {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: 'fuel',
    km: 0,
    ef: 0.192,
    liters: 0,
    count: 1,
    note: '',
    energyRate: EV_DEFAULT_ENERGY_RATE,
    gridEF: EV_GRID_EF,
  }
}

/**
 * @param {number} ef
 * @param {number} km
 * @param {number} days
 * @param {number} months
 * @param {number} wfh
 * @param {number} carpool
 */
export function calcCommute(ef, km, days, months, wfh, carpool) {
  const effectiveDays = Math.max(0, days - wfh)
  const total = (km * 2 * effectiveDays * months * ef) / carpool
  return Math.round(total * 10) / 10
}
