const $ = id => document.getElementById(id);
const key = 'wow-shuffle-calculator-v1';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);

function newShuffle(name = 'New shuffle') {
  return {id: crypto.randomUUID(), name, output: '', sale: '', yield: '1',
    batch: '1', fee: '5', extra: '0c', target: '1c', ingredients: []};
}

function example() {
  const shuffle = {...newShuffle('Woolen Reagent Bag'), output: 'Woolen Reagent Bag', sale: '1g50s', batch: '20', collapsed: {setup: true}};
  const dye = item('Cerulean Dye', '1', '1g25s');
  dye.children = [item('Frilled Lichen', '2', '68s58c'), item('Empty Vial', '1', '0c')];
  shuffle.ingredients = [
    {...item('Bolt of Woolen Cloth', '3', '5s9c'), children: [item('Wool Cloth', '3')]},
    item('Fine Thread', '1', '1s'), dye
  ];
  return shuffle;
}

let state;
try { state = JSON.parse(localStorage.getItem(key)); } catch {}
if (!state?.shuffles?.length) {
  const seed = example();
  state = {active: seed.id, shuffles: [seed]};
}

const active = () => state.shuffles.find(shuffle => shuffle.id === state.active) || state.shuffles[0];
function save() {
  try { localStorage.setItem(key, JSON.stringify(state)); }
  catch {
    $('storage').hidden = false;
    $('storage').textContent = 'Browser storage is unavailable. Changes are saved for this session only.';
  }
}

function field(label, value, fieldName, id = '') {
  const numeric = ['qty', 'yield', 'batch', 'fee', 'totalQty'].includes(fieldName);
  return `<label>${label}<input data-field="${fieldName}" data-id="${id}" value="${escapeHtml(value)}"
    ${numeric ? 'inputmode="decimal"' : ''} autocomplete="off"></label>`;
}

function sourceControl(node) {
  return `<label class="source">Use<select data-field="mode" data-id="${node.id}">
      ${[['auto','Cheapest available'],['buy','Buy from AH'],['craft','Craft it']].map(([value,label]) =>
      `<option value="${value}" ${node.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function ingredient(node, depth = 0) {
  const recipe = node.children.length > 0;
  const name = escapeHtml(node.name || 'New reagent');
  const branch = recipe ? `<details class="subrecipe" data-branch="${node.id}" ${node.folded ? '' : 'open'}>
    <summary>Crafting recipe <span class="formula" id="formula-${node.id}"></span></summary>
    <div class="branch-body">
      ${field('Units this recipe makes', node.yield, 'yield', node.id)}
      ${node.children.map(child => ingredient(child, depth + 1)).join('')}
      <button data-action="child" data-id="${node.id}">+ Add material</button>
    </div></details>` : '';
  return `<article class="ingredient" id="row-${node.id}" aria-label="${name}">
    <div class="ingredient-fields">${field(depth ? 'Crafting material' : 'Reagent', node.name, 'name', node.id)}
    ${field(depth ? 'Qty per recipe' : 'Qty needed', node.qty, 'qty', node.id)}
    ${field('Buy price each', node.price, 'price', node.id)}</div>
    <div class="actions">
      ${recipe ? sourceControl(node) : `<button data-action="child" data-id="${node.id}">Add crafting recipe</button>`}
      <button data-action="total" id="total-action-${node.id}" data-id="${node.id}">${node.totalPrice === undefined ? 'Use purchase total' : 'Clear purchase total'}</button>
      <button class="remove" data-action="remove" data-id="${node.id}">Remove</button>
    </div>
    ${node.totalPrice === undefined ? '' : `<div class="bulk-price"><div class="bulk-fields">
      ${field('Purchase quantity', node.totalQty, 'totalQty', node.id)}
      ${field('Total price for that quantity', node.totalPrice, 'totalPrice', node.id)}</div>
      <p class="hint" id="total-note-${node.id}"></p></div>`}
    ${branch}
    ${recipe ? `<div class="comparison" id="cost-${node.id}"></div>` : ''}
  </article>`;
}

function renderRecipe() {
  const s = active();
  $('parent-name').textContent = s.output || 'Finished item';
  $('yield-line').innerHTML = field('Items made by one craft', s.yield, 'yield');
  $('ingredients').innerHTML = s.ingredients.map(node => ingredient(node)).join('') || '<p class="hint">Add the first reagent used to make this item.</p>';
}

function sourceVerdict(node, difference) {
  let action = 'Need inputs';
  let tone = 'neutral';
  let reason = 'Complete both pricing paths to compare.';
  if (difference === 0) {
    action = 'Either';
    reason = 'Buying and crafting cost the same.';
  } else if (difference !== null) {
    const craft = difference > 0;
    action = craft ? 'Craft' : 'Buy';
    tone = craft ? 'craft' : 'buy';
    reason = `${craft ? 'Crafting' : 'Buying'} saves ${money(Math.abs(difference))} this batch.`;
    if (node.mode !== 'auto' && node.mode !== tone) {
      reason += ` Your selected source is ${node.mode === 'buy' ? 'Buy' : 'Craft'}.`;
    }
  }
  return `<div class="source-verdict ${tone}"><div class="source-title"><strong>${action}</strong>
    <b>${escapeHtml(node.name || 'Unnamed reagent')}</b></div><p>${reason}</p></div>`;
}

function updateBranchCosts(items, runs, verdicts) {
  for (const node of items) {
    const required = runs * Number(node.qty);
    $('total-action-' + node.id).dataset.required = positive(required) ? required : '';
    if (node.totalPrice !== undefined) {
      const note = $('total-note-' + node.id);
      if (usesPurchaseTotal(node, required)) {
        const cost = copper(node.totalPrice);
        note.textContent = Number.isSafeInteger(cost) ? `Buying ${required} here costs ${money(cost)} in total.` : 'Enter the AH total in gold, silver or copper.';
      } else {
        note.textContent = `This recipe needs ${positive(required) ? required : '—'} for the batch. The unit price applies until the purchase quantity matches.`;
      }
    }
    if (!node.children.length) continue;
    const name = node.name.trim() || 'reagent';
    const parts = node.children.map(child => `${child.qty || '—'} × ${child.name.trim() || 'material'}`);
    $('formula-' + node.id).textContent = `${parts.join(' + ')} → ${node.yield || '—'} × ${name}`;
    const buy = plan([node], runs, {id: node.id, mode: 'buy'});
    const craft = plan([node], runs, {id: node.id, mode: 'craft'});
    const difference = buy && craft ? buy.cost - craft.cost : null;
    const verdict = sourceVerdict(node, difference);
    verdicts.set(node.id, verdict);
    const hasTotal = node.totalPrice !== undefined || [...nodes(node.children)].some(({node: child}) => child.totalPrice !== undefined);
    const quantity = hasTotal ? required : Number(node.yield);
    const label = positive(quantity) ? quantity : '—';
    const buyQuote = hasTotal ? buy?.cost : copper(node.price) * quantity;
    const craftQuote = hasTotal ? craft : plan(node.children, 1);
    $('cost-' + node.id).innerHTML = `${verdict}<div class="quotes"><div>Buy ${label} ready-made<strong>${positive(quantity) && Number.isSafeInteger(buyQuote) ? money(buyQuote) : 'Needs price'}</strong></div>
      <div>Craft ${label} from materials<strong>${positive(quantity) && craftQuote ? money(craftQuote.cost) : 'Needs recipe inputs'}</strong></div></div>`;
    updateBranchCosts(node.children, Math.ceil(required / Number(node.yield)), verdicts);
  }
}

function updateCosts() {
  const s = active();
  const verdicts = new Map();
  updateBranchCosts(s.ingredients, Number(s.batch), verdicts);
  $('setup-summary').textContent = `${s.batch || '—'} crafts · ${s.sale || 'Set sale price'} each`;
  return verdicts;
}

function *nodes(items, ancestors = []) {
  for (const node of items) {
    yield {node, ancestors};
    yield* nodes(node.children, [...ancestors, node.id]);
  }
}

function renderMenu() {
  $('saved').innerHTML = state.shuffles.map(shuffle =>
    `<option value="${shuffle.id}" ${shuffle.id === active().id ? 'selected' : ''}>${escapeHtml(shuffle.name || 'Untitled shuffle')}</option>`).join('');
}

function render() {
  const s = active();
  renderMenu();
  for (const id of ['setup', 'recipe']) $(id).open = !s.collapsed?.[id];
  syncView();
  $('settings').innerHTML = [
    [['Shuffle name', 'name'], ['Finished item', 'output']],
    [['Sale price per item', 'sale'], ['Crafts in batch', 'batch']],
    [['AH cut (%)', 'fee'], ['Other costs per sale', 'extra'], ['Profit target per sale', 'target']]
  ].map(group => `<div class="fields">${group.map(([label, name]) => field(label, s[name], name)).join('')}</div>`).join('');
  renderRecipe();
  results();
}

function results() {
  const verdicts = updateCosts();
  const s = active();
  const r = summarize(s);
  const row = (label, value, tone = '') =>
    `<div class="metric"><span>${label}</span><strong class="${tone}">${value}</strong></div>`;
  const signed = (label, value) => row(label, money(value), value > 0 ? 'gain' : value < 0 ? 'loss' : '');
  const choices = [...nodes(s.ingredients)].filter(({node}) => node.children.length);
  const comparisons = choices.map(({node, ancestors}) => {
    const craft = summarize(s, {id: node.id, ancestors, mode: 'craft'});
    const buy = summarize(s, {id: node.id, ancestors, mode: 'buy'});
    const outcome = scenario => {
      if (!scenario) return 'Unavailable';
      if (scenario.profit === 0) return 'Break-even';
      return `${money(Math.abs(scenario.profit))} ${scenario.profit < 0 ? 'loss' : 'profit'}`;
    };
    const parent = ancestors.length ? choices.find(entry => entry.node.id === ancestors.at(-1)).node : null;
    return `<div class="source-choice">
      ${parent ? `<p class="hint">If crafting ${escapeHtml(parent.name || 'the parent reagent')}</p>` : ''}
      ${verdicts.get(node.id)}
      ${craft?.profit < 0 && buy?.profit < 0 ? '<p class="batch-warning">Both options lose money on the finished batch.</p>' : ''}
      <div class="outcomes"><span>Batch if crafted <b>${outcome(craft)}</b></span><span>Batch if bought <b>${outcome(buy)}</b></span></div>
    </div>`;
  }).join('');
  $('analysis').innerHTML = `<section><h2>Profit estimate</h2>${r ? `
    <div class="profit">${signed('Batch profit', r.profit)}</div>
    <p class="hint">Sell ${r.units} × ${escapeHtml(s.output || 'finished product')}</p>
    ${signed('Average profit per sale', Math.floor(r.profit / r.units))}
    ${row('Sale proceeds after AH cut', money(r.proceeds))}
    ${row('Batch material cost', money(r.cost))}
    ${row('Other batch costs', money(r.expenses))}
    <p class="target ${r.profit >= r.goal ? 'gain' : 'loss'}">${r.profit >= r.goal ? 'Meets profit target' : 'Below profit target'}</p>
    ` : '<p class="hint">Enter valid prices and quantities for a complete buy or craft path.</p>'}</section>
    ${comparisons ? `<section><h2>Craft vs. buy</h2>${comparisons}</section>` : ''}
    ${r ? `<section><h2>Maximum buy prices</h2><p class="hint">Ceiling per item for ${money(copper(s.target))} profit per sale. Each ceiling assumes the other prices and sources stay fixed.</p>
      <table><thead><tr><th>Item</th><th>Batch qty</th><th>Max each</th></tr></thead><tbody>
      ${ceilings(r).map(row => `<tr><th scope="row">${escapeHtml(row.name)}</th><td>${row.units}</td>
      <td>${row.ceiling < 0 ? 'No viable price' : money(row.ceiling)}</td></tr>`).join('')}</tbody></table>
      <p class="hint">Batch costs include whole reagent crafts. Leftovers have zero resale value.</p>
    </section>` : ''}`;
}

function edit(event) {
  const {field, id} = event.target.dataset;
  if (!field) return;
  const s = active();
  const node = id ? [...nodes(s.ingredients)].find(({node}) => node.id === id)?.node : s;
  if (!node) return;
  node[field] = event.target.value;
  save();
  if (!id && field === 'output') $('parent-name').textContent = node.output || 'Finished item';
  if (id && field === 'name') $('row-' + id).setAttribute('aria-label', node.name || 'New reagent');
  if (!id && field === 'name') renderMenu();
  results();
}
function syncView() {
  const compact = !$('setup').open && !$('recipe').open;
  document.querySelector('.layout').classList.toggle('results-view', compact);
  $('view').textContent = compact ? 'Edit inputs' : 'Show results';
}

for (const id of ['setup', 'recipe']) {
  $(id).ontoggle = () => {
    const shuffle = active();
    shuffle.collapsed ??= {};
    shuffle.collapsed[id] = !$(id).open;
    syncView();
    save();
  };
}

$('view').onclick = () => {
  const expand = !$('setup').open && !$('recipe').open;
  $('setup').open = expand;
  $('recipe').open = expand;
  active().collapsed = {setup: !expand, recipe: !expand};
  save();
  syncView();
};

document.addEventListener('input', edit);
$('saved').onchange = event => { state.active = event.target.value; save(); render(); };
function append(shuffle) {
  state.shuffles.push(shuffle);
  state.active = shuffle.id;
  save();
  render();
}
$('new').onclick = () => append(newShuffle());
$('duplicate').onclick = () => {
  const copy = structuredClone(active());
  copy.id = crypto.randomUUID();
  copy.name += ' (copy)';
  append(copy);
};
$('delete').onclick = () => {
  if (!confirm(`Delete “${active().name || 'Untitled shuffle'}”?`)) return;
  state.shuffles = state.shuffles.filter(shuffle => shuffle.id !== active().id);
  if (!state.shuffles.length) state.shuffles.push(newShuffle());
  state.active = state.shuffles[0].id;
  save();
  render();
};
function add(list) {
  const node = item();
  list.push(node);
  save();
  render();
  document.querySelector(`input[data-id="${node.id}"]`).focus();
}
$('add').onclick = () => add(active().ingredients);
$('ingredients').onclick = event => {
  const summary = event.target.closest('.subrecipe > summary');
  if (summary) {
    event.preventDefault();
    const details = summary.parentElement;
    const entry = [...nodes(active().ingredients)].find(({node}) => node.id === details.dataset.branch);
    details.open = !details.open;
    entry.node.folded = !details.open;
    save();
    return;
  }
  const {action, id} = event.target.dataset;
  if (!action) return;
  const s = active();
  const all = [...nodes(s.ingredients)].map(({node}) => node);
  const node = all.find(node => node.id === id);
  if (action === 'total') {
    const adding = node.totalPrice === undefined;
    if (adding) {
      node.totalQty = event.target.dataset.required;
      node.totalPrice = '';
    } else {
      delete node.totalQty;
      delete node.totalPrice;
    }
    save();
    render();
    const focus = adding ? document.querySelector(`input[data-id="${id}"][data-field="totalPrice"]`) : $('total-action-' + id);
    focus.focus();
    return;
  }
  if (action === 'child') {
    node.folded = false;
    add(node.children);
    return;
  }
  if (node.children.length && !confirm(`Remove ${node.name || 'this reagent'} and its crafting recipe?`)) return;
  const parent = all.find(parent => parent.children.includes(node));
  const siblings = parent ? parent.children : s.ingredients;
  siblings.splice(siblings.indexOf(node), 1);
  if (parent && !siblings.length) parent.mode = 'auto';
  save();
  render();
};
save();
render();

// Auctionator quotes text columns and writes unit prices as integer copper.
function csvFields(line) {
  const fields = [];
  const token = /(?:"((?:[^"]|"")*)"|([^",]*))(,|$)/y;
  while (true) {
    const match = token.exec(line);
    if (!match) return null;
    fields.push((match[1] ?? match[2]).replaceAll('""', '"').trim());
    if (!match[3]) return fields;
  }
}

function importedPrices(text, shuffle) {
  const lines = text.trim().replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).map(line => line.trim().replace(/\\$/, '').trim()).filter(Boolean);
  const header = csvFields(lines.shift() || '')?.map(value => value.toLowerCase()) || [];
  const nameIndex = header.indexOf('name');
  const priceIndex = header.indexOf('price');
  if (nameIndex < 0 || priceIndex < 0) throw Error('Copy Export Results with the Price and Name column headings included.');

  const prices = new Map();
  let skipped = 0;
  for (const line of lines) {
    const fields = csvFields(line);
    const name = fields?.[nameIndex]?.toLowerCase();
    const price = Number(fields?.[priceIndex]);
    if (!name || fields.length !== header.length || !/^\d+$/.test(fields[priceIndex]) || !Number.isSafeInteger(price) || price <= 0) {
      skipped++;
      continue;
    }
    // Equal names with different prices may refer to different item variants.
    prices.set(name, prices.has(name) && prices.get(name) !== price ? null : price);
  }
  const candidates = [{name: shuffle.output, owner: shuffle, field: 'sale'}];
  for (const {node} of nodes(shuffle.ingredients)) candidates.push({name: node.name, owner: node, field: 'price'});
  const targets = candidates.filter(target => Number.isSafeInteger(prices.get(target.name.trim().toLowerCase())));
  for (const target of targets) target.price = money(prices.get(target.name.trim().toLowerCase()));
  const used = new Set(targets.map(target => target.name.trim().toLowerCase()));
  const unused = [...prices.keys()].filter(name => !used.has(name)).map(name => prices.get(name) === null ? name + ' (conflicting prices)' : name);
  return {targets, unused, skipped};
}

function previewPrices() {
  const button = $('apply-prices');
  const preview = $('price-preview');
  const shuffle = active();
  button.disabled = true;
  const raw = $('price-csv').value.trim();
  if (!raw) {
    preview.textContent = '';
    return [];
  }
  try {
    const {targets, unused, skipped} = importedPrices(raw, shuffle);
    const entries = targets.map(target => `<tr><th scope="row">${escapeHtml(target.name)}<small> ${target.field === 'sale' ? '(sale)' : '(buy)'}</small></th>
      <td>${escapeHtml(target.owner[target.field]) || '—'}</td><td>${target.price}</td></tr>`).join('');
    preview.innerHTML = `<p><b>${escapeHtml(shuffle.name || 'Current shuffle')}</b></p>
      ${entries ? `<table><thead><tr><th>Item</th><th>Current</th><th>Imported</th></tr></thead><tbody>${entries}</tbody></table>` : '<p>No matching prices. Check the item names in this shuffle.</p>'}
      ${targets.some(t => t.owner.totalPrice !== undefined) ? '<p class="hint">This updates unit prices. A purchase total takes priority for its exact quantity.</p>' : ''}
      ${unused.length ? `<p class="hint">Skipped items: ${escapeHtml(unused.join(', '))}.</p>` : ''}
      ${skipped ? `<p class="hint">Invalid rows skipped: ${skipped}.</p>` : ''}`;
    button.disabled = targets.length === 0;
    return targets;
  } catch (error) {
    preview.textContent = error.message;
    return [];
  }
}

$('import-prices').onclick = () => {
  $('import-status').hidden = true;
  $('price-csv').value = '';
  previewPrices();
  $('price-dialog').showModal();
  $('price-csv').focus();
};
$('price-csv').oninput = previewPrices;
$('apply-prices').onclick = () => {
  const targets = previewPrices();
  if (!targets.length) return;
  for (const target of targets) target.owner[target.field] = target.price;
  save();
  render();
  $('price-dialog').close();
  $('import-status').textContent = `Applied ${targets.length} ${targets.length === 1 ? 'price' : 'prices'} to ${active().name || 'this shuffle'}.`;
  $('import-status').hidden = false;
};
