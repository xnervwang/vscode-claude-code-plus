// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Supervisors: a conversation the user asked to watch other conversations. It becomes one when the user ticks another
 * conversation for it in the Supervisor panel (src/steward-view.js), and stops being one when nothing is ticked.
 *
 * Who manages whom is kept in stewards.json in the plan directory, so every window and the plugin's supervisor hooks
 * (claude-plugin/agent-work-plan/hooks/steward.py, steward_table.py) read the same answer. The panel writes it.
 * src/relay.js writes it too, in the window that shows a supervisor: when that supervisor asks to change its own list, and
 * when it ticks a conversation the supervisor has just opened.
 *
 * A conversation can have several supervisors, each of which ticks it on its own. Only its lead may act on it
 * (src/steward-leads.js); the others observe it. A supervisor has none: a conversation that becomes a supervisor leaves
 * every list it was on.
 *
 *   { "version": 3, "stewards": { "<supervisor session id>": { "manages": ["<key>", ...],
 *                                                          "ticked": ["<key>", ...],
 *                                                          "names": { "<key>": "title" },
 *                                                          "paths": { "<key>": "<plan file>" }, "at": <ms>,
 *                                                          "all": true, "title": "<the supervisor's own title>",
 *                                                          "newSince": <ms>, "newSkip": ["<key>", ...],
 *                                                          "newBefore": ["<key>", ...], "allSince": <ms>,
                                                          "since": { "<key>": <ms> } } },
 *     "leads": { "<key>": <its lead, src/steward-leads.js> }, "tickets": { "<supervisor> <key>": { at, term } }, "rev": <n> }
 *
 * A key is a Claude Code session id, or `<source id>:<session id>` for another agent's conversation
 * (src/steward-keys.js); a supervisor is always a Claude Code conversation. "paths" gives the plan file of each such
 * conversation, as its source gave it when the conversation was ticked: the plugin's hooks cannot ask Agent Plus, and
 * the file's name is the source's own. Version 1 had only session ids and no "paths", version 2 allowed one supervisor
 * per conversation, and version 3 had no leads; such a table is read unchanged and is written as version 4 at its next
 * change, with a lead for each managed conversation. This build reads what it understands of a table of a later
 * version and never writes one, so that it does not drop what the later build added.
 *
 * "since" records when the supervisor started managing each conversation, and "allSince" when it turned "All, including
 * new ones" on: when a conversation has no lead, the supervisor that started managing it first leads it.
 * "tickets" are the take-over questions a supervisor asked the user (src/relay.js), and "rev" counts the writes.
 *
 * Every write takes the file's lock (src/file-lock.js) and reads the file again while holding it, so two windows that
 * write the table at the same moment both keep their edits, and a lead changes only once.
 *
 * "all" is there only when the user ticked "All, including new ones": the panel in the supervisor's window then keeps
 * "manages" equal to every conversation open in a VS Code window that is no supervisor (src/steward-view.js). "ticked" is
 * the part of "manages" ticked by hand, or opened by the supervisor itself, rather than added by "all"; it is written only
 * for a supervisor with "all" on, since every other supervisor's list is all ticked.
 *
 * "newSince" is there while "New conversations" is on: the supervisor's window adds to its list each conversation that
 * starts after that time, except supervisors and the ones in "newSkip", which were unticked while the switch was on.
 * Another agent's conversation has no start time this extension can read, so one counts as new when it was not among
 * "newBefore", that agent's conversations listed when the switch was turned on.
 *
 * Every reader takes the file through settle(), whatever wrote it, so a table an older build wrote with a supervisor on a
 * list reads the same in every window and hook; the window that may write the table writes the settled one back
 * (migrate).
 *
 * The titles are the ones the panel showed when the file was last written; the hooks print them, since they have no
 * other cheap way to name a conversation that is not running.
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { planDir, SESSION, writeAtomic } = require('./claude-files');
const duplicates = require('./duplicates');
const keys = require('./steward-keys');
const leadsOf = require('./steward-leads');
const titleMarks = require('./title-marks');
const { withLock, writeLocked, readWhole, LockLost } = require('./file-lock');

const FILE = 'stewards.json';
const VERSION = 4;
const MAX_MANAGED = 100;
const MAX_NAME = 200;
/* How long to wait for a supervisor's inbox to accept a notice. */
const POST_TIMEOUT_MS = 3000;
/* When the old lead has not finished a hand-over within this time, it is made without its note. */
const HAND_OVER_MS = 10 * 60 * 1000;
/* The user's yes to a take-over question counts only within this time of the question. */
const TICKET_MS = 30 * 60 * 1000;

const ids = (list, not) => [...new Set((Array.isArray(list) ? list : [])
  .map(keys.managedId).filter((x) => x && x !== not))].slice(0, MAX_MANAGED);
const when = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

function pathsOf(given, manages) {
  const out = {};
  if (!given || typeof given !== 'object') return out;
  for (const m of manages) if (keys.planFileOk(m, given[m])) out[m] = given[m];
  return out;
}

/* The entries of a parsed file, each { manages, ticked, names, paths, at, all, title, newSince, newSkip, newBefore }
   with `ticked` as written (null when absent), before settle(). */
function entriesOf(d) {
  const out = {};
  const all = d && d.stewards && typeof d.stewards === 'object' ? d.stewards : {};
  for (const [key, v] of Object.entries(all)) {
    if (!SESSION.test(key) || !v || typeof v !== 'object') continue;
    const id = key.toLowerCase();
    const manages = ids(v.manages, id);
    const names = {};
    for (const m of manages) if (v.names && typeof v.names[m] === 'string') names[m] = v.names[m].slice(0, MAX_NAME);
    const since = when(v.newSince) > 0 ? v.newSince : 0;
    const began = {};
    for (const m of manages) if (v.since && when(v.since[m]) > 0) began[m] = v.since[m];
    out[id] = { manages, ticked: Array.isArray(v.ticked) ? ids(v.ticked, id) : null, names, paths: pathsOf(v.paths, manages),
      at: when(v.at), all: v.all === true, title: typeof v.title === 'string' ? v.title.slice(0, MAX_NAME) : '',
      newSince: since, newSkip: since ? ids(v.newSkip, id) : [], newBefore: since ? ids(v.newBefore, id) : [],
      allSince: v.all === true ? when(v.allSince) : 0, since: began };
  }
  return out;
}

/* Whether entry `e` makes its conversation a supervisor. */
const isSteward = (e) => !!e && (e.manages.length > 0 || e.all || e.newSince > 0);

/*
 * The table as the rules have it, from `entries` (entriesOf). A supervisor without "ticked" has ticked everything it
 * manages, unless it has "all" on: then its whole list counts as coming from "all". The entries are taken oldest
 * first; each keeps what it manages except conversations that are supervisors by then. An entry that keeps anything, or
 * has a switch on, becomes a supervisor and leaves every list it is on, and the entry it leaves may end up with nothing.
 * An entry with nothing and both switches off is no supervisor.
 */
function settle(entries) {
  const order = Object.keys(entries).sort((a, b) => (entries[a].at - entries[b].at) || (a < b ? -1 : a > b ? 1 : 0));
  const out = {};
  const drop = (h, c) => {
    const t = out[h];
    t.manages = t.manages.filter((x) => x !== c);
    t.ticked = t.ticked.filter((x) => x !== c);
    delete t.names[c];
    delete t.paths[c];
    delete t.since[c];
    if (!isSteward(t)) delete out[h];
  };
  for (const id of order) {
    const e = entries[id];
    const mine = new Set(e.all ? e.ticked || [] : e.manages);
    const list = e.manages.filter((c) => c !== id && !out[c]);
    const t = { manages: list, ticked: list.filter((c) => mine.has(c)), names: {}, paths: {}, at: e.at, all: e.all,
      title: e.title || '', newSince: e.newSince || 0, newSkip: e.newSince ? (e.newSkip || []).slice() : [],
      newBefore: e.newSince ? (e.newBefore || []).slice() : [], allSince: e.all ? e.allSince || 0 : 0, since: {} };
    if (!isSteward(t)) continue;
    for (const h of Object.keys(out)) if (out[h].manages.includes(id)) drop(h, id);
    for (const c of list) if (e.names[c]) t.names[c] = e.names[c];
    for (const c of list) if (e.paths && e.paths[c]) t.paths[c] = e.paths[c];
    for (const c of list) if (e.since && e.since[c]) t.since[c] = e.since[c];
    out[id] = t;
  }
  return out;
}

/* The file's JSON, or null when there is none yet or it cannot be read; a read made during another window's write is
   tried again until that write is done (file-lock.js readWhole). */
function parse(dir) {
  return readWhole(path.join(dir, FILE));
}

/** supervisor id -> { manages, ticked, names, paths, at, all, title, newSince, newSkip, newBefore }, settled, leaving out
    anything malformed and supervisors that manage nothing and have both switches off. */
function read(dir = planDir()) {
  return settle(entriesOf(parse(dir)));
}

function newer(dir = planDir()) {
  const d = parse(dir);
  return d && typeof d.version === 'number' && d.version > VERSION ? d.version : 0;
}

/* `table` as the file stores it. */
function stewardsOut(table) {
  const out = {};
  for (const [id, v] of Object.entries(table)) {
    out[id] = { manages: v.manages, names: v.names, at: v.at };
    if (v.paths && Object.keys(v.paths).length) out[id].paths = v.paths;
    if (v.all) { out[id].all = true; out[id].ticked = v.ticked; if (v.allSince) out[id].allSince = v.allSince; }
    if (v.title) out[id].title = v.title;
    if (v.newSince) {
      out[id].newSince = v.newSince;
      if (v.newSkip && v.newSkip.length) out[id].newSkip = v.newSkip;
      if (v.newBefore && v.newBefore.length) out[id].newBefore = v.newBefore;
    }
    if (v.since && Object.keys(v.since).length) out[id].since = v.since;
  }
  return out;
}

/* A table's content as one string. Two tables that differ only in key order, in the fields they leave out or in their
   version give the same string. */
const meaning = (t) => JSON.stringify(Object.keys(t).sort().map((id) => {
  const v = t[id], paths = v.paths || {}, since = v.newSince || 0, began = v.since || {};
  return [id, v.manages, v.all ? (v.ticked || []).filter((c) => v.manages.includes(c)) : null,
    Object.keys(v.names).sort().map((c) => [c, v.names[c]]), Object.keys(paths).sort().map((c) => [c, paths[c]]), v.at, !!v.all,
    v.title || '', since, since ? v.newSkip || [] : [], since ? v.newBefore || [] : [], v.all ? v.allSince || 0 : 0,
    Object.keys(began).sort().map((c) => [c, began[c]])];
}));
const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

/*
 * How the windows learn who is alive (src/steward-view.js sets it): alive(id) whether a live window shows supervisor
 * `id` now, gone(id) "dead" once it has not been for DEAD_AFTER_MS, "archived" once it is archived, else false. Until a
 * window sets it, every supervisor counts as alive, so nothing is reassigned on a guess.
 */
let liveness = { alive: () => true, gone: () => false };
function setLiveness(l) { liveness = Object.assign({ alive: () => true, gone: () => false }, l || {}); }
let leadListeners = [];
/* fn(changes, state) after a write that changed any lead: { key, from, to, why, term, handed } each. */
function onLeadChange(fn) { leadListeners.push(fn); return { dispose: () => { leadListeners = leadListeners.filter((f) => f !== fn); } }; }

/*
 * Reads the table, applies `change` to it and writes it back, all under the file's lock. `change(state)` gets { table,
 * leads, tickets } (the table settled, the leads as read) and may change any of them in place or return a new table.
 * steward-leads.js plan then works the leads out again, with `opened` mapping each conversation a supervisor has just
 * opened to that supervisor, and hand-overs pending for longer than HAND_OVER_MS are made without their note. The file
 * is written only when something changed. Returns { table, leads, tickets, changes, wrote }, or the state as read when
 * the file is of a later version, which this build never writes.
 */
function update(dir = planDir(), change = () => {}, opts = {}) {
  for (let tries = 0; ; tries++) {
    try { return updateOnce(dir, change, opts); } catch (e) {
      /* Another window took the lock over from this one, which was too slow, so this window's change was not
         written; it is made again. */
      if (!(e instanceof LockLost) || tries >= 2) throw e;
    }
  }
}
function updateOnce(dir, change, { now = Date.now(), opened = {} } = {}) {
  const file = path.join(dir, FILE);
  fs.mkdirSync(dir, { recursive: true });
  const out = withLock(file, () => {
    const d = parse(dir);
    const later = d && typeof d.version === 'number' && d.version > VERSION;
    const entries = entriesOf(d);
    const before = { table: meaning(entries), leads: sorted(leadsOf.leadsOf(d)), tickets: sorted(leadsOf.ticketsOf(d)) };
    const state = { table: settle(entries), leads: leadsOf.leadsOf(d), tickets: leadsOf.ticketsOf(d) };
    if (later) return Object.assign(state, { changes: [], wrote: false });
    const was = {};
    for (const [k, v] of Object.entries(state.leads)) was[k] = v.lead;
    const given = change(state);
    if (given && typeof given === 'object' && !Array.isArray(given) && given !== state) state.table = given;
    state.table = settle(state.table);
    for (const [k, e] of Object.entries(state.leads)) {
      if (!e.pending || now - e.pending.at < HAND_OVER_MS) continue;
      const to = e.pending.to;
      state.leads[k] = { lead: to, term: e.term + 1, at: now, why: e.pending.by === 'panel' ? 'panel' : 'takeover', was: e.lead };
      /* A note that was on its way may have arrived, so the new lead's first message does not say how it got the
         conversation. */
      if (!e.pending.sending) state.leads[k].intro = 'unhanded';
      else state.leads[k].handed = true;
      if (e.tell) state.leads[k].tell = e.tell;
    }
    for (const [t, v] of Object.entries(state.tickets)) if (!(now - v.at < TICKET_MS)) delete state.tickets[t];
    const p = leadsOf.plan(state.table, state.leads, { now, gone: liveness.gone, alive: liveness.alive, opened,
      migrated: !!d && typeof d.version === 'number' && d.version < 4 });
    for (const c of p.changes) if (c.why === 'dead' || c.why === 'archived' || c.why === 'dropped') p.next[c.key].intro = c.why;
    state.leads = p.next;
    const changes = [];
    for (const [k, v] of Object.entries(state.leads)) {
      if ((was[k] || '') !== v.lead) changes.push({ key: k, from: was[k] || '', to: v.lead, why: v.why, term: v.term, handed: !!v.handed });
    }
    for (const k of Object.keys(was)) if (!state.leads[k] && was[k]) changes.push({ key: k, from: was[k], to: '', why: 'none', term: 0, handed: false });
    const after = { table: meaning(state.table), leads: sorted(state.leads), tickets: sorted(state.tickets) };
    const wrote = !d || d.version !== VERSION || after.table !== before.table || after.leads !== before.leads || after.tickets !== before.tickets;
    if (wrote) {
      const rev = (d && typeof d.rev === 'number' ? d.rev : 0) + 1;
      writeLocked(file, JSON.stringify({ version: VERSION, stewards: stewardsOut(state.table), leads: state.leads, tickets: state.tickets, rev }, null, 1) + '\n');
    }
    return Object.assign(state, { changes, wrote });
  });
  if (out.changes.length) for (const fn of leadListeners.slice()) { try { fn(out.changes, out); } catch (_) { /* the listener's own */ } }
  return out;
}

/*
 * Makes `sup` the lead of `key`, as the user chose in the Supervisor panel. As with a take-over the user agreed to in a
 * supervisor conversation (src/relay.js takeLead), a lead that is alive hands the conversation over first (the caller
 * tells it to); when the lead is gone, or there is none, the conversation changes hands at once. Returns { outcome:
 * 'lead' | 'pending' | 'refused', reason, lead }, `lead` being the lead it had before.
 */
function takeLead(dir, key, sup, { by = 'panel', now = Date.now() } = {}) {
  let out = { outcome: 'refused', reason: 'that supervisor does not manage the conversation', lead: '' };
  update(dir, ({ table, leads: L }) => {
    if (!leadsOf.candidates(table, key).includes(sup)) return;
    const e = L[key], lead = leadsOf.leadOf(table, L, key);
    if (lead === sup) { out = { outcome: 'lead', reason: '', lead }; return; }
    if (e && e.pending && e.pending.to !== sup) { out = { outcome: 'refused', reason: 'it is being handed over to another supervisor', lead }; return; }
    if (lead && liveness.alive(lead) && !liveness.gone(lead)) {
      L[key] = Object.assign({}, e, { pending: { to: sup, at: now, by } });
      out = { outcome: 'pending', reason: '', lead };
      return;
    }
    L[key] = { lead: sup, term: (e ? e.term : 0) + 1, at: now, why: by === 'panel' ? 'panel' : 'takeover', was: lead || (e ? e.lead : ''), intro: lead ? 'unhanded' : 'none' };
    if (e && e.tell) L[key].tell = e.tell;
    out = { outcome: 'lead', reason: '', lead };
  }, { now });
  return out;
}

/** The table, its leads and tickets as read, without writing. */
function state(dir = planDir()) {
  const d = parse(dir);
  return { table: settle(entriesOf(d)), leads: leadsOf.leadsOf(d), tickets: leadsOf.ticketsOf(d), version: d && d.version };
}

/** Writes the settled table back when it differs from what the file holds, and gives each managed conversation that
    has none a lead. Returns true when it wrote the file. Only a window allowed to save the table calls it. */
function migrate(dir = planDir()) {
  if (!parse(dir)) return false;
  return update(dir).wrote;
}

function manages(table, steward, id) {
  const t = table[steward];
  return !!t && (t.manages.includes(id) || (t.all && id !== steward && !table[id]));
}

/*
 * The supervisors that manage `key`, in table order; none when `key` is a supervisor, or another agent's conversation of a
 * source no supervisor can manage (keys.allowed). The relay sends that conversation's handoffs to one of them
 * (src/relay.js).
 */
function stewardsOf(table, key) {
  if (typeof key !== 'string' || !key || table[key]) return [];
  if (!keys.isClaude(key) && !keys.allowed(key)) return [];
  return Object.keys(table).filter((s) => manages(table, s, key));
}

/* `list` ordered by when the user last typed to each supervisor (`userAt(id)`, 0 when unknown), most recent first, and by
   session id between supervisors with the same time. */
const byUser = (list, userAt) => list.map((s) => ({ s, at: Number(userAt(s)) || 0 }))
  .sort((a, b) => (b.at - a.at) || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0)).map((x) => x.s);

/**
 * Sets what `steward` manages to `list`, with the titles in `names` and, for another agent's conversations, the plan
 * files in `paths`; a conversation missing from either keeps what the table had for it. `every` turns "all" on or off,
 * and `later` turns "New conversations" on or off; `before` gives the other agents' conversations listed when it is
 * turned on. Without them the settings stay. With "all" on, `ticked` lists the conversations in `list` that were ticked
 * by hand (by default, those ticked before); with it off, the whole list counts as ticked. `title` is the supervisor's own
 * title. Supervisors are left out of the list. An empty list removes the supervisor from the table unless a switch is on.
 */
function setManaged(steward, list, names = {}, { dir = planDir(), now = Date.now(), every, ticked, paths = {}, title, later, before, opened = '' } = {}) {
  if (typeof steward !== 'string' || !SESSION.test(steward)) return read(dir);
  const id = steward.toLowerCase();
  const key = keys.managedId(opened);
  return update(dir, ({ table }) => setIn(table, id, list, names, { now, every, ticked, paths, title, later, before }),
    { now, opened: key ? { [key]: id } : {} }).table;
}

/* Applies setManaged's change to `all`, the settled table, and returns it. */
function setIn(all, id, list, names, { now, every, ticked, paths, title, later, before }) {
  const was = all[id];
  const keepAll = typeof every === 'boolean' ? every : !!(was && was.all);
  const since = later === true ? (was && was.newSince) || now : later === false ? 0 : (was ? was.newSince : 0);
  const own = keepAll ? new Set(Array.isArray(ticked) ? ids(ticked, id) : was ? was.ticked : []) : null;
  const manages = ids(list, id).filter((m) => !all[m]);
  let skip = [], seen = [];
  if (since) {
    const same = was && was.newSince === since ? was : null;
    skip = same ? same.newSkip.slice() : [];
    for (const m of same ? same.manages : []) if (!manages.includes(m) && !skip.includes(m)) skip.push(m);
    skip = skip.filter((m) => !manages.includes(m)).slice(-MAX_MANAGED);
    seen = same ? same.newBefore : ids(before, id);
  }
  if (manages.length || keepAll || since) {
    const kept = {}, files = {};
    for (const m of manages) {
      const t = names && typeof names[m] === 'string' ? names[m] : was && was.names[m];
      if (typeof t === 'string' && t) kept[m] = t.slice(0, MAX_NAME);
      const f = paths && keys.planFileOk(m, paths[m]) ? paths[m] : was && was.paths[m];
      if (f) files[m] = f;
    }
    const own_ = typeof title === 'string' && title ? title.slice(0, MAX_NAME) : (was && was.title) || '';
    const began = {};
    for (const m of manages) began[m] = (was && was.since && was.since[m]) || now;
    const allSince = keepAll ? (was && was.all && was.allSince) || now : 0;
    all[id] = { manages, ticked: own ? manages.filter((m) => own.has(m)) : manages, names: kept, paths: files, at: now, all: keepAll,
      title: own_, newSince: since, newSkip: skip, newBefore: seen, allSince, since: began };
  } else delete all[id];
  return all;
}

/** Refreshes the saved titles, the supervisors' own among them. */
function rename(names, { dir = planDir() } = {}) {
  let changed = false;
  update(dir, ({ table: all }) => {
    for (const [id, v] of Object.entries(all)) {
      for (const m of v.manages) {
        const t = typeof names[m] === 'string' ? names[m].slice(0, MAX_NAME) : '';
        if (t && v.names[m] !== t) { v.names[m] = t; changed = true; }
      }
      const own = typeof names[id] === 'string' ? names[id].slice(0, MAX_NAME) : '';
      if (own && own !== id && v.title !== own) { v.title = own; changed = true; }
    }
  });
  return changed;
}

/*
 * The line a supervisor's message to a conversation starts with, and the supervisor it names. The managed conversation reads
 * it to know which supervisor the message is from (hooks/steward.py says so each turn), and the relay reads it in that
 * conversation's transcript to find the supervisor that started a turn. hooks/steward_table.py parses the same form.
 * The line is written with "supervisor"; one that says "steward", as earlier builds wrote it, is read the same way, and
 * letter case does not matter.
 * The title loses every mark (src/title-marks.js) here, whatever the caller passed: a stored title can still carry
 * one that an older build wrote into it, and the line names the supervisor by its title alone.
 */
const FROM_HEAD = 'Sent by the supervisor ';
const FROM_TAIL = ' for the user:';
const FROM_START = /^\s*Sent by the (?:supervisor|steward) /i;
const FROM = /^Sent by the (?:supervisor|steward) (?:"(.*)" )?\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\) for the user:[ \t]*$/i;
function fromLine(steward, title) {
  const t = titleMarks.withoutMarks(String(title || '')).replace(/\s+/g, ' ').trim();
  return `${FROM_HEAD}${t && t !== steward ? `"${t}" ` : ''}(${steward})${FROM_TAIL}`;
}
/* { steward, title } named by the first line of `text`, or null. */
function senderOf(text) {
  const first = String(text || '').replace(/^\s+/, '').split(/\r?\n/)[0];
  const m = FROM.exec(first);
  return m ? { steward: m[2].toLowerCase(), title: m[1] || '' } : null;
}
const withFrom = (steward, title, text) => fromLine(steward, title) + '\n' + text;
/* `text` after the line a supervisor's message starts with, or `text` itself when it does not start with one; '' when it
   is that line alone or is cut short inside it. Claude Code titles a conversation with its first message until it has
   a better title, which for one a supervisor started is that line. */
const FROM_LEAD = /^\s*Sent by the (?:supervisor|steward) (?:"[\s\S]*?" )?\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\) for the user:/i;
function withoutFrom(text) {
  const s = String(text || '');
  if (!FROM_START.test(s)) return s;
  const m = FROM_LEAD.exec(s);
  return m ? s.slice(m[0].length).replace(/^\s+/, '') : '';
}
/* A title for a conversation a supervisor started with `text`: the first line of the user's words, cut at a word to at most
   TITLE_MAX characters; '' when there are none. */
const TITLE_MAX = 60;
function titleOfWords(text) {
  const line = (withoutFrom(text).split(/\r?\n/).find((l) => l.trim()) || '').replace(/\s+/g, ' ').trim();
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX - 1), space = cut.lastIndexOf(' ');
  return (space > TITLE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '') + '\u2026';
}

/* Records of typed text are kept under this hash, which ignores whitespace as the transcript check (src/sent-check.js)
   does when it compares a message. */
const textHash = (text) => crypto.createHash('sha256').update(String(text || '').replace(/[\s\u200b]+/g, ''), 'utf8').digest('hex');

/* Notices from earlier builds begin with "Steward notice". */
const NOTICE_HEAD = 'Supervisor notice from Claude Code Plus';
const NOTICE = /^(?:Supervisor|Steward) notice from Claude Code Plus/i;
const isNotice = (text) => NOTICE.test(String(text || ''));

/*
 * The notices a supervisor is sent when one of its conversations stops: a turn that ended, or a conversation that started
 * waiting for the user. `before` and `after` map a session id to its state in the Conversations view's words
 * (working, background, prompt, unread, idle). One that had only background work left stops when that work ends. A
 * conversation seen for the first time sends nothing.
 */
function changes(before, after, manages) {
  const out = [];
  for (const id of manages) {
    const was = before.get(id), now = after.get(id);
    if (was === undefined || now === undefined || was === now) continue;
    if (now === 'prompt') out.push({ id, what: 'waiting' });
    else if ((was === 'working' || was === 'background') && (now === 'idle' || now === 'unread')) out.push({ id, what: 'done' });
  }
  return out;
}

function stopLine(procs) {
  const p = duplicates.oldOne(procs);
  if (p) return `The Stop the old process button in the Supervisor panel stops pid ${p.pid}, and so does kill ${p.pid}.`;
  return 'They run copies kept in different folders, and no copy is far enough behind the others to count as stale, so the '
    + 'Supervisor panel offers no button to stop one; the user closes the tab of the process that should stop.';
}

/*
 * The notice text, which opens by saying it is from this extension and not from the user. `details` gives, by session
 * id, { state, doing, asks, waitingOn, held }: carrying them saves the supervisor a tool call per conversation, and each
 * call makes it read its whole context again. `asks` holds only questions no supervisor has been given. `held` lists
 * { text, steward, title } for a question or a wait another supervisor of the conversation was given, so that the user is
 * asked once. On an "ended" entry of `list`, `why` is the notice's words for the work that stopped.
 */
function noticeText(list, names, details = {}) {
  const said = new Set();
  const line = (c) => {
    const name = names[c.id] ? `"${names[c.id]}"` : 'a conversation';
    const d = details[c.id];
    const head = c.what === 'waiting' ? `- ${name} (${c.id}) is waiting for the user.`
      : c.what === 'ended' ? `- ${name} (${c.id}): its ${c.why}.`
        : c.what === 'twice' ? `- ${name} (${c.id}) is run by ${c.procs.length} processes at once: `
          + `${c.procs.map(duplicates.describe).join('; ')}. ${stopLine(c.procs)}`
          : c.what === 'stopped' ? `- ${name} (${c.id}): Claude Code Plus stopped its process ${duplicates.describe(c.stop)}, `
            + `${c.stop.how === 'auto' ? 'as it was idle and its window was gone' : 'from the Stop the old process button'}.`
            : `- ${name} (${c.id}) finished its turn.`;
    if (!d || said.has(c.id)) return head;
    said.add(c.id);
    const more = [`  Now: ${d.state}${d.doing && d.doing.length ? '; doing: ' + d.doing.join(' · ') : ''}`];
    if (d.waitingOn) more.push(`  Waiting on ${d.waitingOn}`);
    for (const q of d.asks || []) more.push(`  Question for the user: ${q}`);
    for (const h of d.held || []) {
      more.push(`  Already given to the supervisor ${h.title ? `"${h.title}" ` : ''}(${h.steward}), which asks the user: ${h.text}`);
    }
    return [head].concat(more).join('\n');
  };
  return NOTICE_HEAD + ', not a message from the user. Conversations you manage changed:\n'
    + list.map(line).join('\n')
    + '\nRead one with the supervisor skill\'s steward-peek.py only if you need its latest reply. If none of it needs the'
    + ' user, reply with exactly [[quiet]] or a single dash.';
}

/*
 * Posts `text` to a session's inbox socket, which Claude Code documents for scripts posting into a session
 * (https://code.claude.com/docs/en/cross-session-messaging.md, "The session's inbox socket"). The line it reads is not
 * documented; this is the shape Claude Code 2.1.322 takes (test/against-latest.js checks the newest release still does).
 * An idle session starts a turn with it. Not on native Windows, where a connection must first authenticate with a token
 * only the session itself holds.
 */
function post(address, text, { from = 'claude-code-plus', timeoutMs = POST_TIMEOUT_MS, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (platform === 'win32' || typeof address !== 'string' || !address) { resolve(false); return; }
    const where = address.startsWith('uds:') ? address.slice(4) : address;
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    let sock;
    try { sock = net.connect(where); } catch (_) { finish(false); return; }
    const timer = setTimeout(() => { try { sock.destroy(); } catch (_) { /* gone */ } finish(false); }, timeoutMs);
    sock.on('error', () => { clearTimeout(timer); finish(false); });
    sock.on('connect', () => {
      sock.end(JSON.stringify({ type: 'user', message: { content: text }, from }) + '\n', () => { clearTimeout(timer); finish(true); });
    });
  });
}

module.exports = { read, state, update, takeLead, setManaged, rename, migrate, newer, settle, entriesOf, isSteward, manages, stewardsOf, byUser, changes,
  noticeText, post, setLiveness, onLeadChange, NOTICE_HEAD, isNotice, fromLine, senderOf, withFrom, withoutFrom, titleOfWords, textHash, FILE,
  VERSION, MAX_MANAGED, HAND_OVER_MS, TICKET_MS };
