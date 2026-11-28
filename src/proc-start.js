// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * When a process started, which tells it from a later process given the same pid: a lock or a window entry records
 * the pid and start of the process that wrote it, and a reader that finds that pid running with another start knows the
 * writer is gone. The form is the one Claude Code writes as procStart in ~/.claude/sessions/<pid>.json, so the two can
 * be compared as well: on Linux field 22 of /proc/<pid>/stat, the start in clock ticks since boot; on macOS and the
 * other systems with ps, what `ps -o lstart=` prints in the C locale and UTC.
 *
 * Windows has no way to read another process's creation time short of starting PowerShell, which takes most of a
 * second, so there startOf gives null and alive() only asks whether the pid exists.
 */
const fs = require('fs');
const cp = require('child_process');

const valid = (pid) => Number.isInteger(pid) && pid > 0;

/* The fields of /proc/<pid>/stat after the command name, which can hold spaces and parentheses itself: [0] is the
   state, [19] the start. */
function statFields(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, 'latin1');
    return s.slice(s.lastIndexOf(')') + 2).split(' ');
  } catch (_) { return null; }
}

function psStart(pid) {
  try {
    const out = cp.execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      env: Object.assign({}, process.env, { LC_ALL: 'C', TZ: 'UTC' }) }).trim();
    return out || null;
  } catch (_) { return null; }
}

/* A `ps` takes milliseconds and blocks the extension host, and a lock's waiter asks about the same pid every few
   milliseconds, so outside Linux a start is kept per pid: this process's own for good, another's for CACHE_MS. A kept
   start can only confirm that a pid still has the start asked about; alive() reads again before it calls a process
   gone. */
const CACHE_MS = 10000;
const CACHE_MAX = 64;
const cache = new Map();

function fresh(pid) {
  const start = psStart(pid);
  if (start === null) { cache.delete(pid); return null; }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(pid, { start, at: Date.now() });
  return start;
}

/** The start time of process `pid` as a string, or null when it cannot be read: no such process, or Windows. */
function startOf(pid) {
  if (!valid(pid) || process.platform === 'win32') return null;
  if (process.platform === 'linux') {
    const f = statFields(pid);
    return f && f[19] ? f[19] : null;
  }
  const kept = cache.get(pid);
  if (kept && (pid === process.pid || Date.now() - kept.at < CACHE_MS)) return kept.start;
  return fresh(pid);
}

/**
 * Whether process `pid` is running and, given `start` (from startOf), is the process that started then; where the start
 * cannot be read, only the pid is checked. On Linux a zombie counts as gone: it has ended, and only its parent has not
 * collected it yet.
 */
function alive(pid, start) {
  if (!valid(pid)) return false;
  try { process.kill(pid, 0); } catch (e) {
    if (!e || e.code !== 'EPERM') { cache.delete(pid); return false; }
  }
  const want = start === undefined || start === null || start === '' ? null : String(start);
  if (process.platform === 'linux') {
    const f = statFields(pid);
    if (f && (f[0] === 'Z' || f[0] === 'X')) return false;
    return want === null || !f || !f[19] || f[19] === want;
  }
  if (want === null) return true;
  const now = startOf(pid);
  if (now === null || now === want) return true;
  const again = pid === process.pid ? now : fresh(pid);
  return again === null || again === want;
}

module.exports = { startOf, alive };
