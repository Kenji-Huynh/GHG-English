<script>
  import { normKey } from '../lib/suggestions.js'

  let {
    value = $bindable(''),
    /** @type {string[]} */
    options = [],
    placeholder = '',
    id = undefined,
    /** Called on every change (typing or picking) */
    oninput = (/** @type {string} */ _v) => {},
    /** Called only when an existing option is picked from the list */
    onpick = (/** @type {string} */ _v) => {},
  } = $props()

  const MAX_SHOWN = 8

  let open = $state(false)
  let activeIdx = $state(-1)

  const query = $derived(normKey(value))
  const matches = $derived.by(() => {
    const list = query ? options.filter((o) => normKey(o).includes(query)) : options
    // Values starting with the query first, then the rest (each group keeps the usage order)
    const starts = list.filter((o) => normKey(o).startsWith(query))
    const rest = list.filter((o) => !normKey(o).startsWith(query))
    return [...starts, ...rest].slice(0, MAX_SHOWN)
  })
  const exact = $derived(!!query && options.some((o) => normKey(o) === query))
  const showNew = $derived(!!query && !exact)

  function pick(/** @type {string} */ v) {
    value = v
    open = false
    activeIdx = -1
    oninput(v)
    onpick(v)
  }

  function onType(/** @type {Event} */ e) {
    value = /** @type {HTMLInputElement} */ (e.currentTarget).value
    open = true
    activeIdx = -1
    oninput(value)
  }

  function onKey(/** @type {KeyboardEvent} */ e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      open = true
      return
    }
    if (!open || !matches.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIdx = (activeIdx + 1) % matches.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIdx = (activeIdx - 1 + matches.length) % matches.length
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pick(matches[activeIdx])
    } else if (e.key === 'Escape') {
      open = false
    }
  }

  function onBlur() {
    open = false
    // Typed a known value with different case/accents → snap to the saved spelling
    const same = options.find((o) => normKey(o) === normKey(value))
    if (same && same !== value) pick(same)
  }
</script>

<div class="combo">
  <input
    type="text"
    {id}
    {placeholder}
    {value}
    autocomplete="off"
    oninput={onType}
    onfocus={() => (open = true)}
    onblur={onBlur}
    onkeydown={onKey}
  />
  {#if options.length}
    <span class="combo-caret" aria-hidden="true">▾</span>
  {/if}
  {#if open && (matches.length || showNew)}
    <ul class="combo-list" role="listbox">
      {#each matches as m, i}
        <li role="option" aria-selected={i === activeIdx}>
          <!-- mousedown (not click) so the input does not lose focus/close the list first -->
          <button
            type="button"
            tabindex="-1"
            class:active={i === activeIdx}
            onmousedown={(e) => {
              e.preventDefault()
              pick(m)
            }}
            onmouseenter={() => (activeIdx = i)}>{m}</button
          >
        </li>
      {/each}
      {#if showNew}
        <li class="combo-new">＋ New value: <strong>{value.trim()}</strong></li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .combo {
    position: relative;
  }
  .combo input {
    padding-right: 26px;
  }
  .combo-caret {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    color: var(--text3);
    pointer-events: none;
  }
  .combo-list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 50;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 260px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  }
  .combo-list button {
    width: 100%;
    text-align: left;
    padding: 7px 12px;
    font-size: 13px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text);
    font-family: var(--sans);
  }
  .combo-list button.active {
    background: var(--accent-bg);
  }
  .combo-new {
    padding: 7px 12px;
    font-size: 12px;
    color: var(--text3);
    border-top: 1px dashed var(--border);
  }
  .combo-new strong {
    color: var(--accent);
  }
</style>
