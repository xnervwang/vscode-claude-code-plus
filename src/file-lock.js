// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * A lock around a read-change-write of a file that every VS Code window on this machine writes (stewards.json, and the
 * relay's shared JSON files): the directory <file>.lock, made with mkdir, which only one process at a time can make.
 * Its owner.json names the holder, { pid, start, token, at }, with start as src/proc-start.js reads it and token 16
 * random hex digits.
 *
 * A waiter takes the lock over only from a holder that is gone (its pid not running, or running with another start,
 * so given to a later process), from one that has held it for STALE_MS, or, when owner.json cannot be read, once the
 * directory is OWNERLESS_MS old: a holder writes owner.json right after making the directory. A holder that is only
 * slow, or stopped for a while, keeps the lock. A holder that was taken over from finds out when it writes: writeLocked
 * checks the token just before its rename and throws LockLost instead, so the file keeps what the new holder wrote.
 *
 * The directory is always moved aside to a name of its own before it is removed, by a waiter taking it over as by its
 * holder releasing it, and what was moved is checked to be the lock meant: of two processes removing one lock, only
 * the one whose rename succeeds goes on, and a lock made in between is put back rather than removed.
 *
 * The wait blocks the extension host, which is what keeps the change and the read it is based on together, so fn has
 * to be synchronous. The wait is normally nothing, and longest when a window stopped while holding the lock.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startOf, alive } = require('./proc-start');

const STALE_MS = 30000;
const OWNERLESS_MS = 1000;
/* Longer than STALE_MS, so that a waiter lasts until a stopped holder's lock can be taken over. */
const WAIT_MS = 35000;
const OWNER = 'owner.json';
const STEP_MIN_MS = 2;
const STEP_MAX_MS = 20;
const cell = new Int32Array(new SharedArrayBuffer(4));
const nap = (ms) => { Atomics.wait(cell, 0, 0, ms); };
const random = (bytes) => crypto.randomBytes(bytes).toString('hex');

class LockLost extends Error {
  constructor(file) {
    super(`another process took over the lock on ${file}, so it was not written`);
    this.name = 'LockLost';
    this.file = file;
  }
}

class LockTimeout extends Error {
  constructor(file, waitedMs, holder) {
    super(`waited ${waitedMs} ms for the lock on ${file}` + (holder ? `, held by process ${holder.pid}` : ''));
    this.name = 'LockTimeout';
    this.file = file;
    this.holder = holder || null;
  }
}

/* The locks this process holds, by the full path of the locked file: the token in their owner.json. */
const holds = new Map();

/* Windows refuses some file operations for a moment while another process has the file open, as readers of these
   files do all the time; such a refusal is tried again rather than taken as an answer. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const busy = (e) => process.platform === 'win32' && !!e && BUSY.has(e.code);
/* A reader that opens the file over and over can keep a rename refused for longer than a few tries. */
const RENAME_WAITS_MS = [10, 20, 40, 60, 80, 120, 160, 200, 250, 300, 350, 400];

/* fs.renameSync, with a refusal on Windows tried again over about two seconds. */
function rename(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (!busy(e) || i >= RENAME_WAITS_MS.length) throw e;
      nap(RENAME_WAITS_MS[i]);
    }
  }
}

function readOwner(dir) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, OWNER), 'utf8'));
    if (!d || typeof d !== 'object' || typeof d.token !== 'string' || !d.token || !Number.isInteger(d.pid)
        || !Number.isFinite(d.at)) return null;
    return d;
  } catch (_) { return null; }
}

/* The directory's identity, which a rename keeps: what tells a lock with no owner.json from one made after it. */
function identity(dir) {
  try { const s = fs.statSync(dir, { bigint: true }); return `${s.dev}:${s.ino}`; } catch (_) { return null; }
}

function removeDir(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const n of names) { try { fs.unlinkSync(path.join(dir, n)); } catch (_) { /* rmdir below then fails too */ } }
  try { fs.rmdirSync(dir); } catch (_) { /* left for the sweep after the next take-over */ }
}

/*
 * Writes owner.json into a directory this process has just made, and answers whether it holds the lock: only if no
 * other owner.json got there first. The text goes into a file of its own and is then linked to the name, so owner.json
 * is never seen half written and is never replaced.
 */
function claim(dir, text) {
  const owner = path.join(dir, OWNER);
  const tmp = `${owner}.${process.pid}.${random(4)}.tmp`;
  try { fs.writeFileSync(tmp, text, { flag: 'wx' }); } catch (e) {
    if ((e && e.code === 'ENOENT') || busy(e)) return false;
    throw e;
  }
  try {
    fs.linkSync(tmp, owner);
    return true;
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'ENOENT')) return false;
    /* A file system with no hard links: made in place, still only where there is none. */
    try { fs.writeFileSync(owner, text, { flag: 'wx' }); return true; } catch (e2) {
      if ((e2 && (e2.code === 'EEXIST' || e2.code === 'ENOENT')) || busy(e2)) return false;
      throw e2;
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* moved aside with the directory */ }
  }
}

function acquire(dir, token, start) {
  try { fs.mkdirSync(dir); } catch (e) {
    if ((e && e.code === 'EEXIST') || busy(e)) return false;
    throw e;
  }
  try {
    return claim(dir, JSON.stringify({ pid: process.pid, start, token, at: Date.now() }) + '\n');
  } catch (e) {
    try { fs.rmdirSync(dir); } catch (_) { /* not empty: another owner.json is in it */ }
    throw e;
  }
}

/* What a waiter sees of the lock in `dir`: its owner, or with none its identity and age; null when there is no lock. */
function look(dir) {
  let st;
  try { st = fs.statSync(dir); } catch (_) { return null; }
  const owner = readOwner(dir);
  return { owner, id: owner ? null : identity(dir), mtime: st.mtimeMs };
}

/* Why the lock seen can be taken over, or '' while its holder may still be using it. */
function why(seen, now) {
  const o = seen.owner;
  if (!o) {
    const age = now - seen.mtime;
    return age > OWNERLESS_MS ? `it names no holder and was made ${Math.round(age)} ms ago` : '';
  }
  if (!alive(o.pid, o.start)) return `process ${o.pid}, which held it, is no longer running`;
  const age = now - o.at;
  return age > STALE_MS ? `process ${o.pid} has held it for ${Math.round(age / 1000)} s` : '';
}

/* Whether the directory moved to `away` is the lock seen: the same owner, or with none the same directory. */
function sameLock(away, seen) {
  const o = readOwner(away);
  if (seen.owner) return !!o && o.token === seen.owner.token;
  return !o && seen.id !== null && identity(away) === seen.id;
}

/*
 * Removes the lock seen in `dir` by moving it aside first, and answers whether this call removed it. A lock moved that
 * is not the one seen, made in the moment between, is put back where its holder looks for it.
 */
function drop(dir, seen, log) {
  const away = `${dir}.stale-${random(8)}`;
  try { rename(dir, away); } catch (_) { return false; }
  if (sameLock(away, seen)) { removeDir(away); return true; }
  try { rename(away, dir); } catch (_) {
    /* Another lock is in place by now; this one's holder finds its token gone when it writes. */
    removeDir(away);
  }
  log(`${dir} changed while it was being removed, and was left to its new holder`);
  return false;
}

/* Removes what an earlier take-over or release moved aside and could not remove, as Windows can refuse it. */
function sweep(dir, now) {
  const parent = path.dirname(dir), prefix = path.basename(dir) + '.stale-';
  let names = [];
  try { names = fs.readdirSync(parent).filter((n) => n.startsWith(prefix)); } catch (_) { return; }
  for (const n of names) {
    const p = path.join(parent, n);
    try { if (now - fs.statSync(p).mtimeMs > STALE_MS) removeDir(p); } catch (_) { /* gone already */ }
  }
}

/**
 * Runs fn() while this process holds the lock of `file`, and returns what fn returns. fn writes `file` with
 * writeLocked. Called again for the same file from inside fn, it runs the inner fn under the lock already held.
 * Throws LockTimeout after opts.waitMs (WAIT_MS by default) without the lock; opts.log, if given, is told of each
 * take-over.
 */
function withLock(file, fn, opts = {}) {
  const key = path.resolve(file);
  if (holds.has(key)) return fn();
  const dir = key + '.lock';
  const waitMs = Number.isFinite(opts.waitMs) ? opts.waitMs : WAIT_MS;
  const log = (line) => {
    try { if (typeof opts.log === 'function') opts.log(line); } catch (_) { /* it must not keep the lock nor hide fn's error */ }
  };
  try { fs.mkdirSync(path.dirname(key), { recursive: true }); } catch (_) { /* the mkdir below says so */ }
  const token = random(8);
  const start = startOf(process.pid);
  const began = Date.now();
  let seen = null;
  for (let tries = 0; ; tries++) {
    if (acquire(dir, token, start)) break;
    seen = look(dir);
    const reason = seen ? why(seen, Date.now()) : '';
    if (reason && drop(dir, seen, log)) {
      log(`took over ${dir}: ${reason}`);
      sweep(dir, Date.now());
      continue;
    }
    const waited = Date.now() - began;
    if (waited >= waitMs) throw new LockTimeout(file, waited, seen && seen.owner);
    nap(seen ? Math.min(STEP_MIN_MS * (1 + tries), STEP_MAX_MS) : STEP_MIN_MS);
  }
  holds.set(key, token);
  try { return fn(); } finally {
    holds.delete(key);
    const o = readOwner(dir);
    if (o && o.token === token) drop(dir, { owner: o }, log);
  }
}

/**
 * Writes `text` to `file` whole, from inside withLock(file, ...): a temporary file renamed over it, but only while this
 * process still holds the lock. If it was taken over, throws LockLost and leaves the file as the new holder wrote it.
 */
function writeLocked(file, text) {
  const key = path.resolve(file);
  const token = holds.get(key);
  if (!token) throw new Error(`writeLocked(${file}) outside withLock on it`);
  const tmp = `${key}.${process.pid}.${random(4)}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    const o = readOwner(key + '.lock');
    if (!o || o.token !== token) throw new LockLost(file);
    rename(tmp, key);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* never written, or renamed */ }
    throw e;
  }
}

/* How long readWhole() waits for another process that holds the lock. */
const READ_WAIT_MS = 200;

/**
 * The JSON in `file`, read without taking the lock, or null when there is none. On Windows a read can fail, or find no
 * file at all, at the moment writeLocked renames the new file over the old one, and the writer holds the lock all
 * through it; so a read that fails is tried again while the lock is there, for up to READ_WAIT_MS, and once more after
 * it goes. Inside withLock on the same file nothing else can be writing it, so a failed read is not tried again.
 */
function readWhole(file) {
  const key = path.resolve(file);
  const mine = holds.has(key);
  const until = Date.now() + READ_WAIT_MS;
  let free = 0;
  for (;;) {
    try { return JSON.parse(fs.readFileSync(key, 'utf8')); } catch (_) { /* tried again below */ }
    if (mine) return null;
    if (fs.existsSync(key + '.lock')) {
      free = 0;
      if (Date.now() >= until) return null;
      nap(STEP_MIN_MS);
    } else if (++free > 1) return null;
  }
}

module.exports = { withLock, writeLocked, readWhole, LockLost, LockTimeout, STALE_MS, READ_WAIT_MS };
