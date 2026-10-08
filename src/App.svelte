<script>
  import { get } from 'svelte/store'
  import {
    currentMonth,
    currentYear,
    activePage,
    setPeriod,
    setActivePage,
    shiftPeriod,
    periodLabel,
    periodKeys,
    selectedCompany,
    syncStatus,
    startLiveSync,
    refreshFromLark,
  } from './lib/ghg.js'
  import CompanySelect from './components/CompanySelect.svelte'
  import { toastOk, showErrorDetail } from './lib/notify.js'
  import Dashboard from './components/Dashboard.svelte'
  import OfficePage from './components/OfficePage.svelte'
  import EmployeePage from './components/EmployeePage.svelte'
  import CommutePage from './components/CommutePage.svelte'
  import ClosePeriodPage from './components/ClosePeriodPage.svelte'

  $effect(() => startLiveSync())

  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(t)
  })

  const syncLabel = $derived.by(() => {
    const s = $syncStatus
    if (s.state === 'error') return 'Lark sync error'
    if (!s.lastSync) return 'Connecting to Lark…'
    const sec = Math.max(0, Math.round((now - s.lastSync) / 1000))
    return sec < 3 ? 'Live · synced just now' : `Live · synced ${sec}s ago`
  })

  async function onSyncChipClick() {
    const s = get(syncStatus)
    if (s.state === 'error' && s.error) {
      await showErrorDetail(s.error, 'Lark Base sync failed')
    }
    await refreshFromLark()
  }

  const yearOptions = $derived.by(() => {
    const y = new Date().getFullYear()
    const arr = []
    for (let i = y - 3; i <= y + 2; i++) arr.push(i)
    return arr
  })

  /** @param {Event} e */
  function onMonthChange(e) {
    const m = +/** @type {HTMLSelectElement} */ (e.currentTarget).value
    setPeriod(m, get(currentYear))
    toastOk(`Switched to ${periodLabel(m, get(currentYear))}`)
  }

  /** @param {Event} e */
  function onYearChange(e) {
    const y = +/** @type {HTMLSelectElement} */ (e.currentTarget).value
    setPeriod(get(currentMonth), y)
    toastOk(`Switched to ${periodLabel(get(currentMonth), y)}`)
  }

  function shift(delta) {
    shiftPeriod(delta)
    toastOk(`Switched to ${periodLabel(get(currentMonth), get(currentYear))}`)
  }
</script>

<div class="top-bar">
  <div class="logo">GHG<span>.</span>INVENTORY</div>
  <div class="period-controls">
    <button type="button" class="btn-period" onclick={() => shift(-1)} aria-label="Previous period">‹</button>
    <select value={$currentMonth} onchange={onMonthChange}>
      {#each Array(12) as _, i}
        <option value={i + 1}>Month {i + 1}</option>
      {/each}
    </select>
    <select value={$currentYear} onchange={onYearChange}>
      {#each yearOptions as y}
        <option value={y}>{y}</option>
      {/each}
    </select>
    <button type="button" class="btn-period" onclick={() => shift(1)} aria-label="Next period">›</button>
    <span class="period-active" title="New rows are saved to Lark with this reporting period">
      Active period: <strong>{periodLabel($currentMonth, $currentYear)}</strong>
    </span>
    <span class="period-badge" title="Number of periods with data in Lark Base">{$periodKeys.length} periods</span>
    <CompanySelect
      bind:value={$selectedCompany}
      showAll={true}
      hideLabel={true}
      compact={true}
      id="global-company"
      title="Filter by company — All companies = show all"
    />
  </div>
  <div class="top-bar-right">
    <button
      type="button"
      class="sync-chip sync-chip--{$syncStatus.state === 'error' ? 'error' : $syncStatus.lastSync ? 'ok' : 'loading'}"
      title={$syncStatus.state === 'error'
        ? 'Click to see the error and retry'
        : 'Data is read from and written to Lark Base directly. Click to refresh now.'}
      onclick={onSyncChipClick}
    >
      <span class="sync-chip-dot" aria-hidden="true"></span>
      {syncLabel}
    </button>
  </div>
</div>

<div class="nav">
  <button type="button" class="nav-tab" class:active={$activePage === 'dashboard'} onclick={() => setActivePage('dashboard')}>
    Dashboard
  </button>
  <button type="button" class="nav-tab" class:active={$activePage === 'office'} onclick={() => setActivePage('office')}>
    Office (Scope 1 &amp; 2)
  </button>
  <button type="button" class="nav-tab" class:active={$activePage === 'employee'} onclick={() => setActivePage('employee')}>
    Employees (Scope 3)
  </button>
  <button type="button" class="nav-tab" class:active={$activePage === 'commute'} onclick={() => setActivePage('commute')}>
    Daily Commute
  </button>
  <button type="button" class="nav-tab" class:active={$activePage === 'close'} onclick={() => setActivePage('close')}>
    Close Period
  </button>
</div>

<div class="page">
  {#if $activePage === 'dashboard'}
    <Dashboard />
  {:else if $activePage === 'office'}
    <OfficePage />
  {:else if $activePage === 'employee'}
    <EmployeePage />
  {:else if $activePage === 'commute'}
    <CommutePage />
  {:else}
    <ClosePeriodPage />
  {/if}
</div>
