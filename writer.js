/*
 * writer.js — Writer mode.
 *
 * The rest of this app turns a set of choices into an instruction for a machine. This file
 * turns the same choices into something a person can work from: a brief to pin above the desk,
 * the questions those choices ought to make you answer, a beat sheet with the word budget
 * already worked out, and exercises you can do this afternoon with a pen.
 *
 * Nothing here needs a model, an account or a connection. Every builder returns Markdown, so
 * one output serves four purposes — read it on screen, copy it into Scrivener or Obsidian,
 * download it as a .md, or print it as a worksheet.
 *
 * Adding a worksheet: write a builder, add it to BUILDERS. It receives the whole context and
 * returns a Markdown string, or null when there is not enough filled in to be worth showing.
 */

'use strict';

const Writer = (function () {

  /* ── formatting helpers ───────────────────────────────────────────────── */

  const num = (n) => Number(n).toLocaleString('en-GB');

  /** A rule to write on when the sheet is printed, and a visible gap when it is not. */
  const RULE = '\n_______________________________________________________________\n';

  function fieldLabel(ctx, key) {
    const f = ctx.fields[baseKey(key)];
    if (!f) return key;
    return key === baseKey(key) ? f.label : f.label + ' (second)';
  }

  function baseKey(key) {
    return key.endsWith('2') ? key.slice(0, -1) : key;
  }

  function valueOf(ctx, key) {
    const v = ctx.values[key];
    // `null` has to be caught explicitly: String(null) is "null", and a saved file or a shared
    // link can carry a null where a value is expected. Without this the sheets cheerfully
    // print "Length: null" and "your null chapters".
    if (v === undefined || v === null || v === '') return null;
    const s = String(v);
    return s.trim() === '' ? null : s;
  }

  /** The explanation the spreadsheet carries for a chosen option — the AI prompt throws this
      away, but it is the most useful column on a brief. */
  function descOf(ctx, key) {
    const f = ctx.fields[baseKey(key)];
    const v = valueOf(ctx, key);
    if (!f || !v) return '';
    const o = f.options.find((x) => x.value === v);
    const d = (o && o.desc) || '';
    // A few spreadsheet rows carry a "description" that is just the option again in lower
    // case. Printing "Educational — educational" makes the sheet look automated.
    return d.trim().toLowerCase() === v.trim().toLowerCase() ? '' : d;
  }

  /** One cell of a Markdown table: pipes escaped, newlines flattened. */
  function cell(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
  }

  function genreLine(ctx) {
    if (ctx.mode === 'nonfiction') return ctx.nfGenre || null;
    if (ctx.genre1 && ctx.genre2) return ctx.genre1 + ' / ' + ctx.genre2;
    return ctx.genre1 || ctx.genre2 || null;
  }

  /** Substitute {{key}} with the chosen value; return null if any is unset. */
  function fill(text, ctx) {
    let ok = true;
    const out = text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      const v = valueOf(ctx, k) || (k === 'genre1' ? ctx.genre1 : '');
      if (!v) { ok = false; return ''; }
      return v;
    });
    return ok ? out : null;
  }

  /* ── word budget ──────────────────────────────────────────────────────── */

  function budget(ctx) {
    const words = parseInt(ctx.values.wordCount, 10);
    const chapters = parseInt(ctx.values.chapters, 10);
    if (!words || !chapters || words < 1 || chapters < 1) return null;
    return {
      words, chapters,
      perChapter: Math.round(words / chapters),
      // Rough but honest: a 500-word working session is a normal day for most people.
      sessions: Math.ceil(words / 500),
      at: (p) => Math.round(p * words),
      chapterAt: (p) => Math.min(chapters, Math.floor(p * chapters) + 1),
    };
  }

  /* ── 1. the brief ─────────────────────────────────────────────────────── */

  function brief(ctx) {
    const L = ctx.layout;
    const keys = [...L.story, ...L.world, ...L.character, ...L.children]
      .filter((k) => valueOf(ctx, k));
    const g = genreLine(ctx);
    const premise = valueOf(ctx, 'premise');
    if (!keys.length && !g && !premise) return null;

    const title = valueOf(ctx, 'title') || 'Untitled';
    const b = budget(ctx);
    const out = [`# ${title}`, ''];

    const author = valueOf(ctx, 'author');
    if (author) out.push(`*${author}*`, '');

    const facts = [];
    if (g) facts.push(`**Genre** — ${g}`);
    const aud = valueOf(ctx, 'targetAudience') || valueOf(ctx, 'childAgeGroup');
    if (aud) facts.push(`**Reader** — ${aud}`);
    if (b) {
      facts.push(`**Length** — ${num(b.words)} words across ${b.chapters} chapters ` +
                 `(about ${num(b.perChapter)} a chapter)`);
    }
    if (facts.length) out.push(facts.join('  \n'), '');

    if (premise) {
      out.push('## Premise', '', premise, '');
    } else {
      out.push('## Premise', '',
               '*One sentence. Everything else on this page hangs off it.*', RULE, '');
    }

    // The decisions, with what each one actually means. A brief nobody can read six weeks
    // later is not a brief, and "Diegetic" on its own will not survive six weeks.
    const sections = [
      ['The story', L.story],
      ['The world', L.world],
      ['The characters', L.character],
      ["The young reader", L.children],
    ];
    for (const [heading, group] of sections) {
      const set = group.filter((k) => valueOf(ctx, k));
      if (!set.length) continue;
      out.push('## ' + heading, '');
      out.push('| Element | Choice | What that means |', '|---|---|---|');
      for (const k of set) {
        // Every cell, not just the description: a single pipe anywhere in a vocabulary label,
        // value or explanation splits the row and the whole table comes apart. None of the
        // shipped options contain one, but the vocabularies are meant to be extended.
        out.push(`| ${cell(fieldLabel(ctx, k))} | **${cell(valueOf(ctx, k))}** | ` +
                 `${cell(descOf(ctx, k)) || '—'} |`);
      }
      out.push('');
    }

    if (ctx.genreNote) {
      out.push('## About the genre', '', ctx.genreNote, '');
    }

    out.push('---', '',
             `*Book Prompt Studio · seed ${ctx.seed} · ${new Date().toISOString().slice(0, 10)}*`);
    return out.join('\n');
  }

  /* ── 2. craft questions ───────────────────────────────────────────────── */

  function questions(ctx) {
    const C = ctx.craft;
    if (!C) return null;
    const L = ctx.layout;
    const out = ['# Questions to answer before you start', '',
                 '*One honest paragraph each. The ones you want to skip are the ones to do first.*',
                 ''];

    let any = false;
    const asked = [];

    // Genre and premise sit outside the vocabulary fields but are the biggest decisions here.
    const gk = ctx.mode === 'nonfiction' ? 'nfGenre' : 'genre1';
    const gv = ctx.mode === 'nonfiction' ? ctx.nfGenre : ctx.genre1;
    if (gv && C.fields[gk]) asked.push([C.fields[gk].heading, gv, C.fields[gk].questions]);
    if (ctx.genre2 && C.fields.genre2) {
      asked.push([C.fields.genre2.heading, ctx.genre2, C.fields.genre2.questions]);
    }
    if (valueOf(ctx, 'premise') && C.fields.premise) {
      asked.push([C.fields.premise.heading, valueOf(ctx, 'premise'), C.fields.premise.questions]);
    }

    const order = [...L.story, ...L.world, ...L.character, ...L.children, 'wordCount', 'chapters'];
    for (const key of order) {
      const v = valueOf(ctx, key);
      if (!v) continue;
      const entry = C.fields[key] || C.fields[baseKey(key)];
      if (!entry) continue;
      // An option-specific question beats a generic one — a first-person narrator and an
      // unreliable one raise completely different problems.
      const extra = ((C.options[baseKey(key)] || {})[v]) || [];
      asked.push([entry.heading + (key !== baseKey(key) ? ' (second)' : ''), v,
                  extra.concat(entry.questions)]);
    }

    for (const [heading, value, qs] of asked) {
      any = true;
      out.push(`## ${heading}: ${value}`, '');
      qs.forEach((q) => out.push(`- ${q}`, RULE));
      out.push('');
    }

    // The pair questions are the ones worth the price of admission: they only exist because
    // two particular choices were made together.
    const pairs = (C.pairs || [])
      .map((p) => (valueOf(ctx, p.a) && valueOf(ctx, p.b)) ? fill(p.question, ctx) : null)
      .filter(Boolean);
    if (pairs.length) {
      any = true;
      out.push('## Where your choices pull against each other', '');
      pairs.forEach((q) => out.push(`- ${q}`, RULE));
      out.push('');
    }

    return any ? out.join('\n') : null;
  }

  /* ── 3. beat sheet ────────────────────────────────────────────────────── */

  function beats(ctx) {
    const C = ctx.craft;
    if (!C || !C.beats) return null;
    const b = budget(ctx);
    const out = [];

    if (ctx.mode === 'nonfiction') {
      const nf = C.beats.nonfiction;
      out.push('# ' + nf.label, '');
      if (b) out.push(`*${num(b.words)} words · ${b.chapters} chapters · ` +
                      `about ${num(b.perChapter)} words each*`, '');
      out.push(`*${C.beats.note}*`, '');
      for (const beat of nf.beats) {
        const where = b ? ` — around word ${num(b.at(beat.at))}, chapter ${b.chapterAt(beat.at)}`
                        : '';
        out.push(`### ${beat.label}${where}`, '', `*${beat.note}*`, RULE, '');
      }
      return out.join('\n');
    }

    out.push('# Beat sheet', '');
    if (b) {
      out.push(`*${num(b.words)} words · ${b.chapters} chapters · ` +
               `about ${num(b.perChapter)} words a chapter · ` +
               `roughly ${b.sessions} sessions at 500 words a day*`, '');
    } else {
      out.push('*Set a word count and chapter count and this sheet will do the arithmetic ' +
               'for you.*', '');
    }
    out.push(`*${C.beats.note}*`, '');

    const opening = valueOf(ctx, 'opening');
    const ending = valueOf(ctx, 'ending');

    for (const act of C.beats.acts) {
      const share = b ? ` — ${num(Math.round(act.share * b.words))} words` : '';
      out.push(`## ${act.label}${share}`, '');
      for (const beat of act.beats) {
        const where = b ? `word ${num(b.at(beat.at))}, chapter ${b.chapterAt(beat.at)}`
                        : `${Math.round(beat.at * 100)}% in`;
        out.push(`### ${beat.label}  \n*${where}*`, '');
        out.push(`*${beat.note}*`);
        // Slot the chosen opening and ending into the two beats they belong to, so the sheet
        // reflects the decisions already made rather than restating the generic advice.
        if (beat.label === 'Opening image' && opening) {
          out.push('', `**You chose:** ${opening} — ${descOf(ctx, 'opening') || 'your opening'}`);
        }
        if (beat.label === 'Closing image' && ending) {
          out.push('', `**You chose:** ${ending} — ${descOf(ctx, 'ending') || 'your ending'}`);
        }
        out.push(RULE, '');
      }
    }
    return out.join('\n');
  }

  /* ── 4. exercises ─────────────────────────────────────────────────────── */

  function exercises(ctx) {
    const C = ctx.craft;
    if (!C || !C.exercises) return null;
    const kind = ctx.mode;
    const usable = [];
    for (const ex of C.exercises) {
      if (!ex.kind.includes(kind)) continue;
      // `needs` gates the exercise even where the field is not named in the body: "an ordinary
      // Tuesday in this world" is not worth setting as homework before there is a world.
      if ((ex.needs || []).some((k) => !valueOf(ctx, k))) continue;
      const body = fill(ex.body, ctx);
      if (body === null) continue;              // a placeholder whose field is not set
      usable.push({ ex, body });
    }
    if (!usable.length) return null;

    const out = ['# Exercises', '',
                 '*Pen, timer, no editing until the time is up. These are drawn from the ' +
                 'choices you have actually made, so they are about your book rather than ' +
                 'about writing in general.*', ''];
    for (const { ex, body } of usable) {
      out.push(`## ${ex.label}  \n*${ex.minutes} minutes*`, '', body, RULE, '');
    }
    return out.join('\n');
  }

  /* ── 5. character sheet ───────────────────────────────────────────────── */

  function characters(ctx) {
    if (!ctx.layout.character.length) return null;
    const strength = valueOf(ctx, 'strength');
    const weakness = valueOf(ctx, 'weakness');
    const out = ['# Character sheets', '',
                 '*Three is usually enough to start. A character who wants the same thing as ' +
                 'another character, by the same means, is one character.*', ''];

    const rows = [
      ['Name', ''],
      ['What they want', '*the thing they would say if asked*'],
      ['What they need', '*the thing they would deny*'],
      ['What it costs them to get it', ''],
      ['Strength', strength ? `**${strength}** — ${descOf(ctx, 'strength')}` : ''],
      ['Weakness', weakness ? `**${weakness}** — ${descOf(ctx, 'weakness')}` : ''],
      ['Where the strength makes things worse', ''],
      ['What they will not talk about', ''],
      ['How they speak differently from everyone else', ''],
      ['Who they are wrong about', ''],
    ];

    for (let i = 1; i <= 3; i++) {
      out.push(`## Character ${i}`, '');
      for (const [label, hint] of rows) {
        // Only the first sheet carries the rolled strength and weakness — the other two are
        // yours to fill, or the cast comes out as three versions of one person.
        const value = i === 1 ? hint : (hint.startsWith('*') ? hint : '');
        out.push(`**${label}**${value ? '  \n' + value : ''}`, RULE, '');
      }
    }
    return out.join('\n');
  }

  /* ── 6. revision checklist ────────────────────────────────────────────── */

  function revision(ctx) {
    const L = ctx.layout;
    const set = [...L.story, ...L.world, ...L.character, ...L.children]
      .filter((k) => valueOf(ctx, k));
    if (set.length < 3) return null;

    const out = ['# Revision pass', '',
                 '*Every line here is a promise you made at the planning stage. This is the ' +
                 'pass where you find out which ones the draft actually kept.*', ''];

    for (const k of set) {
      out.push(`- [ ] **${fieldLabel(ctx, k)}: ${valueOf(ctx, k)}** — find the three pages ` +
               'where this is unmistakably true. If you cannot find three, it is an ' +
               'intention rather than a feature of the book.');
    }
    out.push('');
    out.push('## Regardless of what you planned', '');
    [
      'Read the first page and the last page together. Do they belong to the same book?',
      'Find your longest paragraph. Does it earn its length, or is it where you stopped making decisions?',
      'Cover every speech tag for a chapter. Can you still tell the speakers apart?',
      'List what changes in each chapter. Cut or merge any chapter where nothing does.',
      'Find the scene you skipped past in summary. Is that because it is unimportant, or because it is hard?',
      'Search for your three favourite words. Count them. Most writers are shocked at this stage.',
      'Read the dialogue aloud, all of it. Anything you stumble on, a reader stumbles on.',
    ].forEach((l) => out.push(`- [ ] ${l}`));
    return out.join('\n');
  }

  /* ── assembly ─────────────────────────────────────────────────────────── */

  const BUILDERS = [
    { id: 'brief', label: 'Book brief',
      summary: 'One page to pin above the desk. Every decision, with what it means.',
      build: brief },
    { id: 'questions', label: 'Craft questions',
      summary: 'What your choices oblige you to answer. The part a dropdown cannot do for you.',
      build: questions },
    { id: 'beats', label: 'Beat sheet',
      summary: 'A three-act skeleton with your word budget already worked out.',
      build: beats },
    { id: 'characters', label: 'Character sheets',
      summary: 'Three blank sheets, seeded with the strength and weakness you rolled.',
      build: characters },
    { id: 'exercises', label: 'Exercises',
      summary: 'Timed drills built from your own choices. Pen and paper.',
      build: exercises },
    { id: 'revision', label: 'Revision pass',
      summary: 'For later: check the draft against the promises made here.',
      build: revision },
  ];

  function all(ctx) {
    return BUILDERS.map((w) => {
      let md = null;
      try { md = w.build(ctx); }
      catch (err) { md = '*This sheet could not be built: ' + err.message + '*'; }
      return { id: w.id, label: w.label, summary: w.summary, md };
    });
  }

  /* ── the smallest Markdown renderer that serves these documents ───────── */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/ {2}$/, '<br>');
  }

  /**
   * A stable identity for one answer box.
   *
   * Keyed by the text of the question it sits under, not by its position in the document.
   * Position looked simpler and is wrong: re-rolling changes how many beats or questions a
   * sheet has, every index after the change shifts by one, and yesterday's answer to "What
   * does she want?" silently reappears under "What is in her way?". A key built from the
   * question means a changed question detaches its answer rather than misfiling it.
   */
  function answerKey(sheetId, label, n) {
    const slug = String(label || '_')
      .replace(/[*_`]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    return sheetId + '/' + (slug || '_') + '#' + n;
  }

  // How tall an answer box should be, from what it is answering. A one-line premise and a
  // twenty-minute writing exercise are not the same prompt.
  const ROWS = { exercise: 10, beat: 4, question: 3, field: 2, plain: 3 };

  function toHtml(md, opts) {
    if (!md) return '';
    const fill = opts && opts.fillable;
    const sheetId = (opts && opts.sheetId) || 'sheet';
    const answers = (opts && opts.answers) || {};
    let label = '', kind = 'plain', nUnder = 0;
    const lines = md.split('\n');
    const out = [];
    let inTable = false, inList = false;

    const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
    const closeTable = () => {
      if (inTable) { out.push('</tbody></table></div>'); inTable = false; }
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/\s+$/, (m) => (m.length >= 2 ? '  ' : ''));
      const t = line.trim();

      if (t.startsWith('|')) {
        const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        // The dashed row under a table header is a separator, not data.
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        if (!inTable) {
          closeList();
          // The wrapper scrolls rather than pushing the page sideways. The brief's table is
          // three columns of prose, and on a phone that has to go somewhere.
          out.push('<div class="tablewrap"><table><thead><tr>' +
                   cells.map((c) => `<th>${inline(c)}</th>`).join('') +
                   '</tr></thead><tbody>');
          inTable = true;
        } else {
          out.push('<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
        }
        continue;
      }
      closeTable();

      if (!t) { closeList(); continue; }
      if (/^_{5,}$/.test(t)) {
        closeList();
        if (!fill) { out.push('<div class="wline"></div>'); continue; }
        const k = answerKey(sheetId, label, nUnder++);
        const v = answers[k] == null ? '' : String(answers[k]);
        out.push('<textarea class="wfield" rows="' + (ROWS[kind] || 3) +
                 '" data-k="' + esc(k) + '" spellcheck="true" ' +
                 'aria-label="' + esc(label || 'Your answer') + '">' + esc(v) + '</textarea>');
        continue;
      }
      if (t === '---') { closeList(); out.push('<hr>'); continue; }

      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        closeList();
        const n = h[1].length;
        // A heading opens a new answer scope.
        label = h[2]; nUnder = 0;
        kind = n >= 3 ? 'beat' : 'plain';
        out.push(`<h${n}>${inline(h[2])}</h${n}>`);
        continue;
      }

      const li = t.match(/^-\s+(.*)$/);
      if (li) {
        if (!inList) { out.push('<ul>'); inList = true; }
        const box = li[1].match(/^\[ \]\s+(.*)$/);
        if (box) {
          if (!fill) {
            out.push(`<li class="chk">${inline(box[1])}</li>`);
          } else {
            const k = answerKey(sheetId, box[1], 0);
            const on = answers[k] ? ' checked' : '';
            out.push(`<li class="chk chk-live"><label><input type="checkbox" class="wchk" ` +
                     `data-k="${esc(k)}"${on}> <span>${inline(box[1])}</span></label></li>`);
          }
        } else {
          // A list item is a question in the craft and pair sheets, and the answer box that
          // follows belongs to it.
          label = li[1]; nUnder = 0; kind = 'question';
          out.push(`<li>${inline(li[1])}</li>`);
        }
        continue;
      }

      closeList();
      // A bold-only paragraph is a character-sheet field label ("**Wants**"), and the box under
      // it holds a phrase rather than a paragraph.
      const bold = t.match(/^\*\*([^*]+)\*\*/);
      if (bold) { label = bold[1]; nUnder = 0; kind = 'field'; }
      // An exercise announces its length on the line under its heading, not in it. That line
      // is the only signal that this heading wants a page to write on rather than a few lines.
      else if (/^\*\s*\d+\s*minutes?\s*\*$/i.test(t)) { kind = 'exercise'; }
      out.push(`<p>${inline(t)}</p>`);
    }
    closeList();
    closeTable();
    return out.join('\n');
  }

  /**
   * The same document as Markdown, with typed answers written in place of the blank rules.
   *
   * Copy and Download used to emit the worksheet as it was generated - every answer line still
   * blank - so someone who had filled a sheet in got an empty copy of it back. The label and
   * key rules here have to match `toHtml` exactly or the keys will not line up; `tools/smoke.py`
   * asserts that they do.
   */
  // NOT `fill` - that name is already taken above by the {{key}} substitution used for pair
  // questions and exercise bodies, and a second declaration in this scope silently replaces it.
  function fillAnswers(md, opts) {
    if (!md) return '';
    const sheetId = (opts && opts.sheetId) || 'sheet';
    const answers = (opts && opts.answers) || {};
    let label = '', nUnder = 0;
    const out = [];

    for (const raw of md.split('\n')) {
      const t = raw.trim();

      if (/^_{5,}$/.test(t)) {
        const v = answers[answerKey(sheetId, label, nUnder++)];
        out.push(v == null || v === '' || v === false ? raw : String(v));
        continue;
      }

      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) { label = h[2]; nUnder = 0; out.push(raw); continue; }

      const li = t.match(/^-\s+(.*)$/);
      if (li) {
        const box = li[1].match(/^\[ \]\s+(.*)$/);
        if (box) {
          const on = answers[answerKey(sheetId, box[1], 0)];
          out.push(raw.replace('[ ]', on ? '[x]' : '[ ]'));
        } else {
          label = li[1]; nUnder = 0;
          out.push(raw);
        }
        continue;
      }

      const bold = t.match(/^\*\*([^*]+)\*\*/);
      if (bold) { label = bold[1]; nUnder = 0; }
      out.push(raw);
    }
    return out.join('\n');
  }

  return { all, toHtml, fillAnswers, budget, answerKey };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Writer;
