// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * When src/duplicates.js stops an editor process, the background commands, monitors and subagents Claude Code runs
 * inside it stop too, and the conversation's other process never had them: a timer the conversation set to come back
 * to something is gone, and nothing says so. This finds that work and writes the notice for the other process.
 *
 * The work is what the stopped process's Stop hook last reported, in <session>.tasks beside the plan with that process's
 * pid (hooks/record-background.py), each command's text read from the transcript. Without such a file, as on Claude Code
 * before 2.1.326, it is the Bash shells under the process in /proc.
 * Both processes write the transcript, so it cannot say which one runs a task.
 *
 * A task counts as finished once a task notification reports it completed, failed or killed. Not "stopped": a process
 * that resumes the conversation reports the other process's tasks that way at once, while they are still running.
 *
 * Each stop is a file in STOPPED_WORK_DIR, sent by src/detachedends.js deliver() like the other notices.
 */
const fs = require('fs');
const path = require('path');
const { transcriptOf } = require('./claude-files');

const STOPPED_WORK_DIR = 'stopped-work';
const TASKS_SUFFIX = '.tasks';
const TAIL_BYTES = 8 * 1024 * 1024;
const MAX_TASKS = 20;
const NOTICE_TEXT = 200;
const WHO = 'Claude Code Plus';
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FINISHED = new Set(['completed', 'failed', 'killed']);
/* The shell Claude Code runs a Bash command in: its snapshot sourced, then the command in single quotes for eval, each
   quote inside written as '"'"'. */
const SHELL = /shell-snapshots\/snapshot-[^ ]*\.sh[\s\S]*?\beval '((?:[^']|'"'"')*)'/;
const unquote = (s) => s.split(`'"'"'`).join("'");

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
const clip = (s, n = NOTICE_TEXT) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3) + '...' : t; };

function tail(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, from = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - from);
    const got = fs.readSync(fd, buf, 0, buf.length, from);
    const text = buf.toString('utf8', 0, got);
    return from > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } catch (_) { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
}

/*
 * The background commands in a transcript: task id -> { command, description }, with `ended` the ids a task
 * notification has reported finished.
 */
function fromTranscript(file) {
  const uses = new Map(), started = new Map(), ended = new Set();
  for (const line of tail(file).split('\n')) {
    if (!line) continue;
    const hasTask = line.includes('backgroundTaskId'), hasEnd = line.includes('<task-id>'), hasUse = line.includes('"tool_use"');
    if (!hasTask && !hasEnd && !hasUse) continue;
    let r;
    try { r = JSON.parse(line); } catch (_) { continue; }
    const content = r && r.message && Array.isArray(r.message.content) ? r.message.content : [];
    for (const b of content) {
      if (b && b.type === 'tool_use' && b.input && typeof b.input.command === 'string') uses.set(b.id, b.input);
    }
    const tr = r && r.toolUseResult;
    if (tr && typeof tr.backgroundTaskId === 'string') {
      const res = content.find((b) => b && b.type === 'tool_result');
      const input = res ? uses.get(res.tool_use_id) : null;
      started.set(tr.backgroundTaskId, { command: input ? String(input.command) : '', description: input ? String(input.description || '') : '' });
    }
    if (hasEnd) {
      for (const m of line.matchAll(/<task-id>([A-Za-z0-9_-]+)<\/task-id>[\s\S]{0,400}?<status>([a-z_]+)<\/status>/g)) {
        if (FINISHED.has(m[2])) ended.add(m[1]);
      }
    }
  }
  return { started, ended };
}

/*
 * The work running in process `p` of conversation `session`. `p` comes from src/duplicates.js find().
 */
function lost({ session, p, dir, transcript = transcriptOf, proc = '/proc' }) {
  const d = readJson(path.join(dir, session + TASKS_SUFFIX));
  const own = d && Array.isArray(d.tasks) && d.pid === p.pid;
  const file = transcript(session);
  const t = file ? fromTranscript(file) : { started: new Map(), ended: new Set() };
  const out = [];
  if (own) {
    for (const k of d.tasks) {
      if (!k || typeof k.id !== 'string' || !TASK_ID.test(k.id) || (k.status && k.status !== 'running') || t.ended.has(k.id)) continue;
      const s = t.started.get(k.id);
      out.push({ id: k.id, type: String(k.type || ''), description: String(k.description || (s && s.description) || ''),
        command: s ? s.command : '' });
    }
  } else {
    const byCommand = new Map();
    for (const [id, s] of t.started) if (s.command && !t.ended.has(id)) byCommand.set(s.command, Object.assign({ id }, s));
    for (const command of shellsOf(p.pid, proc)) {
      const s = byCommand.get(command);
      out.push({ id: s ? s.id : '', type: 'shell', description: s ? s.description : '', command });
    }
  }
  return out.slice(0, MAX_TASKS);
}

/* The commands of the Bash shells under `pid`. */
function shellsOf(pid, proc = '/proc') {
  const parent = new Map();
  let names = [];
  try { names = fs.readdirSync(proc).filter((n) => /^\d+$/.test(n)); } catch (_) { return []; }
  for (const n of names) {
    try {
      const st = fs.readFileSync(path.join(proc, n, 'stat'), 'latin1');
      parent.set(Number(n), Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]));
    } catch (_) { /* gone */ }
  }
  const under = (q) => { for (let i = 0, x = q; i < 8 && x > 1; i++) { x = parent.get(x); if (x === pid) return true; } return false; };
  const out = [];
  for (const [q] of parent) {
    if (!under(q)) continue;
    let args = '';
    try { args = fs.readFileSync(path.join(proc, String(q), 'cmdline'), 'utf8').split('\0').join(' '); } catch (_) { continue; }
    const m = SHELL.exec(args);
    if (m && !out.includes(unquote(m[1]))) out.push(unquote(m[1]));
  }
  return out;
}

/* Queues the notice for the stop of `p`, if any work was running. */
function record({ dir, session, p, work, now = Date.now() }) {
  if (!Array.isArray(work) || !work.length) return false;
  try {
    fs.mkdirSync(path.join(dir, STOPPED_WORK_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, STOPPED_WORK_DIR, `${session}.${p.pid}-${p.procStart || 0}.json`),
      JSON.stringify({ session, pid: p.pid, window: p.window || '', windowless: !!p.windowless, work, goneAt: now }) + '\n', { flag: 'wx' });
    return true;
  } catch (_) { return false; }
}

const pad = (n) => String(n).padStart(2, '0');
const when = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

function noticeText(stops, { who = WHO } = {}) {
  const lines = [];
  for (const s of stops.slice().sort((a, b) => a.goneAt - b.goneAt)) {
    const where = s.windowless ? 'whose window was gone' : s.window ? `in window "${s.window}"` : '';
    lines.push(`Process ${s.pid}${where ? ' ' + where : ''}, stopped ${when(s.goneAt)}:`);
    for (const w of s.work || []) {
      const what = [w.description ? clip(w.description) : '', w.command ? '`' + clip(w.command) + '`' : ''].filter(Boolean).join(': ');
      lines.push(`- ${w.type || 'task'} ${w.id}${what ? ' - ' + what : ''}`);
    }
  }
  return `${who} notice, not a message from the user: another process was also running this conversation and has been `
    + 'stopped. The background work below was running in it and stopped with it; this process does not have it. Start '
    + `again whatever is still needed.\n${lines.join('\n')}`;
}

module.exports = { lost, record, noticeText, fromTranscript, shellsOf, STOPPED_WORK_DIR };
