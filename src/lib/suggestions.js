/**
 * Suggestion lists for free-text inputs, built from everything already saved in Lark (all periods).
 * Whatever someone typed once becomes a pickable option for everyone next time.
 */
import { derived } from 'svelte/store'
import { allEquip, allTrips, allCommute } from './ghg.js'

/** Case- and accent-insensitive key ("Hồ Chí Minh" → "ho chi minh") */
export function normKey(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Collects values, keeps the first spelling seen, sorts by how often each value was used */
function counter() {
  /** @type {Map<string, { value: string, n: number }>} */
  const m = new Map()
  return {
    add(/** @type {unknown} */ v) {
      const s = String(v ?? '').trim()
      if (!s) return
      const k = normKey(s)
      const cur = m.get(k)
      if (cur) cur.n++
      else m.set(k, { value: s, n: 1 })
    },
    list() {
      return [...m.values()].sort((a, b) => b.n - a.n || a.value.localeCompare(b.value)).map((x) => x.value)
    },
  }
}

/**
 * @typedef {{ name: string, empId: string, company: string, dept: string }} Person
 * @typedef {{ source: string, unit: string, ef: number, efRef: string }} EquipProfile
 */

export const suggest = derived([allEquip, allTrips, allCommute], ([$equip, $trips, $commute]) => {
  const names = counter()
  const empIds = counter()
  const tripNames = counter()
  const cities = counter()
  const airports = counter()
  const projects = counter()
  const transportNotes = counter()
  const stays = counter()
  const equipment = counter()
  const efRefs = counter()
  const locations = counter()

  /** @type {Map<string, Person>} */ const byName = new Map()
  /** @type {Map<string, Person>} */ const byEmpId = new Map()
  /** @type {Map<string, EquipProfile>} */ const byEquipment = new Map()

  /** @param {any} r */
  const addPerson = (r) => {
    names.add(r.name)
    empIds.add(r.empId)
    const p = { name: r.name || '', empId: r.empId || '', company: r.company || '', dept: r.dept || '' }
    if (p.name && !byName.has(normKey(p.name))) byName.set(normKey(p.name), p)
    if (p.empId && !byEmpId.has(normKey(p.empId))) byEmpId.set(normKey(p.empId), p)
  }

  const newestFirst = (/** @type {any[]} */ a) => [...a].sort((x, y) => (y.pk || '').localeCompare(x.pk || ''))

  for (const t of newestFirst($trips)) {
    addPerson(t)
    tripNames.add(t.trip)
    cities.add(t.from)
    cities.add(t.to)
    projects.add(t.proj)
    for (const l of t.flightLegs || []) {
      airports.add(l.from)
      airports.add(l.to)
    }
    for (const s of t.otherTransports || []) transportNotes.add(s.note)
    for (const s of t.hotelStays || []) stays.add(s.note)
  }
  for (const c of newestFirst($commute)) addPerson(c)
  for (const e of newestFirst($equip)) {
    equipment.add(e.equipment)
    efRefs.add(e.efRef)
    locations.add(e.location)
    const k = normKey(e.equipment)
    if (e.equipment && e.source && !byEquipment.has(k)) {
      byEquipment.set(k, { source: e.source, unit: e.unit, ef: e.ef, efRef: e.efRef })
    }
  }

  return {
    names: names.list(),
    empIds: empIds.list(),
    tripNames: tripNames.list(),
    cities: cities.list(),
    airports: airports.list(),
    projects: projects.list(),
    transportNotes: transportNotes.list(),
    stays: stays.list(),
    equipment: equipment.list(),
    efRefs: efRefs.list(),
    locations: locations.list(),
    /** @param {string} name */
    personByName: (name) => byName.get(normKey(name)) ?? null,
    /** @param {string} id */
    personByEmpId: (id) => byEmpId.get(normKey(id)) ?? null,
    /** @param {string} name */
    equipmentProfile: (name) => byEquipment.get(normKey(name)) ?? null,
  }
})
