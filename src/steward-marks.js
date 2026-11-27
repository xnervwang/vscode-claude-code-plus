// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Titles for a supervisor's tab (supervisors are in src/stewards.js): its own title, the name the user gave it or else the
 * one Claude Code shows, with the supervisor crown after it; a tab whose conversation has a reply not read yet ends in
 * an envelope, after the crown. The session list draws both apart from the title (src/page/84-row-marks.js), so the list's titles, and
 * the text Claude Code puts in its rename boxes, carry neither. How many conversations a supervisor manages is in the
 * Supervisor panel. Which marks there are and how they are taken off a title is src/title-marks.js.
 *
 * Nothing is written to the transcript; a name typed with marks in it is stored without them (the rename edit in
 * src/host.js). When a conversation stops managing any, the crown goes.
 */
const fs = require('fs');
const path = require('path');
const stewards = require('./stewards');
const marks = require('./title-marks');

/* The supervisor mark. */
const MARK = marks.CROWN;
const { ENVELOPE, withoutMarks } = marks;

/** `own` with the crown after it. */
function stewardTitle(own) {
  return marks.withMarks(own, { steward: true });
}

/* What a table entry manages: 'all', or how many; tabTitle() treats 0 as not a supervisor. */
const size = (t) => (t.all ? 'all' : t.manages.length);

/*
 * The session list entries with every mark taken off their titles: one stored by an older build, typed by the user, or
 * put into a title by Claude Code. The panel replaces a row's title only when the new one arrives as customTitle.
 */
function cleaned(entries) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((e) => {
    if (!e || typeof e !== 'object') return e;
    const custom = typeof e.customTitle === 'string' ? withoutMarks(e.customTitle) : e.customTitle;
    const summary = typeof e.summary === 'string' ? withoutMarks(e.summary) : e.summary;
    if (custom === e.customTitle && summary === e.summary) return e;
    return Object.assign({}, e, { customTitle: custom || summary, summary });
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

/* The session ids of the supervisors in `table`, in lower case. */
const stewardIds = (table) => Object.keys(table || {}).filter((id) => table[id] && size(table[id])).map((id) => id.toLowerCase());

/*
 * Computes a tab's title. current: the title shown now. kept: what this function last set ({ original, shown }), or
 * null. custom: the user's name for the conversation. n: what size() gives, 0 if it is not a supervisor. own: the
 * conversation's own title. unseen: whether it has a reply not read yet, and envelope the form to draw it in
 * (src/envelope.js). Returns { title, kept }. A current title other than the one last set came from Claude Code and
 * becomes the one to restore, without the marks it may carry.
 */
function tabTitle(current, kept, custom, n, own, unseen = false, envelope = ENVELOPE) {
  let original = kept && kept.shown === current ? kept.original : current;
  if (withoutMarks(original) !== original) original = withoutMarks(original) || withoutMarks(own);
  if (!n && !unseen) return { title: original, kept: null };
  const shown = marks.withMarks(n ? custom || original || own : original, { steward: !!n, unseen, envelope });
  return { title: shown, kept: { original, shown } };
}

module.exports = { MARK, ENVELOPE, size, withoutMarks, stewardTitle, cleaned, tableReader, stewardIds, tabTitle };
