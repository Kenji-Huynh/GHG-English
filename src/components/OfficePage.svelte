<script>
  import { EMISSION_SOURCES, UNIT_OPTIONS } from '../lib/constants.js'
  import { COMPANIES, isValidCompany, matchesCompany } from '../lib/companies.js'
  import CompanySelect from './CompanySelect.svelte'
  import CompanyFilterBadge from './CompanyFilterBadge.svelte'
  import RowActionIcons from './RowActionIcons.svelte'
  import { get } from 'svelte/store'
  import {
    equipRows,
    equipDrafts,
    equipDraftRows,
    offSettings,
    periodLabel,
    currentMonth,
    currentYear,
    setCompanyLocation,
    addEquipDraft,
    updateEquipDraft,
    selectDraftSource,
    removeEquipDraft,
    editEquipRecord,
    saveEquipDraft,
    deleteEquipRecord,
    selectedCompany,
  } from '../lib/ghg.js'
  import { confirmDanger, toastOk, confirmAction, toastErr, showErrorDetail } from '../lib/notify.js'

  /** @type {Set<string>} */
  let busyIds = $state(new Set())

  /** @param {string} id @param {boolean} on */
  function setBusy(id, on) {
    const next = new Set(busyIds)
    if (on) next.add(id)
    else next.delete(id)
    busyIds = next
  }

  let location = $state('')
  let defaultCompany = $state(COMPANIES[0])

  $effect(() => {
    const saved = $offSettings.company ?? ''
    if (isValidCompany(saved)) defaultCompany = saved
    location = $offSettings.location ?? ''
  })

  $effect(() => {
    if ($selectedCompany) defaultCompany = $selectedCompany
  })

  $effect(() => {
    if (!isValidCompany(defaultCompany)) return
    setCompanyLocation(defaultCompany, location)
  })

  function persistLocation() {
    if (!isValidCompany(defaultCompany)) return
    setCompanyLocation(defaultCompany, location)
  }

  const visibleEquipRows = $derived.by(() => {
    if (!$selectedCompany) return $equipRows
    return $equipRows.filter((r) => matchesCompany(r.company, $selectedCompany))
  })

  const officeTotals = $derived.by(() => {
    let s1 = 0
    let s2 = 0
    for (const r of visibleEquipRows) {
      const t = r.volume && r.ef ? (r.volume * r.ef) / 1000 : 0
      if (r.scope === 1) s1 += t
      else s2 += t
    }
    return { s1, s2 }
  })

  const confirmedEquipRows = $derived(visibleEquipRows)

  const draftEquipRows = $derived.by(() => {
    if (!$selectedCompany) return $equipDraftRows
    return $equipDraftRows.filter((r) => matchesCompany(r.company, $selectedCompany))
  })

  /** Record ids currently being edited in the input section */
  const editingRecordIds = $derived(new Set($equipDraftRows.map((d) => d.recordId).filter(Boolean)))

  async function onDeleteDraft(row) {
    if (row.recordId) {
      removeEquipDraft(row.id)
      toastOk('Edit cancelled — Lark record unchanged')
      return
    }
    const ok = await confirmDanger('Delete draft row?', 'This row has not been saved to Lark yet.', 'Delete')
    if (!ok) return
    removeEquipDraft(row.id)
    toastOk('Draft row deleted')
  }

  async function onDeleteFromSummary(id) {
    const ok = await confirmDanger(
      'Delete this row?',
      'The record will be permanently deleted from Lark Base.',
      'Delete',
    )
    if (!ok) return
    setBusy(id, true)
    try {
      await deleteEquipRecord(id)
      toastOk('Deleted from Lark Base')
    } catch (e) {
      await showErrorDetail(e, 'Deleting from Lark Base failed')
    } finally {
      setBusy(id, false)
    }
  }

  function onEditFromSummary(row) {
    if (!editEquipRecord(row)) {
      toastErr('This row is already open for editing above')
      return
    }
    toastOk('Row copied to the input section above — edit then click ✓ to save')
  }

  function onAddRow() {
    addEquipDraft(defaultCompany)
  }

  async function onConfirmRow(row) {
    const fresh = get(equipDrafts).find((r) => r.id === row.id) ?? row
    if (!fresh.source?.trim()) {
      toastErr('Please select an emission source')
      return
    }
    if (!fresh.ef || fresh.ef <= 0) {
      toastErr('Please enter a valid emission factor (EF)')
      return
    }
    if (!fresh.volume || fresh.volume <= 0) {
      toastErr('Please enter a volume greater than 0')
      return
    }
    if (!isValidCompany(fresh.company || defaultCompany)) {
      toastErr('Please select a company')
      return
    }
    if (!fresh.company) updateEquipDraft(fresh.id, 'company', defaultCompany)
    const ok = await confirmAction(fresh.recordId ? 'Save changes to Lark Base?' : 'Add to Lark Base?', '')
    if (!ok) return
    setBusy(fresh.id, true)
    try {
      await saveEquipDraft(fresh.id)
      toastOk(fresh.recordId ? 'Lark record updated' : 'Row saved to Lark Base')
    } catch (e) {
      await showErrorDetail(e, 'Saving to Lark Base failed')
    } finally {
      setBusy(fresh.id, false)
    }
  }

  /** @param {string} id @param {string} raw */
  function setEquipNumber(id, key, raw) {
    const n = raw === '' ? 0 : Number(raw)
    updateEquipDraft(id, key, Number.isFinite(n) ? n : 0)
  }
</script>

<div class="page-title">Stationary Combustion — Office</div>
<div class="page-sub">
  Fixed emission sources at office / facility · Scope 1 (direct combustion) &amp; Scope 2 (purchased electricity)
</div>

<div class="card">
  <div class="card-head">
    <div class="card-head-left"><div class="card-title">Reporting period info</div></div>
  </div>
  <div class="card-body g3">
    <div class="field">
      <label>Reporting period</label>
      <input
        type="text"
        readonly
        value={periodLabel($currentMonth, $currentYear)}
        style="background: var(--surface2); color: var(--text2); cursor: default"
      />
    </div>
    <div class="field">
      <label>Location / Facility</label>
      <input type="text" placeholder="Building XYZ, District 1, HCMC" bind:value={location} oninput={persistLocation} />
    </div>
    <div class="field">
      <label>Company (default for new rows)</label>
      <CompanySelect bind:value={defaultCompany} hideLabel={true} required={true} id="office-default-company" />
    </div>
  </div>
</div>

<div class="card">
  <div class="card-head">
    <div class="card-head-left">
      <div class="card-title">Equipment / emission source list</div>
      <CompanyFilterBadge />
      <span class="card-scope scope-s1" style="background:#fdecea;color:#c0392b">SCOPE 1 &amp; 2</span>
    </div>
    <button type="button" class="btn btn-add" onclick={onAddRow}>+ Add equipment row</button>
  </div>
  <div class="card-body">
    {#if draftEquipRows.length === 0}
      <div class="empty">
        <div class="empty-icon">⚙️</div>
        {#if $equipRows.length === 0}
          No equipment yet. Click "+ Add equipment row" to get started.
        {:else}
          No rows being edited — saved rows are in the summary table below (live from Lark Base). Click
          "+ Add equipment row" or <strong>Edit</strong> a row in the table below to make changes.
        {/if}
      </div>
    {:else}
      {#each draftEquipRows as row, i (row.id)}
        {@const total = row.volume && row.ef ? (row.volume * row.ef) / 1000 : 0}
        <div class="flight-leg-card eq-card">
          <div class="flight-leg-card-toolbar">
            <div class="eq-card-tags">
              <span class="flight-leg-badge">Equipment {i + 1}</span>
              <span class="badge {row.scope === 1 ? 'scope-s1' : 'scope-s2'}">Scope {row.scope}</span>
              <span class="eq-draft-pill">{row.recordId ? 'Editing Lark record' : 'Not saved yet'}</span>
            </div>
            <div class="eq-card-actions">
              <button
                type="button"
                class="btn btn-sm eq-save-btn"
                title={row.recordId ? 'Save changes to Lark Base' : 'Save to Lark Base'}
                disabled={busyIds.has(row.id)}
                onclick={() => onConfirmRow(row)}
              >
                {busyIds.has(row.id) ? 'Saving…' : '✓ Confirm'}
              </button>
              <button type="button" class="btn btn-danger btn-sm" onclick={() => onDeleteDraft(row)}>
                {row.recordId ? 'Cancel edit' : 'Delete'}
              </button>
            </div>
          </div>
          <div class="eq-card-grid">
            <div class="field">
              <label for="eq-name-{row.id}">Equipment</label>
              <input
                id="eq-name-{row.id}"
                type="text"
                placeholder="Air conditioner, generator..."
                value={row.equipment}
                oninput={(e) => updateEquipDraft(row.id, 'equipment', e.currentTarget.value)}
              />
            </div>
            <div class="field">
              <label for="eq-co-{row.id}">Company</label>
              <select
                id="eq-co-{row.id}"
                value={row.company || defaultCompany}
                onchange={(e) => updateEquipDraft(row.id, 'company', e.currentTarget.value)}
                required
              >
                {#each COMPANIES as co}
                  <option value={co}>{co}</option>
                {/each}
              </select>
            </div>
            <div class="field eq-span-2">
              <label for="eq-src-{row.id}">Emission source</label>
              <select
                id="eq-src-{row.id}"
                value={row.source}
                onchange={(e) => selectDraftSource(row.id, e.currentTarget.value)}
              >
                <option value="">-- Select source --</option>
                {#each EMISSION_SOURCES as s}
                  <option value={s.label}>{s.label}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label for="eq-unit-{row.id}">Unit</label>
              <select
                id="eq-unit-{row.id}"
                value={row.unit}
                onchange={(e) => updateEquipDraft(row.id, 'unit', e.currentTarget.value)}
              >
                {#each UNIT_OPTIONS as u}
                  <option>{u}</option>
                {/each}
              </select>
            </div>
            <div class="field field-unit">
              <label for="eq-ef-{row.id}">Emission factor</label>
              <input
                id="eq-ef-{row.id}"
                type="number"
                placeholder="0"
                value={row.ef || ''}
                step="any"
                oninput={(e) => setEquipNumber(row.id, 'ef', e.currentTarget.value)}
              />
              <span class="unit">kgCO₂e</span>
            </div>
            <div class="field">
              <label for="eq-ref-{row.id}">EF reference</label>
              <input
                id="eq-ref-{row.id}"
                type="text"
                placeholder="DEFRA 2023 / MONRE VN..."
                value={row.efRef}
                oninput={(e) => updateEquipDraft(row.id, 'efRef', e.currentTarget.value)}
              />
            </div>
            <div class="field field-unit">
              <label for="eq-vol-{row.id}">Volume</label>
              <input
                id="eq-vol-{row.id}"
                type="number"
                placeholder="0"
                value={row.volume || ''}
                min="0"
                step="any"
                oninput={(e) => setEquipNumber(row.id, 'volume', e.currentTarget.value)}
              />
              {#if row.unit && row.unit !== '—'}<span class="unit">{row.unit}</span>{/if}
            </div>
          </div>
          {#if total > 0}
            <div class="eq-card-formula">
              {row.volume} {row.unit} × {row.ef} kg/unit ÷ 1000 = <strong>{total.toFixed(4)}</strong> tonnes CO₂e
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<div class="card">
  <div class="card-head">
    <div class="card-head-left">
      <div class="card-title">Office emissions summary</div>
      <CompanyFilterBadge />
    </div>
  </div>
  <div class="card-body">
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Equipment</th>
            <th>Company</th>
            <th>Emission source</th>
            <th>Scope</th>
            <th>Unit</th>
            <th>Volume</th>
            <th>EF</th>
            <th>Total GHG (tonnes CO₂e)</th>
            <th class="eq-summary-actions-th">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#if confirmedEquipRows.length === 0}
            <tr>
              <td colspan="9" style="text-align:center;color:var(--text3);padding:1.5rem">
                {#if $equipRows.length === 0}
                  No data yet
                {:else}
                  No rows for {$selectedCompany} in this period
                {/if}
              </td>
            </tr>
          {:else}
            {#each confirmedEquipRows as r (r.id)}
              {@const tot = r.volume && r.ef ? (r.volume * r.ef) / 1000 : 0}
              <tr class:trip-row-editing={editingRecordIds.has(r.id)} style:opacity={busyIds.has(r.id) ? 0.5 : null}>
                <td>{r.equipment || '—'}</td>
                <td>{r.company || '—'}</td>
                <td>{r.source || '—'}</td>
                <td>
                  <span class="badge {r.scope === 1 ? 'scope-s1' : 'scope-s2'}">Scope {r.scope}</span>
                </td>
                <td>{r.unit || '—'}</td>
                <td class="num">{r.volume || 0}</td>
                <td class="num">{r.ef || 0}</td>
                <td class="num" style="font-weight:600;color:var(--accent)">{tot.toFixed(4)}</td>
                <td class="eq-summary-actions">
                  <RowActionIcons
                    onEdit={() => onEditFromSummary(r)}
                    onDelete={() => onDeleteFromSummary(r.id)}
                    editTitle="Edit — copy to input section above"
                    deleteTitle="Delete from Lark Base"
                  />
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
    <div style="margin-top:1rem;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <span style="font-size:13px;color:var(--text2)">Scope 1 total:</span>
      <span class="badge badge-r">{officeTotals.s1.toFixed(4)} tonnes CO₂e</span>
      <span style="font-size:13px;color:var(--text2)">Scope 2 total:</span>
      <span class="badge badge-a">{officeTotals.s2.toFixed(4)} tonnes CO₂e</span>
    </div>
  </div>
</div>
