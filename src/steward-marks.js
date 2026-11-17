// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Titles for a steward's tab and session list row (stewards are in src/stewards.js): its own title, the name the user
 * gave it or else the one Claude Code shows, with a bell appended. How many conversations it manages is in the Steward
 * panel.
 *
 * Nothing is written to the transcript. When it stops managing any conversation, the bell goes.
 */
const fs = require('fs');
const path = require('path');
const stewards = require('./stewards');

const BELL = '\u{1F6CE}\uFE0F';
const ENDS = [' ' + BELL, ' \u{1F6CE}'];

/** `title` without a bell this module put at its end. */
function withoutBell(title) {
  const text = String(title == null ? '' : title);
  const end = ENDS.find((e) => text.endsWith(e));
  return end ? text.slice(0, -end.length) : text;
}

/** `own` with a bell after it. */
function stewardTitle(own) {
  const text = withoutBell(String(own || '').trim()).trim();
  return text ? text + ' ' + BELL : BELL;
}

/* What a table entry manages: 'all', or how many; tabTitle() treats 0 as not a steward. */
const size = (t) => (t.all ? 'all' : t.manages.length);

/* After a conversation stops being a steward, its own title is sent for this long, so every panel restores it. */
const UNDO_MS = 10 * 60000;

/*
 * Returns the session list entries with steward titles applied. The panel replaces a row's title only when the new one
 * arrives as customTitle, so the steward title, and later the restored title, are sent in that field. `marks` maps each
 * marked conversation to the time it stopped being a steward (0 while it still is); this function updates it.
 * `named(id)` returns the name the user gave a conversation. The entry's customTitle cannot answer that, since it also
 * holds the title Claude Code generated.
 */
function marked(entries, table, marks = new Map(), now = Date.now(), named = () => '') {
  if (!Array.isArray(entries)) return entries;
  for (const [id, until] of marks) if (until && now - until > UNDO_MS) marks.delete(id);
  if (!Object.keys(table || {}).length && !marks.size) return entries;
  return entries.map((e) => {
    const raw = e && (e.sessionId || e.id);
    const id = typeof raw === 'string' ? raw.toLowerCase() : '';
    const t = id && table && table[id];
    if (t) {
      marks.set(id, 0);
      return Object.assign({}, e, { customTitle: stewardTitle(named(id) || e.customTitle || e.summary) });
    }
    if (!id || !marks.has(id)) return e;
    if (!marks.get(id)) marks.set(id, now);
    const own = e.customTitle || e.summary;
    return own ? Object.assign({}, e, { customTitle: own }) : e;
  });
}

/* stewards.read, cached until the file's size or modification time changes. */
function tableReader(dir) {
  let key = null, table = {};
  return () => {
    let st = null;
    try { st = fs.statSync(path.join(dir, stewards.FILE)); } catch (_) { /* none */ }
    const k = st ? st.size + ':' + st.mtimeMs : '';
    if (k !== key) { key = k; table = st ? stewards.read(dir) : {}; }
    return table;
  };
}

/*
 * Computes a tab's title. current: the title shown now. kept: what this function last set ({ original, shown }), or
 * null. custom: the user's name for the conversation. n: what size() gives, 0 if it is not a steward. own: the
 * conversation's own title. Returns { title, kept }. A current title other than the one last set came from Claude Code
 * and becomes the one to restore, unless it is a steward title itself: the panel can copy the list's title to the tab.
 */
function tabTitle(current, kept, custom, n, own) {
  let original = kept && kept.shown === current ? kept.original : current;
  if (withoutBell(original) !== original) original = own || withoutBell(original);
  if (!n) return { title: original, kept: null };
  const shown = stewardTitle(custom || original || own);
  return { title: shown, kept: { original, shown } };
}

module.exports = { BELL, size, withoutBell, stewardTitle, marked, tableReader, tabTitle };
