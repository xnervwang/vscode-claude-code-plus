// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * What a conversation is doing, for its dot (src/tabdot.js, the session list, the Steward panel) and for Agent Plus
 * (src/claude-source.js):
 *
 *   working     a turn runs: the panel's busy, or `claude agents` reporting the conversation busy
 *   background  the turn has ended and background work still runs - run_in_background commands and subagents,
 *               Monitors, detached commands, `claude --bg` sessions (src/background.js) - which wakes it when it ends
 *   waiting     a permission prompt or a choice box
 *   stopped     none of these
 *
 * Claude Code's panel reports 'running' for the first two alike, so the panel's busy goes to the host beside its state
 * (src/webview.js) and is read here. A Stop hook that makes the turn go on keeps it working: the panel sets busy back
 * to false only when the turn's result arrives. `claude agents` reports a conversation that only has background work
 * left as idle.
 *
 * The dot is red as well for a question the conversation's plan put to the user after the user's last message
 * (dotOf). A question left open for days is not one of them.
 */
const fs = require('fs');

/* How long a conversation has to stay stopped before it counts as stopped for a notice. A message queued while a turn
   ran starts the next turn within a quarter of a second of that turn's end, so most of this is slack for the panel and
   the host passing the change on. */
const STABLE_MS = 2000;
/* The end of a transcript read for the user's last message, doubled up to MAX_BACK when it is not there. */
const TAIL_BYTES = 256 * 1024;
const MAX_BACK = 16 * 1024 * 1024;

/*
 * host: the state the patched host has for it in this window ('idle', 'running', 'waiting'), with background work
 * already counted as 'running' (__cceWithBackground in extension.js), or '' when no panel here shows it. turn:
 * { busy, bg } as its panel last reported, or null. bg: whether src/background.js finds background work. agent: its
 * merged `claude agents` record, or null.
 *
 * A panel here outranks `claude agents`, which is read at most every half minute. Its last report of a turn counts only
 * while the host still has it running, so a panel that went away mid-turn leaves nothing behind. Its report of
 * background tasks counts whenever the host has the conversation: Claude Code reports a conversation whose only work is
 * a command put in the background as idle, and src/background.js finds that command only on its next scan.
 */
function activityOf({ host = '', turn = null, bg = false, agent = null } = {}) {
  if (host === 'waiting' || (!host && agent && agent.waitingFor)) return 'waiting';
  const told = !!turn && typeof turn.busy === 'boolean';
  const busy = host ? host === 'running' && (told ? turn.busy : !bg) : !!(agent && agent.busy);
  if (busy) return 'working';
  if (bg || host === 'running' || (host && told && turn.bg === true)) return 'background';
  return 'stopped';
}

/*
 * What each panel last reported besides its state (the turn hook in extension.js). report() says whether that changed,
 * and whether a turn has just ended; a panel switching away from a conversation says farewell, which forgets it.
 */
function turnTracker() {
  const turns = new Map();
  return {
    get: (id) => turns.get(id) || null,
    report(id, busy, bg, farewell) {
      if (farewell) return { changed: turns.delete(id), ended: false, bg: false };
      if (typeof busy !== 'boolean') return { changed: false, ended: false, bg: false };
      const was = turns.get(id), now = { busy, bg: bg === true };
      turns.set(id, now);
      if (was && was.busy === now.busy && was.bg === now.bg) return { changed: false, ended: false, bg: now.bg };
      return { changed: true, ended: !!(was && was.busy && !now.busy), bg: now.bg };
    },
  };
}

/*
 * Whether a turn that has just ended leaves a reply to be marked unread here. Claude Code's panel marks one itself when
 * the turn ends out of sight with nothing left running; with background work left it waits until that work ends too,
 * and the reply goes unmarked meanwhile. `bg`: background work found, by the panel or by src/background.js. `shown`:
 * whether a tab or the sidebar shows the conversation on screen.
 */
function marksUnread(ended, bg, shown) {
  return ended === true && bg === true && shown === false;
}

/* The dot: '' for none, else 'working', 'background' or 'waiting'. */
function dotOf(activity, question = false) {
  if (activity === 'waiting' || (question && activity !== 'working')) return 'waiting';
  return activity === 'working' || activity === 'background' ? activity : '';
}

/* Whether a plan row asks the user a question put after `since`, the time of the user's last message; a row that does
   not say when it asked counts from when it started waiting, as Agent Plus counts it. */
function freshQuestion(nodes, since) {
  if (!(since > 0)) return false;
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.waitingOn === 'user' && (n.state === 'waiting' || n.state === 'discussing') && (n.asked || n.since || 0) > since) return true;
    if (freshQuestion(n.children, since)) return true;
  }
  return false;
}

/*
 * The time of a transcript line if it is a message the user typed, else 0. Tool results, hook output, task
 * notifications, messages from other sessions and compaction summaries give 0. Answers on a question card
 * (AskUserQuestion) count as typed, since the card may carry a question from a plan row earlier in the same turn. A
 * message the user types during a turn is recorded as a queued_command attachment with a human origin.
 */
function typedAt(line) {
  if (!line.includes('"user"') && !line.includes('"queued_command"')) return 0;
  let r;
  try { r = JSON.parse(line); } catch (_) { return 0; }
  if (!r || typeof r !== 'object' || r.isSidechain || r.isMeta || r.isCompactSummary) return 0;
  const at = Date.parse(r.timestamp) || 0;
  if (r.type === 'attachment') {
    const a = r.attachment;
    return a && a.type === 'queued_command' && a.commandMode === 'prompt' && a.origin && a.origin.kind === 'human' ? at : 0;
  }
  if (r.type !== 'user') return 0;
  const origin = r.origin && typeof r.origin === 'object' ? r.origin : null;
  if (origin ? origin.kind !== 'human' : r.toolUseResult !== undefined) {
    const u = r.toolUseResult;
    return u && typeof u === 'object' && u.answers && typeof u.answers === 'object' && Object.keys(u.answers).length ? at : 0;
  }
  const c = r.message && r.message.content;
  const text = typeof c === 'string' ? c
    : Array.isArray(c) ? c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('') : '';
  if (!text.trim()) return 0;
  // Builds that wrote no origin put command output and task notifications in user records as tags.
  if (!origin && /^\s*</.test(text)) return 0;
  return at;
}

/* The latest typedAt among the complete lines of `buf`; the first is skipped when it may have been cut. */
function scanLines(buf, fromStart) {
  let at = 0, start = 0;
  if (!fromStart) {
    const nl = buf.indexOf(10);
    if (nl < 0) return 0;
    start = nl + 1;
  }
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end < 0) end = buf.length;
    if (end > start) {
      const t = typedAt(buf.toString('utf8', start, end));
      if (t > at) at = t;
    }
    start = end + 1;
  }
  return at;
}

/*
 * Reads the time of the user's last message from the end of transcripts. Each file is read from its end once; after
 * that only what has been appended since is read.
 */
function lastUserReader({ fsx = fs } = {}) {
  const seen = new Map();
  const read = (fd, pos, len) => {
    const buf = Buffer.alloc(len);
    const n = fsx.readSync(fd, buf, 0, len, pos);
    return n < len ? buf.subarray(0, n) : buf;
  };
  const fromEnd = (fd, size) => {
    for (let len = Math.min(size, TAIL_BYTES); ; len = Math.min(size, len * 2)) {
      const at = scanLines(read(fd, size - len, len), len === size);
      if (at || len === size || len >= MAX_BACK) return at;
    }
  };
  return {
    at(file) {
      if (!file) return 0;
      let fd;
      try {
        fd = fsx.openSync(file, 'r');
        const size = fsx.fstatSync(fd).size;
        const was = seen.get(file);
        let state;
        if (was && size === was.size) return was.at;
        if (was && size > was.size && size - was.done <= MAX_BACK) {
          // From the end of the last complete line read before, so a line written in two pieces is read whole.
          const buf = read(fd, was.done, size - was.done);
          const last = buf.lastIndexOf(10);
          const found = last < 0 ? 0 : scanLines(buf.subarray(0, last + 1), true);
          state = { size, done: last < 0 ? was.done : was.done + last + 1, at: Math.max(was.at, found) };
        } else {
          const tail = read(fd, Math.max(0, size - 1), Math.min(size, 1));
          state = { size, done: tail.length && tail[0] === 10 ? size : 0, at: fromEnd(fd, size) };
          if (!state.done) {
            const chunk = read(fd, Math.max(0, size - TAIL_BYTES), Math.min(size, TAIL_BYTES));
            const last = chunk.lastIndexOf(10);
            state.done = last < 0 ? Math.max(0, size - chunk.length) : size - chunk.length + last + 1;
          }
        }
        if (seen.size > 2000) seen.clear();
        seen.set(file, state);
        return state.at;
      } catch (_) { return 0; }
      finally { if (fd !== undefined) try { fsx.closeSync(fd); } catch (_) { /* closed */ } }
    },
  };
}

module.exports = { STABLE_MS, activityOf, dotOf, turnTracker, marksUnread, freshQuestion, typedAt, scanLines, lastUserReader, TAIL_BYTES, MAX_BACK };
