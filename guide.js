(() => {
  const toggle = $('coin-icons');
  toggle.checked = state.coinIcons !== false;
  document.documentElement.classList.toggle('use-coins', toggle.checked);
  toggle.onchange = () => {
    document.documentElement.classList.toggle('use-coins', toggle.checked);
    state.coinIcons = toggle.checked;
    save();
  };

  const dialog = $('guide-dialog');
  const invite = $('guide-invite');
  invite.hidden = !state.showGuideInvite;
  let draft, step, kept;
  const titles = ['Set up your batch', 'Price a craftable reagent', 'Read your results'];
  const input = (key, label, value, type = 'text') =>
    `<label>${label}<input name="${key}" type="${type}" required ${type === 'number' ? 'min="1" step="1"' : ''} value="${escapeHtml(value)}"></label>`;

  function dismissInvite() {
    invite.hidden = true;
    state.showGuideInvite = false;
    save();
  }
  function start() {
    draft = example();
    draft.name = 'Practice · Woolen Reagent Bag';
    draft.ingredients[0].children[0].price = '1s';
    step = 0;
    kept = false;
    draw();
    dialog.showModal();
    $('guide-title').focus();
  }

  function showComparison() {
    const bolt = draft.ingredients[0];
    const buy = plan([bolt],Number(draft.batch),{id:bolt.id,mode:'buy'});
    const craft = plan([bolt],Number(draft.batch),{id:bolt.id,mode:'craft'});
    const preview = $('guide-comparison');
    if (!buy || !craft) {
      preview.textContent = 'Enter both unit prices to compare.';
      return;
    }
    const quantity = Number(draft.batch) * Number(bolt.qty);
    const savings = buy.cost - craft.cost;
    preview.innerHTML = `<strong>${savings === 0 ? 'Either source costs the same' : savings > 0 ? 'Craft the bolts' : 'Buy the bolts'}</strong>
      <p>For ${quantity} bolts, buying costs ${displayMoney(buy.cost)} and crafting costs ${displayMoney(craft.cost)}.</p>`;
  }
  function draw() {
    $('guide-step').textContent = `Quick start · ${step+1} of ${titles.length}`;
    $('guide-title').textContent = titles[step];
    $('guide-error').textContent = '';
    $('guide-back').hidden = step === 0;
    $('guide-next').textContent = step === 2 ? 'Save shuffle & show results' : 'Next';
    const content = $('guide-content');
    if (step === 0) {
      content.innerHTML = `<p>Make a batch of Woolen Reagent Bags. These sample prices are yours to change. The sale price is for one bag and the batch size is the number of crafts.</p>
        <div class="tool-fields">${input('name','Shuffle name',draft.name)}${input('sale','Sale price per bag',draft.sale)}${input('batch','Crafts in batch',draft.batch,'number')}</div>
        <p class="hint">Type prices like 1g50s or 75s. The sample uses a 5% auction house cut.</p>`;
    } else if (step === 1) {
      const bolt = draft.ingredients[0];
      content.innerHTML = `<p>Each bag takes 3 bolts, 1 Fine Thread and 1 Cerulean Dye. In the recipe editor, <b>Add crafting recipe</b> lets you enter the materials for a reagent.</p>
        <p class="guide-formula">3 Wool Cloth → 1 Bolt of Woolen Cloth</p>
        <div class="tool-fields">${input('bolt','Buy price per bolt',bolt.price)}${input('cloth','Buy price per cloth',bolt.children[0].price)}</div>
        <div id="guide-comparison" class="guide-preview" aria-live="polite"></div>
        <p class="hint">Try raising the cloth price to 2s. With <b>Cheapest available</b> selected, the shopping list follows the cheaper source.</p>`;
      showComparison();
    } else {
      const estimate = summarize(draft);
      const buys = groupPurchases(estimate.purchases);
      content.innerHTML = `<p><b>Show results</b> gives you the shopping list for all ${Number(draft.batch)} crafts. The estimate assumes every bag sells at your entered price.</p>
        <div class="guide-preview"><div class="metric"><span>Estimated batch profit</span><strong>${displayMoney(estimate.profit)}</strong></div></div>
        <table><thead><tr><th>Buy for this batch</th><th>Quantity</th></tr></thead><tbody>${buys.map(row=>`<tr><th>${escapeHtml(row.name)}</th><td>${row.units.toLocaleString()}</td></tr>`).join('')}</tbody></table>
        <details class="guide-reference"><summary>What do the other buttons do?</summary>
        <ul><li><b>New setup</b> starts a profit shuffle or a buy-or-craft comparison. <b>Organize setups</b> changes categories and dropdown order. <b>Duplicate</b> lets you try another batch size or sale price.</li>
        <li><b>Edit inputs</b> opens the settings and recipe. <b>Edit reagents</b> takes you directly to the materials.</li>
        <li><b>Market snapshot</b> lets you choose a US ruleset and faction for each setup, then preview and apply prices. <b>Import AH prices</b> accepts Auctionator’s exported shopping results.</li>
        <li><b>Batch planner</b> tests quantities and price tiers. <b>Compare shuffles</b> ranks saved batches. <b>Sales ledger</b> records actual sales.</li></ul></details>`;
    }
  }
  $('guide-content').oninput = event => {
    const {name, value} = event.target;
    if (step === 0 && ['name','sale','batch'].includes(name)) draft[name] = value;
    if (step === 1 && ['bolt','cloth'].includes(name)) {
      const bolt = draft.ingredients[0];
      (name === 'bolt' ? bolt : bolt.children[0]).price = value;
      showComparison();
    }
    $('guide-error').textContent = '';
  };
  $('guide-form').onsubmit = event => {
    event.preventDefault();
    const bolt = draft.ingredients[0];
    if (step === 0 && (!draft.name.trim() || !positive(draft.batch) || !Number.isSafeInteger(copper(draft.sale)))) {
      $('guide-error').textContent = 'Enter a shuffle name, whole batch size and valid sale price.';
      return;
    }
    if (step === 1 && ![bolt.price,bolt.children[0].price].every(p=>Number.isSafeInteger(copper(p)))) {
      $('guide-error').textContent = 'Enter a valid price for both the bolt and the cloth.';
      return;
    }
    if (step > 0 && !summarize(draft)) {
      $('guide-error').textContent = 'This batch cannot be priced. Check the quantities and prices.';
      return;
    }
    if (step < 2) {step++; draw(); $('guide-title').focus(); return;}
    draft.collapsed = {setup:true, recipe:true};
    append(draft);
    kept = true;
    dialog.close();
  };
  $('guide-back').onclick = () => {step--; draw(); $('guide-title').focus();};
  $('guide-skip').onclick = () => dialog.close();
  dialog.onclose = () => {
    dismissInvite();
    draft = null;
    (kept ? $('view') : $('guide-open')).focus();
  };
  $('guide-dismiss').onclick = () => {dismissInvite(); $('guide-open').focus();};
  $('guide-start').onclick = start;
  $('guide-open').onclick = start;
})();
