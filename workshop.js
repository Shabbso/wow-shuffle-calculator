(() => {
  const dialog = $('work-dialog');
  const body = $('work-body');
  const number = value => Number.isFinite(value) ? value.toLocaleString(undefined,{maximumFractionDigits:1}) : '—';
  const stamp = value => value ? new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
  let worker;
  let feed;
  let plans;
  let selectedRuns;
  const stopWorker = () => {worker?.terminate(); worker = null;};
  function stopFeed() {feed?.abort(); feed = null;}
  dialog.onclose = () => {stopWorker(); stopFeed(); plans = null;};
  $('work-close').onclick = () => dialog.close();
  for (const button of document.querySelectorAll('[data-tool]')) {
    button.onclick = () => {
      $('work-title').textContent = button.textContent;
      dialog.showModal();
      ({planner,compare,ledger,organize})[button.dataset.tool]();
    };
  }

  function organize() {
    body.innerHTML = '<p class="hint">Change a setup’s category or move it up or down in the saved dropdown. A shuffle’s sale price supplies its initial ready-made buy price. Changes save immediately.</p>';
    for (const [kind,label] of setupGroups) {
      const members = groupMembers(kind);
      if (!members.length) continue;
      const section = document.createElement('div');
      section.className = 'setup-group';
      section.innerHTML = `<h3>${label}</h3>`;
      members.forEach((s,index) => {
        const name = s.name || 'Untitled setup';
        const row = document.createElement('div');
        row.className = 'organize-row';
        row.dataset.setupId = s.id;
        row.innerHTML = `<strong>${escapeHtml(name)}</strong>
          <select aria-label="Category for ${escapeHtml(name)}"><option value="shuffle">Profit shuffle</option><option value="acquisition">Buy or craft</option></select>
          <div class="order-controls"><button data-step="-1" ${index===0?'disabled':''} aria-label="Move ${escapeHtml(name)} up">↑ Up</button>
          <button data-step="1" ${index===members.length-1?'disabled':''} aria-label="Move ${escapeHtml(name)} down">↓ Down</button></div>`;
        const select = row.querySelector('select');
        select.value = kind;
        function refresh(focusSelector) {
          save();
          render();
          organize();
          const moved = body.querySelector(`[data-setup-id="${CSS.escape(s.id)}"]`);
          (moved.querySelector(focusSelector) || moved.querySelector('select')).focus();
        }
        select.onchange = () => {setKind(s, select.value); refresh('select');};
        for (const button of row.querySelectorAll('[data-step]')) {
          button.onclick = () => {
            const other = members[index + Number(button.dataset.step)];
            if (!other) return;
            const a = state.shuffles.indexOf(s), b = state.shuffles.indexOf(other);
            [state.shuffles[a],state.shuffles[b]] = [state.shuffles[b],state.shuffles[a]];
            refresh(`[data-step="${button.dataset.step}"]:enabled`);
          };
        }
        section.append(row);
      });
      body.append(section);
    }
  }

  function compare() {
    const rows = groupMembers('shuffle').map(s => ({s,r:summarize(s)}));
    if (!rows.length) {
      body.innerHTML = '<p class="hint">Save a profit shuffle to compare its sale profit here.</p>';
      return;
    }
    rows.sort((a,b) => (b.r ? b.r.profit/b.r.units : -Infinity) - (a.r ? a.r.profit/a.r.units : -Infinity));
    body.innerHTML = `<p class="hint">Saved batches ranked by profit per finished item. Market activity comes from the last finished-item snapshot.</p>
      <div class="scroll-table"><table><thead><tr><th>Shuffle</th><th>Units</th><th>Profit each</th><th>Batch profit</th><th>Materials upfront</th><th>Est. sold/day</th><th>Market scan</th></tr></thead>
      <tbody>${rows.map(({s,r}) => {
        const market=outputMarket(s);
        return `<tr><th><button class="text-button" data-shuffle="${s.id}">${escapeHtml(s.name || 'Untitled shuffle')}</button></th>
          <td>${number(Number(s.batch)*Number(s.yield))}</td><td>${displayMoney(r && Math.floor(r.profit/r.units))}</td><td>${displayMoney(r?.profit)}</td>
          <td>${displayMoney(r?.cost)}</td><td>${number(market?.daily)}</td><td>${stamp(market?.at)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    body.querySelectorAll('[data-shuffle]').forEach(b=>b.onclick=()=>{
      state.active=b.dataset.shuffle;active().collapsed={setup:true,recipe:true};save();render();dialog.close();
    });
  }

  function planner() {
    const s = active();
    const itemLabels = new Map([...nodes(s.ingredients)].map(({node}) => [node.name.trim().toLowerCase(), node.name.trim()]));
    const names = [...itemLabels.keys()].filter(Boolean);
    s.planner ??= {levels:{},limit:String(Math.min(250,Math.max(20,Number(s.batch)||20)))};
    const settings = s.planner;
    body.innerHTML = `<p>${escapeHtml(s.name || 'Untitled shuffle')}</p>
      <p class="hint">Compare whole batches using your sale price and source choices. The planner can split a reagent between buying and crafting. Entered tiers supply only their listed quantities and replace that item's unit price and purchase total in this planner.</p>
      <div class="tool-fields"><label>Test up to (crafts, 1–250)<input id="plan-limit" type="number" min="1" max="250" value="${escapeHtml(settings.limit)}"></label></div>
      <details id="tier-editor"><summary>Available quantities and prices</summary>
        <div class="tool-fields"><label>Reagent<select id="tier-item">${names.map((name,i)=>`<option value="${i}">${escapeHtml(itemLabels.get(name))}</option>`).join('')}</select></label>
        <button id="tier-load" type="button">Load AH tiers</button></div>
        <p class="hint">US Normal Horde snapshots come from <a href="https://forever-ah.com/api/" target="_blank" rel="noopener">Forever AH and Blizzard</a>. The planner prices individual units at each tier. Check stack sizes before buying.</p>
        <div id="tier-rows"></div><button id="tier-add">Add price tier</button><p class="hint" id="tier-source"></p></details>
      <button class="primary" id="plan-run">Compare batch sizes</button>
      <p id="plan-message" role="status"></p><div id="plan-results"></div>`;
    const itemName=()=>names[Number($('tier-item').value)];
    const levelsKey=()=> 'item:' + itemName();
    const levels=()=>settings.levels[levelsKey()] ??= {tiers:[]};
    function invalidate() {
      stopWorker();plans=null;$('plan-results').innerHTML='';$('plan-message').textContent='';save();
    }
    function drawLevels() {
      const group=levels();
      $('tier-rows').innerHTML=group.tiers.map((t,i)=>`<div class="tier-line">
        <label>Available units<input type="number" min="1" data-col="qty" data-row="${i}" value="${escapeHtml(t.qty)}"></label>
        <label>Unit price<input data-col="price" data-row="${i}" value="${escapeHtml(t.price)}"></label>
        <button data-drop="${i}">Remove</button></div>`).join('');
      $('tier-source').textContent=group.at ? 'US Normal Horde · '+stamp(group.at)+' · Available tiers from the returned listings.' : 'Without tiers, this item uses its recipe prices.';
      $('tier-load').disabled=!names.length;
      $('tier-add').disabled=!names.length;
    }
    $('tier-item').onchange=()=>{stopFeed();drawLevels();};
    $('tier-rows').oninput=e=>{
      const {row,col}=e.target.dataset;
      if (!col) return;
      stopFeed();$('tier-load').disabled=false;
      levels().tiers[row][col]=e.target.value;delete levels().at;$('tier-source').textContent='Manually entered tiers.';invalidate();
    };
    $('tier-rows').onclick=e=>{
      if(e.target.dataset.drop===undefined)return;
      stopFeed();levels().tiers.splice(Number(e.target.dataset.drop),1);delete levels().at;invalidate();drawLevels();
    };
    $('tier-add').onclick=()=>{stopFeed();levels().tiers.push({qty:'',price:''});delete levels().at;invalidate();drawLevels();$('tier-rows').lastElementChild.querySelector('input').focus();};
    $('tier-load').onclick=async()=>{
      stopFeed();const controller=new AbortController();feed=controller;
      const name=itemName();$('tier-load').disabled=true;$('tier-source').textContent='Checking US Normal Horde…';
      try {
        const group=await window.loadMarketTiers(name,controller.signal);
        if(controller.signal.aborted)return;
        settings.levels[levelsKey()]=group;invalidate();drawLevels();
      } catch(error){if(!controller.signal.aborted)$('tier-source').textContent=error.message;}
      finally{if(!controller.signal.aborted)$('tier-load').disabled=false;}
    };
    $('plan-limit').oninput=e=>{settings.limit=e.target.value;invalidate();};
    $('plan-run').onclick=()=>{
      invalidate();
      const limit=Number(settings.limit);
      if(!positive(limit)||limit>250){$('plan-message').textContent='Choose a number of crafts from 1 to 250.';return;}
      const tierEntries=[];
      for(const name of names) {
        const entries=settings.levels['item:'+name]?.tiers;
        if(!entries?.length)continue;
        const tiers=entries.map(t=>({qty:Number(t.qty),price:copper(t.price)}));
        if(tiers.some(t=>!positive(t.qty)||!Number.isSafeInteger(t.price))){$('plan-message').textContent='Complete the price tiers for '+name+'.';return;}
        tierEntries.push([name,tiers.sort((a,b)=>a.price-b.price)]);
      }
      try { worker=new Worker('planner-worker.js'); }
      catch { $('plan-message').textContent='Open the hosted web app to run the batch planner.';return; }
      $('plan-message').textContent='Comparing available quantities and sourcing options…';
      worker.onerror=()=>{stopWorker();$('plan-message').textContent='The planner could not run. Refresh the web app and retry.';};
      worker.onmessage=({data})=>{
        stopWorker();
        if(data.error){$('plan-message').textContent=data.error;return;}
        plans=data.rows;
        const available=plans.map((r,i)=>r ? {runs:i+1,r} : null).filter(Boolean);
        if(!available.length){$('plan-message').textContent='No batch can be priced. Check the recipe, prices, quantities available and sale settings.';return;}
        const best=available.reduce((a,b)=>b.r.profit>a.r.profit?b:a);
        const marginal=available.find(({r,runs})=> {
          const previous=runs===1 ? 0 : plans[runs-2]?.profit;
          return previous!==undefined && r.profit-previous < copper(s.target)*Number(s.yield);
        });
        $('plan-message').innerHTML=(best.r.profit>0 ? `Highest total profit: ${displayMoney(best.r.profit)} at ${best.runs} crafts.` : 'No tested batch earns a positive profit.')+
          (marginal ? ` Craft #${marginal.runs} is the first additional craft below your per-sale target.` : '')+
          (available.length<limit ? ` ${limit-available.length} batch sizes could not be supplied or priced.` : '');
        const checkpoints=[...new Set([1,5,10,20,Number(s.batch),best.runs,limit])].filter(n=>positive(n)&&n<=limit).sort((a,b)=>a-b);
        $('plan-results').innerHTML=`<table><thead><tr><th>Crafts</th><th>Material cost</th><th>Batch profit</th></tr></thead><tbody>
          ${checkpoints.map(n=>`<tr><th>${n}</th><td>${displayMoney(plans[n-1]?.cost)}</td><td>${displayMoney(plans[n-1]?.profit)}</td></tr>`).join('')}</tbody></table>
          <label>Inspect a batch<select id="plan-size">${available.map(x=>`<option value="${x.runs}" ${x===best?'selected':''}>${x.runs} crafts · ${money(x.r.profit)} profit</option>`).join('')}</select></label>
          <div id="plan-shopping"></div><button id="plan-record">Record this batch in sales ledger</button>`;
        function inspect(){selectedRuns=Number($('plan-size').value);$('plan-shopping').innerHTML=shoppingList({...s,batch:String(selectedRuns)},plans[selectedRuns-1],true);}
        $('plan-size').onchange=inspect;inspect();
        $('plan-record').onclick=()=>{const estimate=plans[selectedRuns-1];$('work-title').textContent='Sales ledger';stopFeed();ledger(estimate);};
      };
      worker.postMessage({shuffle:s,limit,tierEntries});
    };
    drawLevels();
  }

  function ledger(seed) {
    const s = active();
    const acquisition = isAcquisition(s) ? acquisitionComparison(s) : null;
    const estimate = seed || (acquisition ? acquisition.craft && {units:acquisition.units,cost:acquisition.craft.cost,expenses:0} : summarize(s));
    const batches = state.salesBatches ??= [];
    const today = new Date();
    const date = new Date(today - today.getTimezoneOffset()*60000).toISOString().slice(0,10);
    body.innerHTML = `<p class="hint">Track actual sales in this browser. Each batch keeps the costs and AH cut you record here.</p>
      <details id="ledger-new" ${seed || !batches.length ? 'open' : ''}><summary>Record a crafted batch</summary>
      <form id="batch-form" class="ledger-form"><strong>${escapeHtml(s.output || s.name)}</strong>
      <div class="tool-fields"><label>Date crafted<input type="date" name="date" required value="${date}"></label>
      <label>Units crafted<input type="number" name="units" min="1" required value="${estimate?.units || (positive(s.batch) && positive(s.yield) ? Number(s.batch)*Number(s.yield) : '')}"></label>
      <label>Total batch cost<input name="cost" required placeholder="Gold, silver, copper" value="${estimate ? money(estimate.cost+estimate.expenses) : ''}"></label>
      <label>AH cut (%)<input name="fee" type="number" step="any" min="0" max="100" required value="${escapeHtml(s.fee)}"></label></div>
      <p class="hint">The suggested cost includes materials and other batch costs. Enter what you actually paid.</p>
      <button class="primary">Save batch</button><p role="status"></p></form></details>
      <div id="batch-history"></div>`;
    function drawHistory(openId) {
      $('batch-history').innerHTML = batches.length ? [...batches].reverse().map(b => {
        const sold = b.sales.reduce((sum,x)=>sum+x.units,0);
        const remaining = b.units-sold;
        const net = b.sales.reduce((sum,x)=>sum+(x.price-Math.round(x.price*b.fee/100))*x.units-x.deposit,0);
        const allocatedCost = Number(BigInt(b.cost) * BigInt(sold) / BigInt(b.units));
        const profit = net - allocatedCost;
        return `<details class="batch-log" ${b.id===openId?'open':''}><summary>${escapeHtml(b.output)} <small>${escapeHtml(b.date)} · ${sold}/${b.units} sold · ${displayMoney(profit)} realized</small></summary>
          <div class="ledger-form"><p>${remaining} left to sell · Batch cost <b>${displayMoney(b.cost)}</b> · AH cut ${b.fee}%</p>
          <p class="hint">Realized profit includes the cost of units sold and all lost deposits entered so far.</p>
          ${b.sales.length ? `<table><thead><tr><th>Date</th><th>Sold</th><th>Price each</th><th>Lost deposit</th></tr></thead><tbody>${b.sales.map(x=>`<tr><th>${escapeHtml(x.date)}</th><td>${x.units}</td><td>${x.units?displayMoney(x.price):'—'}</td><td>${displayMoney(x.deposit)}</td></tr>`).join('')}</tbody></table>` : ''}
          <form data-batch="${b.id}"><div class="tool-fields"><label>Date<input name="date" type="date" required min="${escapeHtml(b.date)}" value="${date}"></label>
          <label>Units sold<input name="units" type="number" required min="0" max="${remaining}" value="${remaining?1:0}"></label>
          <label>Sale price each<input name="price" placeholder="e.g. 1g39s"></label><label>Lost deposits (total)<input name="deposit" value="0c" required></label></div>
          <button>Log sale or deposit</button><p role="status"></p></form><div class="ledger-actions">
          ${b.sales.length ? `<button data-undo="${b.id}">Undo last entry</button>` : ''}
          <button data-delete="${b.id}">Delete batch</button></div></div></details>`;
      }).join('') : '<p class="hint">Your recorded batches will appear here.</p>';
    }
    $('batch-form').onsubmit = event => {
      event.preventDefault();
      const form = event.target, data = new FormData(form);
      const cost = copper(data.get('cost')), units = Number(data.get('units'));
      if (!positive(units) || !Number.isSafeInteger(cost)) {form.querySelector('[role=status]').textContent='Enter a whole quantity and a valid total cost.';return;}
      const batch = {id:crypto.randomUUID(), output:s.output||s.name||'Finished item', date:data.get('date'),units,cost,fee:Number(data.get('fee')),sales:[]};
      batches.push(batch);save();$('ledger-new').open=false;drawHistory(batch.id);
    };
    $('batch-history').onsubmit = event => {
      event.preventDefault();
      const form = event.target, data = new FormData(form);
      const b = batches.find(b=>b.id===form.dataset.batch);
      const units=Number(data.get('units')), price=units ? copper(data.get('price')) : 0, deposit=copper(data.get('deposit'));
      const remaining=b.units-b.sales.reduce((sum,x)=>sum+x.units,0);
      if (!Number.isSafeInteger(units) || units<0 || units>remaining || !Number.isSafeInteger(price*units) || !Number.isSafeInteger(deposit) || (!units && !deposit)) {
        form.querySelector('[role=status]').textContent='Enter the quantity sold and a sale price, or enter zero units and a lost deposit.';
        return;
      }
      b.sales.push({date:data.get('date'),units,price,deposit});save();drawHistory(b.id);
    };
    $('batch-history').onclick = event => {
      const {undo,delete:id} = event.target.dataset;
      if (!(undo || id)) return;
      const index=batches.findIndex(b=>b.id===(undo||id));
      if (undo && confirm('Undo the last entry for this batch?')) batches[index].sales.pop();
      else if (id && confirm('Delete this batch and its recorded sales?')) batches.splice(index,1);
      else return;
      save();drawHistory(undo);
    };
    drawHistory();
  }
})();
