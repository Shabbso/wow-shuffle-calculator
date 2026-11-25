function copper(input) {
  const value = input.trim().toLowerCase();
  if (/^\d+(\.\d{1,2})?$/.test(value)) {
    const [silver, fraction = ''] = value.split('.');
    return Number(silver) * 100 + Number(fraction.padEnd(2, '0'));
  }
  const parts = value.match(/^(?:(\d+)\s*g\s*)?(?:(\d+)\s*s\s*)?(?:(\d+)\s*c)?$/);
  return value && parts ? Number(parts[1] || 0) * 10000 + Number(parts[2] || 0) * 100 + Number(parts[3] || 0) : NaN;
}

function money(value) {
  if (!Number.isSafeInteger(value)) return '—';
  const amount = Math.abs(value);
  return (value < 0 ? '−' : '') + [
    amount >= 10000 ? Math.floor(amount / 10000) + 'g' : '',
    amount >= 100 ? Math.floor(amount / 100) % 100 + 's' : '',
    amount % 100 + 'c'
  ].filter(Boolean).join(' ');
}

const item = (name = '', qty = '1', price = '') => ({
  id: crypto.randomUUID(), name, qty, price, yield: '1', mode: 'auto', children: []
});

function positive(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function usesPurchaseTotal(node, units) {
  return node.totalPrice !== undefined && positive(node.totalQty) && Number(node.totalQty) === units;
}

function plan(items, runs, override = {}, allowUnpriced = false) {
  let cost = 0;
  const purchases = [];
  const crafts = [];
  for (const node of items) {
    const units = Number(node.qty) * runs;
    if (!node.name.trim() || !positive(node.qty) || !positive(units)) return null;
    const buyCost = usesPurchaseTotal(node, units) ? copper(node.totalPrice) : copper(node.price) * units;
    const knownBuyCost = Number.isSafeInteger(buyCost) ? buyCost : null;
    const buy = knownBuyCost !== null || allowUnpriced
      ? {cost: knownBuyCost, purchases: [{name: node.name, units, cost: knownBuyCost}]} : null;
    const craftRuns = Math.ceil(units / Number(node.yield));
    const craft = node.children.length && positive(node.yield)
      ? plan(node.children, craftRuns, override, allowUnpriced) : null;
    const mode = node.id === override.id ? override.mode : override.ancestors?.includes(node.id) ? 'craft' : node.mode;
    let chosen;
    if (mode === 'buy' || !node.children.length) chosen = buy;
    else if (mode === 'craft') chosen = craft;
    else if (craft && craft.cost !== null && (knownBuyCost === null || craft.cost < knownBuyCost)) chosen = craft;
    else if (knownBuyCost !== null) chosen = buy;
    if (!chosen) return null;
    cost = cost === null || chosen.cost === null ? null : cost + chosen.cost;
    purchases.push(...chosen.purchases);
    if (chosen === craft) {
      crafts.push(...craft.crafts, {
        name: node.name, runs: craftRuns, produced: craftRuns * Number(node.yield), needed: units,
        materials: node.children.map(child => ({name: child.name, units: craftRuns * Number(child.qty)}))
      });
    }
  }
  return cost === null || Number.isSafeInteger(cost) ? {cost, purchases, crafts} : null;
}

function summarize(shuffle, override, route) {
  const sale = copper(shuffle.sale);
  const extra = copper(shuffle.extra);
  const target = copper(shuffle.target);
  const fee = Number(shuffle.fee);
  if (!positive(shuffle.batch) || !positive(shuffle.yield) || !shuffle.fee.trim() ||
      !Number.isFinite(fee) || fee < 0 || fee > 100 ||
      ![sale, extra, target].every(Number.isSafeInteger) || !shuffle.ingredients.length) return null;
  const runs = Number(shuffle.batch);
  const units = runs * Number(shuffle.yield);
  const proceeds = (sale - Math.round(sale * fee / 100)) * units;
  const expenses = extra * units;
  const goal = target * units;
  const result = route || plan(shuffle.ingredients, runs, override);
  if (!result || ![proceeds, expenses, goal, result.cost + expenses].every(Number.isSafeInteger)) return null;
  return {...result, proceeds, expenses, goal, units, profit: proceeds - expenses - result.cost};
}

function groupPurchases(purchases) {
  const grouped = new Map();
  for (const row of purchases) {
    const key = row.name.trim().toLowerCase();
    const group = grouped.get(key);
    if (group) {
      group.units += row.units;
      group.cost = group.cost === null || row.cost === null ? null : group.cost + row.cost;
    } else grouped.set(key, {...row});
  }
  return [...grouped.values()];
}

function ceilings(result) {
  return groupPurchases(result.purchases).map(row => ({
    ...row, maxTotal: result.profit - result.goal + row.cost, ceiling: Math.floor((result.profit - result.goal + row.cost) / row.units)
  }));
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
