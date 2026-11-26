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
/* globalState: set once the question below has been answered, whatever the answer. */
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

/* The note Agent Plus's session list shows above its rows until the question is answered (sessionsNotice in its
   protocol), with a button for each answer that runs `command` with 'hide' or 'keep'; null once it has been answered, or
   while the list is hidden anyway. */
function notice({ state, command, hidden = () => false, t = (s) => s }) {
  if (state.get(ASKED) === true) return null;
  try { if (hidden() === true) return null; } catch (_) { /* asked */ }
  return { text: t(QUESTION), actions: [{ label: t(HIDE), command, arguments: ['hide'] }, { label: t(KEEP), command, arguments: ['keep'] }] };
}

/* The answer a button of that note gives: recorded first, so a second window's note goes too, then 'hide' turns the
   setting on. Resolves to 'hidden', 'kept' or 'asked before'. */
async function answer({ state, pick, hide }) {
  if (state.get(ASKED) === true) return 'asked before';
  await state.update(ASKED, true);
  if (pick === 'hide') { await hide(); return 'hidden'; }
  return 'kept';
}

module.exports = { KEY, SETTING, ASKED, QUESTION, HIDE, KEEP, create, notice, answer };
