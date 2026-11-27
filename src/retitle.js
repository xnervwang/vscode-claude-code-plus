// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * A conversation's request for a new title of its own (the plugin's hooks/retitle.py, through
 * plan_common.request_retitle), carried out by the window hosting it. The files and their order are Agent Plus's
 * docs/protocol.md, "Retitle requests":
 *
 *   <plan dir>/retitle/<key>.json          { format, key, agent, sessionId, title, at, via }   written by the requester
 *   <plan dir>/retitle/<key>.claimed       the request, taken by one window with a rename
 *   <plan dir>/retitle/<key>.result.json   { format, key, outcome, reason, title, at }           read and removed by it
 *
 * Any process can write a request, so a window renames only when the conversation's own transcript has the Bash call
 * that ran retitle.py with this title in its command, in the last RAN_MS, and each call once.
 */
const fs = require('fs');
const path = require('path');
const titleMarks = require('./title-marks');

const DIR = 'retitle';
const KEY = /^[0-9a-z]{12,40}$/;
const FORMAT = 1;
const MAX_TITLE = 80;
/* A window that does not show the conversation leaves the request this long to one that does. */
const OTHERS_WAIT_MS = 2000;
const RAN_MS = 5 * 60000;
const OLD_MS = 10 * 60000;
/* Bytes read from the end of the transcript to find the call. */
const TAIL_BYTES = 2 * 1024 * 1024;
const SCRIPT = 'retitle.py';

/* The title as the protocol cleans it: one space for each run of white space, no ends, no marks, at most MAX_TITLE
   characters. */
function cleanTitle(raw) {
  const one = titleMarks.withoutMarks(String(raw || '').replace(/\s+/g, ' ').trim()).replace(/\s+/g, ' ').trim();
  return [...one].slice(0, MAX_TITLE).join('').trim();
}

/*
 * The id of the Bash call in the transcript `file` that ran retitle.py with `title` in its command, no older than
 * RAN_MS and not in `used`, or ''. Claude Code writes the call a moment after the command starts, so the caller looks
 * again before refusing.
 */
function ranRetitle(file, title, { now = Date.now(), used = new Set() } = {}) {
  let text = '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, len = Math.min(size, TAIL_BYTES);
    const b = Buffer.alloc(len);
    const n = fs.readSync(fd, b, 0, len, size - len);
    text = b.toString('utf8', 0, n);
  } catch (_) { return ''; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.includes(SCRIPT) || !l.includes('"tool_use"')) continue;
    let r;
    try { r = JSON.parse(l); } catch (_) { continue; }
    if (!r || r.type !== 'assistant' || r.isSidechain === true) continue;
    const at = Date.parse(r.timestamp);
    if (!(at > 0) || now - at > RAN_MS) continue;
    const blocks = r.message && Array.isArray(r.message.content) ? r.message.content : [];
    for (const blk of blocks) {
      const command = blk && blk.type === 'tool_use' && blk.name === 'Bash' && blk.input ? String(blk.input.command || '') : '';
      if (command.includes(SCRIPT) && command.includes(title) && !used.has(blk.id)) return String(blk.id || '');
    }
  }
  return '';
}

/* Writes `data` as JSON to `file` through a temporary name beside it. */
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data) + '\n');
  fs.renameSync(tmp, file);
}

/*
 * deps: dir (the plan dir), shows(id) whether a panel of this window shows the conversation, transcriptOf(id),
 * rename(id, title) -> { outcome: 'done' | 'refused' | 'failed', reason }, now(), sleep(ms), log(line).
 * Returns { scan }: scan() handles what is waiting in the folder and resolves once this pass is done.
 */
function create(deps) {
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const folder = path.join(deps.dir, DIR);
  const firstSeen = new Map();
  const used = new Set();
  const answer = (key, outcome, reason, title) => {
    try { writeJson(path.join(folder, `${key}.result.json`), { format: FORMAT, key, outcome, reason, title, at: now() }); }
    catch (e) { if (deps.log) deps.log(`retitle ${key}: the answer could not be written: ${e.message}`); }
    try { fs.unlinkSync(path.join(folder, `${key}.claimed`)); } catch (_) { /* gone */ }
  };
  const carryOut = async (key, req) => {
    const id = String(req.sessionId || '').toLowerCase();
    const raw = typeof req.title === 'string' ? req.title : '';
    if (req.format !== FORMAT || req.agent !== 'Claude Code' || !id) return answer(key, 'refused', 'the request is not one for a Claude Code conversation', '');
    const file = deps.transcriptOf(id);
    let call = file ? ranRetitle(file, raw, { now: now(), used }) : '';
    for (const ms of [500, 1000, 2000, 3000]) {
      if (call || !file) break;
      await sleep(ms);
      call = ranRetitle(file, raw, { now: now(), used });
    }
    if (!call) return answer(key, 'refused', `the conversation's transcript has no ${SCRIPT} command with this title in the last 5 minutes`, '');
    used.add(call);
    const title = cleanTitle(raw);
    if (!title) return answer(key, 'refused', 'the title is empty once white space and marks are taken out', '');
    let r;
    try { r = await deps.rename(id, title); } catch (e) { r = { outcome: 'failed', reason: (e && e.message) || String(e) }; }
    const outcome = r && (r.outcome === 'done' || r.outcome === 'refused') ? r.outcome : 'failed';
    answer(key, outcome, outcome === 'done' ? '' : (r && r.reason) || 'renaming failed', outcome === 'done' ? title : '');
    if (deps.log) deps.log(`retitle ${id}: ${outcome}${outcome === 'done' ? ` "${title}"` : ` (${(r && r.reason) || ''})`}`);
  };
  let running = null, again = false;
  const pass = async () => {
    let names = [];
    try { names = fs.readdirSync(folder); } catch (_) { return; }
    const t = now();
    for (const n of names) {
      const f = path.join(folder, n);
      try { if (t - fs.statSync(f).mtimeMs > OLD_MS) fs.unlinkSync(f); } catch (_) { /* gone */ }
    }
    const later = [];
    for (const n of names) {
      const m = /^(.+)\.json$/.exec(n);
      if (!m || n.endsWith('.result.json') || !KEY.test(m[1])) continue;
      const key = m[1], f = path.join(folder, n);
      let req;
      try { req = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
      const id = String((req && req.sessionId) || '').toLowerCase();
      if (!(deps.shows && deps.shows(id))) {
        const seen = firstSeen.get(key) || t;
        firstSeen.set(key, seen);
        if (t - seen < OTHERS_WAIT_MS) { later.push(OTHERS_WAIT_MS - (t - seen)); continue; }
      }
      try { fs.renameSync(f, path.join(folder, `${key}.claimed`)); } catch (_) { firstSeen.delete(key); continue; }
      firstSeen.delete(key);
      await carryOut(key, req || {});
    }
    for (const k of [...firstSeen.keys()]) if (!names.includes(`${k}.json`)) firstSeen.delete(k);
    if (later.length && deps.later) deps.later(Math.min(...later) + 50);
  };
  const scan = () => {
    if (running) { again = true; return running; }
    running = (async () => {
      try { do { again = false; await pass(); } while (again); } finally { running = null; }
    })();
    return running;
  };
  return { scan, folder };
}

module.exports = { create, cleanTitle, ranRetitle, DIR, MAX_TITLE, OTHERS_WAIT_MS, RAN_MS };
