<script>
  import 'leaflet/dist/leaflet.css'
  import { tick } from 'svelte'

  let {
    value = $bindable(''),
    coords = $bindable(/** @type {{ lat: number, lng: number } | null} */ (null)),
    placeholder = 'Building XYZ, District 1, HCMC',
    onchange = () => {},
  } = $props()

  const NOMINATIM = 'https://nominatim.openstreetmap.org'
  /** Search-as-you-type is not allowed on public Nominatim, so suggestions use Photon (also OSM data). */
  const PHOTON = 'https://photon.komoot.io/api/'
  const VN_BBOX = '102.1,8.2,109.5,23.4'
  const DEFAULT_CENTER = { lat: 10.7769, lng: 106.7009 }
  const SUGGEST_DELAY_MS = 300

  let open = $state(false)
  let query = $state('')
  let searching = $state(false)
  let searchError = $state('')
  /** @type {{ name: string, detail: string, lat: number, lng: number }[]} */
  let results = $state([])
  let activeIdx = $state(-1)
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let suggestTimer
  /** @type {AbortController | undefined} */ let suggestAbort
  let picked = $state(/** @type {{ lat: number, lng: number, address: string } | null} */ (null))
  let resolving = $state(false)

  /** @type {HTMLDivElement | undefined} */
  let mapEl = $state()
  /** @type {any} */ let L
  /** @type {any} */ let map
  /** @type {any} */ let marker

  async function openPicker() {
    open = true
    query = ''
    results = []
    searchError = ''
    picked = coords ? { ...coords, address: value } : null
    await tick()
    await initMap()
  }

  function closePicker() {
    open = false
    map?.remove()
    map = null
    marker = null
  }

  async function initMap() {
    if (!L) {
      L = (await import('leaflet')).default
    }
    if (!mapEl) return
    const start = picked ?? DEFAULT_CENTER
    map = L.map(mapEl).setView([start.lat, start.lng], picked ? 16 : 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    if (picked) placeMarker(picked.lat, picked.lng)
    map.on('click', (/** @type {any} */ e) => {
      results = []
      pickPoint(e.latlng.lat, e.latlng.lng)
    })
  }

  function placeMarker(lat, lng) {
    const icon = L.divIcon({ className: 'loc-pin', html: '📍', iconSize: [28, 28], iconAnchor: [14, 26] })
    if (marker) marker.setLatLng([lat, lng])
    else {
      marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        pickPoint(p.lat, p.lng)
      })
    }
  }

  async function pickPoint(lat, lng, address = '') {
    placeMarker(lat, lng)
    picked = { lat, lng, address: address || `${lat.toFixed(5)}, ${lng.toFixed(5)}` }
    if (address) return
    resolving = true
    try {
      const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en,vi`)
      const j = await r.json()
      if (j?.display_name && picked?.lat === lat && picked?.lng === lng) picked = { lat, lng, address: j.display_name }
    } catch {
      /* keep coordinate text */
    } finally {
      resolving = false
    }
  }

  /** @param {any} f Photon GeoJSON feature */
  function toSuggestion(f) {
    const p = f.properties ?? {}
    const street = [p.housenumber, p.street].filter(Boolean).join(' ')
    const parts = [street, p.locality, p.district, p.city, p.state, p.country].filter(Boolean)
    const name = p.name || street || parts[0] || 'Unnamed place'
    const detail = [...new Set(parts.filter((x) => x !== name))].join(', ')
    const [lng, lat] = f.geometry.coordinates
    return { name, detail, lat, lng }
  }

  async function fetchSuggestions(q) {
    suggestAbort?.abort()
    suggestAbort = new AbortController()
    const center = map?.getCenter() ?? DEFAULT_CENTER
    const url =
      `${PHOTON}?limit=6&bbox=${VN_BBOX}&lat=${center.lat}&lon=${center.lng}` + `&q=${encodeURIComponent(q)}`
    const r = await fetch(url, { signal: suggestAbort.signal })
    const j = await r.json()
    return (j.features ?? []).map(toSuggestion)
  }

  async function runSearch(q) {
    searching = true
    searchError = ''
    try {
      results = await fetchSuggestions(q)
      activeIdx = results.length ? 0 : -1
      if (!results.length) searchError = 'No places found. Try a different keyword.'
    } catch (err) {
      if (err?.name !== 'AbortError') searchError = 'Search failed. Check your internet connection.'
    } finally {
      searching = false
    }
  }

  function onQueryInput() {
    clearTimeout(suggestTimer)
    const q = query.trim()
    if (q.length < 2) {
      suggestAbort?.abort()
      results = []
      searchError = ''
      return
    }
    suggestTimer = setTimeout(() => runSearch(q), SUGGEST_DELAY_MS)
  }

  function onQueryKey(e) {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault()
      activeIdx = (activeIdx + 1) % results.length
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault()
      activeIdx = (activeIdx - 1 + results.length) % results.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[activeIdx]) chooseResult(results[activeIdx])
      else search()
    } else if (e.key === 'Escape' && results.length) {
      e.stopPropagation()
      results = []
    }
  }

  async function search(e) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    clearTimeout(suggestTimer)
    await runSearch(q)
  }

  function chooseResult(res) {
    map.setView([res.lat, res.lng], 17)
    pickPoint(res.lat, res.lng, res.detail ? `${res.name}, ${res.detail}` : res.name)
    query = res.name
    results = []
    activeIdx = -1
  }

  function confirmPick() {
    if (!picked) return
    value = picked.address
    coords = { lat: picked.lat, lng: picked.lng }
    onchange()
    closePicker()
  }

  function onKey(e) {
    if (open && e.key === 'Escape') closePicker()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="loc-input">
  <input
    type="text"
    {placeholder}
    bind:value
    oninput={() => {
      if (!value.trim()) coords = null
      onchange()
    }}
  />
  <button type="button" class="btn btn-sm loc-open" title="Pick on map" onclick={openPicker}>📍 Map</button>
</div>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="loc-backdrop" onclick={closePicker}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="loc-modal" role="dialog" aria-label="Pick location" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="loc-head">
        <strong>Pick location / facility</strong>
        <button type="button" class="loc-close" aria-label="Close" onclick={closePicker}>✕</button>
      </div>

      <div class="loc-search-wrap">
        <form class="loc-search" onsubmit={search}>
          <input
            type="text"
            placeholder="Start typing an address, building, district…"
            autocomplete="off"
            bind:value={query}
            oninput={onQueryInput}
            onkeydown={onQueryKey}
          />
          <button type="submit" class="btn btn-primary btn-sm" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {#if results.length}
          <ul class="loc-results" role="listbox">
            {#each results as res, i}
              <li role="option" aria-selected={i === activeIdx}>
                <button
                  type="button"
                  class:active={i === activeIdx}
                  onmouseenter={() => (activeIdx = i)}
                  onclick={() => chooseResult(res)}
                >
                  <span class="loc-res-icon">📍</span>
                  <span class="loc-res-text">
                    <span class="loc-res-name">{res.name}</span>
                    {#if res.detail}<span class="loc-res-detail">{res.detail}</span>{/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if searchError}
        <div class="loc-hint loc-err">{searchError}</div>
      {/if}

      <div class="loc-map" bind:this={mapEl}></div>
      <div class="loc-hint">Click on the map or drag the pin to adjust the exact position.</div>

      <div class="loc-foot">
        <div class="loc-picked">
          {#if picked}
            <span class="loc-addr">{resolving ? 'Looking up address…' : picked.address}</span>
            <span class="loc-coord">{picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}</span>
          {:else}
            <span class="loc-coord">No location selected yet</span>
          {/if}
        </div>
        <button type="button" class="btn btn-sm" onclick={closePicker}>Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" disabled={!picked || resolving} onclick={confirmPick}>
          Use this location
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .loc-input {
    display: flex;
    gap: 6px;
  }
  .loc-input input {
    flex: 1;
    min-width: 0;
  }
  .loc-open {
    flex-shrink: 0;
    height: 36px;
    white-space: nowrap;
  }
  .loc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .loc-modal {
    width: min(760px, 100%);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--surface);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    padding: 14px 16px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  }
  .loc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .loc-close {
    border: none;
    background: none;
    font-size: 16px;
    cursor: pointer;
    color: var(--text2);
  }
  .loc-search {
    display: flex;
    gap: 6px;
  }
  .loc-search input {
    flex: 1;
    height: 36px;
    padding: 8px 10px;
    font-size: 13px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
  }
  .loc-search input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .loc-search-wrap {
    position: relative;
  }
  .loc-results {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 1100;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 280px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .loc-results button {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    text-align: left;
    padding: 8px 12px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text);
  }
  .loc-results button.active {
    background: var(--accent-bg);
  }
  .loc-res-icon {
    font-size: 14px;
    line-height: 1.4;
  }
  .loc-res-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .loc-res-name {
    font-size: 13px;
    font-weight: 600;
  }
  .loc-res-detail {
    font-size: 11px;
    color: var(--text3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .loc-map {
    height: 380px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }
  .loc-hint {
    font-size: 11px;
    color: var(--text3);
  }
  .loc-err {
    color: var(--danger, #c0392b);
  }
  .loc-foot {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .loc-picked {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .loc-addr {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .loc-coord {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text3);
  }
  :global(.loc-pin) {
    font-size: 26px;
    line-height: 1;
    background: none;
    border: none;
  }
</style>
