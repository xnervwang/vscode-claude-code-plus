// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Checks a conversation's transcript for a message typed into its panel.
 *
 * The panel script judges a send by the message input emptying, and Claude Code can put the text back into the input
 * after sending it (src/page/91-answer.js). The panel then reports the message as not sent, and sending it again would
 * send it twice.
 */
const fs = require('fs');

const TAIL_BYTES = 512 * 1024;
/* How long to keep looking: Claude Code writes the message within a fraction of a second of sending it. */
const WAITS_MS = [300, 600, 900, 1200];

const squash = (s) => String(s || '').replace(/[\s\u200b]+/g, '');
const textOf = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join('\n') : '');

/*
 * 'sent' when an entry written at or after `since` carries `text` as a user message, or as a message queued while a
 * turn ran; 'queued' when only a queue entry was written then, because a queued message reaches the transcript only
 * once the turn takes it; '' otherwise.
 */
function seen(lines, text, since) {
  const want = squash(text);
  if (!want) return '';
  let queued = false;
  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch (_) { continue; }
    if (!d || !(Date.parse(d.timestamp) >= since)) continue;
    if (d.type === 'user' && !d.isMeta && d.message && squash(textOf(d.message.content)) === want) return 'sent';
    if (d.type === 'attachment' && d.attachment && d.attachment.type === 'queued_command'
      && squash(textOf(d.attachment.prompt)) === want) return 'sent';
    if (d.type === 'queue-operation' && d.operation === 'enqueue') queued = true;
  }
  return queued ? 'queued' : '';
}

/* Reads the complete lines in the last TAIL_BYTES of a file, or none if the file cannot be read. */
function tail(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* closed */ } }
  }
}

/* Runs seen() on the transcript, and again after each wait, until it returns 'sent'. */
async function sentSince(file, text, since, { waits = WAITS_MS, sleep } = {}) {
  const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let got = file ? seen(tail(file), text, since) : '';
  for (const ms of waits) {
    if (got === 'sent' || !file) break;
    await pause(ms);
    got = seen(tail(file), text, since);
  }
  return got;
}

module.exports = { seen, tail, sentSince, TAIL_BYTES, WAITS_MS };
