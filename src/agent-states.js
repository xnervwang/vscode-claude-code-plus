// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * What other agents' conversations are doing, for the Steward panel and its notices: the attention files every window
 * with Agent Plus writes in the shared folder (its docs/protocol.md, "Notifications", and readAll in its
 * src/attention.js, whose rules for one item are taken here). hooks/agent_states.py reads them the same way.
 *
 * A window lists its sources' running conversations there, leaving out stopped ones whose reply has been read, so a
 * conversation missing from every file is stopped, or open in no window; neither is waiting. A window writes only
 * while its notifications are on or something listens to onDidChangeAllConversations, which src/steward-core.js does.
 */
const fs = require('fs');
const path = require('path');
const { sharedHome } = require('./files');
const keys = require('./steward-keys');

const ATTENTION_DIR = 'attention';
const FORMAT = 1;
/* A file older than this was left by a window that has gone. */
const STALE_MS = 60000;
const MAX_ITEMS = 200;
const MAX_TOOL = 80;
const WINDOW = /^[0-9a-z]+-[0-9a-f]{8}\.json$/;
/* When two windows report one conversation differently, the report that needs the user most wins. */
const RANK = { waiting: 0, working: 1, background: 2, stopped: 3 };
const OF_STATE = { prompt: 'waiting', working: 'working', unread: 'stopped', idle: 'stopped' };
const KINDS = ['permission', 'question', 'plan', 'choice', 'planQuestion'];

/* { kind } or { kind: 'permission', tool }, or null. */
function reasonOf(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
  if (raw.kind !== 'permission') return { kind: raw.kind };
  const tool = typeof raw.tool === 'string' ? raw.tool.replace(/\s+/g, ' ').trim().slice(0, MAX_TOOL) : '';
  return tool ? { kind: 'permission', tool } : { kind: 'permission' };
}
/* For keeping the fuller of two windows' reasons for one wait: a permission that does not name its tool ranks below
   any other reason. */
const detail = (r) => (!r ? 0 : r.kind === 'permission' && !r.tool ? 1 : 2);

/** key -> { activity, unseen, waitingFor, lastActiveAt } for the conversations of sources other than Claude Code. */
function read({ dir = path.join(sharedHome(), ATTENTION_DIR), now = Date.now() } = {}) {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return out; }
  for (const n of names) {
    if (!WINDOW.test(n)) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { continue; /* being replaced */ }
    if (!d || d.format !== FORMAT || !Array.isArray(d.items) || !(now - d.at < STALE_MS)) continue;
    for (const raw of d.items.slice(0, MAX_ITEMS)) {
      if (!raw || typeof raw.sourceId !== 'string' || raw.sourceId === keys.CLAUDE || typeof raw.sessionId !== 'string') continue;
      const key = keys.keyOf(raw.sourceId, raw.sessionId);
      if (!key) continue;
      const activity = RANK[raw.activity] !== undefined ? raw.activity : OF_STATE[raw.state] || '';
      const unseen = typeof raw.unseen === 'boolean' ? raw.unseen : raw.state === 'unread';
      if (!activity || (activity === 'stopped' && !unseen)) continue;
      const it = { activity, unseen, waitingFor: activity === 'waiting' ? reasonOf(raw.waitingFor) : null,
        lastActiveAt: Number.isFinite(raw.lastActiveAt) ? raw.lastActiveAt : 0 };
      const had = out.get(key);
      if (!had) { out.set(key, it); continue; }
      const win = RANK[activity] < RANK[had.activity] ? it : had;
      out.set(key, { activity: win.activity, unseen: had.unseen || unseen, lastActiveAt: Math.max(had.lastActiveAt, it.lastActiveAt),
        waitingFor: win.activity === 'waiting' ? (detail(it.waitingFor) > detail(had.waitingFor) ? it.waitingFor : had.waitingFor) : null });
    }
  }
  return out;
}

module.exports = { read, reasonOf, ATTENTION_DIR, STALE_MS };
