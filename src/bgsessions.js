// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Background sessions left out of the session list.
 *
 * Claude Code's list already leaves out SDK and daemon sessions, by the entry point and the sessionKind on the first
 * record of a transcript, but not those whose sessionKind is "bg". Its own filter is also skipped altogether when
 * claudeCode.claudeProcessWrapper is set. So the patched host hands the finished list here instead, and this module
 * reads both fields as Claude Code does, leaving out `claude --bg`, `claude -p` and daemon sessions.
 *
 * The entry point comes from the environment of the process: a `claude -p` that a conversation in VS Code runs from
 * Bash inherits "claude-vscode" and records it, so its first prompt decides. Claude Code marks a prompt a person typed
 * with origin.kind "human" and, from 2.1.277, one given to `claude -p` with turnOrigin "sdk". A prompt with neither
 * mark was not typed either, if the version that wrote it marks typed prompts (HUMAN_ORIGIN_FROM).
 *
 * With the setting off, the patched host has Claude Code keep its SDK and daemon sessions too (src/host.js), so that
 * `claude -p` sessions can be listed; daemon sessions are left out still. They are Claude Code's own background
 * processes, not anything a person started.
 *
 * A transcript with a cost or a last prompt but no message is left out as well: opening it shows nothing. Some
 * background sessions leave such files.
 *
 * A session's kind does not change, so each is read once. Claude Code rewrites a transcript with its metadata records
 * first, so a read can catch the file part written: a record counts only once it is whole, and a file holding only
 * metadata counts as empty only once it has not changed for SETTLED_MS. Neither answer is kept until it is certain.
 */
const fs = require('fs');
const path = require('path');
const { projectsDir, transcriptOf, SESSION } = require('./claude-files');

const HEAD_BYTES = 65536;
/* A first record longer than HEAD_BYTES, such as a large attachment, is read up to this much. */
const MAX_BYTES = 1 << 20;
const SETTLED_MS = 10000;
const SDK = /^sdk-(?:cli|ts|py)$/;
const RAN = /"type":"(?:cost-state|last-prompt)"/;
const HIDDEN = new Set(['bg', 'daemon', 'daemon-worker', 'sdk', 'empty']);
const DAEMON = new Set(['daemon', 'daemon-worker']);
/* The first version seen to mark typed prompts with origin.kind "human"; older transcripts mark neither. */
const HUMAN_ORIGIN_FROM = [2, 1, 234];
const kinds = new Map();

/* Whether version `v`, such as "2.1.277", is at least `from`. */
function atLeast(v, from) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  if (!m) return false;
  for (let i = 0; i < 3; i++) {
    const n = Number(m[i + 1]);
    if (n !== from[i]) return n > from[i];
  }
  return true;
}

/* A prompt: a user record with text of its own, not a tool's result, a hidden or meta record, or a summary that
   continues a conversation after compaction. */
function isPrompt(r) {
  if (!r || r.type !== 'user' || r.isMeta || r.isCompactSummary || r.isVisibleInTranscriptOnly) return false;
  const c = r.message && r.message.content;
  if (typeof c === 'string') return !!c.trim();
  return Array.isArray(c) && c.some((b) => b && b.type === 'text') && !c.some((b) => b && b.type === 'tool_result');
}

function promptKind(r) {
  if (r.origin && r.origin.kind === 'human') return '';
  if (r.turnOrigin === 'sdk') return 'sdk';
  if (r.origin || r.turnOrigin) return '';
  return atLeast(r.version, HUMAN_ORIGIN_FROM) ? 'sdk' : '';
}

/* Claude Code's folder name for a working directory; one longer than 200 characters gets a hash it computes itself. */
function folderName(cwd) {
  const name = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
  return name && name.length <= 200 ? name : '';
}

/*
 * The session's kind from the first record with a parent link: its sessionKind, or 'sdk' for an SDK entry point.
 * Otherwise the first prompt decides: 'sdk' if it was not typed, '' if it was or if the part read has no prompt.
 * 'empty' for a file with no such record that shows the session ran and has settled. Null while the session has not
 * started, a record is still being written, a new file has no prompt yet, or the file cannot be read.
 */
function kindOf(file, now = Date.now()) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    let size = Math.min(st.size, HEAD_BYTES), head = '', lines = [], at = -1, whole = false;
    const readHead = () => {
      const buf = Buffer.alloc(size);
      const read = fs.readSync(fd, buf, 0, size, 0);
      head = buf.toString('utf8', 0, read);
      lines = head.split('\n');
      whole = read >= st.size;
    };
    for (;;) {
      readHead();
      at = lines.findIndex((l) => l.includes('"parentUuid":'));
      if ((at >= 0 && at < lines.length - 1) || whole || size >= MAX_BYTES) {
        if (at < 0) return whole && RAN.test(head) && now - st.mtimeMs >= SETTLED_MS ? 'empty' : null;
        break;
      }
      size = Math.min(st.size, MAX_BYTES);
    }
    /* The last piece of what was read has no line end: it may be a record still being written. */
    if (at === lines.length - 1) return null;
    let rec;
    try { rec = JSON.parse(lines[at]); } catch (_) { return null; }
    if (!rec || typeof rec !== 'object') return null;
    if (SDK.test(String(rec.entrypoint || ''))) return 'sdk';
    if (typeof rec.sessionKind === 'string' && rec.sessionKind) return rec.sessionKind;
    /* The first prompt can follow records Claude Code attaches to it; the last piece read may be cut short. */
    for (;;) {
      for (let i = at; i < lines.length - 1; i++) {
        let r;
        try { r = JSON.parse(lines[i]); } catch (_) { continue; }
        if (isPrompt(r)) return promptKind(r);
      }
      if (whole || size >= MAX_BYTES) break;
      size = Math.min(st.size, MAX_BYTES);
      readHead();
    }
    return whole && now - st.mtimeMs < SETTLED_MS ? null : '';
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

/* A session's kind, or null while it cannot be read; such a session is treated as an ordinary one and read again next
   time. */
function kindFor(id, cwd, projects) {
  if (kinds.has(id)) return kinds.get(id);
  const dir = folderName(cwd);
  let file = dir ? path.join(projects, dir, id + '.jsonl') : '';
  if (!file || !fs.existsSync(file)) file = transcriptOf(id, projects);
  const kind = file ? kindOf(file) : null;
  /* A transcript with no message can still get one, when the session is resumed. */
  if (kind !== null && kind !== 'empty') kinds.set(id, kind);
  return kind;
}

function isBackground(id, cwd, projects = projectsDir()) {
  return HIDDEN.has(kindFor(id, cwd, projects));
}

function leaving(entries, cwd, projects, hidden) {
  if (!Array.isArray(entries)) return entries;
  return entries.filter((e) => {
    const id = e && (e.id || e.sessionId);
    return !(typeof id === 'string' && SESSION.test(id) && hidden.has(kindFor(id, cwd, projects)));
  });
}

function withoutBackground(entries, cwd, projects = projectsDir()) { return leaving(entries, cwd, projects, HIDDEN); }

/* What the list keeps when background sessions are shown. */
function withoutDaemons(entries, cwd, projects = projectsDir()) { return leaving(entries, cwd, projects, DAEMON); }

module.exports = { withoutBackground, withoutDaemons, isBackground, kindOf, folderName, SETTLED_MS, HUMAN_ORIGIN_FROM };
