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

function plan(items, runs, override = {}) {
  let cost = 0;
  const purchases = [];
  for (const node of items) {
    const units = Number(node.qty) * runs;
    if (!node.name.trim() || !positive(node.qty) || !positive(units)) return null;
    const buyCost = usesPurchaseTotal(node, units) ? copper(node.totalPrice) : copper(node.price) * units;
    const buy = Number.isSafeInteger(buyCost)
      ? {cost: buyCost, purchases: [{name: node.name, units, cost: buyCost}]} : null;
    const craft = node.children.length && positive(node.yield)
      ? plan(node.children, Math.ceil(units / Number(node.yield)), override) : null;
    const mode = node.id === override.id ? override.mode : override.ancestors?.includes(node.id) ? 'craft' : node.mode;
    let chosen;
    if (mode === 'buy') chosen = buy;
    else if (mode === 'craft') chosen = craft;
    else chosen = craft && (!buy || craft.cost < buy.cost) ? craft : buy;
    if (!chosen) return null;
    cost += chosen.cost;
    purchases.push(...chosen.purchases);
  }
  return Number.isSafeInteger(cost) ? {cost, purchases} : null;
}

function summarize(shuffle, override) {
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
  const result = plan(shuffle.ingredients, runs, override);
  if (!result || ![proceeds, expenses, goal, result.cost + expenses].every(Number.isSafeInteger)) return null;
  return {...result, proceeds, expenses, goal, units, profit: proceeds - expenses - result.cost};
}

function ceilings(result) {
  const grouped = new Map();
  for (const row of result.purchases) {
    const key = row.name.trim().toLowerCase();
    const group = grouped.get(key);
    if (group) {
      group.units += row.units;
      group.cost += row.cost;
    } else grouped.set(key, {...row});
  }
  return [...grouped.values()].map(row => ({
    ...row, ceiling: Math.floor((result.profit - result.goal + row.cost) / row.units)
  }));
}
