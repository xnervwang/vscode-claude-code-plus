// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Tells a conversation when a `claude --bg` session it started ends or stops to wait for an answer. Claude Code does not
 * tell it. Without this the conversation has to keep checking, or set a timer, which dies with its process.
 *
 * src/background.js keeps a link file beside the plan for each conversation, listing the sessions it started, and a
 * session's state is its record under ~/.claude/jobs. Every window compares those states with the ones last seen, kept
 * in SEEN_FILE. Each change worth reporting is written once, as its own file in ENDS_DIR created with O_EXCL as in
 * src/detachedends.js, whose deliver() sends the notices: an idle conversation starts a turn, and one with no process
 * is told the next time it starts.
 *
 * On the first look nothing is reported; the sessions that ended before then are only noted. Nor is a session the
 * conversation stopped itself.
 */
const fs = require('fs');
const path = require('path');
const background = require('./background');
const planNames = require('./plan-names');
const { claudeDir, transcriptOf, writeAtomic } = require('./claude-files');
const watch = require('./steward-watch');

const SEEN_FILE = 'background-seen.json';
const ENDS_DIR = 'background-ended';
/* How long a record may say "working" or "blocked" with no process behind it before the session counts as dead: the
   daemon writes the record and its process record separately. */
const DEAD_AFTER_MS = 2 * 60000;
/* A session that is already over when first found is reported only if it finished after the last look, give or take
   this much. */
const SEEN_SLACK_MS = 60000;
/* Longer fields are cut: the notice goes into the conversation's context. */
const NOTICE_TEXT = 300;
const WHO = 'Claude Code Plus';
const ENDED = new Set(['done', 'failed', 'stopped']);

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
const time = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return isFinite(t) ? t : 0; };
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (s, n = NOTICE_TEXT) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3) + '...' : t; };

/* A session's record, read again only when the file has changed. */
const cache = new Map();
function stateOf(jobs, id) {
  const file = path.join(jobs, id, 'state.json');
  let st;
  try { st = fs.statSync(file); } catch (_) { cache.delete(id); return null; }
  const was = cache.get(id);
  if (was && was.mtimeMs === st.mtimeMs && was.size === st.size) return was.entry;
  const d = readJson(file);
  if (!d || typeof d !== 'object') return was ? was.entry : null;
  const result = d.output && typeof d.output === 'object' ? d.output.result : d.output;
  const entry = { state: str(d.state), name: str(d.name), detail: str(d.detail), needs: str(d.needs), result: str(result),
    updatedAt: time(d.updatedAt), endedAt: time(d.lastTerminalAt) || time(d.firstTerminalAt), startedAt: time(d.createdAt) };
  cache.set(id, { mtimeMs: st.mtimeMs, size: st.size, entry });
  return entry;
}

/* A key for what to report about a session, '' for nothing. */
function signature(e, live, now) {
  if (ENDED.has(e.state)) return `${e.state}@${e.endedAt}`;
  if (live) return e.state === 'blocked' ? `blocked@${e.needs}` : '';
  return now - (e.updatedAt || 0) > DEAD_AFTER_MS ? `died@${e.startedAt}` : '';
}

/*
 * Records the changes since SEEN_FILE was written and returns them. `records` lists the running Claude processes
 * (src/background.js liveRecords). `claim` is false while the notices are off: nothing is recorded then, so turning them
 * on does not report what happened in the meantime.
 */
function update({ dir, records, jobs = path.join(claudeDir(), 'jobs'), now = Date.now(), claim = true,
  transcript = transcriptOf }) {
  const live = new Set();
  for (const r of records || []) if (r && r.kind === 'bg' && typeof r.jobId === 'string') live.add(r.jobId);
  let names = [];
  try { names = planNames.names(dir).filter((n) => background.LINK_FILE.test(n)); } catch (_) { return []; }
  const seenFile = path.join(dir, SEEN_FILE);
  const was = readJson(seenFile);
  const before = was && was.jobs && typeof was.jobs === 'object' ? was.jobs : null;
  const cur = {}, found = [];
  for (const n of names) {
    const session = n.slice(0, -background.SUFFIX.length);
    for (const id of background.readLink(path.join(dir, n)).ids) {
      const e = stateOf(jobs, id);
      if (!e) continue;
      const sig = signature(e, live.has(id), now);
      cur[id] = sig || e.state;
      if (sig) found.push({ session, id, sig, e });
    }
  }
  const recorded = [];
  if (claim && before) {
    for (const { session, id, sig, e } of found) {
      if (before[id] === sig) continue;
      if (before[id] === undefined && ENDED.has(e.state) && e.endedAt < (Number(was.at) || 0) - SEEN_SLACK_MS) continue;
      if (e.state === 'stopped' && watch.stoppedBy(transcript(session), id)) continue;
      const end = { session, job: id, kind: sig.slice(0, sig.indexOf('@')), name: e.name, detail: e.detail, needs: e.needs,
        result: e.result, endedAt: e.endedAt, goneAt: now };
      const key = Buffer.from(sig).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(-24);
      try {
        fs.mkdirSync(path.join(dir, ENDS_DIR), { recursive: true });
        fs.writeFileSync(path.join(dir, ENDS_DIR, `${session}.${id}.${key}.json`), JSON.stringify(end) + '\n', { flag: 'wx' });
        recorded.push(end);
      } catch (_) { /* recorded already, by this window or another */ }
    }
  }
  const next = JSON.stringify(Object.keys(cur).sort().reduce((o, k) => { o[k] = cur[k]; return o; }, {}));
  if (!before || JSON.stringify(Object.keys(before).sort().reduce((o, k) => { o[k] = before[k]; return o; }, {})) !== next) {
    try { writeAtomic(seenFile, JSON.stringify({ at: now, jobs: JSON.parse(next) }) + '\n'); } catch (_) { /* the next look */ }
  }
  return recorded;
}

const pad = (n) => String(n).padStart(2, '0');
const when = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

function line(e) {
  const at = e.endedAt > 0 ? ` at ${when(e.endedAt)}` : '';
  const what = e.kind === 'done' ? `finished${at}${e.result ? '. Its result: ' + clip(e.result) : ''}`
    : e.kind === 'failed' ? `failed${at}${e.detail ? ': ' + clip(e.detail) : ''}`
      : e.kind === 'stopped' ? `was stopped${at}`
        : e.kind === 'blocked' ? `is waiting for an answer${e.needs ? ': ' + clip(e.needs) : ''}`
          : 'stopped running before it finished: its process is gone';
  return `- ${e.name ? `"${clip(e.name, 80)}" ` : ''}(${e.job}) ${what}`;
}

/* The opening line says it is not from the user, since anything arriving through the inbox reads as the user's message. */
function noticeText(ends, { who = WHO } = {}) {
  const one = ends.length === 1;
  const lines = ends.slice().sort((a, b) => a.goneAt - b.goneAt).map(line);
  return `${who} notice, not a message from the user: news of ${one ? 'a `claude --bg` session' : '`claude --bg` sessions'} `
    + `this conversation started.\n${lines.join('\n')}\n\`claude logs <id>\` shows a session's output, and \`claude attach <id>\` `
    + 'answers one that is waiting.';
}

module.exports = { update, noticeText, signature, SEEN_FILE, ENDS_DIR, DEAD_AFTER_MS };
