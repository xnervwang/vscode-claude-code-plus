// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The `claude --bg` sessions a conversation started, for the panel's agent map.
 *
 * A detached session's own record names nobody but itself, so who launched it is read from the other side: the Bash call
 * that started it printed `backgrounded · <id>` into the launching conversation's transcript - a fixed template in the
 * CLI, followed by the attach, logs and stop hints, each of which names the id again. This host reads those from the
 * transcript of the conversation in front of the reader, and writes what it found to a small file beside that
 * conversation's plan.
 *
 * Those files are the shared state, not each host's memory. Every window builds the stylesheet from all of them, so two
 * windows looking at different conversations still write the same bytes; building it from what one window had scanned
 * would differ between windows, and the stylesheet is one file they all write - which is how settings once flickered.
 *
 * Reading is incremental (src/claude-files.js). The file records the transcript read offset for every conversation
 * scanned, including ones that launched no background session, so that a window starting up resumes from there instead
 * of the first byte; the first pass over a large conversation reads all of it once.
 *
 * A detached session is never opened from here. The panel launches Claude on whatever conversation it opens, so opening
 * one that a daemon is still writing would put a second process on it.
 */
const fs = require('fs');
const path = require('path');
const { claudeDir, planDir, SESSION, transcriptOf, readLines, oneAtATime, writeAtomic } = require('./claude-files');
const detached = require('./detached');
const planNames = require('./plan-names');

const jobsDir = () => path.join(claudeDir(), 'jobs');
const SUFFIX = '.background';
const LINK_FILE = /^[0-9a-f][0-9a-f-]{7,}\.background$/i;
const SHORT_ID = /^[0-9a-f]{8}$/;
/* The CLI's own words, middle dot and all, at the start of a line. When the output went to a terminal the id is wrapped
   in colour codes. */
const MARK = Buffer.from('backgrounded · ', 'utf8');
const ID_AFTER = /^[ \t]*backgrounded · (?:\x1b\[[0-9;]*m)*([0-9a-f]{8})(?![0-9a-f])/gm;
/* The hints the CLI prints under that line, the command padded and followed by what it does. A launch piped through
   `tail` keeps only these, so each one is a launch in its own right. When the output went to a terminal the whole
   line is dimmed. */
const HINTS = ['open in this terminal', 'show recent output', 'stop this session'];
const HINT_NEEDLES = HINTS.map((h) => Buffer.from(h, 'utf8'));
const ID_IN_HINT = new RegExp('^(?:\\x1b\\[[0-9;]*m)*[ \\t]*claude (?:attach|logs|stop) ([0-9a-f]{8})[ \\t]+(?:'
  + HINTS.join('|') + ')', 'gm');
/* One of those commands alone on its line, which is all a launch piped through `grep -o 'claude attach [0-9a-f]*'`
   keeps. An `echo` leaves the same line, so it counts only for a session created while the call ran. */
const ID_ALONE = /^(?:\x1b\[[0-9;]*m)*[ \t]*claude (?:attach|logs|stop) ([0-9a-f]{8})(?:\x1b\[[0-9;]*m)*[ \t\r]*$/gm;
const ALONE_NEEDLES = ['claude attach ', 'claude logs ', 'claude stop '].map((s) => Buffer.from(s, 'utf8'));
/* Leeway on both sides of the call: the rows and the record are stamped by different processes. */
const DURING_SLACK_MS = 5000;
/* How much of a session's first prompt the launching command must contain, and the shortest prompt that is matched. */
const INTENT_CHARS = 80;
const MIN_INTENT = 12;
/* The flag that starts one, found in the command a tool result answers. */
const BG_FLAG = Buffer.from('--bg', 'utf8');
/* A `claude -p` worker. Its session id follows --resume or --session-id in the command, or is in the stream-json init
   line the command printed. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const WORKER_CMD = /\bclaude\b[^\n|;&]*?\s(?:-p|--print)(?=[\s"']|$)/;
const WORKER_IDS = new RegExp(`(?:--resume|--session-id)[ =]+["']?(${UUID})`, 'gi');
const INIT_ID = new RegExp(`"session_id"\\s*:\\s*"(${UUID})"`, 'gi');
const WORKER_NEEDLES = ['claude -p', 'claude --print', 'claude --resume', 'claude --session-id']
  .map((s) => Buffer.from(s, 'utf8'));
const MAX_WORKERS = 50;
const NEEDLES = [BG_FLAG, MARK, ...HINT_NEEDLES, ...ALONE_NEEDLES, ...WORKER_NEEDLES];
/* A Bash call that starts a `claude --bg` session as a background command (run_in_background) prints into its own file.
   The command's result names that file, and the result is all the transcript gets. The file is read on every pass while
   it may still be written. */
const OUTPUT_AT = /Output is being written to: (\S+\.output)\b/;
const OUTPUT_MS = 24 * 3600 * 1000;
const MAX_OUTPUTS = 20;
const MAX_OUTPUT_BYTES = 1 << 20;
/* Bump this when the scan starts recognising a launch it used to miss: link files written by an older version are then
   read again from the start, once. */
const READER = 5;
/* The stylesheet carries all of this to every panel on every change, so the caps are about its size, not about how
   many sessions anyone starts. */
const MAX_SESSIONS = 10;
const MAX_PER_SESSION = 20;
const MAX_ENTRIES = 40;
/* How far a scan may get ahead of what is on disk before the position is written down. It is only a starting point for
   the next window or the next start, so it does not have to be exact - only not so stale that a restart reads it all. */
const PERSIST_EVERY = 1 << 20;

const textOf = (b) => (typeof b.content === 'string' ? b.content
  : Array.isArray(b.content) ? b.content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('') : '');

/*
 * One transcript line, read for launches. Every condition below has been met on its own by something that was not one.
 *
 * The output has to answer a command that ran `--bg`: a command that printed an earlier launch back - a grep over
 * another transcript, say - produced the very same line, at the start of it, for an id that was real and still had a
 * record, so nothing in the text could tell the two apart. The words have to open a line - indentation allowed, since a
 * command that indents its own output is common and was how the first live launch here went unseen - which keeps out
 * a launch quoted in passing; be followed by exactly eight hex digits, which keeps out a document describing the format; and
 * name a session that has a record. Either end of the CLI's output is enough: a launch whose output lost its hints is an
 * ordinary launch, and so is one whose output kept only the hints - `| tail -3` keeps the last three, and that is how a
 * live launch went unseen. A hint counts only with the words after it, so a command that echoes `claude stop <id>` is
 * not one. Without them, the command alone counts only if the session's record was created between the call and its
 * result; an echo of an older session's id fails that.
 *
 * `ran` carries the commands, and when each was made, across lines and passes, since a call and its result are
 * separate rows.
 */
function readLine(line, ran, jobs, seen, workers, outputs) {
  let row;
  try { row = JSON.parse(line); } catch (_) { return; }
  const blocks = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];
  const at = Date.parse(row && row.timestamp);
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'tool_use' && b.input && typeof b.input.command === 'string') {
      const command = b.input.command;
      const worker = !command.includes('--bg') && WORKER_CMD.test(command);
      if (!worker && !command.includes('--bg')) continue;
      if (worker) for (const m of command.matchAll(WORKER_IDS)) workers.add(m[1].toLowerCase());
      ran.set(b.id, { at, command, worker, background: b.input.run_in_background === true });
      if (ran.size > 500) ran.delete(ran.keys().next().value);
      continue;
    }
    if (b.type !== 'tool_result' || !ran.has(b.tool_use_id)) continue;
    const call = ran.get(b.tool_use_id);
    const text = textOf(b);
    if (call.worker) {
      for (const m of text.matchAll(INIT_ID)) workers.add(m[1].toLowerCase());
      continue;
    }
    const file = call.background && outputs ? (OUTPUT_AT.exec(text) || [])[1] : '';
    if (file && isFinite(call.at)) { outputs.set(file, call.at); continue; }
    let m, named = false;
    for (const re of [ID_AFTER, ID_IN_HINT]) {
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        named = true;
        if (!seen.has(m[1]) && fs.existsSync(path.join(jobs, m[1], 'state.json'))) seen.add(m[1]);
      }
    }
    ID_ALONE.lastIndex = 0;
    while ((m = ID_ALONE.exec(text))) {
      named = true;
      if (!seen.has(m[1]) && createdBetween(path.join(jobs, m[1], 'state.json'), call.at, at)) seen.add(m[1]);
    }
    if (!named) launchedBy(jobs, call, at, seen);
  }
}

const squash = (s) => (typeof s === 'string' ? s.replace(/[\\"'`]/g, '').replace(/\s+/g, ' ').trim() : '');

/*
 * When `| head -1` leaves only "Starting background service…", the output names no session, so the launch is matched by
 * its prompt: a session created while the call ran, whose first prompt appears in the command. Quotes and backslashes
 * are left out of both, since the shell takes them off the prompt it passes on.
 */
function launchedBy(jobs, call, to, seen) {
  if (!isFinite(call.at) || !isFinite(to)) return;
  const command = squash(call.command);
  let names;
  try { names = fs.readdirSync(jobs); } catch (_) { return; }
  for (const id of names) {
    if (!SHORT_ID.test(id) || seen.has(id)) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(jobs, id, 'state.json'), 'utf8')); } catch (_) { continue; }
    const t = Date.parse(d && d.createdAt);
    if (!isFinite(t) || t < call.at - DURING_SLACK_MS || t > to + DURING_SLACK_MS) continue;
    const intent = squash(d.intent).slice(0, INTENT_CHARS);
    if (intent.length >= MIN_INTENT && command.includes(intent)) seen.add(id);
  }
}

function createdBetween(file, from, to) {
  if (!isFinite(from) || !isFinite(to)) return false;
  let t;
  try { t = Date.parse(JSON.parse(fs.readFileSync(file, 'utf8')).createdAt); } catch (_) { return false; }
  return isFinite(t) && t >= from - DURING_SLACK_MS && t <= to + DURING_SLACK_MS;
}

/*
 * `exists` says whether there was a link file at all.
 *
 * Parsed files are cached by modification time and size, so a pass rereads only the files that changed, and a pass over
 * a conversation whose transcript has not grown reads nothing.
 */
const links = new Map();
function readLink(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) {
    links.delete(file);
    return { ids: [], workers: [], outputs: [], scannedTo: 0, launched: 0, exists: !(e && e.code === 'ENOENT') };
  }
  const was = links.get(file);
  if (was && was.mtimeMs === st.mtimeMs && was.size === st.size) return was.link;
  let d = null;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* caught mid-write, or not ours */ }
  const ids = d && Array.isArray(d.ids) ? d.ids.filter((x) => typeof x === 'string' && SHORT_ID.test(x)) : [];
  const workers = d && Array.isArray(d.workers) ? d.workers.filter((x) => typeof x === 'string' && SESSION.test(x)) : [];
  const scannedTo = d && d.reader === READER && typeof d.scannedTo === 'number' && d.scannedTo >= 0 ? d.scannedTo : 0;
  const launched = d && typeof d.launched === 'number' && isFinite(d.launched) ? d.launched : 0;
  const outputs = d && Array.isArray(d.outputs)
    ? d.outputs.filter((o) => o && typeof o.file === 'string' && typeof o.at === 'number' && isFinite(o.at)).map((o) => ({ file: o.file, at: o.at }))
    : [];
  const link = { ids, workers, outputs, scannedTo, launched, exists: true };
  links.set(file, { mtimeMs: st.mtimeMs, size: st.size, link });
  return link;
}

/* What was written is kept as read, so the next pass does not read back the file it wrote itself. */
function writeLink(file, link) {
  writeAtomic(file, JSON.stringify(link) + '\n');
  try {
    const st = fs.statSync(file);
    links.set(file, { mtimeMs: st.mtimeMs, size: st.size,
      link: { ids: link.ids.slice(), workers: (link.workers || []).slice(), outputs: (link.outputs || []).slice(),
        scannedTo: link.reader === READER ? link.scannedTo : 0, launched: link.launched || 0, exists: true } });
  } catch (_) { /* read again next time */ }
}

/* Launch time of the newest of these sessions, from each session's own state.json, so that every window computes the
   same value; 0 when no record has one. */
function launchOf(ids, jobs) {
  let newest = 0;
  for (const id of ids) {
    try {
      const t = Date.parse(JSON.parse(fs.readFileSync(path.join(jobs, id, 'state.json'), 'utf8')).createdAt);
      if (isFinite(t) && t > newest) newest = t;
    } catch (_) { /* no record, or one being written */ }
  }
  return newest;
}

/**
 * Read what one conversation's transcript has added since last time.
 *
 * One pass runs at a time per conversation (oneAtATime in src/claude-files.js).
 */
function scan(session, opts = {}) {
  if (!SESSION.test(String(session || ''))) return Promise.resolve({ added: 0, scannedTo: 0 });
  return scanQueued(session, opts);
}

/* What this host has found per conversation, kept so that a write which lost a race with another window's write puts
   back what the other one did not know about, the next time this host writes. */
const known = new Map();
const knownWorkers = new Map();
const commands = new Map();
/* How far this host has read each transcript, ahead of the file, which is written only every PERSIST_EVERY bytes. */
const readTo = new Map();

/*
 * Only lines containing a needle are parsed, in file order, so a call is seen before the result that answers it. Any
 * other tool result is parsed only when its tool_use_id belongs to a call that ran `--bg`: `head -1` can leave none of
 * the CLI's words in it.
 */
const RESULT_ID = Buffer.from('"tool_use_id":"', 'utf8');
function readChunk(data, ran, jobs, seen, workers, outputs) {
  const last = data.length - 1;
  const starts = new Set(), results = new Map();
  for (const needle of NEEDLES) {
    let at = 0;
    while ((at = data.indexOf(needle, at)) !== -1 && at < last) {
      starts.add(data.lastIndexOf(0x0a, at) + 1);
      at = data.indexOf(0x0a, at) + 1;
    }
  }
  for (let at = 0; (at = data.indexOf(RESULT_ID, at)) !== -1 && at < last;) {
    const ls = data.lastIndexOf(0x0a, at) + 1, from = at + RESULT_ID.length;
    if (!starts.has(ls) && !results.has(ls)) results.set(ls, data.toString('utf8', from, data.indexOf(0x22, from)));
    at = data.indexOf(0x0a, at) + 1;
    if (at === 0) break;
  }
  for (const ls of [...starts, ...results.keys()].sort((a, b) => a - b)) {
    if (results.has(ls) && !ran.has(results.get(ls))) continue;
    readLine(data.subarray(ls, data.indexOf(0x0a, ls)).toString('utf8'), ran, jobs, seen, workers, outputs);
  }
}

/*
 * Reads the output files of background launches (`outputs`: file -> when the call was made) for what the CLI printed,
 * the way a transcript's tool result is read, and returns those still worth reading again: a file is dropped a day
 * after the call, or once it is gone. Claude Code keeps such a file in a folder named after the conversation, so a path
 * without the conversation's id in it is skipped.
 */
const outputRead = new Map();
function readOutputs(session, outputs, jobs, seen, now) {
  const kept = [];
  for (const [file, at] of [...outputs].sort((a, b) => a[1] - b[1]).slice(-MAX_OUTPUTS)) {
    if (now - at > OUTPUT_MS || !file.includes(session)) { outputRead.delete(file); continue; }
    let text;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const st = fs.fstatSync(fd), stamp = st.mtimeMs + ':' + st.size;
        kept.push({ file, at });
        if (outputRead.get(file) === stamp) continue;
        outputRead.set(file, stamp);
        if (outputRead.size > 500) outputRead.delete(outputRead.keys().next().value);
        const buf = Buffer.alloc(Math.min(st.size, MAX_OUTPUT_BYTES));
        text = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch (_) { outputRead.delete(file); continue; }
    for (const re of [ID_AFTER, ID_IN_HINT]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) if (!seen.has(m[1]) && fs.existsSync(path.join(jobs, m[1], 'state.json'))) seen.add(m[1]);
    }
  }
  return kept;
}

async function scanOnce(session, opts) {
  const dir = opts.dir || planDir();
  const jobs = opts.jobs || jobsDir();
  const transcript = opts.transcript || transcriptOf(session, opts.projects);
  if (!transcript) return { added: 0, scannedTo: 0 };
  const file = path.join(dir, session + SUFFIX);
  const link = readLink(file);
  const seen = new Set(link.ids);
  for (const id of known.get(session) || []) seen.add(id);
  const workers = new Set(link.workers);
  for (const id of knownWorkers.get(session) || []) workers.add(id);
  if (!commands.has(session)) commands.set(session, new Map());
  const ran = commands.get(session);
  // A position past the end means the transcript was replaced rather than appended to, so it is read again in full.
  const outputs = new Map(link.outputs.map((o) => [o.file, o.at]));
  const reader = { pos: Math.max(link.scannedTo, readTo.get(session) || 0),
    take: (data) => readChunk(data, ran, jobs, seen, workers, outputs) };
  if (!(await readLines(transcript, reader))) return { added: 0, scannedTo: 0 };
  const consumed = reader.pos;
  const kept = readOutputs(session, outputs, jobs, seen, opts.now || Date.now());
  const outputsChanged = JSON.stringify(kept) !== JSON.stringify(link.outputs);
  const ids = [...seen];
  known.set(session, ids);
  readTo.set(session, consumed);
  const fresh = ids.filter((id) => !link.ids.includes(id));
  // A worker found by the ten-second check (working()) can have been written since this pass read the file.
  for (const id of readLink(file).workers) workers.add(id);
  const found = [...workers].slice(-MAX_WORKERS);
  knownWorkers.set(session, found);
  const freshWorkers = found.filter((id) => !link.workers.includes(id));
  /* Written even when nothing was launched (see the top of this file); collect() skips such files. With write: false
     nothing is written, and working() reads what was found from memory. */
  if (opts.write !== false && (fresh.length || freshWorkers.length || outputsChanged || !link.exists
      || consumed - link.scannedTo >= PERSIST_EVERY)) {
    const launched = Math.max(link.launched, launchOf(link.launched ? fresh : ids, jobs));
    try {
      fs.mkdirSync(dir, { recursive: true });
      writeLink(file, Object.assign({ ids, scannedTo: consumed, reader: READER }, found.length ? { workers: found } : {},
        kept.length ? { outputs: kept } : {}, launched ? { launched } : {}));
    } catch (_) { /* the next pass writes it */ }
  }
  return { added: fresh.length, scannedTo: consumed };
}
const scanQueued = oneAtATime(scanOnce);

/* A state file is rewritten by the daemon while it runs, so a read can land on half of one. Then the last whole reading
   stands in for it rather than the session disappearing from the list for a refresh. */
const lastGood = new Map();
const CONTRACT = /^\s*<!--[\s\S]*?-->\s*/;
const clip = (v, n) => {
  const s = typeof v === 'string' ? v : '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const when = (v) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return isFinite(t) ? t : null;
};

function readState(id, jobs = jobsDir()) {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(path.join(jobs, id, 'state.json'), 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') { lastGood.delete(id); return null; }
    return lastGood.get(id) || null;
  }
  if (!d || typeof d !== 'object') return lastGood.get(id) || null;
  const entry = {
    id,
    name: clip(d.name, 80),
    state: clip(d.state, 20),
    detail: clip(d.detail, 160),
    needs: clip(d.needs, 300),
    result: clip(d.output && typeof d.output === 'object' ? d.output.result : '', 400),
    // A task written to the conventions here opens with a comment block saying what the document is for; the task
    // itself is what comes after it.
    task: clip(String(typeof d.intent === 'string' ? d.intent : '').replace(CONTRACT, '').trim(), 300),
    tokens: typeof d.tokens === 'number' && isFinite(d.tokens) ? d.tokens : null,
    startedAt: when(d.createdAt),
    endedAt: when(d.lastTerminalAt) || when(d.firstTerminalAt),
  };
  lastGood.set(id, entry);
  return entry;
}

/* Sort key of the list: when the link file's conversation last launched a session. A file written before that was
   recorded falls back to its sessions' own records, computed once per version of the file. */
function launchedFor(file, link, jobs) {
  if (link.launched) return link.launched;
  const entry = links.get(file);
  if (!entry) return launchOf(link.ids, jobs);
  if (entry.order === undefined) entry.order = launchOf(link.ids, jobs);
  return entry.order;
}

/**
 * Every recorded session, trimmed to what the panel shows, for the stylesheet.
 *
 * Newest launch first, not by the files' modification times: a file is rewritten as its transcript is read, which says
 * nothing about its sessions, and every rewrite would reorder the list and with it the stylesheet every panel reloads.
 */
function collect(opts = {}) {
  const dir = opts.dir || planDir();
  const jobs = opts.jobs || jobsDir();
  let names;
  try { names = planNames.names(dir).filter((n) => LINK_FILE.test(n)); } catch (_) { return []; }
  const files = [];
  for (const n of names) {
    const file = path.join(dir, n), link = readLink(file);
    if (link.ids.length) files.push({ n, t: launchedFor(file, link, jobs), ids: link.ids });
  }
  files.sort((a, b) => b.t - a.t || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
  const out = [];
  for (const { n, ids } of files.slice(0, MAX_SESSIONS)) {
    const session = n.slice(0, -SUFFIX.length);
    for (const id of ids.slice(-MAX_PER_SESSION)) {
      const entry = readState(id, jobs);
      if (entry) out.push(Object.assign({ session }, entry));
      if (out.length >= MAX_ENTRIES) return out;
    }
  }
  return out;
}

/* Signal 0 only checks; EPERM still means the process exists. */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

/* Whether a record still belongs to the process now holding its pid. A process that died can leave a record whose pid
   another process has since been given. Checked where /proc gives the process start time. */
function sameStart(d, proc) {
  if (typeof d.procStart !== 'string' || !d.procStart) return true;
  let s;
  try { s = fs.readFileSync(path.join(proc, String(d.pid), 'stat'), 'latin1'); } catch (_) { return true; }
  return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] === d.procStart;
}

/* Session records of running claude processes: the ~/.claude/sessions/<pid>.json files that `claude agents` lists. */
function liveRecords(dir = path.join(claudeDir(), 'sessions'), isAlive = alive, proc = '/proc') {
  const out = [];
  let names;
  try { names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return out; }
  for (const n of names) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { continue; }
    if (d && Number.isInteger(d.pid) && isAlive(d.pid) && sameStart(d, proc)) out.push(d);
  }
  return out;
}

/*
 * Job ids of busy `claude --bg` sessions. Status "busy" is a turn in progress and "shell" a command still running.
 * A session whose detached command (src/detached.js) still runs is busy as well.
 */
const BUSY = new Set(['busy', 'shell']);
function busyOf(records, shells = new Set()) {
  const out = new Set();
  for (const d of records) {
    if (d.kind !== 'bg' || typeof d.jobId !== 'string' || !SHORT_ID.test(d.jobId)) continue;
    const own = typeof d.sessionId === 'string' && shells.has(d.sessionId.toLowerCase());
    if (BUSY.has(d.status) || own) out.add(d.jobId);
  }
  return out;
}
function busyJobs(dir, isAlive = alive, shells) {
  return busyOf(liveRecords(dir, isAlive), shells);
}

/* A `claude -p` worker's record. An idle one is an SDK session waiting for input. */
const isWorker = (d) => /^sdk-/.test(d.entrypoint || '') && d.kind !== 'bg' && SESSION.test(d.sessionId || '');

/* Adds workers to their launchers' link files, so a launcher keeps them after its process exits (a window reload ends
   it). */
function noteWorkers(launchedBy, dir) {
  const by = new Map();
  for (const [w, l] of launchedBy) { if (!by.has(l)) by.set(l, []); by.get(l).push(w); }
  for (const [session, ws] of by) {
    const file = path.join(dir, session + SUFFIX), link = readLink(file);
    const fresh = ws.filter((w) => !link.workers.includes(w));
    if (!fresh.length) continue;
    const workers = [...link.workers, ...fresh].slice(-MAX_WORKERS);
    knownWorkers.set(session, [...new Set([...(knownWorkers.get(session) || []), ...fresh])]);
    try {
      fs.mkdirSync(dir, { recursive: true });
      writeLink(file, Object.assign({ ids: link.ids, workers, scannedTo: link.exists ? link.scannedTo : 0, reader: READER },
        link.launched ? { launched: link.launched } : {}));
    } catch (_) { /* found again on the next check */ }
  }
}

/*
 * The background work a conversation's Stop and SubagentStop hooks last reported
 * (claude-plugin/agent-work-plan/hooks/record-background.py): background commands, subagents, monitors and workflows,
 * on every platform, from Claude Code 2.1.326. It counts only while the claude process that wrote it runs, since that
 * work lives in the process: a live record must name the conversation and have started before the file was written,
 * and must have the file's pid when the file has one. Timers in the file are not counted; they wake the conversation
 * later and run nothing until then.
 */
const TASKS_SUFFIX = '.tasks';
const TASKS_FILE = /^[0-9a-f][0-9a-f-]{7,}\.tasks$/i;
/* The record's start time and the file's are stamped by different processes. */
const STARTED_SLACK_MS = 5000;
const taskFiles = new Map();
function readTasks(file) {
  let st;
  try { st = fs.statSync(file); } catch (_) { taskFiles.delete(file); return null; }
  const was = taskFiles.get(file);
  if (was && was.mtimeMs === st.mtimeMs && was.size === st.size) return was.d;
  let d = null;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return was ? was.d : null; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.tasks)) d = null;
  taskFiles.set(file, { mtimeMs: st.mtimeMs, size: st.size, d });
  return d;
}
function hookWork(dir, records) {
  const out = new Set();
  let names;
  try { names = planNames.names(dir).filter((n) => TASKS_FILE.test(n)); } catch (_) { return out; }
  for (const n of names) {
    const d = readTasks(path.join(dir, n));
    if (!d || !d.tasks.length || typeof d.at !== 'number') continue;
    const session = n.slice(0, -TASKS_SUFFIX.length).toLowerCase();
    const writer = records.some((r) => typeof r.sessionId === 'string' && r.sessionId.toLowerCase() === session
      && (!Number.isInteger(d.pid) || r.pid === d.pid)
      && !(typeof r.startedAt === 'number' && r.startedAt > d.at + STARTED_SLACK_MS));
    if (writer) out.add(session);
  }
  return out;
}

/*
 * Session ids of the conversations with work running: a busy `claude --bg` session it started, a `claude -p` worker it
 * started, a command it left running, or work its hooks reported (hookWork). A worker is tied to it by the process scan
 * (src/detached.js: the detached command holding the worker, CLAUDE_PID while the conversation's process runs, or the
 * session id the worker was started with); after that, by the link file and the workers its transcript names.
 *
 * `shells` and `launchers` are what src/detached.js found. `write` false leaves the link files alone, for a window
 * that must not write shared files.
 */
function working(opts = {}) {
  const dir = opts.dir || planDir();
  const records = opts.records || liveRecords(opts.sessions);
  const shells = opts.shells || new Set();
  const launchedBy = opts.launchers || new Map();
  const busy = opts.busy || busyOf(records, shells);
  if (opts.write !== false && launchedBy.size) noteWorkers(launchedBy, dir);
  const live = new Set(records.filter((d) => isWorker(d) && d.status !== 'idle').map((d) => d.sessionId.toLowerCase()));
  const out = new Set([...shells, ...hookWork(dir, records)]);
  for (const [w, l] of launchedBy) if (live.has(w)) out.add(l);
  let names;
  try { names = planNames.names(dir).filter((n) => LINK_FILE.test(n)); } catch (_) { return out; }
  for (const n of names) {
    const link = readLink(path.join(dir, n));
    if (link.ids.some((id) => busy.has(id)) || link.workers.some((w) => live.has(w) || shells.has(w))) {
      out.add(n.slice(0, -SUFFIX.length));
    }
  }
  for (const [session, ids] of known) if (ids.some((id) => busy.has(id))) out.add(session);
  return out;
}

/*
 * Every window reads /proc for the same answer, a few hundred milliseconds of work over thousands of files each time.
 * The windows share it through SNAPSHOT_FILE in the plan directory: a window takes one written less than SHARE_MS ago
 * instead of reading /proc. A window running an older build reads the file but never writes it. Tests pass a made-up
 * /proc in opts.proc, which is never shared.
 */
const SNAPSHOT_FILE = 'detached.json';
const SHARE_MS = 9000;
/* A window running an earlier build writes no jobs, or no workers; such a file is read again from /proc rather than
   taken to mean that every job has stopped, or that no job holds a worker. */
async function sharedSnapshot(records, opts) {
  if (opts.proc) return detached.snapshot({ proc: opts.proc, records });
  const file = path.join(opts.dir || planDir(), SNAPSHOT_FILE), now = Date.now();
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d.at <= now && now - d.at < SHARE_MS && Array.isArray(d.shells) && Array.isArray(d.launchers) && Array.isArray(d.jobs)
        && Array.isArray(d.workers)) {
      return { shells: new Set(d.shells), launchers: new Map(d.launchers), jobs: d.jobs, workers: d.workers };
    }
  } catch (_) { /* none yet, or caught mid-write */ }
  const snap = await detached.snapshot({ records });
  if (opts.write !== false) {
    try {
      writeAtomic(file, JSON.stringify({ at: Date.now(), shells: [...snap.shells], launchers: [...snap.launchers], jobs: snap.jobs,
        workers: snap.workers || [] }) + '\n');
    } catch (_) { /* the next window reads /proc itself */ }
  }
  return snap;
}

/*
 * The live `claude -p` workers, each with the conversation that started it, for that conversation's agent map:
 * { session, id, pid, name, status, startedAt, inside? }, by session id and start. The launcher is the one the process
 * scan found (src/detached.js) or, where it found none or there is no /proc, the conversation whose link file names
 * the worker. A worker no conversation can be tied to is left out.
 */
const MAX_WORKER_ROWS = 20;
/* Worker session id -> the conversation whose link file names it. */
function workerOwners(dir = planDir()) {
  const owners = new Map();
  let names = [];
  try { names = planNames.names(dir).filter((n) => LINK_FILE.test(n)); } catch (_) { /* no plan folder */ }
  for (const n of names) for (const w of readLink(path.join(dir, n)).workers) owners.set(w.toLowerCase(), n.slice(0, -SUFFIX.length).toLowerCase());
  return owners;
}
function workerRows({ records = [], found = [], dir = planDir() } = {}) {
  const scan = new Map();
  for (const w of found) if (w && typeof w.id === 'string') scan.set(w.id.toLowerCase(), w);
  let owners = null;
  const ownerOf = (id) => (owners || (owners = workerOwners(dir))).get(id) || '';
  const out = [];
  for (const r of records) {
    if (!isWorker(r)) continue;
    const id = r.sessionId.toLowerCase(), s = scan.get(id);
    const session = (s && s.launcher) || ownerOf(id);
    if (!SESSION.test(session) || session === id) continue;
    out.push(Object.assign({ session, id, pid: r.pid, name: clip(r.name, 80), status: clip(r.status, 20),
      startedAt: typeof r.startedAt === 'number' && isFinite(r.startedAt) ? r.startedAt : null }, s && s.inside ? { inside: true } : {}));
  }
  out.sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : (a.startedAt || 0) - (b.startedAt || 0) || a.pid - b.pid));
  return out.slice(0, MAX_WORKER_ROWS);
}

/*
 * The detached commands for the agent map. A command a `claude -p` worker left running keeps the dot of the
 * conversation that started the worker green (working above), also once the worker has ended and its own row is gone,
 * so it carries that conversation as `launcher` for its map to list.
 */
function jobRows({ jobs = [], dir = planDir() } = {}) {
  if (!Array.isArray(jobs) || !jobs.length) return [];
  const owners = workerOwners(dir);
  return jobs.map((j) => {
    const launcher = j && typeof j.session === 'string' ? owners.get(j.session.toLowerCase()) || '' : '';
    return launcher && launcher !== j.session.toLowerCase() ? Object.assign({}, j, { launcher }) : j;
  });
}

let lastJobs = null, lastWorkers = null;
const jobsNow = () => lastJobs;
const workersNow = () => lastWorkers;

/* Reads /proc, or what another window read from it a moment ago, then calls working(). */
async function workingNow(opts = {}) {
  const records = liveRecords(opts.sessions);
  const { shells, launchers, jobs, workers } = await sharedSnapshot(records, opts);
  lastJobs = Array.isArray(jobs) ? jobs : [];
  const set = working(Object.assign({}, opts, { records, shells, launchers }));
  lastWorkers = workerRows({ records, found: Array.isArray(workers) ? workers : [], dir: opts.dir });
  return set;
}

module.exports = {
  scan, collect, readState, readLink, busyJobs, liveRecords, working, workingNow, jobsNow, workersNow, workerRows, jobRows, hookWork,
  SUFFIX, TASKS_SUFFIX, LINK_FILE, MAX_SESSIONS, MAX_PER_SESSION, MAX_ENTRIES, PERSIST_EVERY, SNAPSHOT_FILE, SHARE_MS,
  MAX_WORKER_ROWS,
};
