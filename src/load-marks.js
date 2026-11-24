// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Unread marks through claudeCodePlus.loadRestoredTabs (src/load-tabs.js). Claude Code's host clears a restored
 * conversation's mark the first time its page reports while its tab is in front, and the loader brings each background
 * tab to the front for a moment, so a page that reports during it loses its mark. The host clears the mark in two
 * places in its own code, so instead of preventing the clear, this reads the marks before the loading and sets them
 * again after it.
 */

/** The keys in `before` that are not in `after`. */
function lost(before, after, onScreen) {
  const now = new Set(Array.isArray(after) ? after : []);
  return [...new Set(Array.isArray(before) ? before : [])].filter((k) => typeof k === 'string' && !now.has(k) && !onScreen(k));
}

/*
 * Reads the host's marks with held() (keys, or null when they cannot be read), runs load(), reads them again, and gives
 * each lost mark back with set(key). Returns load()'s result and the keys it set again, as { result, back }; a failure
 * of load() is passed on once the marks are set again. They are all set in one turn: Claude Code reads its marks back
 * from VS Code's storage before each change, and storage hands each write back to the extension host a moment later,
 * which can undo a mark set in a later turn.
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
