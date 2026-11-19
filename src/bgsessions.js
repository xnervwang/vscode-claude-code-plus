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
const kinds = new Map();

/* Claude Code's folder name for a working directory; one longer than 200 characters gets a hash it computes itself. */
function folderName(cwd) {
  const name = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
  return name && name.length <= 200 ? name : '';
}

/*
 * What the first record with a parent link says: its sessionKind ('' when it has none), or 'sdk' for an SDK entry point.
 * With no such record, 'empty' when the whole file shows the session ran and has settled, and null for a session not
 * started yet, a record still being written, or a file that cannot be read.
 */
function kindOf(file, now = Date.now()) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    let size = Math.min(st.size, HEAD_BYTES), head = '', lines = [], at = -1;
    for (;;) {
      const buf = Buffer.alloc(size);
      const read = fs.readSync(fd, buf, 0, size, 0);
      head = buf.toString('utf8', 0, read);
      lines = head.split('\n');
      at = lines.findIndex((l) => l.includes('"parentUuid":'));
      const whole = read >= st.size;
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
    return typeof rec.sessionKind === 'string' ? rec.sessionKind : '';
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

/* A session whose kind cannot be read yet is treated as an ordinary one, and read again next time. */
function isBackground(id, cwd, projects = projectsDir()) {
  if (kinds.has(id)) return HIDDEN.has(kinds.get(id));
  const dir = folderName(cwd);
  let file = dir ? path.join(projects, dir, id + '.jsonl') : '';
  if (!file || !fs.existsSync(file)) file = transcriptOf(id, projects);
  const kind = file ? kindOf(file) : null;
  if (kind === null) return false;
  /* A transcript with no message can still get one, when the session is resumed. */
  if (kind !== 'empty') kinds.set(id, kind);
  return HIDDEN.has(kind);
}

function withoutBackground(entries, cwd, projects = projectsDir()) {
  if (!Array.isArray(entries)) return entries;
  return entries.filter((e) => {
    const id = e && (e.id || e.sessionId);
    return !(typeof id === 'string' && SESSION.test(id) && isBackground(id, cwd, projects));
  });
}

module.exports = { withoutBackground, isBackground, kindOf, folderName, SETTLED_MS };
