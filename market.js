// Forever AH house key 6 maps to US house 114. Verify each reply before using it.
(() => {
  const base = 'https://forever-ah.com/v1/houses/6';
  let session;
  let nextRequest = 0;
  const dateTime = new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });

  async function request(path, signal) {
    // All lookups and history requests share the provider's one-request-per-second pace.
    const start = Math.max(Date.now(), nextRequest);
    nextRequest = start + 1050;
    if (start > Date.now()) await new Promise(resolve => setTimeout(resolve, start - Date.now()));
    signal.throwIfAborted();
    const response = await fetch(base + path, {signal: AbortSignal.any([signal, AbortSignal.timeout(12000)])});
    if (!response.ok) throw Error(response.status === 429 ? 'Provider rate limit reached. Try again in a minute.' : 'Provider unavailable. Try Refresh.');
    const data = await response.json();
    if (data.house?.region !== 'us' || data.house.house_id !== 114 || data.house.house_key !== 6)
      throw Error('The provider returned a different auction house.');
    return data;
  }

  function targets(s) {
    return [{owner:s, field:'sale', name:s.output}, ...Array.from(nodes(s.ingredients), ({node}) =>
      ({owner:node, field:'price', name:node.name}))];
  }
  const key = name => name.trim().toLowerCase();
  const validPrice = price => Number.isSafeInteger(price) && price > 0;
  const priceText = value => validPrice(value) ? money(value) : '—';
  const count = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString(undefined,{maximumFractionDigits:1}) : '—';

  function applySelection(s, rows) {
    for (const target of targets(s)) {
      const row = rows.get(key(target.name));
      if (row?.selected && validPrice(row.quote)) target.owner[target.field] = money(row.quote);
    }
  }

  // Find the first copper price that covers the batch, using the calculator’s per-sale AH rounding.
  function breakEven(estimate, fee) {
    const required = Math.ceil((estimate.cost + estimate.expenses) / estimate.units);
    if (!required) return 0;
    let low = 0;
    let high = Math.ceil((required + 1) / (1 - fee / 100));
    if (!Number.isSafeInteger(high)) return null;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (mid - Math.round(mid * fee / 100) >= required) high = mid;
      else low = mid + 1;
    }
    return low;
  }

  function updateEstimate() {
    const {rows, loading} = session;
    const proposed = structuredClone(active());
    applySelection(proposed, rows);
    const estimate = summarize(proposed);
    const selection = [...rows.values()].filter(row => row.selected);
    $('market-apply').disabled = loading || !selection.length;
    const sale = rows.get(key(proposed.output));
    const usual = sale?.data?.stats?.market_value;
    let message = estimate ? `Projected profit: ${money(Math.floor(estimate.profit / estimate.units))} per sale · ${money(estimate.profit)} per batch.` : 'Complete your recipe and sale settings to preview profit.';
    if (estimate) message += ` Break-even sale price: ${money(breakEven(estimate, Number(proposed.fee)))}.`;
    if (estimate && validPrice(usual)) {
      const typical = summarize({...proposed, sale:money(usual)});
      if (typical) message += ` At the historical reference price of ${money(usual)}, profit is ${money(Math.floor(typical.profit / typical.units))} per sale.`;
    }
    if (targets(proposed).some(t => t.owner.totalPrice !== undefined)) message += ' Purchase totals take priority for their exact quantities.';
    $('market-profit').textContent = message;
  }

  function drawRow(row, index) {
    const el = document.createElement('article');
    el.className = 'market-row';
    const q = row.data;
    const itemName = escapeHtml(row.name);
    if (!q) {
      el.innerHTML = `<b>${itemName}</b><p class="hint">${escapeHtml(row.error)}</p>`;
      return el;
    }
    const time = Date.parse(q.current?.ts);
    const stale = Number.isFinite(time) && Date.now() - time > 2 * 3600000;
    const stamp = Number.isFinite(time) ? dateTime.format(time) : 'Unknown scan time';
    el.innerHTML = `<label class="market-check"><input type="checkbox" ${row.selected ? 'checked' : ''} ${validPrice(row.quote) ? '' : 'disabled'}>
      <span>${itemName} <small>· ${row.roles.has('sale') ? (row.roles.size > 1 ? 'Sale & buy' : 'Sale') : 'Buy'}</small></span></label>
      <p class="hint">Entered: ${escapeHtml([...row.current].join(' / ') || '—')} · Scan: ${stamp}${stale ? ' · Older than 2 hours' : ''}</p>
      <dl><div><dt>Lowest listing</dt><dd>${priceText(row.quote)}</dd></div><div><dt>Listed units</dt><dd>${count(q.current?.quantity)}</dd></div>
      <div><dt>Historical reference¹</dt><dd>${priceText(q.stats?.market_value)}</dd></div><div><dt>Est. sold / day</dt><dd>${count(q.stats?.sold_per_day)}</dd></div></dl>
      <details><summary>7-day price history</summary><div id="history-${index}" class="history-content"></div></details>`;
    el.querySelector('input').onchange = event => {row.selected = event.target.checked; updateEstimate();};
    const panel = el.querySelector('details');
    const signal = session.controller.signal;
    panel.ontoggle = async () => {
      if (!panel.open || panel.dataset.loaded || signal.aborted) return;
      panel.dataset.loaded = 'yes';
      const out = el.querySelector('.history-content');
      out.textContent = 'Loading daily prices…';
      try {
        const result = await request('/items/' + q.item.item_id + '/history?resolution=day', signal);
        if (result.item?.item_id !== q.item.item_id || !Array.isArray(result.points)) throw Error('History unavailable.');
        const points = result.points.filter(p => Number.isFinite(Date.parse(p.ts))).slice(-7);
        out.innerHTML = points.length ? `<table><thead><tr><th>Day (UTC)</th><th>Low ask</th><th>Median ask</th><th>Listed units</th></tr></thead><tbody>${points.map(p =>
          `<tr><th>${new Date(p.ts).toISOString().slice(5,10)}</th><td>${priceText(p.min_unit)}</td><td>${priceText(p.median_unit)}</td><td>${count(p.quantity)}</td></tr>`).join('')}</tbody></table>` : 'No recorded history for this week.';
      } catch {
        out.textContent = 'History unavailable. Close and reopen this section to retry.';
        delete panel.dataset.loaded;
      }
    };
    return el;
  }

  async function load() {
    session?.controller.abort();
    const controller = new AbortController();
    const rows = new Map();
    for (const t of targets(active())) {
      const k = key(t.name);
      if (!k) continue;
      if (!rows.has(k)) rows.set(k,{name:t.name.trim(), roles:new Set(), current:new Set(), selected:false});
      rows.get(k).roles.add(t.field);
      if (t.owner[t.field]) rows.get(k).current.add(t.owner[t.field]);
    }
    session = {rows, controller, loading:true};
    $('market-items').replaceChildren();
    $('market-profit').textContent = '';
    $('market-apply').disabled = true;
    $('market-refresh').disabled = true;
    let i = 0;
    let firstFailure;
    for (const [k,row] of rows) {
      $('market-status').textContent = `Looking up ${row.name} (${i + 1} of ${rows.size})…`;
      try {
        const data = await request('/market?q=' + encodeURIComponent(row.name),controller.signal);
        const matches = data.rows.filter(r => key(r.item.name) === k);
        if (matches.length === 1 && data.total <= data.rows.length) {
          row.data = matches[0];
          const point = row.data.current;
          row.quote = point?.quantity > 0 && Number.isFinite(Date.parse(point.ts)) ? point.min_unit : null;
          // Keep entered vendor prices for the sample's vendor-supplied reagents.
          const vendorPrice = ['fine thread','empty vial'].includes(k) && row.roles.size === 1 && row.roles.has('price') && row.current.size;
          row.selected = validPrice(row.quote) && !vendorPrice && ![...row.current].some(value => copper(value) === 0);
        } else row.error = matches.length || data.total > data.rows.length ? 'Ambiguous match. Keep the entered price.' : 'No exact listed item found.';
      } catch (error) {
        if (controller.signal.aborted) return;
        firstFailure = error.message;
        row.error = firstFailure;
      }
      if (controller.signal.aborted) return;
      $('market-items').append(drawRow(row,i++));
      if (firstFailure) break;
    }
    session.loading = false;
    $('market-refresh').disabled = false;
    const matched = [...rows.values()].filter(row=>validPrice(row.quote)).length;
    $('market-status').textContent = !rows.size ? 'Enter a finished item or reagent name first.' :
      `${matched} of ${rows.size} items priced for ${active().name || 'this shuffle'}. ${firstFailure ? 'Lookup interrupted. Refresh to retry.' : 'Select the prices to apply.'}`;
    if (matched) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = '¹ The reference uses low listing prices over 14 days, with more weight on recent days. Listed units measure supply. Sales per day are inferred from disappearing auctions.';
      $('market-items').append(note);
    }
    updateEstimate();
  }

  $('market-open').onclick = () => { $('market-dialog').showModal(); load(); };
  $('market-refresh').onclick = load;
  $('market-close').onclick = () => $('market-dialog').close();
  $('market-dialog').onclose = () => session?.controller.abort();
  $('market-apply').onclick = () => {
    if (session.loading) return;
    applySelection(active(), session.rows);
    save();
    render();
    $('market-dialog').close();
    $('import-status').textContent = `Applied selected US Normal Horde prices to ${active().name || 'this shuffle'}.`;
    $('import-status').hidden = false;
  };
})();
