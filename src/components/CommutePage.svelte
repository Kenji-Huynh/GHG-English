<script>
  import { DEPT_OPTIONS, COMMUTE_VEHICLES } from '../lib/constants.js'
  import { COMPANIES, isValidCompany, matchesCompany } from '../lib/companies.js'
  import CompanySelect from './CompanySelect.svelte'
  import CompanyFilterBadge from './CompanyFilterBadge.svelte'
  import RowActionIcons from './RowActionIcons.svelte'
  import { calcCommute } from '../lib/calculations.js'
  import { commuteList, upsertCommute, deleteCommuteById, selectedCompany } from '../lib/ghg.js'
  import { confirmDanger, confirmAction, toastOk, toastErr, showErrorDetail } from '../lib/notify.js'

  let cName = $state('')
  let cEmpid = $state('')
  let cDept = $state('')
  let cCompany = $state(COMPANIES[0])
  let cVehicle = $state(COMMUTE_VEHICLES[0].value)
  let cKm = $state(0)
  let cDays = $state(22)
  let cMonths = $state(1)
  let cCarpool = $state(1)
  let cWfh = $state(0)
  let cDeptFilter = $state('')
  /** @type {string | null} */
  let editingCommuteId = $state(null)
  let saving = $state(false)
  let commuteFormCard = $state(/** @type {HTMLDivElement | undefined} */ (undefined))

  /** @param {{ vehicle?: string, ef?: number }} c */
  function vehicleEfFromRecord(c) {
    if (c.ef != null && COMMUTE_VEHICLES.some((v) => v.value === Number(c.ef))) return Number(c.ef)
    const v = String(c.vehicle || '')
    const hit = COMMUTE_VEHICLES.find(
      (x) => v === x.label || x.label.startsWith(v) || v.startsWith(x.label.split(' (')[0]),
    )
    return hit?.value ?? COMMUTE_VEHICLES[0].value
  }

  /** @param {Record<string, unknown>} c */
  function loadCommuteIntoForm(c) {
    editingCommuteId = String(c.id)
    cName = String(c.name ?? '')
    cEmpid = String(c.empId ?? '')
    cDept = String(c.dept ?? '')
    cCompany = isValidCompany(c.company) ? String(c.company) : COMPANIES[0]
    cVehicle = vehicleEfFromRecord(/** @type {{ vehicle?: string, ef?: number }} */ (c))
    cKm = Number(c.km) || 0
    cDays = Number(c.days) ?? 22
    cMonths = Number(c.months) || 1
    cWfh = Number(c.wfh) || 0
    cCarpool = Number(c.carpool) || 1
    commuteFormCard?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    toastOk('Loaded into form — edit then click Update')
  }

  function cancelEditCommute() {
    editingCommuteId = null
    resetForm(false)
  }

  $effect(() => {
    if ($selectedCompany) cCompany = $selectedCompany
  })

  const commuteDeptOptions = $derived.by(() => {
    return [...new Set($commuteList.map((c) => c.dept).filter(Boolean))].sort()
  })

  const filteredCommute = $derived.by(() => {
    let list = [...$commuteList]
    if ($selectedCompany) list = list.filter((c) => matchesCompany(c.company, $selectedCompany))
    if (cDeptFilter) list = list.filter((c) => c.dept === cDeptFilter)
    return list
  })

  const stats = $derived.by(() => {
    const list = filteredCommute
    const total = list.reduce((s, c) => s + (c.co2 || 0), 0)
    const avg = list.length ? total / list.length : 0
    return { total, avg: Math.round(avg), n: list.length }
  })

  const vehicleChart = $derived.by(() => {
    const vMap = {}
    for (const c of filteredCommute) {
      vMap[c.vehicle] = (vMap[c.vehicle] || 0) + (c.co2 || 0)
    }
    const vArr = Object.entries(vMap).sort((a, b) => b[1] - a[1])
    const maxV = Math.max(...vArr.map((v) => v[1]), 1)
    const colors = ['#1A6B3C', '#B85C00', '#1B4F8A', '#C0392B', '#555', '#888', '#aaa']
    return { vArr, maxV, colors }
  })

  const live = $derived.by(() => {
    const ef = Number(cVehicle) || 0
    const km = Number(cKm) || 0
    const days = Number(cDays) || 22
    const months = Number(cMonths) || 1
    const wfh = Number(cWfh) || 0
    const carpool = Number(cCarpool) || 1
    const co2 = calcCommute(ef, km, days, months, wfh, carpool)
    const effectiveDays = Math.max(0, days - wfh)
    const detail =
      co2 > 0
        ? `${km}km×2 × ${effectiveDays}days × ${months}mo × EF${ef} ÷ ${carpool}person = ${Math.round(co2)} kg`
        : ''
    return { co2, detail }
  })

  async function saveCommute() {
    const name = cName.trim()
    const empId = cEmpid.trim()
    if (!name || !empId) {
      toastErr('Please enter full name and employee ID')
      return
    }
    if (!isValidCompany(cCompany)) {
      toastErr('Please select a company')
      return
    }
    const isEdit = !!editingCommuteId
    const ok = await confirmAction(
      isEdit ? 'Update commute information?' : 'Confirm save commute information?',
      `Estimated: ${live.co2} kg CO₂e (full period)`,
    )
    if (!ok) return

    const ef = Number(cVehicle) || 0
    const km = Number(cKm) || 0
    const days = Number(cDays) || 22
    const months = Number(cMonths) || 1
    const wfh = Number(cWfh) || 0
    const carpool = Number(cCarpool) || 1
    const co2 = live.co2
    const vehicleLabel =
      COMMUTE_VEHICLES.find((v) => v.value === ef || v.value == cVehicle)?.label.split(' (')[0] ?? ''

    saving = true
    try {
      const { updated } = await upsertCommute(
        {
          name,
          empId,
          dept: cDept,
          company: cCompany,
          vehicle: vehicleLabel,
          ef,
          km,
          days,
          months,
          wfh,
          carpool,
          co2,
        },
        editingCommuteId,
      )
      toastOk(
        updated
          ? `Updated commute info for ${name}`
          : `Saved commute info for ${name} — ${co2} kg CO₂e`,
      )
      editingCommuteId = null
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
      const ok = await confirmAction('Clear form?', '')
      if (!ok) return
    }
    cName = ''
    cEmpid = ''
    cDept = ''
    cCompany = COMPANIES[0]
    cVehicle = COMMUTE_VEHICLES[0].value
    cKm = 0
    cDays = 22
    cMonths = 1
    cCarpool = 1
    cWfh = 0
    editingCommuteId = null
    if (ask) toastOk('Form cleared')
  }

  async function deleteRow(id) {
    const ok = await confirmDanger('Remove employee from commute table?', '', 'Delete')
    if (!ok) return
    try {
      await deleteCommuteById(id)
      if (editingCommuteId === id) editingCommuteId = null
      toastOk('Deleted')
    } catch (e) {
      await showErrorDetail(e, 'Deleting from Lark Base failed')
    }
  }
</script>

<div class="page-title">Daily Commute Carbon (Commute)</div>
<div class="page-sub">
  Scope 3.7 · Employee commuting · Emissions from each employee's commute distance
</div>

<div class="card" class:trip-form-editing={!!editingCommuteId} bind:this={commuteFormCard}>
  <div class="card-head">
    <div class="card-head-left">
      <div class="card-title">{editingCommuteId ? 'Edit commute' : 'Add / update commute information'}</div>
      <span class="card-scope scope-s3">SCOPE 3.7</span>
      {#if editingCommuteId}
        <span class="eq-draft-pill">Editing</span>
      {/if}
    </div>
  </div>
  <div class="card-body">
    <div class="g3">
      <div class="field">
        <label>Full name <span class="required">*</span></label>
        <input type="text" placeholder="John Smith" bind:value={cName} />
      </div>
      <div class="field">
        <label>Employee ID <span class="required">*</span></label>
        <input type="text" placeholder="EMP-00123" bind:value={cEmpid} />
      </div>
      <div class="field">
        <label>Company <span class="required">*</span></label>
        <CompanySelect bind:value={cCompany} hideLabel={true} required={true} id="commute-company" />
      </div>
      <div class="field">
        <label>Department</label>
        <select bind:value={cDept}>
          <option value="">-- Select --</option>
          {#each DEPT_OPTIONS as d}
            <option value={d}>{d}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label>Primary transport</label>
        <select bind:value={cVehicle}>
          {#each COMMUTE_VEHICLES as v}
            <option value={v.value}>{v.label}</option>
          {/each}
        </select>
      </div>
      <div class="field field-unit">
        <label>One-way distance</label>
        <input type="number" placeholder="15" min="0" step="0.1" bind:value={cKm} />
        <span class="unit">km</span>
      </div>
      <div class="field">
        <label>Working days / month</label>
        <input type="number" placeholder="22" min="0" max="31" bind:value={cDays} />
      </div>
      <div class="field">
        <label>Months in reporting period</label>
        <input type="number" min="1" bind:value={cMonths} />
      </div>
      <div class="field">
        <label>Carpooling?</label>
        <select bind:value={cCarpool}>
          <option value={1}>No (travelling alone)</option>
          <option value={2}>Yes — 2 people</option>
          <option value={3}>Yes — 3 people</option>
          <option value={4}>Yes — 4 people</option>
        </select>
      </div>
      <div class="field">
        <label>Work from home (WFH) days / month</label>
        <input type="number" placeholder="0" min="0" bind:value={cWfh} />
      </div>
    </div>

    <div class="live-box">
      <span style="font-size:12px;color:var(--text2)">Estimated CO₂ (full period):</span>
      <span class="live-mono">{live.co2 > 0 ? live.co2 : '—'}</span>
      <span style="font-size:12px;color:var(--text2)">kg CO₂e</span>
      <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">{live.detail}</span>
    </div>

    <div class="actions-bar">
      <button type="button" class="btn btn-primary" disabled={saving} onclick={saveCommute}>
        {saving ? 'Saving…' : editingCommuteId ? 'Update' : 'Save commute information'}
      </button>
      {#if editingCommuteId}
        <button type="button" class="btn" onclick={cancelEditCommute}>Cancel edit</button>
      {:else}
        <button type="button" class="btn" onclick={() => resetForm(true)}>Clear form</button>
      {/if}
    </div>
  </div>
</div>

<div class="card">
  <div class="card-head">
    <div class="card-head-left">
      <div class="card-title">Employee commute summary</div>
      <CompanyFilterBadge />
    </div>
    <select
      style="padding:6px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--radius)"
      bind:value={cDeptFilter}
    >
      <option value="">All departments</option>
      {#each commuteDeptOptions as d}
        <option value={d}>{d}</option>
      {/each}
    </select>
  </div>
  <div class="card-body">
    <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 1rem">
      <div class="stat stat-info">
        <div class="stat-label">Total employees</div>
        <div class="stat-val">{stats.n}</div>
        <div class="stat-unit">people</div>
      </div>
      <div class="stat stat-accent">
        <div class="stat-label">Total commute CO₂e</div>
        <div class="stat-val">{Math.round(stats.total)}</div>
        <div class="stat-unit">kg CO₂e</div>
      </div>
      <div class="stat stat-warn">
        <div class="stat-label">Average / person</div>
        <div class="stat-val">{stats.avg}</div>
        <div class="stat-unit">kg CO₂e</div>
      </div>
    </div>

    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Full name</th>
            <th>Emp. ID</th>
            <th>Company</th>
            <th>Department</th>
            <th>Transport</th>
            <th>km/day (one-way)</th>
            <th>Days/month</th>
            <th>WFH/month</th>
            <th>Carpool</th>
            <th>CO₂e (kg)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#if filteredCommute.length === 0}
            <tr>
              <td colspan="12" style="text-align:center;color:var(--text3);padding:2rem">
                {#if $selectedCompany && $commuteList.length > 0}
                  No commute rows for {$selectedCompany} in this period
                {:else}
                  No data yet
                {/if}
              </td>
            </tr>
          {:else}
            {#each filteredCommute as c, i (c.id)}
              <tr class:trip-row-editing={c.id === editingCommuteId}>
                <td style="font-family:var(--mono);font-size:11px;color:var(--text3)">{i + 1}</td>
                <td><strong>{c.name}</strong></td>
                <td class="num">{c.empId}</td>
                <td>{c.company || '—'}</td>
                <td>{c.dept || '—'}</td>
                <td>{c.vehicle}</td>
                <td class="num">{c.km}</td>
                <td class="num">{c.days}</td>
                <td class="num">{c.wfh || 0}</td>
                <td class="num">{c.carpool > 1 ? `${c.carpool} people` : '—'}</td>
                <td>
                  <span class="badge {c.co2 > 200 ? 'badge-r' : c.co2 > 80 ? 'badge-a' : 'badge-g'}"
                    >{c.co2} kg</span
                  >
                </td>
                <td>
                  <RowActionIcons
                    onEdit={() => loadCommuteIntoForm(c)}
                    onDelete={() => deleteRow(c.id)}
                    editTitle="Edit — load into form above"
                    deleteTitle="Delete commute row"
                  />
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <div class="sec-divider" style="margin-top:1.25rem">Breakdown by transport type</div>
    {#if vehicleChart.vArr.length === 0}
      <div style="color:var(--text3);font-size:12px">No data yet</div>
    {:else}
      {#each vehicleChart.vArr as [v, val], i}
        <div class="bar-row">
          <span class="bar-lbl">{v}</span>
          <div class="bar-bg">
            <div
              class="bar-fill"
              style="width: {Math.round((val / vehicleChart.maxV) * 100)}%; background: {vehicleChart.colors[
                i % vehicleChart.colors.length
              ]};"
            ></div>
          </div>
          <span class="bar-val">{Math.round(val)} kg</span>
        </div>
      {/each}
    {/if}
  </div>
</div>
