// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Claude Code does not count a message from another session as the user's consent, but it does count text typed into
 * the conversation's input. A steward speaks for the user in the conversations it manages, so the plugin's
 * hooks/steward-relay.py leaves its message as a request in RELAY_DIR of the plan directory, and a window showing the
 * conversation types it into the input (src/page/91-answer.js).
 *
 * The same requests carry the steward's other actions on the conversations it manages: `rename` gives one a new title,
 * `close` closes its editor tab, and `open` starts a new conversation in the window that has the folder `to` open,
 * typing `text` as its first message. A conversation is only closed, never deleted.
 *
 * Any process can write a request file. A window carries one out only if the conversation is one the steward manages
 * (for `open`, only if the one asking is a steward), and the steward's own transcript has the tool call that ran
 * steward-relay.py for it in the last RAN_MS (ranBy), with the action's flag, and at most once per call.
 *
 *   <plan dir>/relay/<id>.json          { id, steward, action, to, text, confirmed, at }   written by steward-relay.py
 *   <plan dir>/relay/<id>.taken-<pid>   the request, claimed by window <pid> with a rename
 *   <plan dir>/relay/<id>.result.json   { outcome, reason, sessionId }   read and removed by steward-relay.py
 *   <plan dir>/relay/sent.json          { "<steward> <to> <tool call id> <action>": <ms> }
 */
const fs = require('fs');
const path = require('path');
const { SESSION, writeAtomic } = require('./claude-files');

const RELAY_DIR = 'relay';
const REQUEST = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;
/* Requests older than this are dropped; steward-relay.py stops waiting before then. */
const MAX_AGE_MS = 60000;
const RAN_MS = 5 * 60000;
/* Bytes read from the end of the steward's transcript to find that call. */
const TAIL_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 4000;
const MAX_TITLE = 200;
/* The flag each action is run with; a plain message has none. */
const FLAGS = { rename: '--rename', close: '--close', open: '--open' };
const ACTIONS = ['send', ...Object.keys(FLAGS)];
const CONFIRMED = '--confirmed';
const SENT_FILE = 'sent.json';
/* Claude Code writes a tool call to the transcript a moment after the command starts, and a window can read the
   script's request before that; so the transcript is read again after each of these waits before refusing. */
const RAN_WAITS_MS = [500, 1000, 2000, 3000];
const SENT_KEEP_MS = 24 * 3600000;
const SCRIPT = 'steward-relay.py';

/*
 * The tool call in the steward's transcript that ran steward-relay.py for this request, as { id, at }, or null. It
 * must be the steward's own, not a subagent's, at most RAN_MS old, and its command must contain the conversation's
 * session id (for `open`, the folder) and the text; the line that runs the script must carry the flag of `action` and
 * none of the others, and --confirmed when `confirmed` is set. Claude Code writes a tool call to the transcript before running it, so the call is already there
 * while the script waits for an answer.
 */
function ranBy(file, to, text, now = Date.now(), action = 'send', confirmed = false) {
  let tail = '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    const got = fs.readSync(fd, buf, 0, buf.length, from);
    tail = buf.toString('utf8', 0, got);
    if (from > 0) tail = tail.slice(tail.indexOf('\n') + 1);
  } catch (_) { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.indexOf('"tool_use"') === -1 || line.indexOf(SCRIPT) === -1) continue;
    let r;
    try { r = JSON.parse(line); } catch (_) { continue; }
    if (!r || r.type !== 'assistant' || r.isSidechain || !r.message || !Array.isArray(r.message.content)) continue;
    const at = Date.parse(r.timestamp);
    if (!(now - at <= RAN_MS) || at > now + 60000) continue;
    for (const b of r.message.content) {
      const c = b && b.type === 'tool_use' && b.input && typeof b.input.command === 'string' ? b.input.command.replace(/\r\n/g, '\n') : '';
      if (!c.includes(SCRIPT) || !c.toLowerCase().includes(to.toLowerCase()) || !c.includes(text)) continue;
      // Flags are read from the line that runs the script, not from the text after it.
      const line = c.slice(c.lastIndexOf('\n', c.indexOf(SCRIPT)) + 1).split('\n')[0];
      if (Object.entries(FLAGS).some(([a, flag]) => line.includes(flag) !== (a === action))) continue;
      if (confirmed && !line.includes(CONFIRMED)) continue;
      return { id: String(b.id || r.uuid || ''), at };
    }
  }
  return null;
}

function readSent(dir, now) {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(path.join(dir, SENT_FILE), 'utf8')) || {}; } catch (_) { /* none yet */ }
  for (const [k, at] of Object.entries(d)) if (!(typeof at === 'number' && now - at < SENT_KEEP_MS)) delete d[k];
  return d;
}

/*
 * Carries out the requests in `planDir` for conversations this window shows, and the `open` requests for a folder it
 * has open. deps: shownHere(id), hasFolder(folder), stewards() -> the stewards table (src/stewards.js), transcriptOf(id),
 * deliver(id, text), rename(id, title), close(id, confirmed) and open(folder, text) -> Promise<{ outcome, reason,
 * sessionId }> (open's sessionId is the new conversation's, when known), manage(steward, id) to add a conversation to
 * the steward's list, pid, now(), and sleep(ms) for tests. Returns the results it wrote.
 */
async function take(planDir, deps) {
  const dir = path.join(planDir, RELAY_DIR);
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const now = deps.now ? deps.now() : Date.now();
  const done = [];
  for (const name of names) {
    const m = REQUEST.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    let req;
    try { req = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { continue; }
    if (!req || typeof req.to !== 'string' || !(now - req.at < MAX_AGE_MS)) {
      if (req && now - req.at >= MAX_AGE_MS) { try { fs.unlinkSync(file); } catch (_) { /* taken meanwhile */ } }
      continue;
    }
    const action = req.action === undefined ? 'send' : req.action;
    const opening = action === 'open';
    const to = opening ? req.to : req.to.toLowerCase();
    if (opening ? !(path.isAbsolute(to) && deps.hasFolder && deps.hasFolder(to)) : !(SESSION.test(to) && deps.shownHere(to))) continue;
    const taken = path.join(dir, `${m[1]}.taken-${deps.pid}`);
    try { fs.renameSync(file, taken); } catch (_) { continue; }
    const result = await carryOut(req, action, to, dir, deps, now);
    try { writeAtomic(path.join(dir, m[1] + '.result.json'), JSON.stringify(result) + '\n'); } catch (_) { /* the script reports no answer */ }
    try { fs.unlinkSync(taken); } catch (_) { /* gone */ }
    done.push(Object.assign({ id: m[1], action, to }, result));
  }
  return done;
}

/* The request's text for `action`, or a reason to refuse it. A title is one line. */
function textFor(action, raw) {
  const text = String(raw || '').trim();
  if (action === 'close') return text ? { why: 'closing takes no text' } : { text };
  if (action === 'rename') {
    const title = text.replace(/\s+/g, ' ');
    return title && title.length <= MAX_TITLE ? { text: title } : { why: `there is no title, or it is longer than ${MAX_TITLE} characters` };
  }
  return text && text.length <= MAX_TEXT ? { text } : { why: `there is no text, or it is longer than ${MAX_TEXT} characters` };
}

async function carryOut(req, action, to, dir, deps, now) {
  const steward = String(req.steward || '').toLowerCase();
  if (!SESSION.test(steward)) return { outcome: 'refused', reason: 'the request does not say which steward sent it' };
  if (!ACTIONS.includes(action)) return { outcome: 'refused', reason: `there is no action "${action}"` };
  const table = deps.stewards() || {}, t = table[steward];
  if (action === 'open') {
    if (!t) return { outcome: 'refused', reason: 'the one asking is not a steward' };
  } else if (!t || !(t.manages.includes(to) || (t.all && to !== steward && !table[to]))) {
    // A steward of all conversations manages all but other stewards, even ones missing from its list for the moment.
    return { outcome: 'refused', reason: 'that conversation is not one this steward manages' };
  }
  const { text, why } = textFor(action, req.text);
  if (why) return { outcome: 'refused', reason: why };
  const confirmed = action === 'close' && req.confirmed === true;
  const file = deps.transcriptOf(steward);
  let call = file ? ranBy(file, to, action === 'rename' ? String(req.text || '').trim() : text, now, action, confirmed) : null;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; file && !call && i < RAN_WAITS_MS.length; i++) {
    await sleep(RAN_WAITS_MS[i]);
    call = ranBy(file, to, action === 'rename' ? String(req.text || '').trim() : text, deps.now ? deps.now() : Date.now(), action, confirmed);
  }
  if (!call) {
    return { outcome: 'refused', reason: `the steward conversation has not run ${SCRIPT}${FLAGS[action] ? ' ' + FLAGS[action] : ''} for `
      + `${action === 'open' ? 'that folder' : 'that conversation'}${text ? ' with this text' : ''} in its command in the last 5 minutes; `
      + 'give the text in a here-document in the command itself' };
  }
  const key = [steward, to, call.id, action].join(' ');
  const sent = readSent(dir, now);
  if (sent[key]) return { outcome: 'refused', reason: 'that call has already been carried out' };
  const missing = { outcome: 'notReceived', reason: 'this window cannot do that' };
  const r = action === 'send' ? await deps.deliver(to, text)
    : action === 'rename' ? (deps.rename ? await deps.rename(to, text) : missing)
      : action === 'close' ? (deps.close ? await deps.close(to, confirmed) : missing)
        : (deps.open ? await deps.open(to, text) : missing);
  if (r && r.outcome === 'submitted') {
    sent[key] = now;
    try { writeAtomic(path.join(dir, SENT_FILE), JSON.stringify(sent) + '\n'); } catch (_) { /* a repeat is then not caught */ }
    if (action === 'open' && r.sessionId && SESSION.test(r.sessionId) && !t.all && deps.manage) {
      try { deps.manage(steward, r.sessionId.toLowerCase()); } catch (_) { /* the steward ticks it in the panel */ }
    }
  }
  const out = { outcome: (r && r.outcome) || 'uncertain', reason: (r && r.reason) || '' };
  if (r && typeof r.sessionId === 'string' && r.sessionId) out.sessionId = r.sessionId;
  return out;
}

module.exports = { take, ranBy, RELAY_DIR, MAX_AGE_MS, RAN_MS, RAN_WAITS_MS, SENT_FILE, FLAGS, MAX_TITLE };
