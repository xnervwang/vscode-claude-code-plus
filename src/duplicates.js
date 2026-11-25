// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Finds conversations that two Claude Code editor processes run at once. This happens when a window goes away but its
 * extension host stays, waiting for the window to reconnect (up to the server's reconnection grace time). Its claude
 * processes keep going while the reopened window runs the same conversation in a new host. Both write the same
 * transcript, and nobody sees the old one's replies.
 *
 * Only processes under a VS Code extension host count. A `claude -p --resume <id>` that carries a conversation on runs
 * under a shell or init, and a `claude --bg` session has its own record kind, so neither is a second process here.
 *
 * The page of each Claude Code panel messages its host every ALIVE_MS (src/page/99-sweep.js), and the host writes the
 * time it last heard into its window entry as pageAt (src/steward-view.js). A host that has heard nothing for NO_PAGE_MS
 * has no window. An entry without pageAt, as older builds write, counts as having one.
 *
 * Two processes can also run one conversation from different working directories. Claude Code files a conversation's
 * transcript under the project folder named after the directory it runs in, and one continued from another directory
 * has a transcript in each, so a window opened on the other folder resumes the copy kept there, which may be weeks
 * behind. Each process then writes its own copy, and the old process is the one on the copy that was furthest behind,
 * not the one started first.
 */
const fs = require('fs');
const path = require('path');
const { transcriptOf, writeAtomic, projectsDir, projectFolders, filedUnder } = require('./claude-files');

const ALIVE_MS = 60000;
/* Chromium runs the timers of a page that has been hidden a while once a minute at most. */
const NO_PAGE_MS = 5 * 60000;
/* A process counts as idle once neither its transcript nor its status has changed for this long. */
const IDLE_MS = 2 * 60000;
/* A VS Code server starts its extension host with this argument. The desktop app starts it as a utility process: its
   command line says --type=utility, as its other helpers' do, and the process learns it is the extension host only
   after it starts. On the desktop the host is known instead by the window entry it keeps under its own pid
   (src/steward-view.js). An entry is rewritten every minute while its host runs; an older one may name a pid given to
   another process since. */
const HOST_ARG = '--type=extensionHost';
const ENTRY_FRESH_MS = 2 * 60000;
const MAX_HOPS = 6;
const STOPPED_DIR = 'stopped';
const STOPPED_KEEP_MS = 24 * 3600000;

function stat(proc, pid) {
  try {
    const s = fs.readFileSync(path.join(proc, String(pid), 'stat'), 'latin1');
    const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
    return { ppid: Number(f[1]), start: f[19] };
  } catch (_) { return null; }
}
function args(proc, pid) {
  try { return fs.readFileSync(path.join(proc, String(pid), 'cmdline'), 'latin1').split('\0').join(' '); } catch (_) { return ''; }
}
/* The pid of the extension host above `pid`, or 0. `hosts` is the set of extension host pids with a fresh window entry.
   */
function hostOf(pid, proc, hosts) {
  let p = pid;
  for (let i = 0; i < MAX_HOPS; i++) {
    const st = stat(proc, p);
    if (!st || st.ppid <= 1) return 0;
    p = st.ppid;
    if ((hosts && hosts.has(p)) || args(proc, p).includes(HOST_ARG)) return p;
  }
  return 0;
}

/* The window entries of src/steward-view.js, by host pid. */
function windowsIn(dir) {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'windows')).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return out; }
  for (const n of names) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, 'windows', n), 'utf8'));
      if (d && typeof d === 'object') out.set(Number(n.slice(0, -5)), d);
    } catch (_) { /* being written */ }
  }
  return out;
}

const windowName = (w) => String((w && w.name) || '').replace(/\s*\[[^\]]*\]\s*$/, '');

/*
 * Session id -> the processes running it, for each conversation run by several editor processes: [{ pid, procStart,
 * startedAt, host, window, windowless, idle }], oldest first. `records` are the live session records
 * (src/background.js liveRecords).
 */
function find({ records, dir, proc = '/proc', now = Date.now(), transcript = transcriptOf, projects = projectsDir() }) {
  const by = new Map();
  for (const r of records || []) {
    if (!r || r.kind === 'bg' || !Number.isInteger(r.pid) || typeof r.sessionId !== 'string') continue;
    const id = r.sessionId.toLowerCase();
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(r);
  }
  const out = new Map();
  let wins = null, hosts = null;
  for (const [id, rs] of by) {
    if (rs.length < 2) continue;
    if (!wins) {
      wins = windowsIn(dir);
      hosts = new Set([...wins].filter(([, w]) => typeof w.at === 'number' && now - w.at < ENTRY_FRESH_MS).map(([pid]) => pid));
    }
    const procs = [];
    for (const r of rs) {
      const host = hostOf(r.pid, proc, hosts);
      if (host) procs.push({ r, host });
    }
    if (procs.length < 2) continue;
    const folders = new Set(procs.map(({ r }) => folderOf(r.cwd)));
    const copies = folders.size > 1 && !folders.has('') ? copiesOf(id, procs.map(({ r }) => r), projects) : null;
    let written = 0;
    try { written = fs.statSync(transcript(id)).mtimeMs; } catch (_) { /* none yet */ }
    out.set(id, procs.map(({ r, host }) => {
      const w = wins.get(host);
      const p = {
        pid: r.pid, procStart: typeof r.procStart === 'string' ? r.procStart : '', startedAt: Number(r.startedAt) || 0, host,
        window: windowName(w),
        windowless: !!(w && typeof w.pageAt === 'number' && now - w.pageAt > NO_PAGE_MS),
        idle: r.status === 'idle' && now - (Number(r.statusUpdatedAt) || 0) > IDLE_MS && now - written > IDLE_MS,
      };
      if (copies) {
        const c = copies.get(folderOf(r.cwd));
        Object.assign(p, { copy: true, cwd: r.cwd, lastBefore: c.lastBefore, stale: c.stale });
        p.idle = r.status === 'idle' && now - (Number(r.statusUpdatedAt) || 0) > IDLE_MS && now - c.writtenAt > IDLE_MS;
      }
      return p;
    }).sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid));
  }
  return out;
}

/* The name of the project folder where Claude Code files the conversations of working directory `cwd`, as filedUnder()
   in src/claude-files.js matches it; '' when there is no directory. */
function folderOf(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '';
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return process.platform === 'win32' || process.platform === 'darwin' ? name.toLowerCase() : name;
}
/* Where a process in working directory `cwd` writes the transcript of conversation `id`, or '' when that is not found.
   A folder name over 200 characters carries a hash this code does not compute, so the project folders are searched for
   one that filedUnder() matches. */
function transcriptIn(cwd, id, projects) {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (name.length <= 200) return path.join(projects, name, id + '.jsonl');
  for (const dir of projectFolders(projects) || []) {
    const file = path.join(dir, id + '.jsonl');
    if (filedUnder(path.basename(dir), cwd) && fs.existsSync(file)) return file;
  }
  return '';
}

/* How far back from its end a transcript is read for the newest entry before a time (READ_BACK), and a cache of the
   entries found, by file and time (lastSeen). The cached answer holds while the file grows, since anything appended is newer than that time. */
const READ_BACK = 16 * 1024 * 1024;
const READ_CHUNK = 256 * 1024;
const lastSeen = new Map();
/* The time of the newest entry in `file` written before `before`; `before` itself when every entry read is newer, or
   the last READ_BACK bytes hold none older; -Infinity when the file cannot be read or holds no entry. */
function newestBefore(file, before) {
  const key = file + '\0' + before;
  let fd, size;
  try { fd = fs.openSync(file, 'r'); size = fs.fstatSync(fd).size; } catch (_) { if (fd !== undefined) fs.closeSync(fd); return -Infinity; }
  try {
    const known = lastSeen.get(key);
    if (known && size >= known.size) return known.at;
    let end = size, rest = Buffer.alloc(0), at = -Infinity, found = false, any = false;
    while (end > 0 && size - end < READ_BACK && !found) {
      const start = Math.max(0, end - READ_CHUNK), buf = Buffer.alloc(end - start);
      const n = fs.readSync(fd, buf, 0, buf.length, start);
      let text = Buffer.concat([buf.subarray(0, n), rest]);
      end = start;
      if (start > 0) {
        // The bytes before the first newline end a line that began in the chunk before this one.
        const cut = text.indexOf(10);
        if (cut < 0) { rest = text; continue; }
        rest = text.subarray(0, cut);
        text = text.subarray(cut + 1);
      }
      const lines = text.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0 && !found; i--) {
        let t = NaN;
        try { const d = JSON.parse(lines[i]); t = d && typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : NaN; } catch (_) { /* cut or empty */ }
        if (t >= before) any = true;
        else if (t < before) { at = t; found = true; }
      }
    }
    if (!found && (any || size - end >= READ_BACK)) at = before;
    if (lastSeen.size > 64) lastSeen.clear();
    lastSeen.set(key, { size, at });
    return at;
  } finally { fs.closeSync(fd); }
}

const STALE_GAP_MS = 10 * 60000;
/*
 * For processes running conversation `id` from different working directories: by folder name, { lastBefore, stale,
 * writtenAt }. lastBefore is the time of the newest entry its copy held before the last of the processes started. The
 * stale copy is the one furthest behind, when the next copy's newest entry is STALE_GAP_MS or more later; otherwise
 * no copy is stale.
 * writtenAt, the time of its copy's last write, tells whether its process is idle.
 */
function copiesOf(id, records, projects) {
  const before = Math.max(...records.map((r) => Number(r.startedAt) || 0));
  const out = new Map();
  for (const r of records) {
    const f = folderOf(r.cwd);
    if (out.has(f)) continue;
    const file = transcriptIn(r.cwd, id, projects);
    let writtenAt = 0;
    try { writtenAt = fs.statSync(file).mtimeMs; } catch (_) { /* none */ }
    out.set(f, { lastBefore: file ? newestBefore(file, before) : -Infinity, stale: false, writtenAt });
  }
  const times = [...out.values()].map((c) => c.lastBefore).sort((a, b) => a - b);
  const [first, second] = times;
  if (second - first >= STALE_GAP_MS) {
    for (const c of out.values()) if (c.lastBefore === first) c.stale = true;
  }
  return out;
}

const utc = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
/* A process's pid, start time and window, as the Steward panel and a steward's notice put it, and for one running a copy
   kept in another folder, that folder and how recent its copy was. */
function describe(p) {
  const at = p.startedAt ? utc(p.startedAt) : 'at an unknown time';
  const where = p.windowless ? 'in an extension host whose window is gone' : p.window ? `in window "${p.window}"` : 'in a window not known here';
  if (!p.copy) return `pid ${p.pid}, started ${at}, ${where}`;
  const copy = p.lastBefore > -Infinity ? `whose newest entry was from ${utc(p.lastBefore)} when the later process started` : 'which could not be read';
  return `pid ${p.pid}, started ${at}, ${where}, on the copy kept for ${p.cwd}, ${copy}${p.stale ? ' (stale)' : ''}`;
}

/* The idle processes in hosts with no window, to be stopped without asking; none unless another process has a
   window. */
function autoStops(group) {
  return group.some((p) => !p.windowless) ? group.filter((p) => p.windowless && p.idle && (!p.copy || p.stale)) : [];
}
/* The process the Stop button stops, or undefined for none. */
function oldOne(group) {
  if (group.some((p) => p.copy)) return group.find((p) => p.stale);
  return group.find((p) => p.windowless) || group[0];
}

/*
 * Stops process `p` of conversation `id`, unless its pid now belongs to another process, and records the stop in
 * STOPPED_DIR for the steward's notices. Returns whether it was stopped.
 */
function stop(id, p, how, { dir, proc = '/proc', kill = (pid) => process.kill(pid, 'SIGTERM'), now = Date.now() } = {}) {
  const st = stat(proc, p.pid);
  if (!st || (p.procStart && st.start !== p.procStart)) return false;
  try { kill(p.pid); } catch (_) { return false; }
  try {
    fs.mkdirSync(path.join(dir, STOPPED_DIR), { recursive: true });
    const file = path.join(dir, STOPPED_DIR, `${p.pid}-${p.procStart || 0}.json`);
    if (!fs.existsSync(file)) writeAtomic(file, JSON.stringify({ session: id, pid: p.pid, startedAt: p.startedAt, window: p.window,
      windowless: p.windowless, how, at: now }) + '\n');
  } catch (_) { /* stopped, but the steward is not told */ }
  return true;
}

/* The stops recorded since `since`, newest last, pruning those older than STOPPED_KEEP_MS. */
function stopped(dir, since, now = Date.now()) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(path.join(dir, STOPPED_DIR)).filter((n) => n.endsWith('.json')); } catch (_) { return out; }
  for (const n of names) {
    const file = path.join(dir, STOPPED_DIR, n);
    let d = null;
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { continue; }
    if (!d || !(now - d.at < STOPPED_KEEP_MS)) { try { fs.unlinkSync(file); } catch (_) { /* gone */ } continue; }
    if (d.at > since) out.push(d);
  }
  return out.sort((a, b) => a.at - b.at);
}

module.exports = { find, autoStops, oldOne, stop, stopped, describe, hostOf, newestBefore, ALIVE_MS, NO_PAGE_MS, IDLE_MS, STALE_GAP_MS, STOPPED_DIR };
