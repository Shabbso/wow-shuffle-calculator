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
  const numeric = ['qty', 'yield', 'batch', 'fee'].includes(fieldName);
  return `<label>${label}<input data-field="${fieldName}" data-id="${id}" value="${escapeHtml(value)}"
    ${numeric ? 'inputmode="decimal"' : ''} autocomplete="off"></label>`;
}

let recipeId = null;

function context() {
  const s = active();
  const entries = [...nodes(s.ingredients)];
  const entry = entries.find(({node}) => node.id === recipeId);
  const parents = entry ? [...entry.ancestors, recipeId].map(id => entries.find(({node}) => node.id === id).node) : [];
  let runs = Number(s.batch);
  for (const parent of parents) runs = Math.ceil(runs * Number(parent.qty) / Number(parent.yield));
  return {parent: entry?.node, parents, runs, items: entry?.node.children ?? s.ingredients};
}

function sourceControl(node) {
  return `<label class="source">Use<select data-field="mode" data-id="${node.id}">
      ${[['auto','Cheapest available'],['buy','Buy from AH'],['craft','Craft it']].map(([value,label]) =>
      `<option value="${value}" ${node.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function ingredient(node) {
  const recipe = node.children.length > 0;
  return `<article class="ingredient" aria-label="${escapeHtml(node.name || 'New reagent')}">
    <div class="ingredient-fields">${field('Reagent', node.name, 'name', node.id)}
    ${field('Qty needed', node.qty, 'qty', node.id)}
    ${field('Buy price each', node.price, 'price', node.id)}</div>
    <div class="actions">
    ${recipe ? sourceControl(node) : ''}
    <button data-action="open" data-id="${node.id}">${recipe ? 'Open recipe' : 'Add crafting recipe'}</button>
    <button class="remove" data-action="remove" data-id="${node.id}">Remove</button></div>
    ${recipe ? `<p class="decision" id="cost-${node.id}"></p>` : ''}</article>`;
}

function navigateRecipe(id) {
  recipeId = id;
  renderRecipe();
  $('parent-name').focus();
}

function renderRecipe() {
  const s = active();
  const {parent, parents, items} = context();
  const trail = [{id: '', name: s.output || 'Finished item'}, ...parents];
  $('path').innerHTML = parent ? trail.slice(0, -1).map(n =>
    `<button data-parent="${n.id}">${escapeHtml(n.name || 'Unnamed reagent')}</button><span aria-hidden="true"> › </span>`).join('') + 'Reagent recipe' : 'Finished item';
  $('parent-name').textContent = (parent ? parent.name : s.output) || (parent ? 'Unnamed reagent' : 'Finished item');
  $('yield-line').innerHTML = field('Items made by one craft', (parent || s).yield, 'yield', parent?.id);
  $('ingredients').innerHTML = items.map(ingredient).join('') || '<p class="hint">Add the first reagent used to make this item.</p>';
  $('back').hidden = !parent;
  $('parent-source').hidden = !parent;
  $('parent-source').innerHTML = parent ? sourceControl(parent) + '<div id="parent-cost"></div>' : '';
  updateCosts();
}

function updateCosts() {
  const {items, runs, parents, parent} = context();
  if (parent) {
    let parentRuns = Number(active().batch);
    for (const n of parents.slice(0,-1)) parentRuns = Math.ceil(parentRuns * Number(n.qty) / Number(n.yield));
    const required = parentRuns * Number(parent.qty);
    const buy = plan([parent], parentRuns, {id: parent.id, mode: 'buy'});
    const craft = plan([parent], parentRuns, {id: parent.id, mode: 'craft'});
    const savings = craft && buy ? Math.abs(buy.cost - craft.cost) : null;
    const verdict = savings === null ? 'Enter the missing prices to compare both sources.'
      : savings === 0 ? 'Both sources cost the same.'
      : (buy.cost < craft.cost ? 'Buying' : 'Crafting') + ' saves ' + money(savings);
    $('parent-cost').innerHTML = `<p class="demand">Cost to supply ${positive(required) ? required : '—'} × ${escapeHtml(parent.name || 'reagent')}</p>
      <div class="quotes"><div>Buy from AH<strong>${buy ? money(buy.cost) : 'Needs price'}</strong></div>
      <div>Craft from reagents<strong>${craft ? money(craft.cost) : 'Needs prices'}</strong></div></div>
      <p class="verdict">${verdict}</p>`;
  }
  for (const node of items.filter(n => n.children.length)) {
    const entry = $('cost-' + node.id);
    if (!entry) continue;
    const buy = plan([node], runs, {id: node.id, mode: 'buy'});
    const craft = plan([node], runs, {id: node.id, mode: 'craft'});
    const buyWins = buy && (!craft || buy.cost <= craft.cost);
    const route = node.mode === 'auto' ? (buyWins ? 'buy' : 'craft') : node.mode;
    const chosen = route === 'buy' ? buy : craft;
    entry.textContent = `For this batch · Buy: ${buy ? money(buy.cost) : 'needs price'} · Craft: ${craft ? money(craft.cost) : 'needs recipe prices'} · ${chosen ? (route === 'buy' ? 'Buying' : 'Crafting') : 'Incomplete'}`;
  }
  $('setup-summary').textContent = `${active().batch || '—'} crafts · ${active().sale || 'Set sale price'} each`;
}

$('back').onclick = () => {
  const {parents} = context();
  navigateRecipe(parents.at(-2)?.id || null);
};
$('path').onclick = event => {
  if (event.target.matches('button')) navigateRecipe(event.target.dataset.parent || null);
};

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
  const s = active();
  const r = summarize(s);
  const row = (label, value, tone = '') =>
    `<div class="metric"><span>${label}</span><strong class="${tone}">${value}</strong></div>`;
  const signed = (label, value) => row(label, money(value), value > 0 ? 'gain' : value < 0 ? 'loss' : '');
  const choices = [...nodes(s.ingredients)].filter(({node}) => node.children.length);
  const comparisons = choices.map(({node, ancestors}) => {
    const craft = summarize(s, {id: node.id, ancestors, mode: 'craft'});
    const buy = summarize(s, {id: node.id, ancestors, mode: 'buy'});
    return `<tr><th scope="row">${escapeHtml(node.name || 'Unnamed ingredient')}</th>
      <td>${craft ? money(craft.profit) : '—'}</td><td>${buy ? money(buy.profit) : '—'}</td></tr>`;
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
    ${comparisons ? `<section><h2>Craft vs. buy</h2><p class="hint">Batch profit if you craft or buy each reagent. For a nested reagent, this assumes you craft its parent. A dash means a price or recipe is missing.</p>
      <table><thead><tr><th>Ingredient</th><th>Craft</th><th>Buy</th></tr></thead><tbody>${comparisons}</tbody></table></section>` : ''}
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
  if (!id && field === 'output') {
    if (recipeId) $('path').querySelector('button').textContent = node.output || 'Finished item';
    else $('parent-name').textContent = node.output || 'Finished item';
  }
  updateCosts();
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
$('saved').onchange = event => { recipeId = null; state.active = event.target.value; save(); render(); };
function append(shuffle) {
  recipeId = null;
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
  recipeId = null;
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
$('add').onclick = () => add(context().items);
$('ingredients').onclick = event => {
  const {action, id} = event.target.dataset;
  if (!action) return;
  const s = active();
  const all = [...nodes(s.ingredients)].map(({node}) => node);
  const node = all.find(node => node.id === id);
  if (action === 'open') {
    navigateRecipe(id);
    if (!node.children.length) add(node.children);
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
