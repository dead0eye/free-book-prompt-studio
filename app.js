/*
 * Book Prompt Studio
 *
 * A planning tool for writers. Everything it knows lives in four JSON files:
 *
 *   data/vocab.json       1,300+ options across 30 vocabularies, extracted from Book Prompt.xlsx
 *   data/categories.json  91 fiction and 40 non-fiction genres, with descriptions
 *   data/craft.json       the craft questions, exercises and beat structures — hand-written
 *   data/templates.json   the AI prompt templates, with {{field}} placeholders
 *
 * The output panel has two halves. Writer mode (writer.js) turns the choices into things a
 * person works from: a brief, the questions those choices oblige you to answer, a beat sheet
 * with the word budget worked out, blank character sheets, timed exercises, a revision pass.
 * Prompt mode turns the same choices into an instruction for a language model. Neither is
 * privileged by the data — they are two readings of one set of decisions.
 *
 * No build step, no dependencies, no account, no network. Add an option to the spreadsheet,
 * re-run tools/xlsx_to_json.py, reload the page.
 */

'use strict';

const $ = (id) => document.getElementById(id);

const MODES = [
  { id: 'fiction',    label: 'Fiction' },
  { id: 'children',   label: "Children's" },
  { id: 'world',      label: 'Worldbuilding' },
  { id: 'nonfiction', label: 'Non-fiction' },
];

/* Which vocabulary fields each mode shows, and in which card. */
const LAYOUT = {
  fiction: {
    story: ['tone', 'tone2', 'style', 'style2', 'theme', 'theme2', 'setting', 'timePeriod',
            'pov', 'mood', 'dialogue', 'pacing', 'opening', 'ending', 'targetAudience'],
    world: ['wbCivilization', 'wbGeography', 'wbStem', 'wbPolitics', 'wbRaces', 'wbEconomy',
            'wbReligion', 'wbSociety', 'wbTravel', 'wbCommunication'],
    character: ['strength', 'weakness'],
    children: [],
  },
  children: {
    story: ['tone', 'tone2', 'style', 'style2', 'setting', 'timePeriod', 'pacing'],
    world: [],
    character: ['strength', 'weakness'],
    children: ['childAgeGroup', 'childReadingLevel', 'childTopic', 'childTopic2',
               'childTheme', 'childTheme2', 'moral', 'moral2'],
  },
  world: {
    story: ['timePeriod', 'setting', 'mood'],
    world: ['wbCivilization', 'wbGeography', 'wbStem', 'wbPolitics', 'wbRaces', 'wbEconomy',
            'wbReligion', 'wbSociety', 'wbTravel', 'wbCommunication'],
    character: [],
    children: [],
  },
  nonfiction: {
    story: ['tone', 'style', 'targetAudience', 'theme', 'nfTopic'],
    world: [],
    character: [],
    children: [],
  },
};

/* Fields ending in `2` are a second slot on the same vocabulary — the spreadsheet had two
   tone columns, two theme columns and so on. One definition, two dropdowns. */
function baseKey(key) {
  return key.endsWith('2') ? key.slice(0, -1) : key;
}

const state = {
  mode: 'fiction',
  seed: randomSeed(),
  values: {},          // field key -> chosen value
  locked: {},          // field key -> true, meaning a roll must not touch it
  genre1: '', genre2: '', nfGenre: '',
  sheet: 'brief',      // which output sheet is open
  project: '',         // name of the saved project this came from, if any
  answers: {},         // answer key -> what the reader typed into a worksheet
};

let VOCAB = null, CATS = null, TPL = null, CRAFT = null, FIELDS = {};

/* ── seeded rng ─────────────────────────────────────────────────────────── */

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFor(label) {
  let a = hash(state.seed + ':' + label);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// The pill has always advertised that the same seed re-rolls identically, but there was no way
// to type one in: you could read a seed and never use it. Reproducing a roll meant having saved
// or shared the project first, which is the one case where you do not need the seed.
function askForSeed() {
  const typed = prompt('Enter a seed to reproduce a roll exactly.\n\n' +
                       'Letters and digits, up to 12 characters. Pinned fields stay pinned.',
                       state.seed);
  if (typed === null) return;
  const seed = typed.trim().toUpperCase();
  if (!seed) return;
  if (!/^[A-Z0-9]{1,12}$/.test(seed)) {
    toast('A seed is letters and digits only, up to 12 characters');
    return;
  }
  state.seed = seed;
  rollAll(false, true);
}

function randomSeed() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

/* ── boot ───────────────────────────────────────────────────────────────── */

const DATA_FILES = ['vocab', 'categories', 'templates', 'craft'];

/**
 * Load the data. `fetch` is the authoritative path — it reads the JSON files directly, so
 * hand-edits to templates.json or craft.json show up on reload. But browsers block fetch from
 * `file://`, and telling a writer to install Python before they can open a writing tool is a
 * bad first five minutes. So when fetch fails we fall back to data/bundle.js, which is the
 * same four files as one script tag, and the app opens with a double click.
 */
async function loadData() {
  try {
    const [v, c, t, k] = await Promise.all(
      DATA_FILES.map((n) => fetch('data/' + n + '.json').then((r) => {
        if (!r.ok) throw new Error(n + '.json: HTTP ' + r.status);
        return r.json();
      })));
    return [v, c, t, k, 'files'];
  } catch (err) {
    const bundled = await loadBundle();
    if (bundled) return bundled;
    throw err;
  }
}

function loadBundle() {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'data/bundle.js';
    s.onload = () => {
      const B = window.BOOK_PROMPT_DATA;
      resolve(B ? [B.vocab, B.categories, B.templates, B.craft, 'bundle'] : null);
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

async function boot() {
  let source;
  try {
    [VOCAB, CATS, TPL, CRAFT, source] = await loadData();
  } catch (err) {
    $('error').innerHTML =
      `<div class="err"><b>Could not load the data files.</b><br><br>` +
      `Browsers block <code>fetch()</code> from <code>file://</code> pages, and the offline ` +
      `bundle (<code>data/bundle.js</code>) is missing too. Either rebuild the bundle:<br><br>` +
      `<code>python tools/bundle.py</code><br><br>or serve the folder over HTTP:<br><br>` +
      `<code>python tools/serve.py</code><br><br>` +
      `<em>${esc(String(err.message))}</em></div>`;
    return;
  }

  VOCAB.fields.forEach((f) => { FIELDS[f.key] = f; });
  buildDerivedFields();

  $('tabs').innerHTML = MODES.map((m) =>
    `<button data-mode="${m.id}"${m.id === state.mode ? ' class="on"' : ''}>${m.label}</button>`
  ).join('');
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.mode = b.dataset.mode;
    document.querySelectorAll('#tabs button').forEach((x) =>
      x.classList.toggle('on', x.dataset.mode === state.mode));
    render(); save();
  });

  // Counted from FIELDS, not VOCAB.fields, so the derived vocabularies are included.
  const all = Object.values(FIELDS);
  const total = all.reduce((a, f) => a + f.options.length, 0);
  $('stat').textContent =
    `${all.length} vocabularies · ${total.toLocaleString()} options · ` +
    `${CATS.fiction.items.length + CATS.nonfiction.items.length} genres` +
    (source === 'bundle' ? ' · offline bundle' : '');

  $('seedPill').onclick = () => { closeMenus(); askForSeed(); };
  $('rollAll').onclick = () => { closeMenus(); rollAll(false); };
  $('rollEmpty').onclick = () => { closeMenus(); rollAll(true); };
  $('unpinAll').onclick = () => {
    closeMenus(); state.locked = {}; render(); save(); toast('Everything unpinned');
  };
  $('clearAll').onclick = () => {
    closeMenus();
    if (!confirm('Clear every field? Pins are cleared too. Saved projects are not touched.')) return;
    state.values = {}; state.locked = {};
    state.genre1 = state.genre2 = state.nfGenre = '';
    render(); save();
  };
  $('share').onclick = shareLink;
  $('saveFile').onclick = () => { closeMenus(); saveFile(); };
  $('loadFile').onclick = () => { closeMenus(); $('fileInput').click(); };
  $('fileInput').onchange = loadFile;
  $('projSave').onclick = projectSaveAs;
  $('projUpdate').onclick = projectUpdate;
  $('projDelete').onclick = projectDelete;
  $('projSel').onchange = projectOpen;
  $('btnCopy').onclick = () => copy(activeSheetText(), 'Copied');
  $('btnDownload').onclick = () => { closeMenus(); downloadSheet(); };
  $('btnPrint').onclick = () => { closeMenus(); printSheet(); };
  $('btnDownloadAll').onclick = () => { closeMenus(); downloadPack(); };
  $('btnPrintAll').onclick = () => { closeMenus(); printPack(); };

  // A click anywhere else closes an open header menu, the way a menu is expected to behave.
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.menu[open]').forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });

  restore();
  $('wrap').hidden = false;
  render();
}

/**
 * Two vocabularies in the spreadsheet were extracted but never surfaced. `marketing` is 14
 * groups of digital-marketing topics — a real vocabulary for anyone writing that kind of
 * non-fiction, so it becomes a field. `shortGenres` is a shortlist of the ten genres the
 * spreadsheet's author reached for most, so it becomes an optgroup at the top of the genre
 * dropdown rather than a field of its own.
 */
function buildDerivedFields() {
  if (Array.isArray(VOCAB.marketing) && VOCAB.marketing.length) {
    const options = [];
    for (const group of VOCAB.marketing) {
      for (const t of group.topics) {
        const o = { value: t.value !== undefined ? t.value : t, group: group.label };
        if (t.desc) o.desc = t.desc;
        options.push(o);
      }
    }
    FIELDS.nfTopic = {
      key: 'nfTopic', label: 'Marketing topic', group: 'story', options,
      hint: 'Only relevant to digital-marketing books. Leave it unset for anything else.',
    };
  } else {
    // Nothing to show — drop it from the layout rather than render an empty dropdown.
    LAYOUT.nonfiction.story = LAYOUT.nonfiction.story.filter((k) => k !== 'nfTopic');
  }
}

/*
 * Inline SVG rather than characters. The obvious glyphs for these two buttons — a die face and
 * a pushpin — are exactly the kind of codepoint that renders as an empty box on a machine
 * without the right font, and a form full of tofu is worse than no icon at all.
 */
const ICON_ROLL =
  '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">' +
  '<rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6"/><circle cx="6.8" cy="6.8" r="1.5" fill="currentColor"/>' +
  '<circle cx="10" cy="10" r="1.5" fill="currentColor"/>' +
  '<circle cx="13.2" cy="13.2" r="1.5" fill="currentColor"/></svg>';

const ICON_PIN =
  '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">' +
  '<path d="M6.2 9V5.4a3.8 3.8 0 0 1 7.6 0V9" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round"/>' +
  '<rect x="4.2" y="9" width="11.6" height="8" rx="2" fill="currentColor"/></svg>';

const ICON_UNPIN =
  '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">' +
  '<path d="M6.2 9V5.4a3.8 3.8 0 0 1 7.4-1.1" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round"/>' +
  '<rect x="4.2" y="9" width="11.6" height="8" rx="2" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6"/></svg>';

function closeMenus() {
  document.querySelectorAll('details.menu[open]').forEach((d) => { d.open = false; });
}

/* ── rendering ──────────────────────────────────────────────────────────── */

function render() {
  const L = LAYOUT[state.mode];
  $('seedPill').textContent = 'seed ' + state.seed;

  renderGenre();
  renderManual();
  renderGroup('storyBody', 'storyCount', L.story);
  renderGroup('worldBody', 'worldCount', L.world);
  renderGroup('charBody', null, L.character);
  renderGroup('childBody', null, L.children);

  $('worldCard').hidden = L.world.length === 0;
  $('charCard').hidden = L.character.length === 0;
  $('childCard').hidden = L.children.length === 0;
  $('storyCard').hidden = L.story.length === 0;

  renderProjects();
  renderOutput();
}

function renderGroup(bodyId, countId, keys) {
  const el = $(bodyId);
  if (!keys.length) { el.innerHTML = ''; return; }
  el.innerHTML = keys.map(fieldHTML).join('');
  if (countId) {
    const n = keys.reduce((a, k) => a + (FIELDS[baseKey(k)]?.options.length || 0), 0);
    $(countId).textContent = n.toLocaleString() + ' options';
  }
  el.querySelectorAll('select[data-key]').forEach((sel) => {
    sel.onchange = () => {
      state.values[sel.dataset.key] = sel.value;
      updateDesc(sel.dataset.key);
      renderOutput(); save();
    };
  });
  el.querySelectorAll('button[data-roll]').forEach((btn) => {
    btn.onclick = () => { rollOne(btn.dataset.roll); };
  });
  el.querySelectorAll('button[data-pin]').forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.pin;
      if (state.locked[k]) delete state.locked[k]; else state.locked[k] = true;
      render(); save();
    };
  });
}

function fieldHTML(key) {
  const f = FIELDS[baseKey(key)];
  if (!f) return '';
  const second = key !== baseKey(key);
  const label = second ? f.label + ' (second)' : f.label;
  const val = state.values[key] || '';
  const pinned = !!state.locked[key];

  let current = null, opts = '';
  for (const o of f.options) {
    if (o.group && o.group !== current) {
      if (current) opts += '</optgroup>';
      opts += `<optgroup label="${esc(o.group)}">`;
      current = o.group;
    }
    opts += `<option${o.value === val ? ' selected' : ''}>${esc(o.value)}</option>`;
  }
  if (current) opts += '</optgroup>';

  return `<div class="field${pinned ? ' pinned' : ''}" data-field="${key}">
    <label for="f_${key}">${esc(label)}
      <span class="cnt">${f.options.length}</span></label>
    <div class="ctl">
      <select id="f_${key}" data-key="${key}">
        <option value="">&mdash;</option>${opts}
      </select>
      <button class="roll" data-roll="${key}" title="Roll this one"
        aria-label="Roll ${esc(label)}">${ICON_ROLL}</button>
      <button class="pin${pinned ? ' on' : ''}" data-pin="${key}" aria-pressed="${pinned}"
        aria-label="${pinned ? 'Unpin' : 'Pin'} ${esc(label)}"
        title="${pinned ? 'Pinned — rolls leave this alone' : 'Pin it, so rolls leave it alone'}"
        >${pinned ? ICON_PIN : ICON_UNPIN}</button>
    </div>
    <div class="desc" id="d_${key}">${esc(descFor(key) || f.hint || '')}</div>
  </div>`;
}

function descFor(key) {
  const f = FIELDS[baseKey(key)];
  const v = state.values[key];
  if (!f || !v) return '';
  const o = f.options.find((x) => x.value === v);
  return o && o.desc ? o.desc : '';
}

function updateDesc(key) {
  const el = $('d_' + key);
  if (el) el.textContent = descFor(key) || (FIELDS[baseKey(key)] || {}).hint || '';
}

function renderManual() {
  const kind = state.mode === 'world' ? 'fiction' : state.mode;
  const fields = (TPL.manualFields || []).filter((m) => m.kind.includes(kind));
  // Seed the declared defaults into state, so a field showing "30000" actually contributes
  // 30000 to the output rather than reading as unset until someone types in it.
  fields.forEach((m) => {
    if (state.values[m.key] === undefined && m.default !== undefined) {
      state.values[m.key] = m.default;
    }
  });
  $('manualBody').innerHTML = fields.map((m) => {
    const v = state.values[m.key] !== undefined ? state.values[m.key] : (m.default ?? '');
    const control = m.type === 'textarea'
      ? `<textarea id="m_${m.key}" data-manual="${m.key}" placeholder="${esc(m.placeholder || '')}">${esc(v)}</textarea>`
      : `<input type="${m.type}" id="m_${m.key}" data-manual="${m.key}" value="${esc(v)}" placeholder="${esc(m.placeholder || '')}">`;
    return `<div class="field"><label for="m_${m.key}">${esc(m.label)}</label>
      <div class="ctl">${control}</div>
      ${m.hint ? `<div class="desc">${esc(m.hint)}</div>` : ''}</div>`;
  }).join('');

  $('manualBody').querySelectorAll('[data-manual]').forEach((el) => {
    el.oninput = () => {
      state.values[el.dataset.manual] = el.value;
      renderOutput(); save();
    };
  });
}

function renderGenre() {
  const nf = state.mode === 'nonfiction';
  const set = nf ? CATS.nonfiction : CATS.fiction;
  $('genreCount').textContent = set.items.length + ' genres';

  const slots = nf
    ? [['nfGenre', 'Category']]
    : [['genre1', 'Primary genre'], ['genre2', 'Secondary genre (optional)']];

  // The spreadsheet's own shortlist, floated to the top. Ten familiar names beat scrolling
  // ninety-one alphabetised ones when you already know roughly what you are writing.
  const shortlist = !nf && Array.isArray(VOCAB.shortGenres)
    ? VOCAB.shortGenres.filter((n) => set.items.some((i) => i.name === n))
    : [];

  $('genreBody').innerHTML = slots.map(([key, label]) => {
    const chosen = state[key];
    const item = set.items.find((i) => i.name === chosen);
    const opt = (n) => `<option${n === chosen ? ' selected' : ''}>${esc(n)}</option>`;
    // Only the slot a full roll actually overwrites gets a pin. The secondary genre is never
    // rolled by "Roll everything" — nothing can clobber it, so a pin there would be a control
    // that does nothing.
    const pinnable = key !== 'genre2';
    const pinned = !!state.locked[key];
    return `<div class="field${pinned ? ' pinned' : ''}">
      <label for="g_${key}">${label} <span class="cnt">${set.items.length}</span></label>
      <div class="ctl">
        <select id="g_${key}" data-genre="${key}">
          <option value="">&mdash;</option>
          ${shortlist.length ? `<optgroup label="Common choices">${shortlist.map(opt).join('')}</optgroup>` : ''}
          ${shortlist.length ? '<optgroup label="Everything">' : ''}
          ${set.items.map((i) => opt(i.name)).join('')}
          ${shortlist.length ? '</optgroup>' : ''}
        </select>
        <button class="roll" data-genreroll="${key}" title="Roll this one"
          aria-label="Roll ${label}">${ICON_ROLL}</button>
        ${pinnable ? `<button class="pin${pinned ? ' on' : ''}" data-pin="${key}"
          aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${label}"
          title="${pinned ? 'Pinned — rolls leave the genre alone'
                          : 'Pin it, so rolls leave the genre alone'}"
          >${pinned ? ICON_PIN : ICON_UNPIN}</button>` : ''}
      </div>
      ${item && item.description ? `<details class="gen"><summary>About ${esc(item.name)}</summary>
        <div class="genbody">${esc(item.description)}
        ${item.examples ? `<br><br><em>Examples: ${esc(item.examples)}</em>` : ''}</div></details>` : ''}
    </div>`;
  }).join('');

  $('genreBody').querySelectorAll('[data-genre]').forEach((sel) => {
    sel.onchange = () => {
      state[sel.dataset.genre] = sel.value; renderGenre(); renderOutput(); save();
    };
  });
  $('genreBody').querySelectorAll('[data-genreroll]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.genreroll;
      // A pin has to mean the same thing everywhere, including the dice next to it.
      if (state.locked[key]) return toast('The genre is pinned — unpin it to roll it');
      const items = (key === 'nfGenre' ? CATS.nonfiction : CATS.fiction).items;
      state[key] = items[Math.floor(rngFor(key + Date.now())() * items.length)].name;
      renderGenre(); renderOutput(); save();
    };
  });
  $('genreBody').querySelectorAll('[data-pin]').forEach((btn) => {
    btn.onclick = () => {
      const k = btn.dataset.pin;
      if (state.locked[k]) delete state.locked[k]; else state.locked[k] = true;
      renderGenre(); save();
    };
  });
}

/* ── rolling ────────────────────────────────────────────────────────────── */

function rollOne(key) {
  const f = FIELDS[baseKey(key)];
  if (!f) return;
  if (state.locked[key]) return toast('That field is pinned — unpin it to roll it');
  const r = rngFor(key + ':' + Date.now());
  state.values[key] = f.options[Math.floor(r() * f.options.length)].value;
  render(); save();
}

function rollAll(emptyOnly, keepSeed) {
  const L = LAYOUT[state.mode];
  const keys = [...L.story, ...L.world, ...L.character, ...L.children];
  if (!emptyOnly && !keepSeed) state.seed = randomSeed();
  let skipped = 0;
  keys.forEach((key, i) => {
    if (state.locked[key]) { skipped++; return; }
    if (emptyOnly && state.values[key]) return;
    const f = FIELDS[baseKey(key)];
    if (!f) return;
    const r = rngFor(key + ':' + i);
    let pick = f.options[Math.floor(r() * f.options.length)].value;
    // A "second" slot draws from the same vocabulary as its base, so re-roll rather than
    // print "with elements of Gritty & Raw" twice in one sentence.
    if (key !== baseKey(key) && f.options.length > 1) {
      let guard = 0;
      while (pick === state.values[baseKey(key)] && guard++ < 12) {
        pick = f.options[Math.floor(r() * f.options.length)].value;
      }
    }
    state.values[key] = pick;
  });
  const items = state.mode === 'nonfiction' ? CATS.nonfiction.items : CATS.fiction.items;
  const gk = state.mode === 'nonfiction' ? 'nfGenre' : 'genre1';
  if ((!emptyOnly || !state[gk]) && !state.locked[gk]) {
    state[gk] = items[Math.floor(rngFor(gk + ':g')() * items.length)].name;
  }
  render(); save();
  toast((emptyOnly ? 'Filled the empty fields'
        : (keepSeed ? 'Rebuilt from seed ' : 'Rolled everything — seed ') + state.seed) +
        (skipped ? ` · ${skipped} pinned` : ''));
}

/* ── prompt assembly ────────────────────────────────────────────────────── */

/**
 * A line is dropped entirely if any {{field}} in it is unset. That is what lets a half-filled
 * form still produce a clean prompt instead of one littered with "undefined".
 *
 * {{ and theme2}} is a conditional fragment: the literal text before the field name is kept
 * only when the field has a value, and the whole fragment vanishes when it does not.
 */
/**
 * One definition of "this field has a value", used everywhere a field is tested.
 *
 * The null check is not hypothetical: `state.values` is restored wholesale from a saved file
 * or a shared link, and JSON carries nulls. Without it the prompts print the word "null", the
 * "n unset" badge under-reports, and a conditional fragment renders as " and null".
 */
function isSet(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function fillLine(line, values) {
  let dropped = false;

  let out = line.replace(/\{\{([^}]+)\}\}/g, (whole, inner) => {
    const trimmed = inner.trim();
    if (isSet(values[trimmed])) return String(values[trimmed]);
    if (values[trimmed] !== undefined || FIELDS[baseKey(trimmed)] || isManual(trimmed)) {
      // A known field with no value.
      const words = trimmed.split(/\s+/);
      if (words.length > 1) return '';       // conditional fragment: drop silently
      dropped = true;
      return '';
    }
    // Conditional fragment such as " and theme2" or ", with elements of style2".
    const words = trimmed.split(/\s+/);
    const key = words[words.length - 1];
    if (!isSet(values[key])) return '';
    const prefix = inner.slice(0, inner.lastIndexOf(key));
    return prefix + String(values[key]);
  });

  if (dropped) return null;
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  return out.length ? out : null;
}

function isManual(key) {
  return (TPL.manualFields || []).some((m) => m.key === key);
}

function currentValues() {
  const v = Object.assign({}, state.values);
  v.genre1 = state.genre1;
  v.genre2 = state.genre2;
  v.nfGenre = state.nfGenre;
  return v;
}

function buildPrompt(tpl) {
  const values = currentValues();
  return tpl.body.map((l) => fillLine(l, values)).filter(Boolean).join('\n\n');
}

function templatesForMode() {
  return TPL.templates.filter((t) => t.kind === state.mode);
}

function promptsMarkdown() {
  return templatesForMode()
    .map((t) => `### ${t.label}\n\n${buildPrompt(t)}`)
    .join('\n\n---\n\n');
}

/* ── the output panel ───────────────────────────────────────────────────── */

const PROMPT_TAB = '@prompts';

function writerContext() {
  const L = LAYOUT[state.mode];
  const gv = state.mode === 'nonfiction' ? state.nfGenre : state.genre1;
  const set = state.mode === 'nonfiction' ? CATS.nonfiction : CATS.fiction;
  const item = set.items.find((i) => i.name === gv);
  return {
    mode: state.mode, seed: state.seed, layout: L, fields: FIELDS, craft: CRAFT,
    values: currentValues(),
    genre1: state.genre1, genre2: state.genre2, nfGenre: state.nfGenre,
    genreNote: item && item.description
      ? item.description + (item.examples ? '\n\n*Examples: ' + item.examples + '*' : '')
      : '',
  };
}

let SHEETS = [];

function renderOutput() {
  SHEETS = Writer.all(writerContext());

  const tabs = SHEETS.map((s) =>
    `<button data-sheet="${s.id}"${s.md ? '' : ' disabled title="Fill in a little more first"'}
      class="${state.sheet === s.id ? 'on' : ''}">${esc(s.label)}</button>`).join('') +
    '<span class="sep"></span>' +
    `<button data-sheet="${PROMPT_TAB}" class="${state.sheet === PROMPT_TAB ? 'on' : ''}"
      title="The same choices, written as an instruction for a language model">AI prompts</button>`;
  $('sheettabs').innerHTML = tabs;
  $('sheettabs').querySelectorAll('button[data-sheet]').forEach((b) => {
    b.onclick = () => { state.sheet = b.dataset.sheet; renderOutput(); save(); };
  });

  if (state.sheet === PROMPT_TAB) {
    $('sheetWhy').textContent =
      'For a language model. Everything above, written as an instruction.';
    renderPrompts();
    return;
  }

  const active = SHEETS.find((s) => s.id === state.sheet);
  if (!active) { state.sheet = 'brief'; return renderOutput(); }
  $('sheetWhy').textContent = active.summary;

  if (!active.md) {
    $('sheet').className = 'empty';
    $('sheet').innerHTML =
      'Nothing to build yet. Choose a genre and a few fields on the left — or open the ' +
      '<b>Roll</b> menu and roll everything — and this sheet fills in as you go.';
    return;
  }
  $('sheet').className = 'sheet';
  $('sheet').innerHTML = Writer.toHtml(active.md, {
    fillable: true, sheetId: active.id, answers: state.answers,
  });
  wireAnswerFields();
}

/**
 * Make the worksheets typeable.
 *
 * The sheets are rebuilt from scratch on every roll and every field change, so a typed answer
 * cannot live in the DOM - it lives in `state.answers`, keyed by the question it answers, and
 * the fresh markup is populated from there.
 *
 * Answers whose key is no longer present are deliberately NOT pruned. Re-roll a tone, and the
 * craft questions change; re-roll it back and the answers you had written return. Cleaning up
 * "orphans" would mean silently deleting someone's writing because they moved a dropdown.
 */
function growField(el) {
  // A textarea clips its overflow when printed, so what is on paper would be the first three
  // lines of a long answer with no sign that the rest exists. Height has to follow content.
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 24) + 'px';
  // An empty box prints as a ruled line to write on; a filled one prints as what was written.
  // CSS cannot ask whether a textarea has a value, so the state is put in a class.
  el.classList.toggle('is-empty', !el.value.trim());
}

/** Size every field inside a container. The print pack builds its own markup, and an unsized
    textarea there would clip a long answer to its first few lines on paper. */
function sizeFieldsIn(root) {
  if (root) root.querySelectorAll('textarea.wfield').forEach(growField);
}

function wireAnswerFields() {
  const grow = growField;

  $('sheet').querySelectorAll('textarea.wfield').forEach((el) => {
    grow(el);
    el.addEventListener('input', () => {
      grow(el);
      state.answers[el.dataset.k] = el.value;
      saveSoon();
    });
  });

  $('sheet').querySelectorAll('input.wchk').forEach((el) => {
    el.addEventListener('change', () => {
      state.answers[el.dataset.k] = el.checked;
      saveSoon();
    });
  });
}

// Typing is a keystroke at a time; writing to localStorage on every one of them is wasted work
// and, on a long answer, noticeable.
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function renderPrompts() {
  const list = templatesForMode();
  const values = currentValues();
  $('sheet').className = '';
  $('sheet').innerHTML = list.map((t, i) => {
    const text = buildPrompt(t);
    const missing = (t.uses || []).filter((k) => !k.endsWith('2') && !isSet(values[k]));
    return `<div class="prompt">
      <div class="head"><b>${esc(t.label)}</b><span class="grow"></span>
        ${missing.length ? `<span class="pill" title="${esc(missing.join(', '))}">${missing.length} unset</span>` : ''}
        <button class="b sm" data-copy="${i}">Copy</button></div>
      <div class="note">${esc(t.summary || '')}</div>
      <div class="out">${esc(text) || 'Fill in a few fields and the prompt appears here.'}</div>
    </div>`;
  }).join('');

  $('sheet').querySelectorAll('[data-copy]').forEach((btn) => {
    btn.onclick = () => copy(buildPrompt(list[+btn.dataset.copy]), 'Prompt copied');
  });
}

function activeSheetText() {
  if (state.sheet === PROMPT_TAB) return promptsMarkdown();
  const s = SHEETS.find((x) => x.id === state.sheet);
  return s && s.md ? sheetMarkdown(s) : '';
}

/**
 * A worksheet as Markdown with whatever has been typed into it written in.
 *
 * Copy and Download read the generated Markdown straight from the builder, which still has
 * every answer line blank. Someone who filled a sheet in and then copied it got an empty copy
 * of their own work back.
 */
function sheetMarkdown(s) {
  return Writer.fillAnswers(s.md, { sheetId: s.id, answers: state.answers });
}

function bookSlug() {
  return (state.values.title || 'book').toString()
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'book';
}

function downloadSheet() {
  const text = activeSheetText();
  if (!text) return toast('Nothing to download yet');
  const sheet = state.sheet === PROMPT_TAB ? 'prompts' : state.sheet;
  download(text, `${bookSlug()}-${sheet}.md`, 'text/markdown');
  toast('Downloaded as Markdown');
}

/* ── the whole pack ─────────────────────────────────────────────────────── */

/**
 * Every worksheet that has something on it, as one document.
 *
 * The AI prompts are deliberately left out: this is the pack you print, or hand to a
 * copywriter or a friend, and an instruction addressed to a language model is not part of
 * that. It is still one click away on its own tab.
 */
function packSheets() {
  return SHEETS.filter((s) => s.md);
}

function packMarkdown() {
  const sheets = packSheets();
  if (!sheets.length) return '';
  const title = state.values.title || 'Untitled';
  const author = state.values.author;
  const head = [`# ${title}`, ''];
  if (author) head.push(`*${author}*`, '');
  head.push(`*Planning pack · ${sheets.length} worksheets · seed ${state.seed} · ` +
            `${new Date().toISOString().slice(0, 10)}*`, '');
  head.push('', ...sheets.map((s, i) => `${i + 1}. ${s.label} — ${s.summary}`), '');
  // Each sheet already opens with its own `# heading`, so they need no further introduction.
  return head.join('\n') + '\n---\n\n' +
         sheets.map(sheetMarkdown).join('\n\n---\n\n') + '\n';
}

function downloadPack() {
  const text = packMarkdown();
  if (!text) return toast('Nothing to download yet — fill in a few fields first');
  download(text, `${bookSlug()}-planning-pack.md`, 'text/markdown');
  toast(`Downloaded ${packSheets().length} worksheets as one file`);
}

/**
 * Printing goes through the browser's own print dialog, where "Save as PDF" is a destination.
 * That is a deliberate choice rather than a missing feature: the browser's print engine sets
 * better type than a bundled PDF library would, it costs nothing to ship, and it keeps the
 * promise that this app makes no network request and has no dependencies. The file is written
 * by the browser, on the reader's machine.
 */
/*
 * Printing temporarily rearranges the page, and every rearrangement has to be undone whether
 * the reader printed, saved a PDF or cancelled. The restore is deliberately paranoid:
 *
 *   - it can only ever run once, so a browser firing both afterprint and the media query
 *     change does not undo the next print's setup;
 *   - a new print finishes the previous one first, because a leaked `print-all` class would
 *     mean the next single-sheet print silently emitted the entire pack;
 *   - the timeout is a leak-guard measured in tens of seconds, not a mechanism. Firing it
 *     early would pull the document out from under an open dialog.
 */
let pendingRestore = null;

/**
 * Swap every filled answer box for plain text before printing, and put it back afterwards.
 *
 * A textarea is a replaced element: browsers do not paginate inside one. An answer taller than
 * the remaining space on the page is simply cut off at the boundary, with no second page and
 * no indication that anything is missing - the one failure mode where the reader loses their
 * own writing without being told. Ordinary block text breaks across pages normally.
 */
function freezeFieldsForPrint(root) {
  root.querySelectorAll('textarea.wfield').forEach((el) => {
    if (!el.value.trim()) return;            // empty boxes print as the ruled line
    const div = document.createElement('div');
    div.className = 'wfield-frozen';
    div.textContent = el.value;
    el.insertAdjacentElement('afterend', div);
    el.classList.add('wfield-hidden');
  });
}

function thawFields(root) {
  root.querySelectorAll('.wfield-frozen').forEach((d) => d.remove());
  root.querySelectorAll('.wfield-hidden').forEach((el) => el.classList.remove('wfield-hidden'));
}

function printWithTitle(name, before, after) {
  if (pendingRestore) pendingRestore();

  const original = document.title;
  // Chrome and Edge use document.title as the default filename when saving as PDF, so this is
  // the difference between "Book Prompt Studio.pdf" and "The Salt Line - beat sheet.pdf".
  document.title = name;
  if (before) before();
  freezeFieldsForPrint(document.body);

  const media = window.matchMedia ? window.matchMedia('print') : null;
  let guard = null;

  const restore = () => {
    if (pendingRestore !== restore) return;   // already restored
    pendingRestore = null;
    clearTimeout(guard);
    window.removeEventListener('afterprint', restore);
    if (media && media.removeEventListener) media.removeEventListener('change', onMedia);
    document.title = original;
    thawFields(document.body);
    if (after) after();
  };
  const onMedia = (e) => { if (!e.matches) restore(); };

  pendingRestore = restore;
  window.addEventListener('afterprint', restore);
  // Safari has historically been unreliable about afterprint; leaving print media is the
  // same signal by another route.
  if (media && media.addEventListener) media.addEventListener('change', onMedia);
  guard = setTimeout(restore, 60000);

  window.print();
}

function printSheet() {
  if (!activeSheetText()) return toast('Nothing to print yet');
  const active = SHEETS.find((s) => s.id === state.sheet);
  const label = state.sheet === PROMPT_TAB ? 'AI prompts' : (active ? active.label : 'sheet');
  printWithTitle(`${state.values.title || 'Untitled'} - ${label}`);
}

function printPack() {
  const sheets = packSheets();
  if (!sheets.length) return toast('Nothing to print yet — fill in a few fields first');

  const title = state.values.title || 'Untitled';
  const author = state.values.author;
  const parts = [
    `<div class="sheet cover"><h1>${esc(title)}</h1>` +
    (author ? `<div class="by">${esc(author)}</div>` : '<div class="by"></div>') +
    `<div class="meta">Planning pack &middot; ${sheets.length} worksheets<br>` +
    `${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` +
    `<br>seed ${esc(state.seed)}</div>` +
    `<ol class="contents">${sheets.map((s) =>
      `<li>${esc(s.label)}<br><span class="of">${esc(s.summary)}</span></li>`).join('')}</ol>` +
    '</div>',
  ];
  // Fillable, exactly like the on-screen sheet. Rendering the plain form here meant the whole
  // pack printed as blank worksheets no matter how much had been typed into them.
  for (const s of sheets) {
    parts.push(`<div class="sheet">${Writer.toHtml(s.md, {
      fillable: true, sheetId: s.id, answers: state.answers,
    })}</div>`);
  }

  $('printAll').innerHTML = parts.join('\n');
  sizeFieldsIn($('printAll'));
  printWithTitle(
    `${title} - planning pack`,
    () => document.body.classList.add('print-all'),
    () => {
      document.body.classList.remove('print-all');
      $('printAll').innerHTML = '';   // it is only ever built for one print
    },
  );
}

function download(text, filename, type) {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── persistence ────────────────────────────────────────────────────────── */

/*
 * Three places state can live, and it is worth being explicit about which is which:
 *
 *   localStorage['book-prompt-studio']           the working copy, saved on every keystroke
 *   localStorage['book-prompt-studio:projects']  named projects, saved when you ask
 *   a downloaded .json file                      the only copy that outlives the browser
 *
 * The first two are this browser, on this machine, in this profile. Clearing site data
 * deletes both. Nothing is ever sent anywhere — there is no server to send it to.
 */

const STORE = 'book-prompt-studio';
const PROJECTS = 'book-prompt-studio:projects';
const SNAPSHOT_VERSION = 3;

function snapshot() {
  return {
    v: SNAPSHOT_VERSION, app: 'book-prompt-studio',
    mode: state.mode, seed: state.seed, values: state.values, locked: state.locked,
    genre1: state.genre1, genre2: state.genre2, nfGenre: state.nfGenre,
    sheet: state.sheet, project: state.project, answers: state.answers,
    savedAt: new Date().toISOString(),
  };
}

// `snapshot()` stamps every save with `app` and `v`. Nothing used to read either back, so a
// snapshot from a sibling tool - they all share this #base64 link format - or from a newer
// version of this one was applied wholesale: a foreign seed, a genre that is not in the list
// and a tone that does not exist all landed in the UI, and the app carried on as if the
// project were real. The stamp only means something if it is checked on the way in.
function snapshotFault(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'that is not a saved project';
  if (s.app && s.app !== 'book-prompt-studio') return 'that project belongs to a different tool';
  const v = Number(s.v);
  if (v && v > SNAPSHOT_VERSION) return 'that project was saved by a newer version of this app';
  return null;
}

function apply(s) {
  if (snapshotFault(s)) return false;
  state.mode = MODES.some((m) => m.id === s.mode) ? s.mode : state.mode;
  state.seed = typeof s.seed === 'string' && /^[A-Z0-9]{1,12}$/.test(s.seed)
    ? s.seed : state.seed;
  state.values = s.values && typeof s.values === 'object' ? s.values : {};
  state.locked = s.locked && typeof s.locked === 'object' ? s.locked : {};
  state.genre1 = s.genre1 || '';
  state.genre2 = s.genre2 || '';
  state.nfGenre = s.nfGenre || '';
  // Not validated against SHEETS here: SHEETS is not built until after boot, and renderOutput
  // already falls back to 'brief' for an id it does not recognise.
  state.sheet = s.sheet || state.sheet;
  // Typed worksheet answers. Snapshots written before v3 have none, which is not an error -
  // they simply predate the fields existing.
  state.answers = s.answers && typeof s.answers === 'object' && !Array.isArray(s.answers)
    ? s.answers : {};
  state.project = s.project || '';
  document.querySelectorAll('#tabs button').forEach((x) =>
    x.classList.toggle('on', x.dataset.mode === state.mode));
  return true;
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { return false; }   // private mode, or the quota is full
}

function save() { writeStore(STORE, snapshot()); }

function restore() {
  if (location.hash.length > 1) {
    let fault = 'that link could not be read';
    try {
      const s = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1)))));
      fault = snapshotFault(s);
      if (!fault) { apply(s); return; }
    } catch (e) { /* leave the default fault message */ }
    // Falling through silently left someone who pasted a truncated or foreign link staring at
    // an empty studio with no idea why. Say so, once the toast element exists.
    setTimeout(() => toast(fault + ' — opened your working copy instead'), 400);
  }
  apply(readStore(STORE, null));
}

function projects() { return readStore(PROJECTS, {}) || {}; }

function renderProjects() {
  const all = projects();
  const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  $('projSel').innerHTML =
    `<option value="">${state.project ? '— switch project —' : '— unsaved working copy —'}</option>` +
    names.map((n) => `<option${n === state.project ? ' selected' : ''}>${esc(n)}</option>`).join('');
  $('projUpdate').disabled = !state.project;
  $('projDelete').disabled = !state.project;
  $('projNote').innerHTML =
    (state.project ? `Open: <b>${esc(state.project)}</b>. ` : 'Not saved as a project yet. ') +
    `Your work is autosaved to this browser as you type` +
    (names.length ? `, alongside ${names.length} saved project${names.length === 1 ? '' : 's'}` : '') +
    `. Nothing leaves this machine.`;
}

function projectSaveAs() {
  const name = (prompt('Name this project:', state.values.title || state.project || '') || '').trim();
  if (!name) return;
  const all = projects();
  if (all[name] && !confirm(`"${name}" already exists. Overwrite it?`)) return;
  state.project = name;
  all[name] = snapshot();
  if (!writeStore(PROJECTS, all)) return toast('Could not save — browser storage is unavailable');
  save(); renderProjects(); closeMenus();
  toast(`Saved as "${name}"`);
}

function projectUpdate() {
  if (!state.project) return;
  const all = projects();
  all[state.project] = snapshot();
  if (!writeStore(PROJECTS, all)) return toast('Could not save — browser storage is unavailable');
  renderProjects(); closeMenus();
  toast(`Updated "${state.project}"`);
}

function projectDelete() {
  if (!state.project) return;
  if (!confirm(`Delete the saved project "${state.project}"?\n\nWhat is on screen stays; ` +
               `only the saved copy in this browser goes.`)) return;
  const all = projects();
  const name = state.project;
  delete all[name];
  writeStore(PROJECTS, all);
  state.project = '';
  save(); renderProjects(); closeMenus();
  toast(`Deleted "${name}"`);
}

function projectOpen(e) {
  const name = e.target.value;
  if (!name) return;
  const all = projects();
  if (!all[name]) return;
  apply(all[name]);
  state.project = name;
  save(); render(); closeMenus();
  toast(`Opened "${name}"`);
}

function shareLink() {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(snapshot()))));
  const url = location.origin + location.pathname + '#' + b64;
  history.replaceState(null, '', '#' + b64);
  copy(url, 'Link copied — it carries every choice');
}

function saveFile() {
  const name = (state.project || state.values.title || state.mode).toString()
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'book';
  download(JSON.stringify(snapshot(), null, 2), `${name}-${state.seed}.json`, 'application/json');
  toast('Downloaded');
}

function loadFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    let parsed = null;
    try { parsed = JSON.parse(fr.result); }
    catch (err) { return toast('That file is not valid JSON'); }
    if (!parsed || typeof parsed !== 'object' || !parsed.values) {
      return toast('That file is not a Book Prompt Studio save');
    }
    apply(parsed);
    save(); render();
    toast('Opened ' + file.name);
  };
  fr.readAsText(file);
  e.target.value = '';
}

/* ── small helpers ──────────────────────────────────────────────────────── */

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function copy(text, message) {
  if (!text) return toast('Nothing to copy yet');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(message || 'Copied'); }
    catch (e) { toast('Copying was blocked — select the text and copy it by hand'); }
    ta.remove();
  };
  if (!navigator.clipboard) return fallback();
  navigator.clipboard.writeText(text).then(() => toast(message || 'Copied')).catch(fallback);
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

boot();
