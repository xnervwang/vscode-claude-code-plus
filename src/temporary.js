// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Temporary conversations, Claude Code's part. Agent Plus keeps the registry and asks for the deletes; its exports give
 * isTemporary, temporaryIds, onDidChangeTemporary and addTemporary once its features include 'temporary'.
 *
 * Claude Code gives a new conversation its session id only when its first message is sent, so a conversation started
 * as temporary is first known by its panel. Right before this extension runs Claude Code's open command for one, it
 * arms; the panel Claude Code sets up while armed (the "plain" call of the tab icon hook, src/host.js) is the new one.
 * When that panel first reports a session id, the id is registered with Agent Plus (by 'source'). A panel closed
 * before it has an id leaves nothing on disk and is forgotten with it.
 *
 * A temporary conversation's tab title starts with the hourglass (src/title-marks.js withTemporary), from the moment
 * its panel is set up.
 */
const path = require('path');

/* How long an arm waits for Claude Code to set up the new panel. */
const ARM_MS = 5000;

/*
 * `deps`: core() Agent Plus's exports, or null; sourceId; log(line).
 */
function create(deps) {
  const pending = new WeakSet();
  let armedUntil = 0;
  const core = () => {
    let c = null;
    try { c = deps.core(); } catch (_) { c = null; }
    return c && Array.isArray(c.features) && c.features.includes('temporary') && typeof c.isTemporary === 'function'
      && typeof c.addTemporary === 'function' ? c : null;
  };
  const register = (sessionId, by) => {
    const c = core();
    if (!c) return Promise.resolve({ ok: false, reason: 'Agent Plus has no temporary conversations' });
    return Promise.resolve(c.addTemporary(deps.sourceId, sessionId, { by })).then((r) => {
      const ok = !!(r && r.ok === true);
      deps.log(`temporary conversation ${sessionId}: ${ok ? 'registered' : 'not registered'} (by ${by})${!ok && r && r.reason ? ': ' + r.reason : ''}`);
      return { ok, reason: ok ? '' : (r && r.reason) || 'Agent Plus did not say why' };
    }, (e) => {
      deps.log(`temporary conversation ${sessionId}: not registered: ${(e && e.message) || e}`);
      return { ok: false, reason: String((e && e.message) || e) };
    });
  };
  const isTemporary = (sessionId) => {
    const c = core();
    if (!c || typeof sessionId !== 'string' || !sessionId) return false;
    try { return c.isTemporary(deps.sourceId, sessionId) === true; } catch (_) { return false; }
  };
  return {
    available: () => !!core(),
    /* Called right before Claude Code's open command for a temporary conversation; disarm() after it returns. */
    arm(now = Date.now()) { armedUntil = now + ARM_MS; },
    disarm() { armedUntil = 0; },
    /* A panel Claude Code has just set up, with no session yet: the new temporary one while armed. */
    setUp(panel, now = Date.now()) {
      if (!panel || !armedUntil || now > armedUntil) return false;
      armedUntil = 0;
      pending.add(panel);
      return true;
    },
    /* A panel reporting its session id: a pending one registers it and is pending no more. */
    seen(panel, sessionId) {
      if (!panel || !pending.has(panel) || typeof sessionId !== 'string' || !sessionId) return null;
      pending.delete(panel);
      return register(sessionId, 'source');
    },
    /* A conversation a supervisor opened with --open --temp (src/relay.js). */
    register,
    isTemporary,
    /* Whether a tab shows a temporary conversation: its panel is waiting for its id, or the id is registered. */
    marks: (panel, sessionId) => (!!panel && pending.has(panel)) || isTemporary(sessionId),
  };
}

/*
 * What a temporary conversation's delete removes beyond Claude Code's own files and its work plan (src/deletesession.js
 * findAll): its scratch session folder, ~/.claude/scratch/<project folder>/<session id>, under each project folder
 * that holds its transcript.
 */
function scratchDirs(claudeDir, projectNames, sessionId) {
  return projectNames.map((name) => path.join(claudeDir, 'scratch', name, sessionId));
}

module.exports = { create, scratchDirs, ARM_MS };
