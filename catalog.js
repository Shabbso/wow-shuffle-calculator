// Item identity is separate from the editor's UUID for a particular recipe row.
const itemCatalog = new Map();
const catalogNames = new Map();
const catalogRecipes = new Map();
const normalizeItem = name => name.trim().toLowerCase();
function indexItem(entry) {
  if (typeof entry.name !== 'string' || !entry.name.trim() || itemCatalog.has(entry.id)) return;
  const name = normalizeItem(entry.name);
  itemCatalog.set(entry.id,{...entry,key:name,words:name.split(/[^a-z0-9]+/).filter(Boolean)});
  if (!catalogNames.has(name)) catalogNames.set(name,[]);
  catalogNames.get(name).push(entry.id);
}
function indexRecipe(recipe) {
  const list = catalogRecipes.get(recipe.output) || [];
  if (!list.some(r => r.id === recipe.id)) list.push(recipe);
  catalogRecipes.set(recipe.output,list);
}
if (typeof foreverCatalog !== 'undefined') {
  foreverCatalog.items.forEach(indexItem);
  foreverCatalog.recipes.forEach(indexRecipe);
}
function knownItemId(name, id) {
  if (Number.isSafeInteger(id) && id > 0) return id;
  const matches = catalogNames.get(normalizeItem(name));
  return matches?.length === 1 ? matches[0] : null;
}
function itemLink(name,id) {
  id = knownItemId(name,id);
  if (!id) return escapeHtml(name);
  const quality = itemCatalog.get(id)?.quality;
  const tone = ['UNCOMMON','RARE','EPIC','LEGENDARY'].includes(quality) ? ' ' + quality.toLowerCase() : '';
  return `<a class="game-item${tone}" href="https://www.wowhead.com/forever/item=${id}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
}
function recipeButtonLabel(name,id) {
  const recipes = catalogRecipes.get(knownItemId(name,id));
  return recipes?.length === 1 ? `Use ${escapeHtml(recipes[0].profession)} recipe` : 'Find recipe';
}

// Accept a single substitution, insertion, deletion or adjacent transposition.
function similarWord(a,b) {
  if (a.length < 3 || Math.abs(a.length-b.length)>1) return false;
  let i=0;
  while (i<a.length && a[i]===b[i]) i++;
  if (a.length!==b.length) return a.length>b.length ? a.slice(i+1)===b.slice(i) : a.slice(i)===b.slice(i+1);
  return a.slice(i+1)===b.slice(i+1) ||
    (a[i]===b[i+1] && a[i+1]===b[i] && a.slice(i+2)===b.slice(i+2));
}
function itemSuggestions(query) {
  const key = normalizeItem(query);
  const words = key.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const entry of itemCatalog.values()) {
    let cost=0;
    for (const word of words) {
      if (entry.words.includes(word)) continue;
      if (entry.words.some(w=>w.startsWith(word))) cost+=1;
      else if (entry.words.some(w=>similarWord(word,w))) cost+=4;
      else {cost=Infinity;break;}
    }
    if (Number.isFinite(cost)) hits.push({entry,score:entry.key===key ? -100 : cost*8 + Math.abs(entry.words.length-words.length) + (entry.key.startsWith(key)?0:2)});
  }
  hits.sort((a,b)=>a.score-b.score || a.entry.name.length-b.entry.name.length || a.entry.id-b.entry.id);
  return hits.slice(0,7).map(x=>x.entry);
}

document.addEventListener('DOMContentLoaded', () => {
  const list = $('item-suggestions'), dialog = $('recipe-dialog');
  const queryCache = new Set(), icons = new Map();
  let session, recipeController, timer;

  function closeList() {
    clearTimeout(timer);
    if (session) {
      session.controller.abort();
      session.input.setAttribute('aria-expanded','false');
      session.input.removeAttribute('aria-activedescendant');
    }
    session=null;list.hidden=true;list.replaceChildren();
  }
  function positionList() {
    if (!session || !session.input.isConnected) {closeList();return;}
    const r=session.input.getBoundingClientRect();
    list.style.width = Math.min(Math.max(r.width,285),innerWidth-16)+'px';
    list.style.left = Math.max(8,Math.min(r.left,innerWidth-list.offsetWidth-8))+'px';
    const above = innerHeight-r.bottom<160 && r.top>innerHeight-r.bottom;
    list.style.top = above ? 'auto' : r.bottom+'px';
    list.style.bottom = above ? (innerHeight-r.top)+'px' : 'auto';
    list.style.maxHeight = Math.min(275,Math.max(100,above?r.top-8:innerHeight-r.bottom-8))+'px';
  }
  function show(s, message) {
    s.items=itemSuggestions(s.query);
    s.selected=-1;s.input.removeAttribute('aria-activedescendant');
    list.innerHTML=s.items.map((v,i)=>{
      const professions=[...new Set((catalogRecipes.get(v.id)||[]).map(r=>r.profession))];
      const kind=professions.length ? professions.join(' / ')+' · Crafted item' : v.name.startsWith('Pattern:') ? 'Pattern · '+v.category : v.category;
      return `<div role="option" aria-selected="false" id="suggestion-${i}" data-choice="${i}"><span class="suggestion-icon">${icons.has(v.id)?`<img src="${icons.get(v.id)}" alt="">`:''}</span><span><strong>${escapeHtml(v.name)}</strong><small>${escapeHtml(kind)} · #${v.id}</small></span></div>`;
    }).join('') || `<p role="status">${escapeHtml(message || 'Searching Forever items…')}</p>`;
    list.hidden=false;s.input.setAttribute('aria-expanded','true');positionList();
  }
  async function loadMore(s) {
    const signal=s.controller.signal;
    try {
      if (!queryCache.has(s.query) && !catalogNames.has(s.query)) {
        const data=await (await window.catalogFetch('/items/search?q='+encodeURIComponent(s.query),signal)).json();
        if (signal.aborted || !s.input.isConnected) return;
        for (const raw of data) if (positive(raw.item_id) && typeof raw.name==='string') {
          indexItem({id:raw.item_id,name:raw.name,category:raw.item_subclass||raw.item_class||'Item',quality:raw.quality});
        }
        queryCache.add(s.query);
        if(s.selected===-1) show(s,'No match. You can keep the name you typed.');
      } else if (!s.items.length) show(s,'No match. You can keep the name you typed.');
      for (const [i,v] of s.items.entries()) {
        if (signal.aborted || !s.input.isConnected) return;
        if (icons.has(v.id)) continue;
        const blob=await (await window.catalogFetch('/items/'+v.id+'/icon',signal)).blob();
        if (signal.aborted) return;
        const url=URL.createObjectURL(blob);
        if (icons.size>=100) {const first=icons.keys().next().value;URL.revokeObjectURL(icons.get(first));icons.delete(first);}
        icons.set(v.id,url);
        const img=new Image();img.alt='';img.src=url;
        list.querySelector(`[data-choice="${i}"] .suggestion-icon`)?.replaceChildren(img);
      }
    } catch {
      if (!signal.aborted && !s.items.length) show(s,'Online lookup unavailable. You can enter the item manually.');
    }
  }
  function suggest(input) {
    closeList();
    const query=normalizeItem(input.value);
    if(query.length<2) return;
    const s=session={input,query,controller:new AbortController()};
    show(s);
    timer=setTimeout(()=>loadMore(s),450);
  }
  function owner(id) {
    return id ? [...nodes(active().ingredients)].find(e=>e.node.id===id)?.node : active();
  }
  function choose(index) {
    if (!session) return;
    const {input,items}=session, chosen=items[index];closeList();
    if(!chosen || !input.isConnected) return;
    const {field,id}=input.dataset, target=owner(id);
    if (!target) return;
    if (target.itemId!==chosen.id) delete target.catalogRecipeId;
    target.itemId=chosen.id;target[field]=chosen.name;
    save();render();
    document.querySelector(`input[data-field="${field}"][data-id="${id}"]`)?.focus();
  }
  document.addEventListener('input',e=>{if(e.target.matches('input[role=combobox]')) suggest(e.target);});
  document.addEventListener('focusout',e=>{if(e.target===session?.input) closeList();});
  document.addEventListener('keydown',e=>{
    if (!e.target.matches('input[role=combobox]')) return;
    if (!session && e.key==='ArrowDown') suggest(e.target);
    if (!session || session.input!==e.target) return;
    if (e.key==='Escape') {e.preventDefault();closeList();return;}
    if (e.key==='Enter' && session.selected>=0) {e.preventDefault();choose(session.selected);return;}
    if (!['ArrowDown','ArrowUp'].includes(e.key) || !session.items.length) return;
    e.preventDefault();
    session.selected=Math.max(0,Math.min(session.items.length-1,session.selected+(e.key==='ArrowDown'?1:-1)));
    list.querySelectorAll('[role=option]').forEach((el,i)=>el.setAttribute('aria-selected',String(i===session.selected)));
    const selected=list.children[session.selected];
    session.input.setAttribute('aria-activedescendant',selected.id);selected.scrollIntoView({block:'nearest'});
  });
  list.addEventListener('mousedown',e=>e.preventDefault());
  list.onclick=e=>{const choice=e.target.closest('[data-choice]');if(choice) choose(Number(choice.dataset.choice));};
  window.addEventListener('resize',()=>{if(session) positionList();});
  window.addEventListener('scroll',e=>{if(session && !list.contains(e.target instanceof Node?e.target:null)) positionList();},true);

  async function openRecipe(button) {
    closeList();
    const id=button.dataset.recipeFor, s=active(), target=owner(id);
    const name=id ? target.name : s.output;
    if(!name.trim()) {
      if(!id) $('setup').open=true;
      document.querySelector(`input[data-id="${id}"][data-field="${id?'name':'output'}"]`).focus();return;
    }
    const output=knownItemId(name,target.itemId);
    const controller=new AbortController();recipeController=controller;
    const body=$('lookup-body');
    $('lookup-title').textContent=name;
    body.textContent='Looking for a Forever recipe…';dialog.showModal();
    let choices=catalogRecipes.get(output) || [];
    if (!choices.length) {
      try {
        const data=await window.requestMarket('/crafting?q='+encodeURIComponent(name),controller.signal,pricingMarket(s));
        if(controller.signal.aborted) return;
        for(const r of data.rows) {
          if (!positive(r.item?.item_id) || !positive(r.recipe_id) || !r.reagents?.length ||
            !r.reagents.every(p=>positive(p.item_id)&&positive(p.quantity)&&typeof p.name==='string')) continue;
          if (output ? output!==r.item.item_id : normalizeItem(r.item.name)!==normalizeItem(name)) continue;
          for(const p of [r.item,...r.reagents]) indexItem({id:p.item_id,name:p.name,quality:p.quality,category:p.item_subclass||'Reagent'});
          indexRecipe({id:r.recipe_id,output:r.item.item_id,name:r.recipe_name,profession:r.profession,yieldCount:r.crafted_quantity,parts:r.reagents.map(p=>[p.item_id,p.quantity])});
        }
        choices=(output?[output]:catalogNames.get(normalizeItem(name))||[]).flatMap(key=>catalogRecipes.get(key)||[]);
      } catch {
        if (!controller.signal.aborted) body.textContent='Recipe lookup is unavailable. Close this preview to enter materials manually.';
        return;
      }
    }
    if (!choices.length) {body.textContent='No matching Forever recipe was found. You can enter its materials manually.';return;}
    const listKey=id?'children':'ingredients', existing=target[listKey];
    body.innerHTML=`<label>Profession and recipe<select id="lookup-choice">${choices.map((r,i)=>`<option value="${i}">${escapeHtml(r.profession)} · ${escapeHtml(r.name)} (#${r.id})</option>`).join('')}</select></label>
      ${existing.length?`<label class="recipe-replace"><input type="checkbox" id="lookup-replace"> Use catalog quantities and remove materials outside this recipe</label>`:''}
      <div id="lookup-preview"></div><button class="primary" id="lookup-apply">Apply recipe</button>`;
    function proposed() {
      const recipe=choices[Number($('lookup-choice').value)];
      const replace=$('lookup-replace')?.checked;
      const unused=[...existing];
      const children=recipe.parts.map(([itemId,qty])=>{
        const part=itemCatalog.get(itemId);
        const i=unused.findIndex(n=>n.itemId===itemId || (!n.itemId && normalizeItem(n.name)===part.key));
        const old=i<0 ? null : unused.splice(i,1)[0];
        return old ? {...old,itemId,qty:replace?String(qty):old.qty} : {...item(part.name,String(qty)),itemId};
      });
      if(!replace) children.push(...unused);
      const keepYield=!replace && (existing.length || Number(target.yield)!==1);
      return {recipe,children,yield:keepYield?target.yield:String(recipe.yieldCount)};
    }
    function preview() {
      const plan=proposed();
      const valid=positive(plan.recipe.yieldCount);
      $('lookup-apply').disabled=!valid;
      $('lookup-preview').innerHTML=`<p>Catalog yield: ${escapeHtml(plan.recipe.yieldCount)} · Yield after import: ${escapeHtml(plan.yield)}</p>
        <table><thead><tr><th>Material</th><th>Catalog</th><th>After import</th></tr></thead><tbody>${plan.children.map(n=>
          `<tr><th>${itemLink(n.name,n.itemId)}</th><td>${plan.recipe.parts.find(p=>p[0]===n.itemId)?.[1]??'—'}</td><td>${escapeHtml(n.qty)}</td></tr>`).join('')}</tbody></table>
        <p class="hint">${valid?'Matching materials keep their prices and nested recipes. Use Market snapshot to price new materials.':'This recipe has a variable or unknown yield. Enter a whole yield manually.'}</p>`;
    }
    $('lookup-choice').onchange=preview;
    if($('lookup-replace')) $('lookup-replace').onchange=preview;
    $('lookup-apply').onclick=()=>{
      const plan=proposed();if(!positive(plan.recipe.yieldCount) || active()!==s || owner(id)!==target) return;
      target.itemId=plan.recipe.output;target.catalogRecipeId=plan.recipe.id;
      target[id?'name':'output']=itemCatalog.get(plan.recipe.output).name;
      target[listKey]=plan.children;target.yield=plan.yield;
      if(id) target.folded=false;
      if(!id && s.name==='New setup') s.name=s.output;
      save();render();dialog.close();
      document.querySelector(`[data-recipe-for="${id}"]`)?.focus();
    };
    preview();
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-recipe-for]');if(b) openRecipe(b);});
  $('lookup-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>recipeController?.abort());
});
