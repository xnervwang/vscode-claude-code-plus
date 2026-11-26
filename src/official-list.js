// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Whether Claude Code's own session list is shown (claudeCodePlus.hideOfficialSessionList).
 *
 * Claude Code shows its session list's container and view while the context key claude-vscode.sessionsListEnabled is
 * true, and sets it to true once, as it activates. This extension depends on Claude Code and so activates after it:
 * setting the key to false then hides the list until Claude Code activates again, and turning the setting off sets it
 * back to true. Nothing in Claude Code opens that view by itself. The Session history at the top of a conversation is
 * part of the conversation's page, which the key does not touch.
 *
 * With the setting off from the start the key is left alone, so Claude Code's own value stands.
 */
const KEY = 'claude-vscode.sessionsListEnabled';
const SETTING = 'hideOfficialSessionList';
/* globalState: set once the question below has been asked, whatever the answer. */
const ASKED = 'officialSessionListAsked';
const QUESTION = 'Agent Plus now lists your Claude Code conversations. Hide Claude Code\'s own session list? You can change this later with the setting Claude Code Plus: Hide Official Session List.';
const HIDE = 'Hide It';
const KEEP = 'Keep It';

/* `execute` runs a VS Code command and `hidden` reads the setting. apply() makes the key follow the setting and resolves
   to whether it set the key; dispose() shows the list again if this extension hid it. */
function create({ execute, hidden, log = () => {} }) {
  let hiding = false;
  const set = (shown) => Promise.resolve()
    .then(() => execute('setContext', KEY, shown))
    .catch((e) => log(`official session list: setting ${KEY} failed: ${(e && e.message) || e}`));
  return {
    apply() {
      let want = false;
      try { want = hidden() === true; } catch (_) { want = false; }
      if (want === hiding) return Promise.resolve(false);
      hiding = want;
      return set(!want).then(() => true);
    },
    dispose() {
      if (!hiding) return Promise.resolve(false);
      hiding = false;
      return set(true).then(() => true);
    },
    get hiding() { return hiding; },
  };
}

/* Asks once whether to hide the list. `ask(question, ...buttons)` shows the question and resolves to the button picked, or
   undefined; `hide()` turns the setting on. The question is recorded as asked before it is shown, so a second window
   opening the list at the same moment, or a dismissed question, does not ask again; no answer leaves the list shown.
   Resolves to 'hidden', 'kept', 'dismissed' or 'asked before'. */
async function askOnce({ state, ask, hide, t = (s) => s }) {
  if (state.get(ASKED) === true) return 'asked before';
  await state.update(ASKED, true);
  const hideLabel = t(HIDE), keepLabel = t(KEEP);
  let pick;
  try { pick = await ask(t(QUESTION), hideLabel, keepLabel); } catch (_) { pick = undefined; }
  if (pick === hideLabel) { await hide(); return 'hidden'; }
  return pick === keepLabel ? 'kept' : 'dismissed';
}

module.exports = { KEY, SETTING, ASKED, QUESTION, HIDE, KEEP, create, askOnce };
