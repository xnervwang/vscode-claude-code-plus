// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Agent Plus's notices as cards in this window's Claude Code panels (src/page/95-notices.js draws them). Agent Plus
 * hands the whole list over through showNotices() in src/claude-source.js, in every window. Every panel of the window
 * gets it, a hidden one too, so a tab brought to the front shows the cards at once; a page made later asks for them.
 * A card's open and dismiss come back from the page and go to Agent Plus's commands, so the conversation is opened in
 * whichever window shows it, and dismissed in every window. Agent Plus's mode for the cards (normal, folded, quiet) goes
 * with them, and a page's buttons for the modes set it through Agent Plus's command.
 */

const MAX_CARDS = 100;
const MAX_TEXT = 200;
const KINDS = ['waiting', 'finished'];
const MODES = ['normal', 'folded', 'quiet'];

const text = (v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');

/* What a page is sent: only cards with the fields it draws, each a string, a boolean or a number. */
function cleanCards(cards) {
  const out = [];
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || typeof c.sourceId !== 'string' || typeof c.sessionId !== 'string' || !c.sourceId || !c.sessionId || !KINDS.includes(c.kind)) continue;
    out.push({ sourceId: text(c.sourceId), sessionId: text(c.sessionId), kind: c.kind, at: Number.isFinite(c.at) ? c.at : 0,
      title: text(c.title), steward: c.steward === true, agent: text(c.agent) });
    if (out.length >= MAX_CARDS) break;
  }
  return out;
}

/*
 * `send(message)` sends to every panel of the window; `onScreen()` says whether a Claude Code panel of the window is on
 * screen; `run(command, ...args)` runs a VS Code command; `on()` is false while this extension is turned off, and the
 * panels are then sent no cards.
 */
function createNotices({ send, onScreen, run, on = () => true, now = Date.now, log = () => {} }) {
  let cards = [], mode = 'normal', sent = '';
  const push = () => {
    try { send({ type: 'cce_notices', cards, now: now(), mode }); } catch (e) { log('notices: ' + ((e && e.message) || e)); }
  };
  return {
    /* Returns whether the cards are on screen in this window. */
    show(list, options) {
      let live = false;
      try { live = on() !== false; } catch (_) { live = false; }
      cards = live ? cleanCards(list) : [];
      mode = options && MODES.includes(options.mode) ? options.mode : 'normal';
      const now = JSON.stringify([cards, mode]);
      if (now !== sent) { sent = now; push(); }
      if (!cards.length) return false;
      try { return onScreen() === true; } catch (_) { return false; }
    },
    /* A page's message: 'ask' for the cards, a card opened or dismissed, or a mode picked ('mode-folded'). */
    heard(action, sourceId, sessionId) {
      const both = typeof sourceId === 'string' && !!sourceId && typeof sessionId === 'string' && !!sessionId;
      const picked = /^mode-(.*)$/.exec(String(action));
      if (picked) return MODES.includes(picked[1]) ? run('agentPlus.chooseCardMode', picked[1]) : undefined;
      if (action === 'ask') push();
      else if (action === 'open' && both) return run('agentPlus.openAttention', sourceId, sessionId);
      else if (action === 'dismiss' && both) return run('agentPlus.dismissAttention', sourceId, sessionId);
      else if (action === 'dismiss-all') return run('agentPlus.dismissAttention');
      return undefined;
    },
    cards: () => cards.slice(),
  };
}

module.exports = { createNotices, cleanCards, MAX_CARDS };
