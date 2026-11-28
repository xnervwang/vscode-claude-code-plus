// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The other places a Claude Code conversation is open or runs, besides the VS Code windows the session list already
 * knows of: the `elsewhere` and `processes` of its row (Agent Plus's protocol, Session list).
 *
 * Every Claude Code process keeps a record of itself in <config>/sessions/<pid>.json while it runs: its session id,
 * folder, entrypoint (cli for a terminal, claude-vscode for a VS Code panel, claude-desktop for the desktop app), kind
 * (interactive, or bg for `claude --bg`), status, start time and, for `claude --bg`, its job id. Claude Code's own
 * extension reads the same records for the ring it draws on a conversation open in another process, and sorts them the
 * same way. A record whose process is gone, or whose process id now belongs to a process started at another
 * time, is left out.
 *
 * The core finds other VS Code windows from the files each window writes. A VS Code panel's process is reported
 * here only when it is not this window's own and no window's file lists its conversation. The rest are described from
 * the process: on Linux its terminal device, and from its environment the terminal program and its tmux or screen
 * session; on macOS the same through ps; on Windows only the names of the processes it runs under.
 */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeDir, SESSION } = require('./claude-files');

/* The protocol's limits on `elsewhere`. */
const MAX_PLACES = 8;
const MAX_LABEL = 80;
const MAX_DETAIL = 200;
const MAX_ANCESTORS = 32;
/* Kept for each process this long: its terminal and environment do not change while it runs. */
const INFO_MS = 10 * 60000;
/* The Windows process table is kept this long, as reading it starts PowerShell. */
const TABLE_MS = 60000;
const RUN_MS = 3000;

/* The kind of place a record comes from, as Claude Code's extension sorts them: a background run, a terminal, a
   VS Code panel, the desktop app, or another Claude process. */
function classify(r) {
  if (r.kind && r.kind !== 'interactive') return 'exec';
  switch (r.entrypoint) {
    case 'cli': return 'terminal';
    case 'claude-vscode': return 'vscode';
    case 'claude-desktop': case 'claude-desktop-3p': return 'desktop';
    default: return 'other';
  }
}
/* 'vscode' is a VS Code window whose own file the core does not see. */
const PROTOCOL_KIND = { terminal: 'terminal', desktop: 'desktop', exec: 'exec', vscode: 'vscode', other: 'other' };

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const home = os.homedir();
const tilde = (p) => (typeof p === 'string' && home && (p === home || p.startsWith(home + path.sep)) ? '~' + p.slice(home.length) : String(p || ''));
/* "2h 5m", "40s", "3d 4h": how long a process has run. */
function lasted(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
const shortTty = (t) => String(t || '').replace(/^\/dev\//, '');

/* The values of `keys` in a NUL-separated environment block. */
function envOf(block, keys) {
  const out = {};
  for (const line of String(block || '').split('\0')) {
    const i = line.indexOf('=');
    if (i > 0 && keys.includes(line.slice(0, i))) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}
const ENV_KEYS = ['TERM_PROGRAM', 'TMUX', 'TMUX_PANE', 'STY'];

/* What can be read about processes on this machine. Every member may be replaced for a test. */
function system(platform = process.platform) {
  const run = (cmd, args) => {
    try { return cp.execFileSync(cmd, args, { encoding: 'utf8', timeout: RUN_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (_) { return ''; }
  };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  /* tmux names its session for a pane when asked through the socket in TMUX. */
  const tmuxSession = (tmux, pane) => {
    const socket = String(tmux || '').split(',')[0];
    if (!socket || !pane) return '';
    return run('tmux', ['-S', socket, 'display-message', '-p', '-t', pane, '#S']).trim();
  };
  if (platform === 'linux') {
    return {
      platform, alive, tmuxSession,
      /* Field 22 of /proc/<pid>/stat, the start time in clock ticks, as Claude Code writes procStart. */
      startToken: (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[19] || null; } catch (_) { return null; } },
      parentOf: (pid) => { try { return Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[1]) || 0; } catch (_) { return 0; } },
      tty: (pid) => { try { const t = fs.readlinkSync(`/proc/${pid}/fd/0`); return /^\/dev\/(pts\/|tty)/.test(t) ? t : ''; } catch (_) { return ''; } },
      env: (pid) => { try { return envOf(fs.readFileSync(`/proc/${pid}/environ`, 'latin1'), ENV_KEYS); } catch (_) { return {}; } },
      names: () => null,
    };
  }
  if (platform === 'darwin') {
    let table = null, tableAt = 0;
    const parents = () => {
      if (!table || Date.now() - tableAt > RUN_MS) {
        table = new Map();
        for (const line of run('ps', ['-axo', 'pid=,ppid=']).split('\n')) {
          const m = /^\s*(\d+)\s+(\d+)/.exec(line);
          if (m) table.set(Number(m[1]), Number(m[2]));
        }
        tableAt = Date.now();
      }
      return table;
    };
    return {
      platform, alive, tmuxSession,
      startToken: () => null,
      parentOf: (pid) => parents().get(pid) || 0,
      tty: (pid) => { const t = run('ps', ['-o', 'tty=', '-p', String(pid)]).trim(); return t && t !== '??' ? '/dev/' + t : ''; },
      /* ps -E prints the environment after the command line, as space-separated assignments. */
      env: (pid) => {
        const out = {};
        for (const m of run('ps', ['-wwE', '-o', 'command=', '-p', String(pid)]).matchAll(/(?:^|\s)(TERM_PROGRAM|TMUX|TMUX_PANE|STY)=(\S+)/g)) out[m[1]] = m[2];
        return out;
      },
      names: () => null,
    };
  }
  if (platform === 'win32') {
    let table = null, tableAt = 0;
    /* Windows soon reuses a process id, so a table read before a record was written may name the process that had the
       id before. */
    const read = (since = 0) => {
      if (!table || Date.now() - tableAt > TABLE_MS || tableAt < since) {
        table = new Map();
        const csv = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.Name)" }']);
        for (const line of csv.split(/\r?\n/)) {
          const m = /^(\d+),(\d+),(.*)$/.exec(line.trim());
          if (m) table.set(Number(m[1]), { parent: Number(m[2]), name: m[3] });
        }
        tableAt = Date.now();
      }
      return table;
    };
    return {
      platform, alive, tmuxSession: () => '',
      startToken: () => null,
      parentOf: (pid) => (read().get(pid) || {}).parent || 0,
      tty: () => '',
      env: () => ({}),
      names: (pid, since) => {
        const out = [], t = read(since);
        for (let p = pid, n = 0; p && n < MAX_ANCESTORS; n++) { const e = t.get(p); if (!e) break; out.push(e.name); p = e.parent; }
        return out;
      },
    };
  }
  return { platform, alive, tmuxSession: () => '', startToken: () => null, parentOf: () => 0, tty: () => '', env: () => ({}), names: () => null };
}

function records(dir, sys) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return []; }
  const out = [];
  for (const n of names) {
    let r;
    let written = 0;
    try {
      const file = path.join(dir, n);
      r = JSON.parse(fs.readFileSync(file, 'utf8'));
      written = fs.statSync(file).mtimeMs;
    } catch (_) { continue; }
    if (!r || typeof r !== 'object' || !SESSION.test(String(r.sessionId || '')) || !Number.isInteger(r.pid) || r.pid <= 0) continue;
    if (!sys.alive(r.pid)) continue;
    const token = r.procStart == null ? null : sys.startToken(r.pid);
    if (token != null && String(token) !== String(r.procStart)) continue;
    out.push({ r, written });
  }
  return out;
}

function under(pid, ancestor, sys) {
  for (let p = pid, n = 0; p > 1 && n < MAX_ANCESTORS; n++) {
    if (p === ancestor) return true;
    p = sys.parentOf(p);
  }
  return false;
}

function windowsTerminal(names) {
  const lower = (names || []).map((n) => String(n).toLowerCase());
  if (lower.includes('windowsterminal.exe')) return 'Windows Terminal';
  if (lower.some((n) => n === 'code.exe' || n === 'code - insiders.exe')) return 'a VS Code terminal';
  if (lower.includes('conhost.exe') || lower.includes('openconsole.exe')) return 'a console window';
  return '';
}

/* The name `claude --bg` gave a job, from its record in <config>/jobs/<id>/state.json, or ''. */
function jobNameOf(jobId, root = claudeDir()) {
  if (!/^[0-9a-f]{6,16}$/i.test(String(jobId || ''))) return '';
  try {
    const d = JSON.parse(fs.readFileSync(path.join(root, 'jobs', jobId, 'state.json'), 'utf8'));
    return d && typeof d.name === 'string' ? d.name.replace(/\s+/g, ' ').trim() : '';
  } catch (_) { return ''; }
}

/* `elsewhere` entries and process counts by session id. `ownPid` is this window's extension host; `claimed(sessionId)`
   says whether some VS Code window's file lists the conversation. */
function create({ dir = () => path.join(claudeDir(), 'sessions'), sys = system(), ownPid = process.pid, claimed = () => false,
  jobName = (id) => jobNameOf(id), now = Date.now } = {}) {
  const infos = new Map();
  /* Keyed by the record's start as well as the pid: within INFO_MS the pid may be given to another process. */
  const info = (pid, t, started, written) => {
    const key = `${pid}:${started}`;
    const hit = infos.get(key);
    if (hit && t - hit.at < INFO_MS) return hit.value;
    const env = sys.env(pid) || {};
    const value = { tty: sys.tty(pid) || '', env, names: sys.names(pid, written) };
    if (env.TMUX && env.TMUX_PANE) value.tmux = sys.tmuxSession(env.TMUX, env.TMUX_PANE) || '';
    if (env.STY) value.screen = String(env.STY).replace(/^\d+\./, '');
    infos.set(key, { at: t, value });
    if (infos.size > 512) infos.delete(infos.keys().next().value);
    return value;
  };
  const place = (r, t, written) => {
    const where = classify(r);
    const ran = Number.isFinite(r.startedAt) ? lasted(t - r.startedAt) : '';
    const proc = `Process ${r.pid}` + (ran ? `, running for ${ran}` : '');
    const folder = r.cwd ? `Folder: ${tilde(r.cwd)}` : '';
    let label, detail;
    if (where === 'terminal') {
      const i = info(r.pid, t, r.startedAt, written);
      const program = i.env.TERM_PROGRAM && !['vscode', 'tmux'].includes(i.env.TERM_PROGRAM) ? i.env.TERM_PROGRAM : '';
      label = i.env.TERM_PROGRAM === 'vscode' ? 'a VS Code terminal'
        : i.tmux ? `tmux session "${i.tmux}"`
        : i.screen ? `screen session "${i.screen}"`
        : i.tty ? `terminal ${shortTty(i.tty)}`
        : windowsTerminal(i.names) || 'a terminal';
      if (r.cwd && (label + ' in ' + tilde(r.cwd)).length <= MAX_LABEL) label += ' in ' + tilde(r.cwd);
      detail = [
        i.tmux && i.env.TMUX_PANE ? `tmux pane ${i.env.TMUX_PANE}` : '',
        program ? `Terminal program: ${program}` : '',
        i.tty ? `Device: ${i.tty}` : '', proc, folder];
    } else if (where === 'exec') {
      const name = String(jobName(r.jobId || '') || '').trim();
      label = name ? `claude --bg job "${name}"` : 'a claude --bg job';
      detail = [proc, folder, r.jobId ? `Job ${r.jobId}` : ''];
    } else if (where === 'desktop') {
      label = 'Claude Desktop';
      detail = [proc, folder];
    } else if (where === 'vscode') {
      label = 'another VS Code window';
      detail = [proc, folder];
    } else {
      label = r.entrypoint ? `another Claude process (${r.entrypoint})` : 'another Claude process';
      detail = [proc, folder];
    }
    return { kind: PROTOCOL_KIND[where], label: clip(label, MAX_LABEL), detail: detail.filter(Boolean).map((l) => clip(l, MAX_DETAIL)), running: r.status === 'busy' };
  };
  return {
    /* Map of session id to { elsewhere, processes }, for every conversation some process has open. */
    scan() {
      const t = now(), out = new Map();
      for (const { r, written } of records(typeof dir === 'function' ? dir() : dir, sys)) {
        const row = out.get(r.sessionId) || { elsewhere: [], processes: 0 };
        row.processes++;
        out.set(r.sessionId, row);
        const where = classify(r);
        if (where === 'vscode' && (under(r.pid, ownPid, sys) || claimed(r.sessionId))) continue;
        if (row.elsewhere.length < MAX_PLACES) row.elsewhere.push(place(r, t, written));
      }
      return out;
    },
  };
}

module.exports = { classify, create, system, envOf, lasted, windowsTerminal, jobNameOf, MAX_PLACES, MAX_LABEL, MAX_DETAIL };
