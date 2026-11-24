// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * A conversation can leave a command running: in the background, or detached, which outlives the turn. Both are found
 * in /proc. Where there is no /proc nothing is found, and only the `claude --bg` sessions and the transcript links of
 * src/background.js remain.
 *
 * The Bash tool puts the conversation in CLAUDE_CODE_SESSION_ID and its claude process in CLAUDE_PID, and a process
 * keeps the environment it started with in /proc/<pid>/environ. A command started with `setsid`, or with
 * `nohup ... &` from a shell that has since exited, is under no claude process any more but still carries both.
 *
 * Shells and `timeout` are counted, going by argv[0] rather than the name in stat: `setsid nohup bash -c '...'`, a
 * script, a Bash tool shell. Outside every claude process, so is any program that leads its own session, which is what
 * `setsid` makes of a command. `setsid nohup bash -c 'python3 job.py'` ends up as python3 itself: bash runs the last
 * command of a -c string in its own place. Programs that detach themselves without starting a session, such as
 * Brazil's Java server or a `tail -F` nobody stopped, stay running long after the work that started them and are not
 * counted. The agent map shows the command of each counted process, so a server that does lead a session can be told
 * apart from the work it outlived.
 *
 * Below a claude process, where the MCP servers and hooks also run, only the Bash tool's own shell counts. The CLI
 * has every Bash command run a shell snapshot first, so that shell's command line names one. It lives as long as the
 * background command it holds; a foreground command is gone once the turn ends. A `claude -p` worker is found from its
 * own session record instead.
 *
 * Those outside the claude processes are also listed as jobs, for the agent map and for the notice a
 * conversation gets when one of them is gone (src/detachedends.js): only the top of each tree, since the processes a
 * detached script starts belong to that script.
 *
 * A job whose tree holds a `claude -p` worker names it: the shell a launch like `( setsid nohup env -u
 * CLAUDE_CODE_SESSION_ID claude -p ... & )` leaves behind is that worker's wrapper, not work of its own. The worker is
 * the first process down the tree with a session record; the wrappers above it (a launcher script, the CLI's own
 * stub) have none, and what lies below it is the worker's own.
 */
const fs = require('fs');
const path = require('path');
const { SESSION } = require('./claude-files');

const SESSION_KEY = Buffer.from('CLAUDE_CODE_SESSION_ID=', 'latin1');
const PID_KEY = Buffer.from('CLAUDE_PID=', 'latin1');
const STARTERS = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'timeout']);
/* In the command of a Bash tool shell: the snapshot of the user's shell that Claude Code has it run first. */
const SNAPSHOT = /shell-snapshots/i;
const MAX_DEPTH = 64;
/* How many /proc files are read at once. */
const BATCH = 128;

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += BATCH) await Promise.all(items.slice(i, i + BATCH).map((x, j) => fn(x, j)));
}
const read = (file, enc) => fs.promises.readFile(file, enc).catch(() => null);
/* A /proc file reports its size as 0, so readFile reads it in 64 KB chunks: a 64 KB buffer for each of thousands of stat
   lines of a few hundred bytes. A stat line is read into one of BATCH small buffers instead, one per read in flight. */
const STAT_BYTES = 1024;
const statBuffers = [];
async function readStat(file, slot) {
  const buf = statBuffers[slot] || (statBuffers[slot] = Buffer.alloc(STAT_BYTES));
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    const { bytesRead } = await fh.read(buf, 0, STAT_BYTES, 0);
    return buf.toString('latin1', 0, bytesRead);
  } catch (_) { return null; } finally { if (fh) await fh.close().catch(() => {}); }
}

/*
 * What the last scan of each /proc root found. Most of a machine's couple of thousand processes were already there
 * ten seconds ago, so their stat is reused. It is read again for a process whose parent is gone (it has been
 * reparented), for one in `fresh` (the caller needs its state now), and for all of them every FULL_EVERY-th scan, so a
 * reused pid or a name changed by exec is noticed within a minute.
 */
const FULL_EVERY = 6;
const scans = new Map();

/* pid -> { comm, state, ppid, session, start } for every process whose stat can be read; start is in clock ticks since
   boot. */
async function processes(proc, { fresh = new Set() } = {}) {
  const out = new Map();
  let names;
  try { names = (await fs.promises.readdir(proc)).filter((n) => /^\d+$/.test(n)); } catch (_) { return out; }
  const last = scans.get(proc) || { count: 0, byPid: new Map() };
  const full = last.count % FULL_EVERY === 0;
  const listed = new Set(names.map(Number));
  const toRead = [];
  for (const n of names) {
    const pid = Number(n), was = last.byPid.get(pid);
    if (full || !was || fresh.has(pid) || (was.ppid > 1 && !listed.has(was.ppid))) toRead.push(n);
    else out.set(pid, was);
  }
  await inBatches(toRead, async (n, slot) => {
    const s = await readStat(path.join(proc, n, 'stat'), slot);
    if (!s) return;
    const open = s.indexOf('('), close = s.lastIndexOf(')');
    if (open < 0 || close < open) return;
    const f = s.slice(close + 2).split(' ');
    out.set(Number(n), { comm: s.slice(open + 1, close), state: f[0], ppid: Number(f[1]), session: Number(f[3]), start: f[19] });
  });
  scans.set(proc, { count: last.count + 1, byPid: out });
  return out;
}

/* The value of `key` in an environment block, or ''. */
function envValue(env, key) {
  if (!env) return '';
  for (let at = env.indexOf(key); at !== -1; at = env.indexOf(key, at + 1)) {
    if (at > 0 && env[at - 1] !== 0) continue;
    const end = env.indexOf(0, at);
    return env.toString('latin1', at + key.length, end === -1 ? env.length : end);
  }
  return '';
}

/* Whether a process is a claude process, named claude or holding a session record (a claude installed through npm runs
   as node), and whether one is among its ancestors or itself. */
function claudeTest(procs, claudePids) {
  const memo = new Map();
  const isClaude = (pid) => claudePids.has(pid) || (procs.get(pid) || {}).comm === 'claude';
  const under = (pid) => {
    const trail = [];
    let found = false;
    for (let p = pid, hops = 0; p > 1 && hops < MAX_DEPTH; hops++) {
      if (memo.has(p)) { found = memo.get(p); break; }
      trail.push(p);
      if (isClaude(p)) { found = true; break; }
      const info = procs.get(p);
      if (!info) break;
      p = info.ppid;
    }
    for (const p of trail) memo.set(p, found);
    return found;
  };
  return { isClaude, under };
}

/*
 * What is running now, given the live session records (src/background.js):
 * - shells: session ids of the conversations with a shell, `timeout` or session leader of their own still running;
 * - launchers: worker session id -> launching session id, for the live `claude -p` workers whose launcher is known;
 * - jobs: { session, pid, start, startedAt, kind, command, workers? } for the jobs outside the claude processes, by
 *   session id and pid. startedAt is in ms, or null when the boot time cannot be read; kind is shell or leader; workers
 *   lists the session ids of the workers in the job's tree.
 * - workers: { id, pid, launcher, inside? } for every live worker; launcher is '' when none is known, and inside is
 *   set when the worker runs below its launcher's own claude process, in a Bash call that is still going.
 *
 * A worker's launcher is, in this order: the conversation of the job whose tree holds it; the claude process its
 * CLAUDE_PID names, whose Bash tool started it - a pid can be reused, so the process now holding it counts only if it
 * started before the worker; or the CLAUDE_CODE_SESSION_ID it was started with, which a launch can leave in place.
 */
const isWorkerRecord = (r) => /^sdk-/.test(r.entrypoint || '') && r.kind !== 'bg' && SESSION.test(r.sessionId || '');
/* How many processes of one job's tree are looked at for a worker. */
const MAX_TREE = 2000;
function workersBelow(top, kids, byPid) {
  const found = [], stack = [top];
  for (let seen = 0; stack.length && seen < MAX_TREE; seen++) {
    const pid = stack.pop();
    for (const k of kids.get(pid) || []) {
      const r = byPid.get(k);
      if (r) { if (isWorkerRecord(r)) found.push(r.sessionId.toLowerCase()); continue; }
      stack.push(k);
    }
  }
  return found;
}
/* Each process's kind and conversation, or NONE. Keyed by pid, start time, name and session, which together
   change when the pid is reused, the process runs another program or starts a session, so a process is read again only
   when one of them changes. */
const NONE = Object.freeze({ id: '' });
const startedBy = new Map();
/* A program started through the dynamic loader by hand, as the AWS CLI's wrapper does, is shown without the loader and
   its options, which would otherwise fill the start of the line. */
const MAX_COMMAND = 1000;
const LOADER = /^ld(-linux)?[\w.-]*\.so(\.\d+)*$/;
const LOADER_OPTIONS = new Set(['--library-path', '--argv0', '--preload', '--audit', '--glibc-hwcaps-prepend', '--glibc-hwcaps-mask']);
const argvOf = (args) => {
  let a = args.split('\0').filter(Boolean);
  if (a.length > 1 && LOADER.test(path.basename(a[0]))) {
    let i = 1;
    while (i < a.length && a[i].startsWith('--')) i += LOADER_OPTIONS.has(a[i]) ? 2 : 1;
    if (i < a.length) a = a.slice(i);
  }
  return a;
};
const oneLine = (a) => a.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_COMMAND);
const commandOf = (args) => oneLine(argvOf(args));
/*
 * The title of a command's card in the agent map: the program and the one argument that tells what it is running, with
 * the whole command line left to the card's hover text.
 *
 * - A Bash tool shell runs Claude Code's shell snapshot and then the command it was given, inside `eval '...'`: that
 *   command is the title, since the shell around it is the same for every one.
 * - Another shell's -c string is the command it runs, so it follows the shell's name.
 * - With perl -e, python -c or node -e, the program text says nothing at a glance and fills the line; the last argument
 *   after it that is not an option is named instead, which for a relay or a server is usually its own name.
 * - `timeout` is followed by the command it limits.
 * - Otherwise the first argument that is not an option.
 *
 * A path shows only its last part. Each part is cut to TITLE_PART characters.
 */
const INLINE = new Set(['-e', '-E', '-c', '--eval']);
const TITLE_PART = 60;
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '\u2026' : s);
const firstLine = (s) => cut(String(s).split('\n').map((l) => l.trim()).filter(Boolean)[0] || '', TITLE_PART);
const pathPart = (s) => (/[\\/]/.test(s) && !/\s/.test(s) ? path.basename(s.replace(/[\\/]+$/, '')) || s : s);
const argPart = (s) => cut(pathPart(s), TITLE_PART);
/* The command a Bash tool shell was given, from its -c string; null for any other -c string. */
const evaled = (c) => {
  if (!SNAPSHOT.test(c)) return null;
  const e = /\beval '((?:[^']|'\\'')*)'/.exec(c);
  if (e) return e[1].replace(/'\\''/g, "'");
  const after = /shell-snapshots[\\/]\S+(?:\s+2>\/dev\/null\s+\|\|\s+true)?\s+&&\s+([\s\S]+)$/.exec(c);
  return after ? after[1] : null;
};
const titleOfArgv = (a) => {
  if (!a.length) return '';
  const prog = path.basename(a[0]), rest = a.slice(1);
  if (prog === 'timeout') {
    const at = rest.findIndex((x) => !x.startsWith('-'));
    return at >= 0 && at + 1 < rest.length ? titleOfArgv(rest.slice(at + 1)) : prog;
  }
  if (STARTERS.has(prog)) {
    const c = rest.findIndex((x) => /^-[a-z]*c$/.test(x));
    if (c >= 0 && typeof rest[c + 1] === 'string') {
      const ran = evaled(rest[c + 1]);
      return ran !== null ? firstLine(ran) : `${prog} -c ${firstLine(rest[c + 1])}`;
    }
  }
  if (rest.length >= 2 && INLINE.has(rest[0])) {
    const after = rest.slice(2), named = after.filter((x) => !x.startsWith('-')).pop();
    return named ? `${prog} ${rest[0]} \u2026 ${argPart(named)}` : `${prog} ${rest[0]} ${firstLine(rest[1])}`;
  }
  const first = rest.find((x) => !x.startsWith('-'));
  return first ? `${prog} ${argPart(first)}` : prog;
};
const titleOf = (args) => titleOfArgv(argvOf(args));
/* Clock ticks per second in /proc/<pid>/stat: USER_HZ, which is 100 on every architecture Linux runs VS Code on. */
const TICKS = 100;
/* The boot time of each /proc root, in ms, from the btime line of its stat file. */
const boots = new Map();
async function bootMs(proc) {
  if (boots.has(proc)) return boots.get(proc);
  const m = /^btime (\d+)$/m.exec((await read(path.join(proc, 'stat'), 'latin1')) || '');
  const ms = m ? Number(m[1]) * 1000 : null;
  boots.set(proc, ms);
  return ms;
}

/* Per /proc root, the pids that were counted as running shells in the last snapshot: their state is read every time. */
const shellPids = new Map();
async function snapshot({ proc = '/proc', records = [] } = {}) {
  const shells = new Set(), launchers = new Map(), counted = new Set(), jobs = [], workers = [];
  const procs = await processes(proc, { fresh: shellPids.get(proc) });
  if (!procs.size) return { shells, launchers, jobs, workers };
  const { isClaude, under } = claudeTest(procs, new Set(records.map((r) => r.pid)));
  const candidates = [...procs].filter(([pid, p]) => p.state !== 'Z' && p.state !== 'X' && !isClaude(pid));
  const keep = new Map(), outside = new Map();
  await inBatches(candidates, async ([pid, p]) => {
    // Whether it is below a claude process is part of the key: a process reparented to init is read again.
    const below = under(p.ppid);
    const key = proc + '\0' + pid + ':' + p.start + ':' + p.comm + ':' + p.session + (below ? ':c' : '');
    let found = startedBy.get(key);
    if (found === undefined) {
      found = NONE;
      const sid = envValue(await read(path.join(proc, String(pid), 'environ')), SESSION_KEY);
      if (SESSION.test(sid)) {
        const args = (await read(path.join(proc, String(pid), 'cmdline'), 'latin1')) || '';
        const shell = STARTERS.has(path.basename(args.split('\0')[0]));
        const kind = shell && (!below || SNAPSHOT.test(args)) ? 'shell' : !shell && !below && p.session === pid ? 'leader' : '';
        if (kind) found = { id: sid.toLowerCase(), kind, command: commandOf(args), title: titleOf(args) };
      }
    }
    keep.set(key, found);
    if (!found.id) return;
    shells.add(found.id);
    counted.add(pid);
    if (!below) outside.set(pid, found);
  });
  shellPids.set(proc, counted);
  startedBy.clear();
  for (const [k, v] of keep) startedBy.set(k, v);
  const boot = outside.size ? await bootMs(proc) : null;
  for (const [pid, f] of outside) {
    let top = true;
    for (let q = procs.get(pid).ppid, hops = 0; q > 1 && hops < MAX_DEPTH; hops++) {
      const o = outside.get(q);
      if (o && o.id === f.id) { top = false; break; }
      const info = procs.get(q);
      if (!info) break;
      q = info.ppid;
    }
    if (!top) continue;
    const start = procs.get(pid).start;
    jobs.push({ session: f.id, pid, start: String(start), startedAt: boot === null ? null : boot + Math.round(Number(start) * 1000 / TICKS),
      kind: f.kind, command: f.command, ...(f.title ? { title: f.title } : {}) });
  }
  jobs.sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : a.pid - b.pid));
  const byPid = new Map(records.map((r) => [r.pid, r]));
  const workerRecords = records.filter(isWorkerRecord);
  const inJob = new Map();
  if (jobs.length && workerRecords.length) {
    const kids = new Map();
    for (const [pid, p] of procs) {
      if (!kids.has(p.ppid)) kids.set(p.ppid, []);
      kids.get(p.ppid).push(pid);
    }
    for (const j of jobs) {
      const found = workersBelow(j.pid, kids, byPid);
      if (!found.length) continue;
      j.workers = found;
      for (const w of found) if (!inJob.has(w)) inJob.set(w, j.session);
    }
  }
  await inBatches(workerRecords, async (r) => {
    const id = r.sessionId.toLowerCase();
    const env = await read(path.join(proc, String(r.pid), 'environ'));
    let launcher = inJob.get(id) || '';
    if (!launcher) {
      const l = byPid.get(Number(envValue(env, PID_KEY)));
      const a = l && procs.get(l.pid), b = procs.get(r.pid);
      if (l && l !== r && SESSION.test(l.sessionId || '') && a && b && Number(a.start) <= Number(b.start)) launcher = l.sessionId.toLowerCase();
    }
    if (!launcher) {
      const sid = envValue(env, SESSION_KEY).toLowerCase();
      if (SESSION.test(sid) && sid !== id) launcher = sid;
    }
    if (launcher) launchers.set(id, launcher);
    let inside = false;
    for (let q = (procs.get(r.pid) || {}).ppid, hops = 0; q > 1 && hops < MAX_DEPTH; hops++) {
      const holder = byPid.get(q);
      if (holder) { inside = !!launcher && String(holder.sessionId || '').toLowerCase() === launcher; break; }
      const info = procs.get(q);
      if (!info) break;
      q = info.ppid;
    }
    workers.push({ id, pid: r.pid, launcher, ...(inside ? { inside: true } : {}) });
  });
  workers.sort((a, b) => a.pid - b.pid);
  return { shells, launchers, jobs, workers };
}

module.exports = { snapshot, processes, titleOf, isWorkerRecord, STARTERS, SNAPSHOT };
