// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Stewards: a conversation the user asked to watch other conversations. It becomes one when the user ticks another
 * conversation for it in the Steward panel (src/steward-view.js), and stops being one when nothing is ticked.
 *
 * Who manages whom is kept in stewards.json in the plan directory, so every window and the plugin's steward hooks
 * (claude-plugin/agent-work-plan/hooks/steward.py, steward_table.py) read the same answer. Only the panel writes it, and a
 * window that has just opened a conversation for a steward, which ticks it for that steward (src/relay.js); a steward
 * cannot otherwise change what it manages.
 *
 * One conversation has one steward at most, and a steward has none: a conversation that becomes a steward leaves every
 * list it was on, one ticked by a steward cannot be ticked by another, and only one steward at a time has "all" on.
 *
 *   { "version": 1, "stewards": { "<steward session id>": { "manages": ["<session id>", ...],
 *                                                          "ticked": ["<session id>", ...],
 *                                                          "names": { "<session id>": "title" }, "at": <ms>,
 *                                                          "all": true } } }
 *
 * "all" is there only when the user ticked "All, including new ones": the panel in the steward's window then keeps
 * "manages" equal to every conversation open in a VS Code window that is no steward and that no other steward has
 * ticked (src/steward-view.js). "ticked" is the part of "manages" ticked by hand, or opened by the steward itself, rather
 * than added by "all"; it is written only for the steward with "all" on, since every other steward's list is all ticked.
 * A tick wins over "all": when another steward ticks a conversation that the steward with "all" on has only because of
 * "all", the conversation moves to the steward that ticked it.
 *
 * Every reader takes the file through settle(), whatever wrote it, so a table an older build wrote with a conversation on
 * two lists, a steward on a list, or "all" on twice reads the same in every window and hook; the window that may write
 * the table writes the settled one back (migrate).
 *
 * The titles are the ones the panel showed when the file was last written; the hook prints them, since it has no other
 * cheap way to name a conversation that is not running.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { planDir, SESSION, writeAtomic } = require('./claude-files');
const duplicates = require('./duplicates');

const FILE = 'stewards.json';
const MAX_MANAGED = 100;
const MAX_NAME = 200;
/* How long to wait for a steward's inbox to accept a notice. */
const POST_TIMEOUT_MS = 3000;

const ids = (list, not) => [...new Set((Array.isArray(list) ? list : [])
  .filter((x) => typeof x === 'string' && SESSION.test(x)).map((x) => x.toLowerCase()).filter((x) => x !== not))].slice(0, MAX_MANAGED);

/* The entries of a parsed file, each { manages, ticked, names, at, all } with `ticked` as written (null when absent),
   before settle(). */
function entriesOf(d) {
  const out = {};
  const all = d && d.stewards && typeof d.stewards === 'object' ? d.stewards : {};
  for (const [key, v] of Object.entries(all)) {
    if (!SESSION.test(key) || !v || typeof v !== 'object') continue;
    const id = key.toLowerCase();
    const manages = ids(v.manages, id);
    const names = {};
    for (const m of manages) if (v.names && typeof v.names[m] === 'string') names[m] = v.names[m].slice(0, MAX_NAME);
    out[id] = { manages, ticked: Array.isArray(v.ticked) ? ids(v.ticked, id) : null, names,
      at: typeof v.at === 'number' && isFinite(v.at) ? v.at : 0, all: v.all === true };
  }
  return out;
}

/*
 * The table as the rules have it, from `entries` (entriesOf). "all" stays on for only one steward, the one whose entry
 * changed last; the others keep their lists, and each of those lists then counts as ticked. A steward without "ticked"
 * has ticked everything it manages, unless it is the one with "all" on: then its whole list counts as coming from
 * "all". The entries are then taken oldest first, the order the ticks were made in. Each keeps what it manages except a
 * conversation that is a steward by then, and except one another steward has, unless it ticked that one itself; a later
 * tick takes a conversation away from an earlier steward. A conversation it has only through "all" it keeps only if
 * nobody else has it. An entry that keeps anything becomes a steward and leaves every list it is on, and the entry it
 * leaves may end up with nothing. An entry with nothing and "all" off is no steward.
 */
function settle(entries) {
  const order = Object.keys(entries).sort((a, b) => (entries[a].at - entries[b].at) || (a < b ? -1 : a > b ? 1 : 0));
  const every = order.filter((id) => entries[id].all).pop() || '';
  const out = {}, holder = new Map();
  const drop = (h, c) => {
    const t = out[h];
    t.manages = t.manages.filter((x) => x !== c);
    t.ticked = t.ticked.filter((x) => x !== c);
    delete t.names[c];
    holder.delete(c);
    if (!t.manages.length && !t.all) delete out[h];
  };
  for (const id of order) {
    const e = entries[id], all = id === every;
    const mine = new Set(all ? e.ticked || [] : e.manages);
    const list = [];
    for (const c of e.manages) {
      if (c === id || out[c] || list.includes(c)) continue;
      const h = holder.get(c);
      if (h) { if (!mine.has(c)) continue; drop(h, c); }
      list.push(c);
    }
    if (!list.length && !all) continue;
    if (holder.has(id)) drop(holder.get(id), id);
    const names = {};
    for (const c of list) if (e.names[c]) names[c] = e.names[c];
    out[id] = { manages: list, ticked: list.filter((c) => mine.has(c)), names, at: e.at, all };
    for (const c of list) holder.set(c, id);
  }
  return out;
}

function parse(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); } catch (_) { return null; /* none yet, or caught mid-write */ }
}

/** steward id -> { manages, ticked, names, at, all }, settled, leaving out anything malformed and stewards that manage
    nothing and are not set to manage all. */
function read(dir = planDir()) {
  return settle(entriesOf(parse(dir)));
}

function write(table, dir) {
  const out = {};
  for (const [id, v] of Object.entries(table)) {
    out[id] = { manages: v.manages, names: v.names, at: v.at };
    if (v.all) { out[id].all = true; out[id].ticked = v.ticked; }
  }
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, FILE), JSON.stringify({ version: 1, stewards: out }, null, 1) + '\n');
}

/* A table's content as one string. Two tables that differ only in key order or in the fields they leave out give the
   same string. */
const meaning = (t) => JSON.stringify(Object.keys(t).sort().map((id) => {
  const v = t[id];
  return [id, v.manages, v.all ? (v.ticked || []).filter((c) => v.manages.includes(c)) : null,
    Object.keys(v.names).sort().map((c) => [c, v.names[c]]), v.at, !!v.all];
}));

/** Writes the settled table back when it differs from what the file holds, as a file an older build wrote can. Returns
    true when it wrote the file. Only a window allowed to save the table calls it. */
function migrate(dir = planDir()) {
  const d = parse(dir);
  if (!d) return false;
  const entries = entriesOf(d), settled = settle(entries);
  if (meaning(entries) === meaning(settled)) return false;
  write(settled, dir);
  return true;
}

/* Who has conversation `id` in `table`, other than `but`: { steward, ticked }, or null. An entry with no "ticked" has
   ticked what it manages unless "all" is on. */
function holderOf(table, id, but = '') {
  for (const [s, t] of Object.entries(table)) {
    if (s === but || !t || !Array.isArray(t.manages) || !t.manages.includes(id)) continue;
    return { steward: s, ticked: Array.isArray(t.ticked) ? t.ticked.includes(id) : !t.all };
  }
  return null;
}

/* The steward other than `but` that has "all" on, or ''. */
const everyOf = (table, but = '') => Object.keys(table).find((s) => s !== but && table[s].all) || '';

/**
 * Sets what `steward` manages to `list`, with the titles in `names`. `every` turns "all" on or off; without it the
 * setting stays. With "all" on, `ticked` lists the conversations in `list` that were ticked by hand (by default, those
 * ticked before); with it off, the whole list counts as ticked. Left out of the list: conversations that are stewards
 * and ones another steward ticked; "all" stays off while another steward has it on. Ticking a conversation another
 * steward has only through "all" takes it from that one, and a steward that comes to manage something leaves every
 * other list. An empty list removes the steward from the table unless "all" is on.
 */
function setManaged(steward, list, names = {}, { dir = planDir(), now = Date.now(), every, ticked } = {}) {
  const all = read(dir);
  if (typeof steward !== 'string' || !SESSION.test(steward)) return all;
  const id = steward.toLowerCase();
  const was = all[id];
  const keepAll = (typeof every === 'boolean' ? every : !!(was && was.all)) && !everyOf(all, id);
  const own = keepAll ? new Set(Array.isArray(ticked) ? ids(ticked, id) : was ? was.ticked : []) : null;
  const manages = ids(list, id).filter((m) => {
    if (all[m]) return false;
    const h = holderOf(all, m, id);
    return !h || (!h.ticked && (!own || own.has(m)));
  });
  if (manages.length || keepAll) {
    const kept = {};
    for (const m of manages) {
      const t = names && typeof names[m] === 'string' ? names[m] : was && was.names[m];
      if (typeof t === 'string' && t) kept[m] = t.slice(0, MAX_NAME);
    }
    all[id] = { manages, ticked: own ? manages.filter((m) => own.has(m)) : manages, names: kept, at: now, all: keepAll };
  } else delete all[id];
  const settled = settle(all);
  write(settled, dir);
  return settled;
}

/** Refreshes the saved titles. Writes the file only if a title changed. */
function rename(names, { dir = planDir() } = {}) {
  const all = read(dir);
  let changed = false;
  for (const v of Object.values(all)) {
    for (const m of v.manages) {
      const t = typeof names[m] === 'string' ? names[m].slice(0, MAX_NAME) : '';
      if (t && v.names[m] !== t) { v.names[m] = t; changed = true; }
    }
  }
  if (changed) write(all, dir);
  return changed;
}

/*
 * The notices a steward is sent when one of its conversations stops: a turn that ended, or a conversation that started
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

/*
 * The notice text, which opens by saying it is from this extension and not from the user. `details` gives, by session
 * id, { state, doing, asks, waitingOn }: carrying them saves the steward a tool call per conversation, and each call
 * makes it read its whole context again. `asks` holds only questions new to the steward. On an "ended" entry of
 * `list`, `why` is the notice's words for the work that stopped.
 */
function noticeText(list, names, details = {}) {
  const said = new Set();
  const line = (c) => {
    const name = names[c.id] ? `"${names[c.id]}"` : 'a conversation';
    const d = details[c.id];
    const head = c.what === 'waiting' ? `- ${name} (${c.id}) is waiting for the user.`
      : c.what === 'ended' ? `- ${name} (${c.id}): its ${c.why}.`
        : c.what === 'twice' ? `- ${name} (${c.id}) is run by ${c.procs.length} processes at once: `
          + `${c.procs.map(duplicates.describe).join('; ')}. The Stop the old process button in the Steward panel stops `
          + `pid ${duplicates.oldOne(c.procs).pid}, and so does kill ${duplicates.oldOne(c.procs).pid}.`
          : c.what === 'stopped' ? `- ${name} (${c.id}): Claude Code Plus stopped its process ${duplicates.describe(c.stop)}, `
            + `${c.stop.how === 'auto' ? 'as it was idle and its window was gone' : 'from the Stop the old process button'}.`
            : `- ${name} (${c.id}) finished its turn.`;
    if (!d || said.has(c.id)) return head;
    said.add(c.id);
    const more = [`  Now: ${d.state}${d.doing && d.doing.length ? '; doing: ' + d.doing.join(' · ') : ''}`];
    if (d.waitingOn) more.push(`  Waiting on ${d.waitingOn}`);
    for (const q of d.asks || []) more.push(`  Question for the user: ${q}`);
    return [head].concat(more).join('\n');
  };
  return 'Steward notice from Claude Code Plus, not a message from the user. Conversations you manage changed:\n'
    + list.map(line).join('\n')
    + '\nRead one with the steward skill\'s steward-peek.py only if you need its latest reply. If none of it needs the'
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

module.exports = { read, setManaged, rename, migrate, settle, entriesOf, holderOf, everyOf, changes, noticeText, post, FILE, MAX_MANAGED };
