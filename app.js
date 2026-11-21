'use strict';

/* ============================================================
   MTG Life Counter
   - Life totals with quick +/- buttons or a typed amount
   - Poison counters
   - Commander tax and commander damage (21 from one commander is lethal)
   - Creatures with +1/+1, -1/-1, end-of-turn pumps and custom counters
   - Optional card lookup via the free Scryfall API
   - Everything is saved in localStorage so a refresh keeps the game
   ============================================================ */

const STORAGE_KEY = 'mtg-life-counter-v1';
const COLORS = ['#e5484d', '#3e8ed0', '#30a46c', '#f5a524', '#8e4ec6', '#12a594'];
const SCRYFALL = 'https://api.scryfall.com';
const COMMON_COUNTERS = [
  'Shield', 'Stun', 'Flying', 'First strike', 'Deathtouch', 'Lifelink',
  'Trample', 'Indestructible', 'Hexproof', 'Vigilance', 'Menace', 'Reach',
  'Charge', 'Loyalty', 'Oil', 'Time',
];

const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ---------------- State ---------------- */

// New players get the lowest unused "Player N" name and an unused color
function makePlayer(life, existing = []) {
  const names = new Set(existing.map((p) => p.name));
  let n = 1;
  while (names.has(`Player ${n}`)) n++;
  const used = new Set(existing.map((p) => p.color));
  const color = COLORS.find((c) => !used.has(c)) || COLORS[existing.length % COLORS.length];
  return { id: uid(), name: `Player ${n}`, life, poison: 0, color, casts: 0, cmdDmg: {} };
}

function newState(count = 2, life = 40) {
  const players = [];
  for (let i = 0; i < count; i++) players.push(makePlayer(life, players));
  return { startingLife: life, players, creatures: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.players) || !s.players.length) return null;
    s.creatures = Array.isArray(s.creatures) ? s.creatures : [];
    // Games saved before commander tracking existed
    s.players.forEach((p) => {
      p.casts = Number(p.casts) || 0;
      p.cmdDmg = p.cmdDmg && typeof p.cmdDmg === 'object' ? p.cmdDmg : {};
    });
    return s;
  } catch {
    return null;
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

let state = load() || newState();

const playerById = (id) => state.players.find((p) => p.id === id);
const creatureById = (id) => state.creatures.find((c) => c.id === id);

/* ---------------- Toast ---------------- */

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- Players ---------------- */

const deltas = {}; // pid -> { value, timer } for the "+3" indicator
const openCommander = new Set(); // pids whose Commander panel is expanded
const CMD_LETHAL = 21;

const maxCmdDmg = (p) => Math.max(0, ...state.players.filter((o) => o !== p).map((o) => p.cmdDmg[o.id] || 0));

function commanderPanel(p) {
  const opponents = state.players.filter((o) => o !== p);
  const rows = opponents.map((o) => `
        <div class="cmd-row" data-from="${o.id}" style="--ocolor:${o.color}">
          <span class="cmd-from"><span class="dot"></span><span class="cmd-name">${esc(o.name)}</span></span>
          <button class="btn" data-action="cmdDmg" data-from="${o.id}" data-amt="-1" aria-label="Remove 1 commander damage from ${esc(o.name)}">−</button>
          <span class="val">0</span>
          <button class="btn" data-action="cmdDmg" data-from="${o.id}" data-amt="1" aria-label="Add 1 commander damage from ${esc(o.name)}">+</button>
        </div>`).join('');
  return `
      <details class="commander" ${openCommander.has(p.id) ? 'open' : ''}>
        <summary><span>Commander</span><span class="cmd-summary"></span></summary>
        <div class="tax-row">
          <div>
            <div class="tax-label">Commander tax</div>
            <div class="tax-sub"></div>
          </div>
          <button class="btn" data-action="cast" data-amt="-1" aria-label="Undo a commander cast">−</button>
          <span class="tax-val">+0</span>
          <button class="btn" data-action="cast" data-amt="1" aria-label="Cast commander from the command zone">+ Cast</button>
        </div>
        <div class="cmd-head">Commander damage taken <small>(also changes life)</small></div>
        ${rows || '<div class="cmd-none">Add another player to track commander damage.</div>'}
      </details>`;
}

function renderPlayers() {
  $('#players').innerHTML = state.players.map((p) => `
    <article class="player" data-pid="${p.id}" style="--pcolor:${p.color}">
      <div class="player-head">
        <input class="player-name" type="text" value="${esc(p.name)}" aria-label="Player name" data-field="name">
        <div class="poison" title="Poison counters">
          ☠
          <button class="btn" data-action="poison" data-amt="-1" aria-label="Remove poison">−</button>
          <span class="count">0</span>
          <button class="btn" data-action="poison" data-amt="1" aria-label="Add poison">+</button>
        </div>
        ${state.players.length > 1 ? `<button class="btn remove-player" data-action="removePlayer" aria-label="Remove ${esc(p.name)}" title="Remove player">✕</button>` : ''}
      </div>

      <div class="life-row">
        <button class="btn" data-action="life" data-amt="-1" aria-label="Lose 1 life">−</button>
        <div class="life-display">
          <div class="life-delta"></div>
          <div class="life-num">0</div>
        </div>
        <button class="btn" data-action="life" data-amt="1" aria-label="Gain 1 life">+</button>
      </div>

      <div class="quick-row">
        <button class="btn lose" data-action="life" data-amt="-5">−5</button>
        <button class="btn lose" data-action="life" data-amt="-10">−10</button>
        <button class="btn gain" data-action="life" data-amt="10">+10</button>
        <button class="btn gain" data-action="life" data-amt="5">+5</button>
      </div>

      <div class="custom-row">
        <input type="number" inputmode="numeric" min="0" placeholder="Amount" aria-label="Custom amount" data-field="amount">
        <button class="btn lose" data-action="custom" data-sign="-1">Lose</button>
        <button class="btn gain" data-action="custom" data-sign="1">Gain</button>
      </div>
      ${commanderPanel(p)}
    </article>
  `).join('');
  state.players.forEach(updatePlayer);
}

function updatePlayer(p) {
  const el = document.querySelector(`.player[data-pid="${p.id}"]`);
  if (!el) return;
  el.querySelector('.life-num').textContent = p.life;
  el.querySelector('.poison .count').textContent = p.poison;
  el.querySelector('.poison').classList.toggle('lethal', p.poison >= 10);

  const tax = p.casts * 2;
  el.querySelector('.tax-val').textContent = `+${tax}`;
  el.querySelector('.tax-sub').textContent = p.casts
    ? `Cast ${p.casts} time${p.casts === 1 ? '' : 's'} from command zone`
    : 'Not cast yet';
  el.querySelectorAll('.cmd-row').forEach((row) => {
    const n = p.cmdDmg[row.dataset.from] || 0;
    row.querySelector('.val').textContent = n;
    row.classList.toggle('lethal', n >= CMD_LETHAL);
  });
  const top = maxCmdDmg(p);
  const bits = [];
  if (tax) bits.push(`tax +${tax}`);
  if (top) bits.push(`${top}/${CMD_LETHAL} dmg`);
  const sum = el.querySelector('.cmd-summary');
  sum.textContent = bits.join(' · ');
  sum.classList.toggle('lethal', top >= CMD_LETHAL);

  el.classList.toggle('dead', p.life <= 0 || p.poison >= 10 || top >= CMD_LETHAL);
}

function changeLife(p, amt) {
  if (!amt) return;
  p.life += amt;
  save();
  updatePlayer(p);

  // Running total of recent changes, e.g. tapping -1 three times shows "−3"
  const d = deltas[p.id] || (deltas[p.id] = { value: 0, timer: null });
  d.value += amt;
  const el = document.querySelector(`.player[data-pid="${p.id}"] .life-delta`);
  if (el) {
    el.textContent = d.value > 0 ? `+${d.value}` : d.value < 0 ? `−${Math.abs(d.value)}` : '±0';
    el.className = `life-delta show ${d.value > 0 ? 'up' : d.value < 0 ? 'down' : ''}`;
  }
  clearTimeout(d.timer);
  d.timer = setTimeout(() => {
    d.value = 0;
    if (el) el.classList.remove('show');
  }, 2000);
}

$('#players').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.player');
  const p = playerById(card.dataset.pid);
  if (!p) return;

  switch (btn.dataset.action) {
    case 'life':
      changeLife(p, Number(btn.dataset.amt));
      break;
    case 'poison':
      p.poison = Math.max(0, p.poison + Number(btn.dataset.amt));
      save();
      updatePlayer(p);
      break;
    case 'cast':
      p.casts = Math.max(0, p.casts + Number(btn.dataset.amt));
      save();
      updatePlayer(p);
      break;
    case 'cmdDmg': {
      const from = btn.dataset.from;
      const cur = p.cmdDmg[from] || 0;
      const next = Math.max(0, cur + Number(btn.dataset.amt));
      if (next === cur) return;
      p.cmdDmg[from] = next;
      changeLife(p, cur - next); // commander damage is real damage; undoing it gives the life back
      break;
    }
    case 'removePlayer': {
      if (state.players.length <= 1) return;
      const owned = state.creatures.filter((c) => c.owner === p.id).length;
      const extra = owned ? ` Their ${owned} creature${owned === 1 ? '' : 's'} will be removed too.` : '';
      if (!confirm(`Remove ${p.name}?${extra}`)) return;
      state.players = state.players.filter((x) => x !== p);
      state.players.forEach((x) => { delete x.cmdDmg[p.id]; });
      state.creatures = state.creatures.filter((c) => c.owner !== p.id);
      save();
      renderAll();
      break;
    }
    case 'custom': {
      const input = card.querySelector('[data-field="amount"]');
      const n = Math.abs(parseInt(input.value, 10));
      if (!n) { input.focus(); return; }
      changeLife(p, n * Number(btn.dataset.sign));
      input.value = '';
      input.blur(); // hide the phone keyboard
      break;
    }
  }
});

$('#players').addEventListener('input', (e) => {
  if (e.target.dataset.field !== 'name') return;
  const p = playerById(e.target.closest('.player').dataset.pid);
  p.name = e.target.value;
  save();
  // Keep the opponent labels in other players' commander damage lists in sync
  document.querySelectorAll(`.cmd-row[data-from="${p.id}"] .cmd-name`).forEach((n) => { n.textContent = p.name; });
});

// Remember which Commander panels are open so re-renders don't collapse them
$('#players').addEventListener('toggle', (e) => {
  if (!e.target.matches('details.commander')) return;
  const pid = e.target.closest('.player').dataset.pid;
  if (e.target.open) openCommander.add(pid); else openCommander.delete(pid);
}, true);

$('#players').addEventListener('change', (e) => {
  if (e.target.dataset.field !== 'name') return;
  const p = playerById(e.target.closest('.player').dataset.pid);
  if (!p.name.trim()) {
    p.name = `Player ${state.players.indexOf(p) + 1}`;
    e.target.value = p.name;
    save();
  }
  renderOwnerSelect();
  renderCreatures();
});

// Pressing Enter in the amount box: treat as damage (the most common case)
$('#players').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.dataset.field !== 'amount') return;
  e.preventDefault();
  e.target.closest('.player').querySelector('[data-action="custom"][data-sign="-1"]').click();
});

/* ---------------- Settings ---------------- */

function syncSettingsUI() {
  const sl = $('#startingLife');
  const preset = [...sl.options].some((o) => o.value === String(state.startingLife));
  if (!preset) {
    let opt = sl.querySelector('option[data-custom]');
    if (!opt) {
      opt = document.createElement('option');
      opt.dataset.custom = '1';
      sl.insertBefore(opt, sl.lastElementChild);
    }
    opt.value = String(state.startingLife);
    opt.textContent = String(state.startingLife);
  }
  sl.value = String(state.startingLife);
}

$('#addPlayerBtn').addEventListener('click', () => {
  const p = makePlayer(state.startingLife, state.players);
  state.players.push(p);
  save();
  renderAll();
  document.querySelector(`.player[data-pid="${p.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#startingLife').addEventListener('change', (e) => {
  let v = e.target.value;
  if (v === 'custom') {
    const input = prompt('Starting life total:', String(state.startingLife));
    const n = parseInt(input, 10);
    if (!n || n < 1) { syncSettingsUI(); return; }
    v = n;
  }
  state.startingLife = Number(v);
  if (confirm(`Set every player's life to ${state.startingLife} now?`)) {
    state.players.forEach((p) => { p.life = state.startingLife; });
  }
  save();
  syncSettingsUI();
  state.players.forEach(updatePlayer);
});

$('#newGameBtn').addEventListener('click', () => {
  if (!confirm('Start a new game? Life, poison, commander tax and damage reset, and all creatures are removed.')) return;
  state.players.forEach((p) => { p.life = state.startingLife; p.poison = 0; p.casts = 0; p.cmdDmg = {}; });
  state.creatures = [];
  save();
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#firstPlayerBtn').addEventListener('click', () => {
  const p = state.players[Math.floor(Math.random() * state.players.length)];
  toast(`🎲 ${p.name} goes first!`, 3000);
});

/* ---------------- Creatures ---------------- */

function ptValue(base, mod) {
  const n = parseInt(base, 10);
  if (Number.isNaN(n)) {
    // e.g. "*" or "1+*" — keep the text and show the modifier
    const b = base === '' || base == null ? '?' : base;
    return mod ? `${b}${mod > 0 ? '+' : ''}${mod}` : b;
  }
  return String(n + mod);
}

function creatureCard(c) {
  const modP = c.plus - c.minus + c.tempP;
  const modT = c.plus - c.minus + c.tempT;
  const net = modP + modT;
  const ptClass = net > 0 ? 'buffed' : net < 0 ? 'debuffed' : '';
  const ptText = `${ptValue(c.power, modP)}/${ptValue(c.toughness, modT)}`;

  const thumb = c.img
    ? `<button class="thumb-btn" data-action="view" aria-label="View card"><img class="thumb" src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy"></button>`
    : `<button class="thumb" data-action="view" aria-label="Card details">${esc(c.name.slice(0, 18))}</button>`;

  const extra = Object.entries(c.counters).map(([name, n]) => `
    <div class="counter">
      <span class="label" title="${esc(name)}">${esc(name)}</span>
      <button class="btn" data-action="ctr" data-name="${esc(name)}" data-amt="-1" aria-label="Remove ${esc(name)} counter">−</button>
      <span class="val">${n}</span>
      <button class="btn" data-action="ctr" data-name="${esc(name)}" data-amt="1" aria-label="Add ${esc(name)} counter">+</button>
    </div>`).join('');

  const counterOptions = COMMON_COUNTERS
    .filter((n) => !(n in c.counters))
    .map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');

  return `
    <article class="creature ${c.tapped ? 'tapped' : ''}" data-cid="${c.id}">
      <div>${thumb}</div>
      <div class="c-main">
        <div class="c-top">
          <div>
            <button class="c-name" data-action="rename" title="Tap to rename">${esc(c.name)}</button>
            ${c.typeLine ? `<div class="c-type">${esc(c.typeLine)}</div>` : ''}
          </div>
          <button class="c-pt ${ptClass}" data-action="editpt" title="Tap to edit base power/toughness">
            ${esc(ptText)}
            <small>base ${esc(c.power || '?')}/${esc(c.toughness || '?')}</small>
          </button>
        </div>

        <div class="counter-grid">
          <div class="counter">
            <span class="label">+1/+1</span>
            <button class="btn" data-action="plus" data-amt="-1" aria-label="Remove +1/+1 counter">−</button>
            <span class="val">${c.plus}</span>
            <button class="btn" data-action="plus" data-amt="1" aria-label="Add +1/+1 counter">+</button>
          </div>
          <div class="counter">
            <span class="label">−1/−1</span>
            <button class="btn" data-action="minus" data-amt="-1" aria-label="Remove -1/-1 counter">−</button>
            <span class="val">${c.minus}</span>
            <button class="btn" data-action="minus" data-amt="1" aria-label="Add -1/-1 counter">+</button>
          </div>
          <div class="counter" title="Until end of turn power boost">
            <span class="label">Pump P</span>
            <button class="btn" data-action="tempP" data-amt="-1" aria-label="Lower temporary power">−</button>
            <span class="val">${c.tempP > 0 ? '+' : ''}${c.tempP}</span>
            <button class="btn" data-action="tempP" data-amt="1" aria-label="Raise temporary power">+</button>
          </div>
          <div class="counter" title="Until end of turn toughness boost">
            <span class="label">Pump T</span>
            <button class="btn" data-action="tempT" data-amt="-1" aria-label="Lower temporary toughness">−</button>
            <span class="val">${c.tempT > 0 ? '+' : ''}${c.tempT}</span>
            <button class="btn" data-action="tempT" data-amt="1" aria-label="Raise temporary toughness">+</button>
          </div>
          ${extra}
        </div>

        <div class="c-actions">
          <select data-action="addctr" aria-label="Add another counter">
            <option value="">+ Other counter…</option>
            ${counterOptions}
            <option value="__custom">Custom…</option>
          </select>
          <button class="btn small ${c.tapped ? 'on' : ''}" data-action="tap">${c.tapped ? 'Tapped' : 'Tap'}</button>
          <button class="btn small" data-action="dup" title="Add a copy (great for tokens)">Copy</button>
          <button class="btn small danger" data-action="remove">Remove</button>
        </div>
      </div>
    </article>`;
}

function renderCreatures() {
  const wrap = $('#creatures');
  if (!state.creatures.length) {
    wrap.innerHTML = '<p class="empty">No creatures yet. Add one above.</p>';
    return;
  }
  wrap.innerHTML = state.players.map((p) => {
    const list = state.creatures.filter((c) => c.owner === p.id);
    if (!list.length) return '';
    return `
      <div class="group-head" style="--pcolor:${p.color}">
        <h3>${esc(p.name)} <span style="color:var(--muted);font-weight:400">(${list.length})</span></h3>
        <button class="btn small" data-action="untapall" data-pid="${p.id}">Untap all</button>
      </div>
      ${list.map(creatureCard).join('')}`;
  }).join('');
}

function renderOwnerSelect() {
  const sel = $('#cOwner');
  const prev = sel.value;
  sel.innerHTML = state.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  if (playerById(prev)) sel.value = prev;
}

function makeCreature(fields) {
  return {
    id: uid(),
    name: fields.name,
    owner: fields.owner,
    power: fields.power ?? '',
    toughness: fields.toughness ?? '',
    plus: 0, minus: 0, tempP: 0, tempT: 0,
    counters: {},
    tapped: false,
    img: fields.img || null,
    imgLarge: fields.imgLarge || null,
    typeLine: fields.typeLine || '',
    oracle: fields.oracle || '',
  };
}

// +1/+1 and -1/-1 counters cancel each other out (rule 704.5q)
function annihilate(c) {
  const n = Math.min(c.plus, c.minus);
  c.plus -= n;
  c.minus -= n;
}

$('#creatures').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.tagName === 'SELECT') return;

  if (btn.dataset.action === 'untapall') {
    state.creatures.forEach((c) => { if (c.owner === btn.dataset.pid) c.tapped = false; });
    save();
    renderCreatures();
    return;
  }

  const c = creatureById(btn.closest('.creature')?.dataset.cid);
  if (!c) return;
  const amt = Number(btn.dataset.amt || 0);

  switch (btn.dataset.action) {
    case 'plus': c.plus = Math.max(0, c.plus + amt); annihilate(c); break;
    case 'minus': c.minus = Math.max(0, c.minus + amt); annihilate(c); break;
    case 'tempP': c.tempP += amt; break;
    case 'tempT': c.tempT += amt; break;
    case 'ctr': {
      const name = btn.dataset.name;
      const n = (c.counters[name] || 0) + amt;
      if (n <= 0) delete c.counters[name]; else c.counters[name] = n;
      break;
    }
    case 'tap': c.tapped = !c.tapped; break;
    case 'dup': {
      const copy = { ...structuredClone(c), id: uid() };
      state.creatures.splice(state.creatures.indexOf(c) + 1, 0, copy);
      toast(`Added another ${c.name}`);
      break;
    }
    case 'remove':
      if (!confirm(`Remove ${c.name}?`)) return;
      state.creatures = state.creatures.filter((x) => x !== c);
      break;
    case 'rename': {
      const name = prompt('Creature name:', c.name);
      if (!name || !name.trim()) return;
      c.name = name.trim();
      break;
    }
    case 'editpt': {
      const v = prompt('Base power/toughness (e.g. 2/3):', `${c.power}/${c.toughness}`);
      if (v == null) return;
      const m = v.split('/');
      if (m.length !== 2) { toast('Use the format power/toughness, e.g. 2/3'); return; }
      c.power = m[0].trim();
      c.toughness = m[1].trim();
      break;
    }
    case 'view':
      showCardDialog(c);
      return;
    default:
      return;
  }
  save();
  renderCreatures();
});

$('#creatures').addEventListener('change', (e) => {
  if (e.target.dataset.action !== 'addctr') return;
  const c = creatureById(e.target.closest('.creature').dataset.cid);
  let name = e.target.value;
  if (!name) return;
  if (name === '__custom') {
    name = (prompt('Counter name:') || '').trim();
    if (!name) { e.target.value = ''; return; }
  }
  c.counters[name] = (c.counters[name] || 0) + 1;
  save();
  renderCreatures();
});

$('#clearEotBtn').addEventListener('click', () => {
  let n = 0;
  state.creatures.forEach((c) => {
    if (c.tempP || c.tempT) n++;
    c.tempP = 0;
    c.tempT = 0;
  });
  save();
  renderCreatures();
  toast(n ? `Cleared pumps on ${n} creature${n === 1 ? '' : 's'}` : 'No pumps to clear');
});

function showCardDialog(c) {
  $('#cardDialogBody').innerHTML = `
    <h3 style="margin:0 0 4px">${esc(c.name)}</h3>
    ${c.typeLine ? `<div style="color:var(--muted);font-size:.85rem">${esc(c.typeLine)}</div>` : ''}
    ${c.imgLarge ? `<img src="${esc(c.imgLarge)}" alt="${esc(c.name)}">` : ''}
    ${c.oracle ? `<p class="oracle">${esc(c.oracle)}</p>` : ''}
    ${!c.imgLarge && !c.oracle ? '<p class="oracle" style="color:var(--muted)">No card details — this creature was added manually.</p>' : ''}
  `;
  $('#cardDialog').showModal();
}

$('#cardDialog').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close(); // tap backdrop to close
});

/* ---------------- Add creature form + Scryfall lookup ---------------- */

const nameInput = $('#cName');
const sugList = $('#suggestions');
let selectedCard = null; // card info from Scryfall matching the current name
let acTimer = null;
let activeSug = -1;

function setStatus(msg) { $('#lookupStatus').textContent = msg || ''; }

function hideSuggestions() {
  sugList.hidden = true;
  sugList.innerHTML = '';
  activeSug = -1;
}

function showSuggestions(names) {
  if (!names.length) { hideSuggestions(); return; }
  sugList.innerHTML = names.map((n, i) => `<li role="option" data-i="${i}" data-name="${esc(n)}">${esc(n)}</li>`).join('');
  sugList.hidden = false;
  activeSug = -1;
}

function cardInfo(card) {
  const faces = card.card_faces || [card];
  const face = faces.find((f) => f.power != null) || faces[0];
  const imgs = card.image_uris || face.image_uris || faces[0].image_uris || {};
  return {
    name: card.card_faces ? face.name : card.name,
    power: face.power ?? '',
    toughness: face.toughness ?? '',
    typeLine: face.type_line || card.type_line || '',
    oracle: face.oracle_text ?? card.oracle_text ?? '',
    img: imgs.small || imgs.normal || null,
    imgLarge: imgs.normal || imgs.large || null,
  };
}

async function fetchCard(name, mode = 'exact') {
  const r = await fetch(`${SCRYFALL}/cards/named?${mode}=${encodeURIComponent(name)}`);
  if (!r.ok) return null;
  return cardInfo(await r.json());
}

function showPreview(info) {
  const box = $('#cardPreview');
  if (!info) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = `
    ${info.img ? `<img src="${esc(info.img)}" alt="">` : ''}
    <div>
      <strong>${esc(info.name)}</strong>
      <div class="type">${esc(info.typeLine)}</div>
      ${info.oracle ? `<div class="oracle">${esc(info.oracle)}</div>` : ''}
    </div>`;
  box.hidden = false;
}

async function selectCard(name) {
  hideSuggestions();
  nameInput.value = name;
  setStatus('Looking up card…');
  try {
    const info = await fetchCard(name);
    if (nameInput.value !== name) return; // user kept typing
    if (!info) { setStatus('Card not found — enter stats manually.'); return; }
    selectedCard = info;
    $('#cPower').value = info.power;
    $('#cTough').value = info.toughness;
    showPreview(info);
    setStatus(info.power === '' ? 'Not a creature card — set power/toughness if needed.' : '');
  } catch {
    setStatus('Card lookup unavailable (offline?) — enter stats manually.');
  }
}

nameInput.addEventListener('input', () => {
  clearTimeout(acTimer);
  selectedCard = null;
  showPreview(null);
  setStatus('');
  const q = nameInput.value.trim();
  if (q.length < 2) { hideSuggestions(); return; }
  acTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (nameInput.value.trim() !== q) return; // stale response
      showSuggestions((j.data || []).slice(0, 10));
    } catch {
      hideSuggestions();
      setStatus('Card search unavailable offline — you can still add creatures manually.');
    }
  }, 250);
});

nameInput.addEventListener('keydown', (e) => {
  const items = [...sugList.querySelectorAll('li')];
  if (sugList.hidden || !items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeSug = (activeSug + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle('active', i === activeSug));
  } else if (e.key === 'Enter' && activeSug >= 0) {
    e.preventDefault();
    selectCard(items[activeSug].dataset.name);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});

// pointerdown fires before the input loses focus, so the tap always registers
sugList.addEventListener('pointerdown', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  e.preventDefault();
  selectCard(li.dataset.name);
});

nameInput.addEventListener('blur', () => setTimeout(hideSuggestions, 150));

$('#addCreatureForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  let power = $('#cPower').value.trim();
  let toughness = $('#cTough').value.trim();
  let info = selectedCard && selectedCard.name.toLowerCase() === name.toLowerCase() ? selectedCard : null;

  // Typed a name but no stats and didn't pick a suggestion: try a fuzzy lookup
  if (!info && !power && !toughness) {
    setStatus('Looking up card…');
    try { info = await fetchCard(name, 'fuzzy'); } catch { info = null; }
    if (!info) {
      setStatus('');
      toast('Card not found — enter power and toughness.');
      $('#cPower').focus();
      return;
    }
    power = info.power;
    toughness = info.toughness;
  }

  const qty = Math.min(50, Math.max(1, parseInt($('#cQty').value, 10) || 1));
  const owner = $('#cOwner').value;
  for (let i = 0; i < qty; i++) {
    state.creatures.push(makeCreature({
      ...(info || {}),
      name: info ? info.name : name,
      owner, power, toughness,
    }));
  }
  save();
  renderCreatures();

  // Reset the form but keep the controller selected
  nameInput.value = '';
  $('#cPower').value = '';
  $('#cTough').value = '';
  $('#cQty').value = '1';
  selectedCard = null;
  showPreview(null);
  setStatus('');
  nameInput.blur();
  toast(qty > 1 ? `Added ${qty}× ${info ? info.name : name}` : `Added ${info ? info.name : name}`);
});

/* ---------------- Screen wake lock ---------------- */

let wakeLock = null;
let wantWake = false;

async function requestWake() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; updateWakeBtn(); });
  } catch {
    wakeLock = null;
  }
  updateWakeBtn();
}

function updateWakeBtn() {
  const b = $('#wakeBtn');
  b.textContent = `Screen on: ${wantWake ? 'on' : 'off'}`;
  b.classList.toggle('on', wantWake && !!wakeLock);
}

if ('wakeLock' in navigator) {
  $('#wakeBtn').addEventListener('click', async () => {
    wantWake = !wantWake;
    if (wantWake) await requestWake();
    else { await wakeLock?.release(); wakeLock = null; updateWakeBtn(); }
  });
  // The lock is dropped when the tab is hidden; take it back when we return
  document.addEventListener('visibilitychange', () => {
    if (wantWake && document.visibilityState === 'visible' && !wakeLock) requestWake();
  });
} else {
  $('#wakeBtn').hidden = true;
}

/* ---------------- Install (PWA) ---------------- */

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
  });
}

/* ---------------- Boot ---------------- */

function renderAll() {
  syncSettingsUI();
  renderPlayers();
  renderOwnerSelect();
  renderCreatures();
}

renderAll();
