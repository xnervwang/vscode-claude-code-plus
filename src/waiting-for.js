// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * What a waiting conversation waits for, in the words of Agent Plus's protocol (a conversation's `waitingFor`), and
 * whether Claude Code's own notice of such a wait is left to Agent Plus.
 *
 * A panel reports what is in front of it with its state (src/webview.js, the state report): the tool of the permission
 * request it shows, or the kind of the dialog it shows. Claude Code asks AskUserQuestion's question and shows
 * ExitPlanMode's plan through the same permission request, so those two tools are a question and a plan to review. A
 * window whose panel does not show the conversation has only `claude agents`, whose waitingFor is a phrase for a kind of
 * wait, grouped here the way the CLI's own status groups them; it never names the tool.
 *
 * Claude Code's panel shows its own notice when a permission request arrives, or auto mode's Continue or Stop dialog,
 * in the conversation's window and only while the panel is not on screen. Agent Plus tells of the same waits in the
 * window the user is in, so while it does (src/core-link.js announcesWaits) the panel leaves its own out; a panel that
 * cannot tell, or an Agent Plus that does not announce, keeps Claude Code's notice.
 */
const QUESTION_TOOL = 'AskUserQuestion';
const PLAN_TOOL = 'ExitPlanMode';
const MAX_TOOL = 80;
const AGENTS = {
  'permission prompt': 'permission', 'sandbox request': 'permission', 'worker request': 'permission', 'goal proposal': 'permission',
  'input needed': 'question', 'dialog open': 'choice',
};

/* `raw` as a panel reports it, { tool } or { dialog }, as a reason; null for anything else. */
function fromPanel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tool = typeof raw.tool === 'string' ? raw.tool.replace(/\s+/g, ' ').trim() : '';
  if (tool === QUESTION_TOOL) return { kind: 'question' };
  if (tool === PLAN_TOOL) return { kind: 'plan' };
  if (tool) return { kind: 'permission', tool: tool.slice(0, MAX_TOOL) };
  if (typeof raw.dialog === 'string') return { kind: 'choice' };
  return null;
}

/* A `claude agents` record's waitingFor as a reason; null for a phrase this does not know. */
function fromAgents(text) {
  const kind = typeof text === 'string' ? AGENTS[text.trim()] : undefined;
  return kind ? { kind } : null;
}

/* Whether this window's panels leave Claude Code's notices of waits out: only while this extension runs and Agent Plus,
   with which its source is registered, says it tells of them. */
function leftToAgentPlus({ core = null, on = true, announcesWaits }) {
  if (!core || !on) return false;
  try { return announcesWaits(core) === true; } catch (_) { return false; }
}

module.exports = { QUESTION_TOOL, PLAN_TOOL, MAX_TOOL, fromPanel, fromAgents, leftToAgentPlus };
