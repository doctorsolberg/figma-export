import {setTimeout as sleep} from 'node:timers/promises';

const item = 'button,a,[role="button"],[role="link"],[tabindex="0"]';

export function card(label) {
  const i = label.indexOf(', folder icon color:');
  if (i > 0) return {kind: 'folder', title: label.slice(0, i), label};
  const m = /^(.+), (?:Design|FigJam|Slides|Published|Make|Buzz|Sites?|Spec|Prototype|Figma) file$/i.exec(label);
  return m && {kind: 'file', title: m[1], label};
}

export function cardIdentity(label) {
  const parsed = card(label);
  return parsed ? `${parsed.kind}:${parsed.kind === 'folder' ? parsed.title : label}` : null;
}

export function canonicalCards(rows) {
  const counts = new Map();
  return rows.flatMap(row => {
    if (!row.actionable) return [];
    const parsed = card(row.label);
    const key = cardIdentity(row.label) ?? `unknown:${row.label}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    return [{...row, ...(parsed ?? {kind:'unknown', title:row.label}), index}];
  });
}

export async function readInventory(page) {
  return page.evaluate(interactive => {
    const rows = [];
    const grids = [...document.querySelectorAll('[role="grid"], [role="listbox"], [role="table"]')]
      .filter(e => e.getClientRects().length && !e.closest('[aria-hidden="true"]'));
    const folderListing = /\/(all-folders|shared-projects)\/?$/.test(location.pathname);
    const folderLabel = ', folder icon color:';
    const folderCard = '[aria-label*="folder icon color:"]';
    const structuralCard = '[data-card-main-action="true"]';
    const completed = grids.length === 1 ? grids[0] : null;
    const number = completed?.getAttribute('aria-rowcount');
    // A row count is evidence only for a grid without headers or other non-card rows.
    const hasHeader = completed?.querySelector('[role="columnheader"], [role="rowheader"]');
    const expected = !hasHeader && number != null && /^\d+$/.test(number) ? Number(number) : null;
    const elements = document.querySelectorAll(`[aria-label],${structuralCard},a[href],[role="option"],[role="listitem"],[role="row"]`);
    for (const element of elements) {
      if (!element.getClientRects().length || element.closest('[aria-hidden="true"]')) continue;
      const label = element.getAttribute('aria-label') ?? '';
      const isFolder = label.includes(folderLabel);
      const itemLike = label.includes(', ') && / file$/i.test(label);
      const structural = element.matches(structuralCard) || (completed?.contains(element) &&
        (element.matches('a[href],[role="option"],[role="listitem"],[role="row"]') || element.matches('button[aria-label]')));
      if (!itemLike && !isFolder && !structural) continue;
      if (!isFolder && element.closest(folderCard)) continue;
      // Team/project summary views may include thumbnail previews. Report ambiguous cards instead of silently hiding them.
      const ambiguousPreview = folderListing && itemLike && !element.matches(structuralCard) && !element.closest('[role="row"]') && !completed?.contains(element);
      const actionable = element.matches(interactive);
      // A labelled wrapper duplicating one actionable card is not an extra row.
      const childCard = Array.from(element.querySelectorAll(`${structuralCard},[aria-label]`))
        .some(child => child.matches(interactive) && (child.getAttribute('aria-label') === label || child.matches(structuralCard) || child.getAttribute('aria-label')?.includes(folderLabel) || /, .+ file$/.test(child.getAttribute('aria-label') ?? '')));
      if (!actionable && childCard) continue;
      const row = element.closest('[aria-rowindex]');
      const position = row && completed?.contains(row) ? row.getAttribute('aria-rowindex') : null;
      rows.push({label:label || '(unlabelled card)', anchor:element.closest('a[href]')?.href ?? null, actionable:actionable&&!ambiguousPreview, position, inCountedGrid:completed?.contains(element)??false});
    }
    const scrollable = e => e.scrollHeight > e.clientHeight + 1 && /^(auto|scroll)$/.test(getComputedStyle(e).overflowY);
    const scrollContainers = completed ? [completed, ...completed.querySelectorAll('*')].filter(scrollable) : [];
    for(let e=completed?.parentElement;e;e=e.parentElement)if(scrollable(e))scrollContainers.push(e);
    if(completed && document.scrollingElement)scrollContainers.push(document.scrollingElement);
    const atEnd = !!completed && scrollContainers.every(e=>e.scrollHeight-e.clientHeight-e.scrollTop<=2);
    const busySelector='[aria-busy="true"], [role="progressbar"]';
    return {rows, expected, atEnd, busy:!!(completed?.closest('[aria-busy="true"]')||completed?.querySelector(busySelector))};
  }, item);
}

export async function waitForCards(read, {timeout = 20_000, interval = 500} = {}) {
  const deadline = Date.now() + timeout;
  do {
    const rows = await read();
    if (rows.length) return rows;
    await sleep(interval);
  } while (Date.now() < deadline);
  return [];
}

export async function findCard(page, label, index, position=null) {
  const parsed = card(label);
  const match = parsed?.kind === 'folder' ? `^=${JSON.stringify(parsed.title + ', folder icon color:')}` : `=${JSON.stringify(label)}`;
  const q=`[aria-label${match}]:is(${item}):visible`;
  if(position!==null){
    const row=`:is([aria-rowindex=${JSON.stringify(position)}],[aria-posinset=${JSON.stringify(position)}])`;
    const located=page.locator(`${row}${q},${row} ${q}`);
    return await located.count()===1?located.first():null;
  }
  const nodes = page.locator(q);
  return await nodes.count() > index ? nodes.nth(index) : null;
}

export async function collectInventory(read, advance, {interval = 650, stableMs = 5000, maxRounds = 150} = {}) {
  const found = new Map();
  let expected = null;
  let lastChange = Date.now();
  let completion = false;
  let countChanged = false;
  let positionChanged = false;
  let outsideGrid = false;
  let endSnapshot = null;
  let stableSince = null;
  for (let round = 0; round < maxRounds; round++) {
    const snapshot = await read();
    if (expected !== null && snapshot.expected !== null && expected !== snapshot.expected) countChanged = true;
    expected = snapshot.expected ?? expected;
    const occurrences = new Map();
    for (const row of snapshot.rows) {
      if (row.inCountedGrid === false) outsideGrid = true;
      const label = cardIdentity(row.label) ?? row.label;
      const raw = row.position !== null && row.position !== undefined ? `position:${row.position}` : row.anchor ? `link:${row.anchor}` : `label:${label}`;
      const occurrence = occurrences.get(raw) ?? 0;
      occurrences.set(raw, occurrence + 1);
      const key = JSON.stringify([raw, occurrence]);
      const previous = found.get(key);
      const changed = previous && ((cardIdentity(previous.label) ?? previous.label) !== label || previous.anchor !== row.anchor || previous.actionable !== row.actionable);
      if (changed) positionChanged = true;
      if (!previous || changed) lastChange = Date.now();
      found.set(key, row);
    }
    // Counts describe rows, not cards. Only a stable tail plus one card for every indexed row qualifies.
    const positions = new Set([...found.values()].map(row=>/^\d+$/.test(String(row.position))?Number(row.position):NaN));
    const positionalCoverage = Number.isSafeInteger(expected) && expected>0 && found.size===expected &&
      positions.size===expected && [...positions].every(position=>position>=1&&position<=expected);
    if (snapshot.atEnd && !snapshot.busy && !countChanged && !positionChanged && !outsideGrid && snapshot.expected===expected && positionalCoverage) {
      const signature=JSON.stringify(snapshot.rows.map(row=>[row.position,cardIdentity(row.label)??row.label,row.anchor,row.actionable]));
      if(signature!==endSnapshot){endSnapshot=signature;stableSince=Date.now();}
      else if(Date.now()-stableSince>=stableMs){completion=true;break;}
    }else{
      endSnapshot=null;stableSince=null;
      if(round>1 && Date.now()-lastChange>=stableMs&&!snapshot.busy)break;
    }
    await advance(snapshot.rows);
    await sleep(interval);
  }
  const rows = [...found.values()];
  const unknown = rows.filter(row => !row.actionable || !card(row.label));
  return {cards:canonicalCards(rows.filter(row => card(row.label))), unknown, verified:completion, expected, observed:rows.length};
}

export async function scanInventory(page) {
  let first;
  await waitForCards(async () => {
    first = await readInventory(page);
    return first.rows;
  });
  if(!first?.rows.length)return {cards:[],unknown:[],verified:false,expected:first?.expected??null,observed:0};
  return collectInventory(async () => {
    if (first) { const initial = first; first = null; return initial; }
    return readInventory(page);
  }, async rows => {
    const last = canonicalCards(rows).filter(row => row.kind !== 'unknown').at(-1);
    const control = last && await findCard(page, last.label, last.index,last.position);
    if (control) {
      await control.scrollIntoViewIfNeeded({timeout:4500}).catch(() => {});
      // Advance the nearest scroll container even when its last rendered card is already visible.
      await control.evaluate(element => {
        let scroller=element.parentElement;
        while(scroller && (!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) || scroller.scrollHeight<=scroller.clientHeight))scroller=scroller.parentElement;
        scroller??=document.scrollingElement;
        if(scroller)scroller.scrollTop+=Math.max(1,Math.floor(scroller.clientHeight*0.75));
      },null,{timeout:3000}).catch(()=>{});
    }
  });
}
