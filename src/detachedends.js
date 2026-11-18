// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Tells a conversation that a command it left running detached has stopped. Claude Code wakes a
 * conversation when one of its own background tasks finishes; a command started with setsid or nohup is not one of
 * them, so without this the conversation learns that it stopped only by looking.
 *
 * Every window compares its scan (src/detached.js) with the jobs last seen running, kept in SEEN_FILE. While the
 * notices are on, a job missing from the scan is recorded in a file of its own under GONE_DIR, created with O_EXCL: the
 * window that creates it is the only one to record that end, so a second window, or one reading an older scan that
 * still has the job, does not record it again. The file stays for MAX_KEEP_MS after the end, sent or not, for the same
 * reason.
 *
 * Commands that stop close together are reported in one notice (BATCH_QUIET_MS, BATCH_MAX_MS), as when a script stops
 * several jobs at once. The notice goes through the conversation's inbox socket (src/stewards.js post()), which starts
 * a turn when the conversation is idle. A conversation that is not running is told when it next runs, within
 * MAX_PENDING_MS. The process was not started by this extension, so its exit status is not known here.
 */
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./claude-files');

const SEEN_FILE = 'detached-seen.json';
const GONE_DIR = 'detached-gone';
const BATCH_QUIET_MS = 15000;
const BATCH_MAX_MS = 60000;
const MAX_PENDING_MS = 24 * 3600e3;
const MAX_KEEP_MS = 2 * 24 * 3600e3;
const LOCK_STALE_MS = 60000;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WHO = 'Claude Code Plus';
/* A command line in the notice is cut here: each one goes into the conversation's context. */
const NOTICE_COMMAND = 200;

const keyOf = (j) => `${j.pid}-${j.start}`;
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
const validJob = (j) => !!j && SESSION.test(j.session || '') && Number.isInteger(j.pid) && /^\d+$/.test(String(j.start || ''));

/*
 * `jobs` is every job running now. `claim` is false while the notices are off: nothing is recorded then, so turning them
 * on does not report commands that stopped in the meantime.
 */
function update({ dir, jobs, now = Date.now(), claim = true }) {
  if (!Array.isArray(jobs)) return [];
  const seenFile = path.join(dir, SEEN_FILE);
  const before = readJson(seenFile);
  const was = before && typeof before.sessions === 'object' && before.sessions ? before.sessions : {};
  const cur = {};
  for (const j of jobs) {
    if (!validJob(j)) continue;
    (cur[j.session] = cur[j.session] || []).push({ pid: j.pid, start: String(j.start), startedAt: j.startedAt || null,
      command: String(j.command || '') });
  }
  const recorded = [];
  if (claim) {
    for (const [session, list] of Object.entries(was)) {
      if (!SESSION.test(session) || !Array.isArray(list)) continue;
      const still = new Set((cur[session] || []).map(keyOf));
      for (const j of list) {
        if (!j || !Number.isInteger(j.pid) || still.has(keyOf(j))) continue;
        const end = { session, pid: j.pid, start: String(j.start), startedAt: j.startedAt || null, command: String(j.command || ''), goneAt: now };
        try {
          fs.mkdirSync(path.join(dir, GONE_DIR), { recursive: true });
          fs.writeFileSync(path.join(dir, GONE_DIR, `${session}.${keyOf(j)}.json`), JSON.stringify(end) + '\n', { flag: 'wx' });
          recorded.push(end);
        } catch (_) { /* recorded already, by this window or another; if the write fails otherwise, this stop goes unreported */ }
      }
    }
  }
  const next = JSON.stringify(Object.keys(cur).sort().reduce((o, k) => { o[k] = cur[k]; return o; }, {}));
  if (JSON.stringify(Object.keys(was).sort().reduce((o, k) => { o[k] = was[k]; return o; }, {})) !== next) {
    try { writeAtomic(seenFile, JSON.stringify({ at: now, sessions: JSON.parse(next) }) + '\n'); } catch (_) { /* the next scan */ }
  }
  return recorded;
}

function recorded(dir) {
  const by = new Map();
  let names = [];
  try { names = fs.readdirSync(path.join(dir, GONE_DIR)).filter((n) => n.endsWith('.json')); } catch (_) { return by; }
  for (const n of names) {
    const file = path.join(dir, GONE_DIR, n);
    const e = readJson(file);
    if (!e || !SESSION.test(e.session || '') || !(e.goneAt > 0)) continue;
    if (!by.has(e.session)) by.set(e.session, []);
    by.get(e.session).push(Object.assign({}, e, { file }));
  }
  return by;
}

const pad = (n) => String(n).padStart(2, '0');
const when = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
const span = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};

/* It opens by saying it is not from the user: what arrives through the inbox otherwise reads as the user's message, and
   could be taken for the user's approval. */
function noticeText(ends, { who = WHO } = {}) {
  const one = ends.length === 1;
  const lines = ends.slice().sort((a, b) => a.goneAt - b.goneAt).map((e) => {
    const parts = [`pid ${e.pid}`];
    if (e.startedAt > 0) parts.push(`started ${when(e.startedAt)}`, `ran for about ${span(e.goneAt - e.startedAt)}`);
    parts.push(`found gone ${when(e.goneAt)}`);
    const cmd = String(e.command || '(command line not read)');
    return `- \`${cmd.length > NOTICE_COMMAND ? cmd.slice(0, NOTICE_COMMAND - 3) + '...' : cmd}\` (${parts.join(', ')})`;
  });
  return `${who} notice, not a message from the user: ${one ? 'a command' : 'commands'} this conversation left running `
    + `detached ${one ? 'is' : 'are'} no longer running. ${one ? 'Its exit code' : 'Their exit codes'} cannot be known; `
    + `look at ${one ? 'its' : 'their'} output if you need the result.\n${lines.join('\n')}`;
}

/* A send holds the lock for at most the inbox post's timeout, well under LOCK_STALE_MS, so an older lock was left by a
   window that stopped. */
function lock(dir, session, now) {
  const at = path.join(dir, GONE_DIR, `${session}.lock`);
  try { fs.mkdirSync(at); return at; } catch (_) { /* held */ }
  try {
    if (now - fs.statSync(at).mtimeMs > LOCK_STALE_MS) { fs.rmSync(at, { recursive: true, force: true }); fs.mkdirSync(at); return at; }
  } catch (_) { /* taken meanwhile */ }
  return null;
}

/*
 * `inbox(session)` gives the conversation's inbox socket, or null when it is not running or should not be woken;
 * `post(address, text)` resolves to whether the inbox took the text.
 */
async function deliver({ dir, inbox, post, now = Date.now(), who = WHO }) {
  const sent = [];
  for (const [session, ends] of recorded(dir)) {
    for (const e of ends) {
      if (now - e.goneAt > MAX_KEEP_MS) { try { fs.rmSync(e.file, { force: true }); } catch (_) { /* gone */ } }
    }
    const due = ends.filter((e) => !e.sentAt && !e.dropped && now - e.goneAt <= MAX_KEEP_MS);
    const stale = due.filter((e) => now - e.goneAt > MAX_PENDING_MS);
    for (const e of stale) {
      try { writeAtomic(e.file, JSON.stringify(Object.assign({}, e, { file: undefined, dropped: now })) + '\n'); } catch (_) { /* next time */ }
    }
    const open = due.filter((e) => now - e.goneAt <= MAX_PENDING_MS);
    if (!open.length) continue;
    const newest = Math.max(...open.map((e) => e.goneAt)), oldest = Math.min(...open.map((e) => e.goneAt));
    if (now - newest < BATCH_QUIET_MS && now - oldest < BATCH_MAX_MS) continue;
    const address = inbox(session);
    if (!address) continue;
    const held = lock(dir, session, now);
    if (!held) continue;
    try {
      // Read again under the lock: another window may have sent them since.
      const mine = open.filter((e) => { const d = readJson(e.file); return d && !d.sentAt && !d.dropped; });
      if (!mine.length) continue;
      if (!await post(address, noticeText(mine, { who }))) continue;
      for (const e of mine) {
        try { writeAtomic(e.file, JSON.stringify(Object.assign({}, e, { file: undefined, sentAt: now })) + '\n'); } catch (_) { /* sent */ }
      }
      sent.push({ session, ends: mine.map((e) => ({ pid: e.pid, command: e.command })) });
    } finally {
      try { fs.rmSync(held, { recursive: true, force: true }); } catch (_) { /* gone */ }
    }
  }
  return sent;
}

module.exports = { update, deliver, noticeText, recorded, SEEN_FILE, GONE_DIR, BATCH_QUIET_MS, BATCH_MAX_MS, MAX_PENDING_MS,
  MAX_KEEP_MS };
