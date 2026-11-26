const $ = id => document.getElementById(id);
const key = 'wow-shuffle-calculator-v1';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);

// AvailableSuperDistrict + AuctionHouseRedirect (Forever build 1.60.1.71139)
// identify the in-game houses. Keys are the US entries from Forever AH /v1/houses.
const pricingMarkets = [
  ['Normal', 'Horde', 114, 6], ['Normal', 'Alliance', 111, 3],
  ['PvP', 'Horde', 113, 5], ['PvP', 'Alliance', 110, 2],
  ['Roleplay', 'Horde', 120, 12], ['Roleplay', 'Alliance', 119, 11],
  ['Roleplay PvP', 'Horde', 124, 15], ['Roleplay PvP', 'Alliance', 123, 14]
].map(([ruleset, faction, id, key]) => ({ruleset, faction, id, key, label: `US · ${ruleset} · ${faction}`}));
function pricingMarket(setup) {
  return pricingMarkets.find(m => m.id === setup.marketHouseId) || pricingMarkets[0];
}
function marketItemPrefix(market) {
  // Existing snapshots and planner tiers belong to US Normal Horde.
  return market === pricingMarkets[0] ? 'item:' : 'us-' + market.id + ':item:';
}

let priceNoticeTimer;
function clearPriceNotice() {
  clearTimeout(priceNoticeTimer);
  $('import-status').hidden = true;
  $('import-status').textContent = '';
}
function showPriceNotice(text) {
  clearPriceNotice();
  $('import-status').textContent = text;
  $('import-status').hidden = false;
  priceNoticeTimer = setTimeout(clearPriceNotice, 6500);
}

const metals = {g:'gold', s:'silver', c:'copper'};

// Only decorate validated display amounts. Inputs, exports and stored prices use plain text.
function priceMarkup(raw) {
  const value = copper(raw);
  if (!Number.isSafeInteger(value)) return escapeHtml(raw) || '—';
  const text = /[gsc]/i.test(raw) ? raw.trim() : money(value);
  return text.replace(/(\d+)(\s*)([gsc])/gi, (_, digits, gap, suffix) => {
    const metal = metals[suffix.toLowerCase()];
    return `<span class="coin-part">${digits}${gap}<abbr class="coin coin-${metal}" title="${metal}" aria-label="${metal}"><span class="coin-letter">${suffix}</span></abbr></span>`;
  });
}

function displayMoney(value) {
  if (!Number.isSafeInteger(value)) return '—';
  return (value < 0 ? '−' : '') + priceMarkup(money(Math.abs(value)));
}

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
  state = {active: seed.id, shuffles: [seed], showGuideInvite:true};
}

const active = () => state.shuffles.find(shuffle => shuffle.id === state.active) || state.shuffles[0];
const isAcquisition = s => s.kind === 'acquisition';
const setupGroups = [['shuffle','Profit shuffles'], ['acquisition','Buy or craft']];
const groupMembers = kind => state.shuffles.filter(s => (isAcquisition(s) ? 'acquisition' : 'shuffle') === kind);
function setKind(s, kind) {
  if (kind === 'acquisition') s.buyPrice ??= s.sale;
  s.kind = kind;
}
function save() {
  try { localStorage.setItem(key, JSON.stringify(state)); }
  catch {
    $('storage').hidden = false;
    $('storage').textContent = 'Browser storage is unavailable. Changes are saved for this session only.';
  }
}

function field(label, value, fieldName, id = '') {
  const numeric = ['qty', 'yield', 'batch', 'fee', 'totalQty'].includes(fieldName);
  const picker = fieldName === 'output' || (fieldName === 'name' && id);
  return `<label>${label}<input ${picker ? 'role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="item-suggestions" placeholder="Type an item name"' : ''} data-field="${fieldName}" data-id="${id}" value="${escapeHtml(value)}"
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
    ${field('Buy price each', node.price, 'price', node.id)}
    <button type="button" class="remove" data-action="remove" data-id="${node.id}">Remove ${depth ? 'material' : 'reagent'}</button></div>
    <div class="actions">
      ${recipe ? sourceControl(node) : `<button data-action="child" data-id="${node.id}">Add crafting recipe</button>`}
      <button type="button" data-recipe-for="${node.id}">${recipeButtonLabel(node.name,node.itemId)}</button>
      <button data-action="total" id="total-action-${node.id}" data-id="${node.id}">${node.totalPrice === undefined ? 'Use purchase total' : 'Clear purchase total'}</button>
    </div>
    ${node.totalPrice === undefined ? '' : `<div class="bulk-price"><div class="bulk-fields">
      ${field('Purchase quantity', node.totalQty, 'totalQty', node.id)}
      ${field('Total price for that quantity', node.totalPrice, 'totalPrice', node.id)}</div>
      <p class="hint" id="total-note-${node.id}"></p></div>`}
    ${branch}
    ${recipe ? `<div class="comparison" id="cost-${node.id}"></div>` : ''}
  </article>`;
}

function showFinishedItem(output) {
  $('parent-name').innerHTML = itemLink(output.trim() || 'No finished item',active().itemId);
  document.querySelector('[data-recipe-for=""]').textContent = recipeButtonLabel(output,active().itemId);
  $('finished-action').textContent = output.trim() ? 'Remove finished item' : 'Set finished item';
}

function renderRecipe() {
  const s = active();
  showFinishedItem(s.output);
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
    reason = `${craft ? 'Crafting' : 'Buying'} saves ${displayMoney(Math.abs(difference))} this batch.`;
    if (node.mode !== 'auto' && node.mode !== tone) {
      reason += ` Your selected source is ${node.mode === 'buy' ? 'Buy' : 'Craft'}.`;
    }
  }
  return `<div class="source-verdict ${tone}"><div class="source-title"><strong>${action}</strong>
    <b>${itemLink(node.name || 'Unnamed reagent', node.itemId)}</b></div><p>${reason}</p></div>`;
}

function updateBranchCosts(items, runs, verdicts, ancestors = []) {
  for (const node of items) {
    const required = runs * Number(node.qty);
    $('total-action-' + node.id).dataset.required = positive(required) ? required : '';
    if (node.totalPrice !== undefined) {
      const note = $('total-note-' + node.id);
      if (usesPurchaseTotal(node, required)) {
        const cost = copper(node.totalPrice);
        note.innerHTML = Number.isSafeInteger(cost) ? `Buying ${required} here costs ${displayMoney(cost)} in total.` : 'Enter the AH total in gold, silver or copper.';
      } else {
        note.textContent = `This recipe needs ${positive(required) ? required : '—'} for the batch. The unit price applies until the purchase quantity matches.`;
      }
    }
    if (!isAcquisition(active()) && usesPurchaseTotal(node, required)) {
      const budget = summarize(active(), {id:node.id, mode:'buy', ancestors});
      if (budget) {
        const room = budget.profit - budget.goal;
        $('total-note-' + node.id).insertAdjacentHTML('beforeend', ` ${room >= 0 ? 'Within budget' : 'Over budget'} by ${displayMoney(Math.abs(room))} against your profit target.`);
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
    $('cost-' + node.id).innerHTML = `${verdict}<div class="quotes"><div>Buy ${label} ready-made<strong>${positive(quantity) && Number.isSafeInteger(buyQuote) ? displayMoney(buyQuote) : 'Needs price'}</strong></div>
      <div>Craft ${label} from materials<strong>${positive(quantity) && craftQuote ? displayMoney(craftQuote.cost) : 'Needs recipe inputs'}</strong></div></div>`;
    updateBranchCosts(node.children, Math.ceil(required / Number(node.yield)), verdicts, [...ancestors, node.id]);
  }
}

function updateCosts() {
  const s = active();
  const verdicts = new Map();
  updateBranchCosts(s.ingredients, Number(s.batch), verdicts);
  const price = isAcquisition(s) ? s.buyPrice : s.sale;
  $('setup-summary').innerHTML = `${escapeHtml(s.batch || '—')} crafts · ${price ? priceMarkup(price) + ' each' : isAcquisition(s) ? 'Set buy price' : 'Set sale price'}`;
  return verdicts;
}

function *nodes(items, ancestors = []) {
  for (const node of items) {
    yield {node, ancestors};
    yield* nodes(node.children, [...ancestors, node.id]);
  }
}

function renderMenu() {
  $('saved').replaceChildren();
  for (const [kind,label] of setupGroups) {
    const members = groupMembers(kind);
    if (!members.length) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const s of members) group.append(new Option(s.name || 'Untitled setup',s.id));
    $('saved').append(group);
  }
  $('saved').value = active().id;
}

function render() {
  const s = active();
  clearPriceNotice();
  $('market-label').textContent = pricingMarket(s).label;
  renderMenu();
  for (const id of ['setup', 'recipe']) $(id).open = !s.collapsed?.[id];
  syncView();
  const check = isAcquisition(s);
  $('setup-kind').value = check ? 'acquisition' : 'shuffle';
  $('setup-title').textContent = check ? 'Purchase & batch settings' : 'Sale & batch settings';
  $('delete').textContent = check ? 'Delete setup' : 'Delete shuffle';
  $('delete-current').textContent = check ? 'Delete this setup' : 'Delete this shuffle';
  document.querySelector('[data-tool="planner"]').hidden = check;
  const settings = [
    [['Setup name', 'name'], ['Finished item', 'output']],
    [check ? ['Finished item buy price each', 'buyPrice'] : ['Sale price per item', 'sale'], ['Crafts in batch', 'batch']]
  ];
  if (!check) settings.push([['AH cut (%)', 'fee'], ['Other costs per sale', 'extra'], ['Profit target per sale', 'target']]);
  $('settings').innerHTML = settings.map(group => `<div class="fields">${group.map(([label, name]) => field(label, s[name] ?? '', name)).join('')}</div>`).join('');
  renderRecipe();
  results();
}

function shoppingList(s, estimate, planner = false) {
  const batchReady = positive(s.batch) && positive(s.yield) && s.ingredients.length;
  const route = batchReady && (estimate || plan(s.ingredients, Number(s.batch), {}, true));
  const heading = `<div class="shopping-head"><h2>Shopping list</h2>${planner ? '' : '<button type="button" data-edit-reagents>Edit reagents</button>'}</div>`;
  if (!route) return `<section class="shopping-list">${heading}
    <p class="hint">Enter the batch and recipe quantities. For craftable reagents, add prices or choose Buy or Craft to set their source.</p></section>`;
  const purchases = groupPurchases(route.purchases);
  return `<section class="shopping-list">${heading}
    <p class="hint">${isAcquisition(s) ? 'Shopping for' : Number(s.batch) + (Number(s.batch) === 1 ? ' craft for' : ' crafts for')} ${Number(s.batch) * Number(s.yield)} × ${itemLink(s.output || 'finished item', s.itemId)}, ${planner ? 'using the planner’s sourcing choices' : isAcquisition(s) ? 'at the compared prices' : 'using your selected sources'}.</p>
    <table><thead><tr><th>Buy</th><th>Quantity</th></tr></thead><tbody>${purchases.map(item =>
      `<tr><th scope="row">${itemLink(item.name, item.itemId)}</th><td><strong>${item.units.toLocaleString()}</strong></td></tr>`).join('')}</tbody></table>
    ${route.crafts.length ? `<h3>Craft after shopping</h3><ol>${route.crafts.map(step =>
      `<li><strong>${step.produced} × ${itemLink(step.name, step.itemId)}</strong>
        <span>${step.produced !== step.runs ? `${step.runs} ${step.runs === 1 ? 'craft' : 'crafts'} · ` : ''}Use ${step.materials.map(m => `${m.units} × ${itemLink(m.name, m.itemId)}`).join(' + ')}${step.produced > step.needed ? ` · ${step.produced - step.needed} left over` : ''}</span></li>`).join('')}</ol>` : ''}
  </section>`;
}

function outputMarket(s) {
  const prefix = marketItemPrefix(pricingMarket(s));
  const cached = s.marketItems?.[prefix + s.output.trim().toLowerCase()];
  return s.marketItems?.[prefix + 'id:' + s.itemId] || (s.itemId && cached?.id !== s.itemId ? undefined : cached);
}

function saleContext(s) {
  const market = outputMarket(s);
  if (!market) return '<p class="hint">Open Market snapshot for the latest listing and historical reference.</p>';
  const typical = Number.isSafeInteger(market.reference) ? summarize({...s, sale:money(market.reference)}) : null;
  return `<div class="metric"><span>Lowest listing</span><strong>${displayMoney(market.low)}</strong></div>
    <div class="metric"><span>Historical reference</span><strong>${displayMoney(market.reference)}</strong></div>
    ${typical ? `<p class="hint">Estimated profit at that price is ${displayMoney(Math.floor(typical.profit / typical.units))} per sale after costs.</p>` : ''}
    <p class="hint">Forever AH · ${pricingMarket(s).label} · ${new Date(market.at).toLocaleString()}</p>`;
}

function acquisitionResults(s) {
  const {units,buy,craft,difference} = acquisitionComparison(s);
  const verdict = difference === null ? 'Need inputs' : difference > 0 ? 'Craft' : difference < 0 ? 'Buy' : 'Either';
  const reason = difference === null ? 'Enter the finished item, its buy price, and a priced recipe to compare both options.'
    : difference === 0 ? 'Both options cost the same. The list shows the ready-made purchase.'
    : `${verdict === 'Craft' ? 'Crafting' : 'Buying'} saves ${displayMoney(Math.abs(difference))} for this batch.`;
  const route = difference > 0 ? craft : {purchases:[{name:s.output,itemId:s.itemId,units,cost:buy}],crafts:[]};
  return `<section class="acquisition"><h2>Buy or craft?</h2>
    <p class="decision"><strong class="decision-${verdict.toLowerCase().split(' ')[0]}">${verdict}</strong> ${itemLink(s.output || 'Finished item',s.itemId)}</p>
    <p>${reason}</p>
    <div class="metric"><span>Buy ready-made${units ? ' × ' + units : ''}</span><strong>${displayMoney(buy)}</strong></div>
    <div class="metric"><span>Craft from materials${units ? ' × ' + units : ''}</span><strong>${displayMoney(craft?.cost)}</strong></div>
    <p class="hint">Craft cost uses your reagent sources and whole recipe batches. This compares acquisition costs before any resale.</p></section>
    ${difference === null ? '' : shoppingList(s,route)}`;
}

function results() {
  const verdicts = updateCosts();
  const s = active();
  if (isAcquisition(s)) {
    $('analysis').innerHTML = acquisitionResults(s);
    return;
  }
  const r = summarize(s);
  const row = (label, value, tone = '') =>
    `<div class="metric"><span>${label}</span><strong class="${tone}">${value}</strong></div>`;
  const signed = (label, value) => row(label, displayMoney(value), value > 0 ? 'gain' : value < 0 ? 'loss' : '');
  const choices = [...nodes(s.ingredients)].filter(({node}) => node.children.length);
  const comparisons = choices.map(({node, ancestors}) => {
    const craft = summarize(s, {id: node.id, ancestors, mode: 'craft'});
    const buy = summarize(s, {id: node.id, ancestors, mode: 'buy'});
    const outcome = scenario => {
      if (!scenario) return 'Unavailable';
      if (scenario.profit === 0) return 'Break-even';
      return `${displayMoney(Math.abs(scenario.profit))} ${scenario.profit < 0 ? 'loss' : 'profit'}`;
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
    <p class="hint">Sell ${r.units} × ${itemLink(s.output || 'finished product', s.itemId)}</p>
    ${signed('Average profit per sale', Math.floor(r.profit / r.units))}
    ${row('Sale proceeds after AH cut', displayMoney(r.proceeds))}
    ${row('Batch material cost', displayMoney(r.cost))}
    ${row('Other batch costs', displayMoney(r.expenses))}
    <details class="sale-context"><summary>Sale price check</summary>
      ${row('Break-even per sale', displayMoney(breakEven(r, Number(s.fee))))}
      ${row('Entered sale price', displayMoney(copper(s.sale)))}
      ${saleContext(s)}</details>
    <p class="target ${r.profit >= r.goal ? 'gain' : 'loss'}">${r.profit >= r.goal ? 'Meets profit target' : 'Below profit target'}</p>
    ` : '<p class="hint">Enter valid prices and quantities for a complete buy or craft path.</p>'}</section>
    ${shoppingList(s, r)}
    ${comparisons ? `<section><h2>Craft vs. buy</h2>${comparisons}</section>` : ''}
    ${r ? `<section><h2>Maximum buy prices</h2><p class="hint">Ceiling per item for ${displayMoney(copper(s.target))} profit per sale. Each ceiling assumes the other prices and sources stay fixed.</p>
      <table><thead><tr><th>Item</th><th>Batch qty</th><th>Max each</th><th>Max total</th></tr></thead><tbody>
      ${ceilings(r).map(row => `<tr><th scope="row">${itemLink(row.name, row.itemId)}</th><td>${row.units}</td>
      <td>${row.ceiling < 0 ? 'No viable price' : displayMoney(row.ceiling)}</td><td>${row.maxTotal < 0 ? '—' : displayMoney(row.maxTotal)}</td></tr>`).join('')}</tbody></table>
      <p class="hint">Batch costs include whole reagent crafts. Leftovers have zero resale value.</p>
    </section>` : ''}`;
}

function edit(event) {
  const {field, id} = event.target.dataset;
  if (!field) return;
  const s = active();
  const node = id ? [...nodes(s.ingredients)].find(({node}) => node.id === id)?.node : s;
  if (!node) return;
  if ((id && field === 'name') || (!id && field === 'output')) {
    if (node[field].trim().toLowerCase() !== event.target.value.trim().toLowerCase()) {
      delete node.itemId;
      delete node.catalogRecipeId;
    }
  }
  node[field] = event.target.value;
  save();
  if (!id && field === 'output') showFinishedItem(node.output);
  if (id && field === 'name') {
    $('row-' + id).setAttribute('aria-label', node.name || 'New reagent');
    document.querySelector(`[data-recipe-for="${id}"]`).textContent = recipeButtonLabel(node.name,node.itemId);
  }
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

$('analysis').onclick = event => {
  if (!event.target.closest('[data-edit-reagents]')) return;
  $('recipe').open = true;
  syncView();
  ($('ingredients').querySelector('input') || $('add')).focus();
};

document.addEventListener('input', edit);
$('saved').onchange = event => { state.active = event.target.value; save(); render(); };
function append(shuffle) {
  state.shuffles.push(shuffle);
  state.active = shuffle.id;
  save();
  render();
}
$('new').onclick = () => {
  append({...newShuffle('New setup'), marketHouseId:pricingMarket(active()).id});
  $('setup-kind').focus();
};
$('setup-kind').onchange = event => {
  setKind(active(),event.target.value);
  save();
  render();
};
$('duplicate').onclick = () => {
  const copy = structuredClone(active());
  copy.id = crypto.randomUUID();
  copy.name += ' (copy)';
  append(copy);
};
$('finished-action').onclick = () => {
  const s = active();
  if (!s.output.trim()) {
    $('setup').open = true;
    $('settings').querySelector('[data-field="output"]').focus();
    return;
  }
  if (!confirm(`Remove “${s.output}” as the finished item and clear its entered output prices? Your shuffle and reagents will be kept.`)) return;
  delete s.itemId;
  delete s.catalogRecipeId;
  s.output = '';
  s.sale = '';
  delete s.buyPrice;
  save();
  render();
  $('finished-action').focus();
};

function deleteShuffle() {
  if (!confirm(`Delete the saved setup “${active().name || 'Untitled shuffle'}” and its recipe?`)) return;
  state.shuffles = state.shuffles.filter(shuffle => shuffle.id !== active().id);
  if (!state.shuffles.length) state.shuffles.push(newShuffle());
  state.active = state.shuffles[0].id;
  save();
  render();
  $('saved').focus();
}
$('delete').onclick = deleteShuffle;
$('delete-current').onclick = deleteShuffle;

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
  if (action !== 'remove') return;
  if (node.children.length && !confirm(`Remove ${node.name || 'this reagent'} and its crafting recipe?`)) return;
  const parent = all.find(parent => parent.children.includes(node));
  const siblings = parent ? parent.children : s.ingredients;
  const index = siblings.indexOf(node);
  siblings.splice(index, 1);
  if (parent && !siblings.length) parent.mode = 'auto';
  save();
  render();
  const next = siblings[index] || siblings[index - 1] || parent;
  (next ? $('row-' + next.id).querySelector('input') : $('add')).focus();
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
  const candidates = [{name: shuffle.output, owner: shuffle, field: isAcquisition(shuffle) ? 'buyPrice' : 'sale'}];
  for (const {node} of nodes(shuffle.ingredients)) candidates.push({name: node.name, owner: node, field: 'price'});
  const ids = idsByName(candidates.map(target => ({name:target.name, itemId:target.owner.itemId})));
  const targets = candidates.filter(target => {
    const key = target.name.trim().toLowerCase();
    return ids.get(key) !== null && Number.isSafeInteger(prices.get(key));
  });
  for (const target of targets) target.price = money(prices.get(target.name.trim().toLowerCase()));
  const used = new Set(targets.map(target => target.name.trim().toLowerCase()));
  const unused = [...prices.keys()].filter(name => !used.has(name)).map(name => {
    if (ids.get(name) === null) return name + ' (multiple item IDs in this setup)';
    return prices.get(name) === null ? name + ' (conflicting prices)' : name;
  });
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
      <td>${priceMarkup(target.owner[target.field] ?? '')}</td><td>${priceMarkup(target.price)}</td></tr>`).join('');
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
  clearPriceNotice();
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
  showPriceNotice(`Applied ${targets.length} ${targets.length === 1 ? 'price' : 'prices'} to ${active().name || 'this shuffle'}.`);
};
