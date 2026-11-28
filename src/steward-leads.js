// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Each managed conversation has one lead supervisor, the only one that may act on it. The others that manage it
 * only observe. stewards.json keeps one entry per managed conversation under "leads" (src/stewards.js), and every
 * window and the plugin's hooks (steward_table.py) read a lead the same way, through leadOf below:
 *
 *   "leads": { "<key>": { "lead": "<supervisor id>" or "", "term": <int>, "at": <ms>, "why": <one of WHY>,
 *                         "was": "<supervisor id>" or "", "pending": { "to", "at", "by" }, "tell": { "kind", "from", "text", "at" },
 *                         "intro": <one of INTROS>, "handed": true } }
 *
 * "term" goes up by one at every change of lead. A request carries the term it was written under, and a window refuses
 * it when the term has moved on since (src/relay.js), even if the same supervisor leads again. "pending" is a hand-over
 * the user agreed to that the old lead has not finished; "tell" is a note for the conversation that could not be sent,
 * which its next turn shows once. "intro" says that the lead came to it without a hand-over note, so its first message
 * starts by saying so (src/relay.js), and "handed" that the old lead's note was sent.
 *
 * Only a window writes the entries, under the table's lock and only when the file still has the term it read, so two
 * windows that decide at the same moment change a lead once. Everything here is a pure function of the table.
 */
const keys = require('./steward-keys');

const WHY = ['first', 'opened', 'new', 'migrated', 'takeover', 'panel', 'dead', 'dropped', 'archived', 'none'];
const KINDS = ['handover', 'intro', 'farewell'];
/* Why a new lead's first message must say how it got the conversation: the old lead did not hand it over, was gone,
   or there was none. */
const INTROS = ['unhanded', 'dead', 'archived', 'dropped', 'none'];
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TELL = 4000;

const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
const sup = (v) => (typeof v === 'string' && SESSION.test(v.toLowerCase()) ? v.toLowerCase() : '');

/* The "leads" of a parsed stewards.json, each entry checked; anything malformed is left out. */
function leadsOf(d) {
  const out = {};
  const all = d && d.leads && typeof d.leads === 'object' ? d.leads : {};
  for (const [k, v] of Object.entries(all)) {
    const key = keys.managedId(k);
    if (!key || !v || typeof v !== 'object') continue;
    const e = { lead: sup(v.lead), term: Math.floor(num(v.term)), at: num(v.at), why: WHY.includes(v.why) ? v.why : 'first', was: sup(v.was) };
    if (v.pending && typeof v.pending === 'object' && sup(v.pending.to)) {
      e.pending = { to: sup(v.pending.to), at: num(v.pending.at), by: v.pending.by === 'panel' ? 'panel' : 'consent' };
      if (num(v.pending.sending)) e.pending.sending = num(v.pending.sending);
    }
    if (INTROS.includes(v.intro)) e.intro = v.intro;
    if (v.handed === true) e.handed = true;
    if (v.tell && typeof v.tell === 'object' && KINDS.includes(v.tell.kind) && typeof v.tell.text === 'string') {
      e.tell = { kind: v.tell.kind, from: sup(v.tell.from), text: v.tell.text.slice(0, MAX_TELL), at: num(v.tell.at) };
    }
    out[key] = e;
  }
  return out;
}

/* The take-over questions asked: "<supervisor> <key>" -> { at, term }. */
function ticketsOf(d) {
  const out = {};
  const all = d && d.tickets && typeof d.tickets === 'object' ? d.tickets : {};
  for (const [k, v] of Object.entries(all)) {
    const [s, key] = String(k).split(' ');
    if (!sup(s) || !keys.managedId(key || '') || !v || typeof v !== 'object') continue;
    out[sup(s) + ' ' + keys.managedId(key)] = { at: num(v.at), term: Math.floor(num(v.term)) };
  }
  return out;
}

/* Whether supervisor `s` manages `key` in the settled `table` (src/stewards.js manages, without its "all" shortcut:
   a supervisor of all conversations has each of them on its list). */
const onList = (table, s, key) => !!table[s] && table[s].manages.includes(key);

/*
 * The lead of `key`: the supervisor its entry names, while that supervisor still has `key` on its list and `key` is
 * not itself a supervisor. Otherwise "": a window assigns one at its next pass.
 */
function leadOf(table, leads, key) {
  const e = leads && leads[key];
  if (!e || !e.lead || table[key]) return '';
  return onList(table, e.lead, key) ? e.lead : '';
}

/* "lead", "observer", or "" when `s` does not manage `key`. */
function roleOf(table, leads, s, key) {
  if (!onList(table, s, key)) return '';
  return leadOf(table, leads, key) === s ? 'lead' : 'observer';
}

function managedKeys(table) {
  const out = new Set();
  for (const s of Object.keys(table)) for (const k of table[s].manages) if (!table[k]) out.add(k);
  return [...out];
}

/* The supervisors with `key` on their list, in table order. */
const candidates = (table, key) => Object.keys(table).filter((s) => onList(table, s, key));

/* When `s` started managing `key`: its "since" time for `key`, falling back to when one of its switches was turned on
   and then to its entry's own time. */
function rankOf(table, s, key) {
  const t = table[s];
  return num(t.since && t.since[key]) || num(t.allSince) || num(t.newSince) || num(t.at);
}

/* Which of `list` started managing `key` first; ties go to the lower session id. */
function first(table, list, key) {
  return list.slice().sort((a, b) => (rankOf(table, a, key) - rankOf(table, b, key)) || (a < b ? -1 : a > b ? 1 : 0))[0] || '';
}

/* Whether `s` has `key` only because one of its switches added it: it neither ticked `key` by hand nor opened it. */
const bySwitch = (table, s, key) => {
  const t = table[s];
  return !!t && (t.all || t.newSince > 0) && !(t.ticked || []).includes(key);
};

/*
 * Works out the leads the table should have now from its current `leads`: `next` (the whole map) and `changes`, one
 * { key, from, to, why, term } for each conversation whose lead changed.
 *
 * - A conversation with no lead gets one: the supervisor that opened it, as `opened` (key -> supervisor) records, else
 *   the one that started managing it first; `migrated` says the table came from a version without leads.
 * - A lead that no longer manages its conversation, or is no longer a supervisor, gives way ("dropped").
 * - A lead for which `gone(s)` returns "dead" or "archived" gives way to the one a pending hand-over names, else the
 *   first of the others that is not gone.
 * A new lead is chosen among the supervisors `alive(s)` accepts, or, when none is alive, among those not gone. With
 * nobody left, the lead is "" ("none"). A conversation nobody manages any more loses its entry. A pending hand-over to
 * someone who no longer manages the conversation, or is gone, is dropped.
 */
function plan(table, leads, { now = Date.now(), gone = () => false, alive = () => true, opened = {}, migrated = false } = {}) {
  const next = {}, changes = [];
  for (const key of managedKeys(table)) {
    const cur = leads[key];
    const lead = leadOf(table, leads, key);
    const left = lead ? gone(lead) : false;
    if (lead && !left) {
      const e = Object.assign({}, cur);
      if (e.pending && (!onList(table, e.pending.to, key) || gone(e.pending.to) || e.pending.to === lead)) delete e.pending;
      next[key] = e;
      continue;
    }
    const kept = candidates(table, key).filter((s) => s !== lead && !gone(s));
    const up = kept.filter((s) => alive(s));
    const live = up.length ? up : kept;
    const o = opened[key] && kept.includes(opened[key]) ? opened[key] : '';
    const handed = cur && cur.pending && kept.includes(cur.pending.to) ? cur.pending.to : '';
    const to = handed || o || first(table, live, key);
    let why = 'none';
    if (to && (!cur || !cur.lead)) why = o ? 'opened' : !cur && migrated ? 'migrated' : bySwitch(table, to, key) && !cur ? 'new' : 'first';
    else if (to) why = left === 'archived' ? 'archived' : left ? 'dead' : 'dropped';
    if (cur && cur.lead === to) { next[key] = Object.assign({}, cur); continue; }
    const term = (cur ? cur.term : 0) + 1;
    const e = { lead: to, term, at: now, why, was: cur ? cur.lead : '' };
    if (cur && cur.tell) e.tell = cur.tell;
    next[key] = e;
    changes.push({ key, from: cur ? cur.lead : '', to, why, term });
  }
  return { next, changes };
}

/*
 * The lead of `key` to report to others. When plan assigns none, because only a supervisor of all conversations covers
 * `key` and no list has it yet, the lead is the first of `supervisors` to have started managing `key`.
 */
function leadNow(table, leads, key, supervisors = []) {
  const lead = leadOf(table, leads, key);
  if (lead) return lead;
  const next = plan(table, leads).next[key];
  if (next && next.lead) return next.lead;
  return supervisors.length ? first(table, supervisors, key) : '';
}

module.exports = { leadsOf, ticketsOf, leadOf, leadNow, roleOf, managedKeys, candidates, rankOf, plan, WHY, KINDS, INTROS };
