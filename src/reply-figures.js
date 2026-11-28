// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Each reply's context share and estimated cost, kept per conversation so that a panel opened again still shows them.
 *
 * The page works a reply's figures out only while that reply is the newest one (src/page/75-turn-stats.js); after
 * that the reply keeps what it last showed, in the page's memory. So a reloaded panel had figures for none of its
 * history. The page now hands its replies' figures here as they settle (src/page/77-kept-figures.js says which and
 * when), keyed by the uuid of the reply's message, and asks for its conversation's figures when it starts to show
 * one. Nothing is read from the transcript and nothing is priced again: what is kept is what the page showed.
 *
 * One small file per conversation under this extension's global storage, replaced whole through a temporary file, and
 * read tolerantly: a file that is missing, cut short or not of this shape counts as holding nothing. Two windows that
 * show one conversation each read the file again just before writing, so they lose nothing to each other short of
 * writing in the same instant.
 *
 * Bounded twice. A file keeps the newest MAX_REPLIES replies, the oldest going first; and when a new file makes more
 * than MAX_FILES, the files changed longest ago go. Deleting a conversation from the session list deletes its file too,
 * with this extension's other records of it (forget, called by deleteChecked in src/claude-session-list.js).
 *
 * The file holds { v: 1, replies: [[uuid, percent or null, dollars or null], ...] }, oldest first. The numbers rather
 * than the labels, so that the page labels kept replies exactly as it labels the newest one.
 */
const fs = require('fs');
const path = require('path');
const { SESSION, writeAtomic } = require('./claude-files');

const DIR = 'reply-figures';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* About 60 bytes a reply, so a full file is under 200 KB. A conversation adds one reply per turn or so. */
const MAX_REPLIES = 3000;
const MAX_FILES = 500;
/* No page sends more than one reply at a time; this only bounds a malformed message. */
const MAX_IN = 50;

const fileOf = (dir, id) => (typeof dir === 'string' && dir && SESSION.test(String(id || '')) ? path.join(dir, id + '.json') : '');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/* One reply as [uuid, percent, dollars], or null when it carries neither figure. */
function clean(row) {
  if (!Array.isArray(row) || typeof row[0] !== 'string' || !UUID.test(row[0])) return null;
  const pct = num(row[1]), usd = num(row[2]);
  if (pct === null && usd === null) return null;
  return [row[0].toLowerCase(), pct, usd];
}

/** The replies kept in a file, oldest first; [] for anything that is not such a file. */
function read(file) {
  if (!file) return [];
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.replies)) return [];
  const out = [];
  for (const row of data.replies) { const r = clean(row); if (r) out.push(r); }
  return out;
}

/* Removes the conversation files changed longest ago until at most `max` are left, never `spare`. */
function prune(dir, max, spare) {
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && SESSION.test(n.slice(0, -5))); } catch (_) { return; }
  if (names.length <= max) return;
  const aged = [];
  for (const n of names) {
    const p = path.join(dir, n);
    if (p === spare) continue;
    try { aged.push([fs.statSync(p).mtimeMs, p]); } catch (_) { /* gone already */ }
  }
  aged.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < aged.length && names.length - i > max; i++) {
    try { fs.unlinkSync(aged[i][1]); } catch (_) { /* gone already, or tried again next time */ }
  }
}

/**
 * Merges `rows` into the conversation's file, each one taking its place as the newest. Returns whether the file was
 * written: rows that change nothing write nothing.
 */
function keep(dir, id, rows, { max = MAX_REPLIES, maxFiles = MAX_FILES } = {}) {
  const file = fileOf(dir, id);
  if (!file || !Array.isArray(rows)) return false;
  const fresh = rows.slice(0, MAX_IN).map(clean).filter(Boolean);
  if (!fresh.length) return false;
  const existed = fs.existsSync(file);
  const all = new Map(read(file).map((r) => [r[0], r]));
  let changed = false;
  for (const r of fresh) {
    const had = all.get(r[0]);
    if (had && had[1] === r[1] && had[2] === r[2]) continue;
    all.delete(r[0]);
    all.set(r[0], r);
    changed = true;
  }
  if (!changed) return false;
  const kept = [...all.values()].slice(-Math.max(1, max));
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(file, JSON.stringify({ v: 1, replies: kept }));
  if (!existed) prune(dir, maxFiles, file);
  return true;
}

/*
 * The extension's side of it. `dir()` is the folder the files go in; `sendTo(sessionId, message)` posts to the panel
 * showing that conversation and says whether one was found, and `sendAll(message)` posts to every panel, each of which
 * keeps only its own conversation's. `on()` is false while the extension is removed or being uninstalled.
 */
function create({ dir, sendTo, sendAll, on = () => true, log = () => {} }) {
  const say = (e) => log(`reply figures: ${(e && e.message) || e}`);
  return {
    ask(sessionId) {
      if (!on() || !fileOf(dir(), sessionId)) return;
      const message = { type: 'cce_figures', sessionId, replies: read(fileOf(dir(), sessionId)) };
      try { if (!sendTo(sessionId, message)) sendAll(message); } catch (e) { say(e); }
    },
    keep(sessionId, rows) {
      if (!on()) return;
      try { keep(dir(), sessionId, rows); } catch (e) { say(e); }
    },
    /* Deletes a conversation's file, once the conversation itself has been deleted. */
    forget(sessionId) {
      const file = fileOf(dir(), sessionId);
      if (!file) return;
      try { fs.unlinkSync(file); } catch (e) { if (!e || e.code !== 'ENOENT') say(e); }
    },
    fileOf: (sessionId) => fileOf(dir(), sessionId),
  };
}

module.exports = { create, read, keep, prune, fileOf, clean, DIR, MAX_REPLIES, MAX_FILES };
