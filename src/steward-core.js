// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * What the steward needs of Agent Plus to manage another agent's conversations (its docs/protocol.md, "The interface"):
 * allConversations(), planPathOf() and deliver(). Without all three, the Steward panel lists Claude Code conversations
 * only.
 *
 * allConversations() is kept current only while something listens to onDidChangeAllConversations. An Agent Plus window
 * writes its attention files, which src/agent-states.js reads for what each conversation is doing, only while its
 * notifications are on or something listens. So the steward subscribes, while link().want(true) says it has a use for
 * them, and a change only redraws the panel.
 */
const keys = require('./steward-keys');
const titleMarks = require('./title-marks');

const FEATURES = ['allConversations', 'deliver', 'planPathOf'];
const UPDATE = 'the Agent Plus in this window cannot pass messages to other agents\' conversations; update it';

const ready = (core) => !!(core && Array.isArray(core.features) && FEATURES.every((f) => core.features.includes(f))
  && typeof core.allConversations === 'function' && typeof core.onDidChangeAllConversations === 'function'
  && typeof core.deliver === 'function' && typeof core.planPathOf === 'function');

/* The conversations open on this machine: { key, sourceId, label, sessionId, title, cwd, lastActiveAt }. */
function others(core) {
  if (!ready(core)) return [];
  let list = [];
  try { list = core.allConversations(); } catch (_) { list = []; }
  const out = [], seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || !keys.OTHER_SOURCES.includes(c.sourceId)) continue;
    const key = keys.keyOf(c.sourceId, c.sessionId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const at = typeof c.lastActiveAt === 'number' ? c.lastActiveAt : Date.parse(c.lastActiveAt || '');
    out.push({ key, sourceId: c.sourceId, label: (typeof c.label === 'string' && c.label) || keys.labelOf(key), sessionId: c.sessionId,
      title: titleMarks.withoutMarks(typeof c.title === 'string' ? c.title : '') || c.sessionId, cwd: typeof c.cwd === 'string' ? c.cwd : '',
      lastActiveAt: Number.isFinite(at) && at > 0 ? at : 0 });
  }
  return out;
}

/* The plan file of `key`'s conversation, or ''. */
function planPathOf(core, key) {
  const p = ready(core) && keys.isOther(key) ? keys.parse(key) : null;
  if (!p) return '';
  let file = '';
  try { file = core.planPathOf(p.sourceId, p.sessionId); } catch (_) { file = ''; }
  return keys.planFileOk(key, file) ? file : '';
}

/* Resolves to { outcome, reason } and never rejects. */
function deliverTo(core, key, text) {
  const p = keys.isOther(key) ? keys.parse(key) : null;
  if (!p) return Promise.resolve({ outcome: 'notReceived', reason: 'the key names no other agent\'s conversation' });
  if (!(core && Array.isArray(core.features) && core.features.includes('deliver') && typeof core.deliver === 'function')) {
    return Promise.resolve({ outcome: 'notReceived', reason: UPDATE });
  }
  return Promise.resolve().then(() => core.deliver({ sourceId: p.sourceId, sessionId: p.sessionId, text }))
    .then((r) => ({ outcome: (r && typeof r.outcome === 'string' && r.outcome) || 'uncertain', reason: (r && typeof r.reason === 'string' && r.reason) || '' }),
      (e) => ({ outcome: 'notReceived', reason: String((e && e.message) || e).slice(0, 200) }));
}

/*
 * The interface this window was given, and the subscription. `changed()` runs when Agent Plus's list changes; `log` for
 * a subscription that fails.
 */
function link({ changed = () => {}, log = () => {} } = {}) {
  let core = null, sub = null, wanted = false, closed = false;
  const unhook = () => { if (sub) { try { sub.dispose(); } catch (_) { /* gone */ } sub = null; } };
  const follow = () => {
    if (closed || !wanted || !ready(core)) { unhook(); return; }
    if (sub) return;
    try { sub = core.onDidChangeAllConversations(() => { if (!closed) changed(); }); } catch (e) { sub = null; log(`steward panel: ${(e && e.message) || e}`); }
  };
  return {
    attach(next) { unhook(); core = next || null; follow(); },
    want(on) { if (wanted === !!on) return; wanted = !!on; follow(); },
    core: () => core,
    listening: () => !!sub,
    dispose() { closed = true; unhook(); },
  };
}

module.exports = { ready, others, planPathOf, deliverTo, link, FEATURES, UPDATE };
