// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
const fs = require('fs');
const path = require('path');
const waiting = require('./waiting');
const planNames = require('./plan-names');
const { planDir, transcriptOf, filedUnder } = require('./claude-files');
const { OPEN_STATES } = require('./workplan');

/* Stopped conversations are listed only while their plan was written within this many days. */
const CLOSED_DAYS = 7;
const HEAD_BYTES = 64 * 1024;

/** State from Claude Code alone. A state the host has for it (`live`) outranks `claude agents`, which is read at most
    every half minute and can still show a wait already answered. */
function stateOf(s, live, unread) {
  const now = live && live.get(s.sessionId);
  if (now ? now === 'waiting' : s.waitingFor) return 'prompt';
  if (now ? now === 'running' : s.busy) return 'working';
  if (unread && unread.has(s.sessionId)) return 'unread';
  return 'idle';
}

function openCount(nodes) {
  return (nodes || []).reduce((n, x) => n + (OPEN_STATES.includes(x.state) ? 1 : 0) + openCount(x.children), 0);
}

/*
 * The folder a conversation belongs to. Its records carry `cwd` values, and this takes the first one that Claude Code
 * would file under the projects/ folder holding the transcript. A conversation resumed in another folder is copied
 * there along with its old records, and their `cwd` is still the folder it was started in. Kept per file and size.
 */
const cwdSeen = new Map();
const TAIL_BYTES = 256 * 1024;
const CWD_ALL = /"cwd":"((?:[^"\\]|\\.)*)"/g;

function cwdsIn(text) {
  const out = [];
  CWD_ALL.lastIndex = 0;
  for (let m; (m = CWD_ALL.exec(text));) { try { out.push(JSON.parse('"' + m[1] + '"')); } catch (_) { /* cut off */ } }
  return out;
}

function transcriptCwd(file) {
  let size = -1;
  try { size = fs.statSync(file).size; } catch (_) { return ''; }
  const seen = cwdSeen.get(file);
  if (seen && seen.size === size) return seen.cwd;
  const dir = path.basename(path.dirname(file));
  let cwd = '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const read = (at, n) => { const buf = Buffer.alloc(n); const got = fs.readSync(fd, buf, 0, n, at); return buf.toString('utf8', 0, got); };
    const head = cwdsIn(read(0, Math.min(HEAD_BYTES, size)));
    cwd = head.find((c) => filedUnder(dir, c)) || '';
    if (!cwd && size > HEAD_BYTES) {
      const tail = cwdsIn(read(Math.max(0, size - TAIL_BYTES), Math.min(TAIL_BYTES, size)));
      cwd = tail.reverse().find((c) => filedUnder(dir, c)) || '';
    }
    if (!cwd) cwd = head[0] || '';
  } catch (_) { /* not readable: not listed */ }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
  if (cwd) cwdSeen.set(file, { size, cwd });
  return cwd;
}

/* Whether each plan file has open rows, by its path, kept while its size and modification time stay the same, so a plan
   that has not changed is not read again. */
const openSeen = new Map();

/** Stopped conversations in `folders` with a plan written in the last CLOSED_DAYS that has open rows, as merge() records. */
function stoppedWithOpenRows(folders, running, { dir = planDir(), now = Date.now(), readPlan, find = transcriptOf } = {}) {
  const out = new Map();
  let names = [];
  try { names = planNames.names(dir).filter((n) => /^[0-9a-f-]{36}\.json$/i.test(n)); } catch (_) { return out; }
  if (openSeen.size > 4 * names.length + 100) openSeen.clear();
  for (const name of names) {
    const id = name.slice(0, -5);
    if (running.has(id)) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch (_) { continue; }
    if (now - st.mtimeMs > CLOSED_DAYS * 86400e3) continue;
    const key = st.mtimeMs + ':' + st.size;
    let seen = openSeen.get(file);
    if (!seen || seen.key !== key) {
      const plan = readPlan(id);
      seen = { key, open: !!(plan && openCount(plan.nodes)) };
      openSeen.set(file, seen);
    }
    if (!seen.open) continue;
    const transcript = find(id);
    const cwd = transcript ? transcriptCwd(transcript) : '';
    if (!cwd) continue;
    const s = { sessionId: id, id: '', kind: 'interactive', cwd, name: '', waitingFor: '', busy: false, processes: 0 };
    if (waiting.inFolders(new Map([[id, s]]), folders).size) out.set(id, s);
  }
  return out;
}

/* planOf() is called only when the first three titles are missing, so a titled conversation does not read its plan. */
function claudeTitle(s, t, planOf) {
  const named = s.name && !waiting.isDefaultName(s.name, s.cwd) ? s.name : '';
  if (t.custom || named || t.ai) return t.custom || named || t.ai;
  const plan = planOf();
  const top = plan && plan.nodes && plan.nodes.find((n) => OPEN_STATES.includes(n.state));
  return (plan && plan.title) || (top && top.title) || s.name || s.id || s.sessionId;
}

module.exports = { claudeTitle, stateOf, openCount, transcriptCwd, stoppedWithOpenRows, CLOSED_DAYS };
