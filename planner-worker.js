importScripts('calc.js');

// Components that share tiered stock must be optimized together. Other branches
// can be minimized independently, since their purchase costs are additive.
function prepare(node, tiers) {
  const key = node.name.trim().toLowerCase();
  const levels = tiers.get(key);
  const children = node.children.map(child => prepare(child, tiers));
  const stock = new Set(children.flatMap(child => [...child.stock]));
  if (levels) stock.add(key);
  return {...node, key, levels, children, stock, unitPrice:copper(node.price),
    linear: !levels && node.totalPrice === undefined && Number(node.yield) === 1 && children.every(child => child.linear)};
}

function components(items) {
  const groups = [];
  for (const item of items) {
    const group = {items:[item], stock:new Set(item.stock)};
    for (let i = groups.length - 1; i >= 0; i--) {
      if (![...item.stock].some(name => groups[i].stock.has(name))) continue;
      const other = groups.splice(i, 1)[0];
      group.items.push(...other.items);
      for (const name of other.stock) group.stock.add(name);
    }
    groups.push(group);
  }
  return groups;
}

function purchaseCost(node, qty, alreadyUsed) {
  if (!qty) return 0;
  if (!node.levels) return usesPurchaseTotal(node, qty) ? copper(node.totalPrice) : qty * node.unitPrice;
  let left = qty;
  let cost = 0;
  for (const level of node.levels) {
    const skip = Math.min(alreadyUsed, level.qty);
    alreadyUsed -= skip;
    const take = Math.min(left, level.qty - skip);
    cost += take * level.price;
    left -= take;
    if (!left) return cost;
  }
  return NaN;
}

function cheapest(component, runs, budget) {
  let best = null;
  const used = new Map();
  const purchases = [];
  const crafts = [];
  function visit(tasks, cost) {
    if (!Number.isSafeInteger(cost) || (best && cost >= best.cost)) return;
    if (!tasks.length) {
      best = {cost, purchases:[...purchases], crafts:[...crafts].reverse()};
      return;
    }
    const [{node, needed}, ...rest] = tasks;
    const max = node.children.length && positive(node.yield) ? Math.ceil(needed / Number(node.yield)) : 0;
    if (!positive(node.qty) || !positive(needed) || !node.key || !Number.isSafeInteger(max)) return;
    if (node.mode === 'craft' && node.children.length && !max) return;
    const first = node.mode === 'craft' ? max : 0;
    const last = node.mode === 'buy' ? 0 : max;
    const step = node.linear ? Math.max(1,max) : 1;
    for (let make = first; make <= last; make += step) {
      if (--budget.left < 0) throw Error('This recipe has too many sourcing combinations. Reduce the maximum crafts or set a reagent to Buy or Craft.');
      const produced = make ? make * Number(node.yield) : 0;
      if (!Number.isSafeInteger(produced)) continue;
      const buy = Math.max(0,needed - produced);
      const prior = used.get(node.key) || 0;
      const spend = purchaseCost(node,buy,prior);
      if (!Number.isSafeInteger(spend)) continue;
      if (buy) {
        used.set(node.key,prior + buy);
        purchases.push({name:node.name,units:buy,cost:spend});
      }
      const parts = make ? node.children.map(child => ({node:child, needed:make * Number(child.qty)})) : [];
      if (make) crafts.push({name:node.name, runs:make, produced, needed:needed-buy,
        materials:parts.map(p => ({name:p.node.name,units:p.needed}))});
      visit([...parts,...rest],cost+spend);
      if (make) crafts.pop();
      if (buy) { purchases.pop(); used.set(node.key,prior); }
    }
  }
  visit(component.items.map(node => ({node,needed:runs * Number(node.qty)})),0);
  return best;
}

self.onmessage = ({data}) => {
  try {
    const {shuffle, limit, tierEntries} = data;
    const tiers = new Map(tierEntries);
    const groups = components(shuffle.ingredients.map(node => prepare(node,tiers)));
    const budget = {left:3500000};
    const rows = [];
    for (let runs=1; runs<=limit; runs++) {
      const parts = groups.map(group => cheapest(group,runs,budget));
      if (!parts.length || parts.some(p => !p)) { rows.push(null); continue; }
      const route = {cost:parts.reduce((sum,p) => sum+p.cost,0), purchases:parts.flatMap(p => p.purchases), crafts:parts.flatMap(p => p.crafts)};
      rows.push(summarize({...shuffle,batch:String(runs)},undefined,route));
    }
    self.postMessage({rows});
  } catch (error) { self.postMessage({error:error.message}); }
};
