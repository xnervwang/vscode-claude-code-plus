// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Unread marks through claudeCodePlus.loadRestoredTabs (src/load-tabs.js). Claude Code's host clears a restored
 * conversation's mark when the conversation's page first reports it while its tab is in front, and the loader brings
 * each background tab to the front for a moment, so a page that reports within that moment loses its mark. The host
 * clears in two places of its own code, so rather than holding the clear off, the marks the host held before the
 * loading are set again after it, for each conversation that lost one and is not on screen then.
 */

/** The marks held `before` and missing `after` whose conversation is not on screen (`onScreen(key)`). */
function lost(before, after, onScreen) {
  const now = new Set(Array.isArray(after) ? after : []);
  return [...new Set(Array.isArray(before) ? before : [])].filter((k) => typeof k === 'string' && !now.has(k) && !onScreen(k));
}

/*
 * Runs load() between two readings of the host's marks (held() -> keys, or null when they cannot be read) and gives
 * each lost mark back with set(key). Returns { result, back }: what load() returned and the keys set again; a failure
 * of load() is passed on after the marks are back. All are set in one turn: Claude Code reads its marks back from VS
 * Code's storage before each change, and storage hands each write back to the extension host a moment later, which can
 * undo a mark set in a later turn.
 */
async function keepMarks(load, { held, onScreen, set }) {
  const before = held();
  let result, failure = null;
  try { result = await load(); } catch (e) { failure = e || new Error('loading the tabs failed'); }
  const back = before ? lost(before, held(), onScreen) : [];
  for (const k of back) set(k);
  if (failure) throw failure;
  return { result, back };
}

module.exports = { lost, keepMarks };
