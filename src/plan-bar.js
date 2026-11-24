// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The plan bar above the input box of each Claude Code panel (src/page/96-plan-bar.js, drawn by Agent Plus's fragment
 * in src/page/04-plan-bar.js): the summary of the conversation a panel shows, from Agent Plus's planSummary() (Plan bar
 * in its docs/protocol.md), and where the bar's two clicks go.
 *
 * A panel asks for its conversation's summary when it starts to show one and when the bar is switched back on. The
 * extension answers, and sends it again whenever Agent Plus reports that summary changed, to the panel showing that
 * conversation; a panel it cannot find by the conversation's id gets the message with the others, and each page keeps
 * only its own conversation's. A click on the bar runs agentPlus.showWorkPlanOf, one on its red part
 * agentPlus.answerQuestionOf.
 *
 * Nothing is asked or sent while claudeCodePlus.show.planBar is off, nor with an Agent Plus that lacks planSummary: the
 * page then has no summary and draws no bar. No editor API here: the tests load it directly.
 */
const SOURCE = 'claude-code';
/* How many conversations' summaries are followed for changes: the ones panels asked about most recently. A window shows
   a few at a time. */
const MAX_FOLLOWED = 200;
const MAX_ID = 200;

const usable = (id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID;

/*
 * `on()` is true while claudeCodePlus.show.planBar is in effect; `sendTo(sessionId, message)` posts to the panel
 * showing that conversation and says whether one was found; `sendAll(message)` posts to every panel; `run(command,
 * arg)` runs a command.
 */
function create({ on, sendTo, sendAll, run, log = () => {} }) {
  let core = null, sub = null, closed = false;
  const followed = new Set();
  const usesCore = () => !!(core && Array.isArray(core.features) && core.features.includes('planSummary')
    && typeof core.planSummary === 'function' && typeof core.onDidChangePlanSummary === 'function');
  const summaryOf = (sessionId) => {
    if (!usesCore()) return null;
    try { return core.planSummary(SOURCE, sessionId) || null; } catch (e) { log(`plan bar: ${(e && e.message) || e}`); return null; }
  };
  const remember = (sessionId) => {
    followed.delete(sessionId);
    followed.add(sessionId);
    while (followed.size > MAX_FOLLOWED) followed.delete(followed.values().next().value);
  };
  const post = (sessionId) => {
    const message = { type: 'cce_plan_bar', sessionId, summary: summaryOf(sessionId) };
    try { if (!sendTo(sessionId, message)) sendAll(message); } catch (e) { log(`plan bar: ${(e && e.message) || e}`); }
  };
  const unhook = () => { if (sub) { try { sub.dispose(); } catch (_) { /* gone */ } sub = null; } };
  const follow = () => {
    if (closed) return;
    if (!on() || !usesCore()) { unhook(); return; }
    if (sub) return;
    try {
      sub = core.onDidChangePlanSummary((e) => {
        if (closed || !on() || !e || e.sourceId !== SOURCE || !followed.has(e.sessionId)) return;
        post(e.sessionId);
      });
    } catch (e) { sub = null; log(`plan bar: ${(e && e.message) || e}`); }
  };
  return {
    /* The agentPlus interface once this extension is registered with it, or null. A panel that asked before then was
       answered with no summary and is sent its own now; every panel is also told the bar can be asked for, so that one
       whose question came before this extension was listening asks again at once. */
    attach(next) {
      unhook();
      core = next || null;
      follow();
      if (!on()) return;
      for (const id of followed) post(id);
      if (usesCore()) { try { sendAll({ type: 'cce_plan_bar_ready' }); } catch (e) { log(`plan bar: ${(e && e.message) || e}`); } }
    },
    settingChanged() { follow(); },
    /* A panel showing conversation `sessionId` asks for its summary. */
    ask(sessionId) {
      if (closed || !usable(sessionId) || !on()) return;
      remember(sessionId);
      follow();
      post(sessionId);
    },
    /* A click on a panel's bar: `part` is 'answer' for the red part, anything else for the bar. */
    async open(sessionId, part) {
      if (closed || !usable(sessionId) || !usesCore()) return;
      await run(part === 'answer' ? 'agentPlus.answerQuestionOf' : 'agentPlus.showWorkPlanOf', { sourceId: SOURCE, sessionId });
    },
    followed: () => [...followed],
    dispose() { closed = true; unhook(); },
  };
}

module.exports = { create, SOURCE, MAX_FOLLOWED };
