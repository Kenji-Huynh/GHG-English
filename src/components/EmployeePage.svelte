<script>
  import {
    DEPT_OPTIONS,
    PURPOSE_OPTIONS,
    HOTEL_OPTIONS,
    CABIN_OPTIONS,
    TRIP_TRANSPORT_TYPES,
  } from '../lib/constants.js'
  import { COMPANIES, isValidCompany, matchesCompany } from '../lib/companies.js'
  import CompanySelect from './CompanySelect.svelte'
  import CompanyFilterBadge from './CompanyFilterBadge.svelte'
  import RowActionIcons from './RowActionIcons.svelte'
  import ComboInput from './ComboInput.svelte'
  import { suggest } from '../lib/suggestions.js'
  import * as DB from '../lib/db.js'
  import {
    calcEmployeeTrip,
    newTransportSegment,
    newHotelStay,
    migrateTripTransports,
    migrateTripHotels,
  } from '../lib/calculations.js'
  import { empTrips, addEmpTrip, updateEmpTripById, deleteEmpTripById, selectedCompany } from '../lib/ghg.js'
  import { confirmDanger, confirmAction, toastOk, toastErr, showErrorDetail } from '../lib/notify.js'

  function newLeg() {
    return {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      from: '',
      to: '',
      km: 0,
      legs: 1,
      cabin: 0.133,
      cabinLabel: 'Economy',
    }
  }

  let flightLegs = $state([newLeg()])
  let eName = $state('')
  let eEmpid = $state('')
  let eDept = $state('')
  let eTrip = $state('')
  let ePurpose = $state(PURPOSE_OPTIONS[0])
  let eFrom = $state('')
  let eTo = $state('')
  let eDate = $state('')
  let eDateTo = $state('')
  let eProj = $state('')
  let eNote = $state('')
  let eCompany = $state(COMPANIES[0])

  /** Picking a known person fills the rest of their details */
  function fillPerson(/** @type {import('../lib/suggestions.js').Person | null} */ p) {
    if (!p) return
    if (p.name) eName = p.name
    if (p.empId) eEmpid = p.empId
    if (isValidCompany(p.company)) eCompany = p.company
    if (p.dept) eDept = p.dept
  }
  let otherTransports = $state([newTransportSegment()])
  let hotelStays = $state([newHotelStay()])
  let empSearch = $state('')
  let empDeptFilter = $state('')
  /** @type {string | null} */
  let editingTripId = $state(null)
  let saving = $state(false)
  let tripFormCard = $state(/** @type {HTMLDivElement | undefined} */ (undefined))

  /* Unsaved form survives a page refresh / tab switch (cleared on save or "Clear form") */
  const FORM_KEY = 'ghg-form-trip'
  const savedForm = DB.load(FORM_KEY)
  if (savedForm) {
    ;({ eName, eEmpid, eDept, eTrip, ePurpose, eFrom, eTo, eDate, eDateTo, eProj, eNote, eCompany } = savedForm)
    editingTripId = savedForm.editingTripId ?? null
    if (savedForm.flightLegs?.length) flightLegs = savedForm.flightLegs
    if (savedForm.otherTransports?.length) otherTransports = savedForm.otherTransports
    if (savedForm.hotelStays?.length) hotelStays = savedForm.hotelStays
    if (eName || eEmpid || eTrip) toastOk('Restored the trip you were entering')
  }
  $effect(() => {
    DB.save(FORM_KEY, {
      eName, eEmpid, eDept, eTrip, ePurpose, eFrom, eTo, eDate, eDateTo, eProj, eNote, eCompany,
      editingTripId,
      flightLegs: $state.snapshot(flightLegs),
      otherTransports: $state.snapshot(otherTransports),
      hotelStays: $state.snapshot(hotelStays),
    })
  })

  $effect(() => {
    if ($selectedCompany) eCompany = $selectedCompany
  })

  const empDeptOptions = $derived.by(() => {
    const depts = [...new Set($empTrips.map((t) => t.dept).filter(Boolean))].sort()
    return depts
  })

  const filteredTrips = $derived.by(() => {
    const q = empSearch.toLowerCase()
    let list = [...$empTrips]
    if ($selectedCompany) list = list.filter((t) => matchesCompany(t.company, $selectedCompany))
    if (q) {
      list = list.filter((t) =>
        `${t.name}${t.trip}${t.from}${t.to}${t.empId}`.toLowerCase().includes(q),
      )
    }
    if (empDeptFilter) list = list.filter((t) => t.dept === empDeptFilter)
    return list
  })

  const live = $derived.by(() => calcEmployeeTrip(flightLegs, otherTransports, hotelStays))

  function addTransport() {
    otherTransports = [...otherTransports, newTransportSegment()]
  }

  function addHotel() {
    hotelStays = [...hotelStays, newHotelStay()]
  }

  async function removeHotel(id) {
    if (hotelStays.length <= 1) {
      toastErr('At least one accommodation row is required (can be left empty)')
      return
    }
    const ok = await confirmDanger('Delete accommodation row?', '', 'Delete')
    if (!ok) return
    hotelStays = hotelStays.filter((h) => h.id !== id)
  }

  async function removeTransport(id) {
    if (otherTransports.length <= 1) {
      toastErr('At least one transport row is required (can be left empty)')
      return
    }
    const ok = await confirmDanger('Delete transport row?', '', 'Delete')
    if (!ok) return
    otherTransports = otherTransports.filter((t) => t.id !== id)
  }

  function addLeg() {
    flightLegs = [...flightLegs, newLeg()]
  }

  async function removeLeg(id) {
    if (flightLegs.length <= 1) {
      toastErr('At least one flight leg is required (can be left empty)')
      return
    }
    const ok = await confirmDanger('Delete flight leg?', '', 'Delete leg')
    if (!ok) return
    flightLegs = flightLegs.filter((l) => l.id !== id)
  }

  /** @param {Record<string, unknown>} t */
  function loadTripIntoForm(t) {
    editingTripId = String(t.id)
    eName = String(t.name ?? '')
    eEmpid = String(t.empId ?? '')
    eDept = String(t.dept ?? '')
    eCompany = isValidCompany(t.company) ? String(t.company) : COMPANIES[0]
    eTrip = String(t.trip ?? '')
    ePurpose = String(t.purpose ?? PURPOSE_OPTIONS[0])
    eFrom = String(t.from ?? '')
    eTo = String(t.to ?? '')
    eDate = String(t.dateFrom ?? '')
    eDateTo = String(t.dateTo ?? '')
    eProj = String(t.proj ?? '')
    eNote = String(t.note ?? '')

    const legs = t.flightLegs?.length ? JSON.parse(JSON.stringify(t.flightLegs)) : [newLeg()]
    flightLegs = legs.map((/** @type {{id?:string}} */ l, i) => ({
      ...l,
      id: l.id || `leg-edit-${i}-${Date.now()}`,
    }))

    const transports = migrateTripTransports(t)
    otherTransports =
      transports.length > 0
        ? transports.map((/** @type {{id?:string}} */ s, i) => ({
            ...s,
            id: s.id || `pt-edit-${i}-${Date.now()}`,
          }))
        : [newTransportSegment()]

    const hotels = migrateTripHotels(t)
    hotelStays =
      hotels.length > 0
        ? hotels.map((/** @type {{id?:string}} */ h, i) => ({
            ...h,
            id: h.id || `hotel-edit-${i}-${Date.now()}`,
          }))
        : [newHotelStay()]

    tripFormCard?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    toastOk('Trip loaded into form — edit then click Update')
  }

  function cancelEdit() {
    editingTripId = null
    resetForm(false)
  }

  async function saveTrip() {
    const name = eName.trim()
    const empId = eEmpid.trim()
    const dept = eDept
    const trip = eTrip.trim()
    const dateFrom = eDate
    if (!name || !empId || !dept || !trip || !dateFrom) {
      toastErr('Please fill in all required fields (*)')
      return
    }
    if (!isValidCompany(eCompany)) {
      toastErr('Please select a company')
      return
    }
    const isEdit = !!editingTripId
    const ok = await confirmAction(
      isEdit ? 'Update business trip?' : 'Confirm save business trip?',
      `Estimated total: ${live.total} kg CO₂e`,
    )
    if (!ok) return

    const stays = JSON.parse(JSON.stringify(hotelStays))
    const firstHotel = HOTEL_OPTIONS.find(
      (h) => h.value === Number(stays[0]?.hotelType) || h.value == stays[0]?.hotelType,
    )

    const payload = {
      name,
      empId,
      dept,
      company: eCompany,
      trip,
      from: eFrom,
      to: eTo,
      dateFrom,
      dateTo: eDateTo,
      purpose: ePurpose,
      proj: eProj,
      note: eNote,
      flightLegs: JSON.parse(JSON.stringify(flightLegs)),
      otherTransports: JSON.parse(JSON.stringify(otherTransports)),
      hotelStays: stays,
      hotelLabel: firstHotel?.label.split(' (')[0] ?? '',
      nights: stays.reduce((s, /** @type {{nights?:number}} */ h) => s + Number(h.nights || 0), 0),
      rooms: stays[0]?.rooms ?? 1,
      co2Air: live.airCO2,
      co2Ground: live.groundCO2,
      co2Hotel: live.hotelCO2,
      co2Total: live.total,
    }

    saving = true
    try {
      if (isEdit) {
        const updated = await updateEmpTripById(editingTripId, payload)
        if (!updated) {
          toastErr('Trip conflicts with existing data — change employee ID / trip name / date / route.')
          return
        }
        toastOk(`Updated "${trip}" — ${live.total} kg CO₂e`)
      } else {
        const added = await addEmpTrip(payload)
        if (!added) {
          toastErr('Trip already exists, not added.')
          return
        }
        toastOk(`Saved "${trip}" — ${live.total} kg CO₂e`)
      }
      editingTripId = null
      await resetForm(false)
    } catch (e) {
      await showErrorDetail(e, 'Saving to Lark Base failed')
    } finally {
      saving = false
    }
  }

  /** @param {boolean} [ask] */
  async function resetForm(ask = true) {
    if (ask) {
      const ok = await confirmAction('Clear form?', 'All currently entered information will be cleared.')
      if (!ok) return
    }
    eName = ''
    eEmpid = ''
    eDept = ''
    eTrip = ''
    ePurpose = PURPOSE_OPTIONS[0]
    eFrom = ''
    eTo = ''
    eDate = ''
    eDateTo = ''
    eProj = ''
    eNote = ''
    eCompany = COMPANIES[0]
    otherTransports = [newTransportSegment()]
    hotelStays = [newHotelStay()]
    flightLegs = [newLeg()]
    editingTripId = null
    if (ask) toastOk('Form cleared')
  }

  async function deleteTrip(id) {
    const ok = await confirmDanger('Delete business trip?', 'Data will be removed from the current reporting period.', 'Delete')
    if (!ok) return
    try {
      await deleteEmpTripById(id)
      if (editingTripId === id) editingTripId = null
      toastOk('Business trip deleted')
    } catch (e) {
      await showErrorDetail(e, 'Deleting from Lark Base failed')
    }
  }
</script>

<div class="page-title">Business Travel Emissions — Employees</div>
<div class="page-sub">
  Scope 3.6 · Business travel · Record each employee's business trip individually
</div>

<div class="card" class:trip-form-editing={!!editingTripId} bind:this={tripFormCard}>
  <div class="card-head">
    <div class="card-head-left">
      <div class="card-title">{editingTripId ? 'Edit business trip' : 'Add new business trip'}</div>
      <span class="card-scope scope-s3">SCOPE 3</span>
      {#if editingTripId}
        <span class="eq-draft-pill">Editing</span>
      {/if}
    </div>
  </div>
  <div class="card-body">
    <div class="sec-divider">Employee information</div>
    <div class="g3">
      <div class="field">
        <label>Full name <span class="required">*</span></label>
        <ComboInput
          placeholder="John Smith"
          bind:value={eName}
          options={$suggest.names}
          onpick={(v) => fillPerson($suggest.personByName(v))}
        />
      </div>
      <div class="field">
        <label>Employee ID <span class="required">*</span></label>
        <ComboInput
          placeholder="EMP-00123"
          bind:value={eEmpid}
          options={$suggest.empIds}
          onpick={(v) => fillPerson($suggest.personByEmpId(v))}
        />
      </div>
      <div class="field">
        <label>Company <span class="required">*</span></label>
        <CompanySelect bind:value={eCompany} hideLabel={true} required={true} id="trip-company" />
      </div>
      <div class="field">
        <label>Department <span class="required">*</span></label>
        <select bind:value={eDept}>
          <option value="">-- Select --</option>
          {#each DEPT_OPTIONS as d}
            <option value={d}>{d}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="sec-divider">Trip information</div>
    <div class="g3">
      <div class="field span2">
        <label>Trip name <span class="required">*</span></label>
        <ComboInput placeholder="Q2/2026 Client Conference" bind:value={eTrip} options={$suggest.tripNames} />
      </div>
      <div class="field">
        <label>Purpose</label>
        <select bind:value={ePurpose}>
          {#each PURPOSE_OPTIONS as p}
            <option value={p}>{p}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label>Departure</label>
        <ComboInput placeholder="Ho Chi Minh City" bind:value={eFrom} options={$suggest.cities} />
      </div>
      <div class="field">
        <label>Destination</label>
        <ComboInput placeholder="Hanoi" bind:value={eTo} options={$suggest.cities} />
      </div>
      <div class="field">
        <label>Departure date</label>
        <input type="date" bind:value={eDate} />
      </div>
      <div class="field">
        <label>Return date</label>
        <input type="date" bind:value={eDateTo} />
      </div>
      <div class="field">
        <label>Project code</label>
        <ComboInput placeholder="PRJ-2026-04" bind:value={eProj} options={$suggest.projects} />
      </div>
    </div>

    <div class="sec-divider">Flights — including connecting legs</div>
    <p class="flight-legs-intro">
      Each block is one flight leg (e.g. SGN → HAN). For connecting flights, click <strong>+ Add flight leg</strong>. Emissions are estimated using: distance × number of flights × cabin class factor.
    </p>
    <div class="flight-legs-list">
      {#each flightLegs as leg, idx (leg.id)}
        <div class="flight-leg-card">
          <div class="flight-leg-card-toolbar">
            <span class="flight-leg-badge">Leg {idx + 1}</span>
            <button
              type="button"
              class="btn btn-danger btn-sm flight-leg-remove"
              aria-label="Delete this flight leg"
              onclick={() => removeLeg(leg.id)}
            >
              Delete leg
            </button>
          </div>
          <div class="g3 flight-leg-card-grid">
            <div class="field">
              <label>Origin</label>
              <ComboInput placeholder="e.g. SGN, Tan Son Nhat" bind:value={leg.from} options={$suggest.airports} />
            </div>
            <div class="field">
              <label>Destination</label>
              <ComboInput placeholder="e.g. HAN, Noi Bai" bind:value={leg.to} options={$suggest.airports} />
            </div>
            <div class="field">
              <label>Cabin class</label>
              <select bind:value={leg.cabin}>
                {#each CABIN_OPTIONS as c}
                  <option value={c.value}>{c.label}</option>
                {/each}
              </select>
            </div>
            <div class="g2 flight-leg-dist-row">
              <div class="field field-unit">
                <label>Estimated distance</label>
                <input type="number" placeholder="0" min="0" step="any" bind:value={leg.km} />
                <span class="unit">km</span>
              </div>
              <div class="field field-unit">
                <label>Number of flights</label>
                <input type="number" placeholder="1" min="1" step="1" bind:value={leg.legs} />
                <span class="unit">flights</span>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
    <button type="button" class="btn btn-add flight-legs-add" onclick={addLeg}>+ Add flight leg</button>

    <div class="sec-divider">Other transport (car, fuel, ride-hail, train…)</div>
    <p class="flight-legs-intro">
      A trip can have multiple types: e.g. 7 fuel refills, 1 ride-hail, 2 flights (in the section above). Each row = one type / one group of receipts.
    </p>
    <div class="flight-legs-list">
      {#each otherTransports as seg, idx (seg.id)}
        <div class="flight-leg-card">
          <div class="flight-leg-card-toolbar">
            <span class="flight-leg-badge">Transport {idx + 1}</span>
            <button type="button" class="btn btn-danger btn-sm" onclick={() => removeTransport(seg.id)}>Delete</button>
          </div>
          <div class="g3 flight-leg-card-grid">
            <div class="field">
              <label>Type</label>
              <select bind:value={seg.type}>
                {#each TRIP_TRANSPORT_TYPES as tt}
                  <option value={tt.value}>{tt.label}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label>Note (e.g. Fuel receipt #3)</label>
              <ComboInput placeholder="Short description" bind:value={seg.note} options={$suggest.transportNotes} />
            </div>
            <div class="field field-unit">
              <label>Count / number of receipts</label>
              <input type="number" min="1" bind:value={seg.count} />
            </div>
            {#if seg.type === 'fuel'}
              <div class="field field-unit">
                <label>Total fuel (per occurrence)</label>
                <input type="number" min="0" step="any" bind:value={seg.liters} />
                <span class="unit">liters</span>
              </div>
            {:else if seg.type === 'ev'}
              <div class="field field-unit">
                <label>Distance (per occurrence)</label>
                <input type="number" min="0" step="any" bind:value={seg.km} />
                <span class="unit">km</span>
              </div>
              <div class="field field-unit">
                <label>Energy consumption rate</label>
                <input type="number" min="0" step="any" bind:value={seg.energyRate} />
                <span class="unit">kWh/km</span>
              </div>
              <div class="field field-unit">
                <label>Grid emission factor</label>
                <input type="number" min="0" step="any" bind:value={seg.gridEF} />
                <span class="unit">kg CO₂e/kWh</span>
              </div>
              <p class="flight-legs-intro" style="grid-column: 1 / -1; margin: 0">
                Emissions = distance × energy rate × grid EF × count
              </p>
            {:else}
              <div class="field field-unit">
                <label>Distance (per occurrence)</label>
                <input type="number" min="0" step="any" bind:value={seg.km} />
                <span class="unit">km</span>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <button type="button" class="btn btn-add flight-legs-add" onclick={addTransport}>+ Add transport / receipt</button>

    <div class="sec-divider">Accommodation — multiple hotels / stays</div>
    <p class="flight-legs-intro">
      Each row = one place to stay (different hotels, homestays, guesthouses…). Example: 3 nights Hotel A + 2 nights Hotel B.
    </p>
    <div class="flight-legs-list">
      {#each hotelStays as stay, idx (stay.id)}
        <div class="flight-leg-card">
          <div class="flight-leg-card-toolbar">
            <span class="flight-leg-badge">Stay {idx + 1}</span>
            <button type="button" class="btn btn-danger btn-sm" onclick={() => removeHotel(stay.id)}>Delete</button>
          </div>
          <div class="g3 flight-leg-card-grid">
            <div class="field span2">
              <label>Name / location (optional)</label>
              <ComboInput
                placeholder="e.g. Muong Thanh Da Nang, Hoi An homestay"
                bind:value={stay.note}
                options={$suggest.stays}
              />
            </div>
            <div class="field">
              <label>Accommodation type</label>
              <select bind:value={stay.hotelType}>
                {#each HOTEL_OPTIONS as h}
                  <option value={h.value}>{h.label}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label>Number of nights</label>
              <input type="number" placeholder="0" min="0" bind:value={stay.nights} />
            </div>
            <div class="field">
              <label>Number of rooms</label>
              <input type="number" min="1" bind:value={stay.rooms} />
            </div>
          </div>
        </div>
      {/each}
    </div>
    <button type="button" class="btn btn-add flight-legs-add" onclick={addHotel}>+ Add accommodation / hotel</button>

    <div class="field">
      <label>Notes</label>
      <textarea placeholder="Motorcycle taxi, airport shuttle, etc." bind:value={eNote}></textarea>
    </div>

    <div class="live-box">
      <span style="font-size:12px;color:var(--text2)">Estimated CO₂:</span>
      <span class="live-mono">{live.total > 0 ? live.total : '—'}</span>
      <span style="font-size:12px;color:var(--text2)">kg CO₂e</span>
      <span style="font-size:11px;color:var(--text3);margin-left:auto;font-family:var(--mono)">
        {live.total > 0
          ? `Flight: ${live.airCO2} · Ground: ${live.groundCO2} · Hotel: ${live.hotelCO2} kg`
          : ''}
      </span>
    </div>

    <div class="actions-bar">
      <button type="button" class="btn btn-primary" disabled={saving} onclick={saveTrip}>
        {saving ? 'Saving…' : editingTripId ? 'Update trip' : 'Save business trip'}
      </button>
      {#if editingTripId}
        <button type="button" class="btn" onclick={cancelEdit}>Cancel edit</button>
      {:else}
        <button type="button" class="btn" onclick={() => resetForm(true)}>Clear form</button>
      {/if}
    </div>
  </div>
</div>

<div class="card">
  <div class="card-head">
    <div class="card-head-left">
      <div class="card-title">Business trip history</div>
      <CompanyFilterBadge />
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input
        type="text"
        placeholder="Search name, trip..."
        style="padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius);width:min(220px,100%)"
        bind:value={empSearch}
      />
      <select
        style="padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius)"
        bind:value={empDeptFilter}
      >
        <option value="">All departments</option>
        {#each empDeptOptions as d}
          <option value={d}>{d}</option>
        {/each}
      </select>
    </div>
  </div>
  <div class="card-body">
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Full name</th>
            <th>Emp. ID</th>
            <th>Company</th>
            <th>Department</th>
            <th>Trip</th>
            <th>Route</th>
            <th>Date</th>
            <th class="num">Flight (kg)</th>
            <th class="num">Ground (kg)</th>
            <th class="num">Hotel (kg)</th>
            <th class="num">Total (kg)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#if filteredTrips.length === 0}
            <tr>
              <td colspan="12" style="text-align:center;color:var(--text3);padding:2rem">
                {#if $selectedCompany && $empTrips.length > 0}
                  No trips for {$selectedCompany} in this period (try selecting "All companies" in the top bar)
                {:else}
                  No data yet
                {/if}
              </td>
            </tr>
          {:else}
            {#each filteredTrips as t}
              {@const legSummary =
                t.flightLegs && t.flightLegs.length
                  ? t.flightLegs.map((/** @type {{from?:string,to?:string}} */ l) => `${l.from}→${l.to}`).join(' / ')
                  : '—'}
              {@const ptSummary =
                t.otherTransports?.length
                  ? t.otherTransports
                      .map(
                        (/** @type {{type?:string,count?:number,note?:string}} */ s) =>
                          `${s.note || s.type}${s.count > 1 ? `×${s.count}` : ''}`,
                      )
                      .join(' · ')
                  : t.fuel || t.groundKm
                    ? 'Car/fuel (legacy)'
                    : ''}
              {@const hotelSummary =
                t.hotelStays?.length
                  ? t.hotelStays
                      .map(
                        (/** @type {{note?:string,nights?:number,rooms?:number}} */ h) =>
                          `${h.note || 'Hotel'} ${h.nights}n×${h.rooms || 1}r`,
                      )
                      .join(' · ')
                  : t.nights
                    ? `${t.hotelLabel || 'Hotel'} ${t.nights}n`
                    : '—'}
              <tr class:trip-row-editing={t.id === editingTripId}>
                <td><strong>{t.name}</strong></td>
                <td class="num" style="font-family:var(--mono);font-size:12px">{t.empId}</td>
                <td>{t.company || '—'}</td>
                <td>{t.dept}</td>
                <td>
                  {t.trip}<br />
                  <span style="font-size:11px;color:var(--text3)">{t.purpose || ''}</span>
                </td>
                <td style="font-size:11px">{t.from || '—'} → {t.to || '—'}</td>
                <td style="font-size:11px">{t.dateFrom || '—'}</td>
                <td class="num" style="font-size:11px">
                  {t.co2Air || 0}
                  {#if legSummary !== '—'}
                    <br /><span style="color:var(--text3);font-weight:400;font-family:var(--mono)">{legSummary}</span>
                  {/if}
                </td>
                <td class="num" style="font-size:11px">
                  {t.co2Ground || 0}
                  {#if ptSummary}
                    <br /><span style="color:var(--text3);font-weight:400">{ptSummary}</span>
                  {/if}
                </td>
                <td class="num" style="font-size:11px">
                  {t.co2Hotel || 0}
                  {#if hotelSummary !== '—'}
                    <br /><span style="color:var(--text3);font-weight:400">{hotelSummary}</span>
                  {/if}
                </td>
                <td class="num">
                  <span
                    class="badge {t.co2Total > 500 ? 'badge-r' : t.co2Total > 100 ? 'badge-a' : 'badge-g'}"
                    >{t.co2Total} kg</span
                  >
                </td>
                <td>
                  <RowActionIcons
                    onEdit={() => loadTripIntoForm(t)}
                    onDelete={() => deleteTrip(t.id)}
                    editTitle="Edit trip — load into form above"
                    deleteTitle="Delete business trip"
                  />
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
