// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Which conversations a Claude Code panel turns into links when a reply names them (src/page/95-conversation-links.js),
 * and what a click on such a link opens.
 *
 * When Agent Plus offers allConversations (its docs/protocol.md), the list comes from it: the conversations of every
 * agent that its Conversations view reads anyway, those running on this machine and those shown in this window. With
 * an Agent Plus that lacks it, the list is the Claude Code conversations this extension finds itself. Every panel is
 * sent the list when it changes, and a panel that opens later asks for it. A click goes to agentPlus.openConversation,
 * which brings the conversation forward in the window that shows it, offers to open it here when no window does, and
 * opens it through its own agent, so a Codex conversation opens in Codex.
 *
 * Nothing is read or sent while claudeCodePlus.show.conversationLinks is off. No editor API here: the tests load it
 * directly.
 */
const MAX_LISTED = 2000;
const MAX_TITLE = 300;
/* How often this extension's own list is read again, without Agent Plus's: a conversation that starts running tells
   nothing here, and the list of running ones is kept for 30 seconds (src/claude-source.js). */
const OWN_POLL_MS = 15000;
/* The Claude Code source's id, as src/claude-source.js registers it, for the lists this extension makes itself. */
const OWN_SOURCE = 'claude-code';
const OWN_LABEL = 'Claude Code';

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/* The entry a panel gets for one conversation, or null when its id is unusable. */
function entryOf(c, sourceId, label) {
  if (!c || typeof c.sessionId !== 'string' || !c.sessionId || c.sessionId.length > 200) return null;
  const at = typeof c.lastActiveAt === 'number' ? c.lastActiveAt : Date.parse(c.lastActiveAt || '');
  return { sourceId: text(c.sourceId, 80) || sourceId, label: text(c.label, 80) || label, sessionId: c.sessionId, title: text(c.title, MAX_TITLE),
    cwd: text(c.cwd, 1000), lastActiveAt: Number.isFinite(at) && at > 0 ? at : 0 };
}

/* `lists` as Agent Plus's allConversations() gives it, or this extension's own, each conversation once. */
function entries(list, sourceId = '', label = '') {
  const out = [], seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    const e = entryOf(c, sourceId, label);
    if (!e) continue;
    const key = e.sourceId + '\n' + e.sessionId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= MAX_LISTED) break;
  }
  return out;
}

/*
 * `on()` is true while claudeCodePlus.show.conversationLinks is in effect; `own()` resolves to this extension's Claude
 * Code conversations, for an Agent Plus without allConversations; `send(message)` posts to every panel; `open(target)`
 * runs agentPlus.openConversation; `openOwn(sessionId)` opens a Claude Code conversation when there is no Agent Plus to
 * ask. `every(fn, ms)` replaces setInterval, in tests.
 */
function create({ on, own, send, open, openOwn, log = () => {}, every = setInterval, pollMs = OWN_POLL_MS }) {
  let core = null, sub = null, list = [], key = '', rev = 0, closed = false, asking = null, poll = null, polling = false;
  const usesCore = () => !!(core && Array.isArray(core.features) && core.features.includes('allConversations')
    && typeof core.allConversations === 'function' && typeof core.onDidChangeAllConversations === 'function');
  const post = () => { try { send({ type: 'cce_conversations', rev, list }); } catch (e) { log(`conversation links: ${(e && e.message) || e}`); } };
  /* `force` sends the list even when it has not changed, for a panel that asked. */
  const take = (next, force) => {
    const k = JSON.stringify(next.map((e) => [e.sourceId, e.sessionId, e.title, e.cwd]));
    if (k !== key) { key = k; rev++; list = next; post(); return; }
    list = next;
    if (force) post();
  };
  const fromCore = (force) => {
    let got = [];
    try { got = core.allConversations(); } catch (e) { got = []; }
    take(entries(got), force);
  };
  const fromOwn = (force) => {
    if (asking) { if (force) asking.then(() => post()); return asking; }
    asking = Promise.resolve().then(() => own()).then((got) => { if (!closed && on() && !usesCore()) take(entries(got, OWN_SOURCE, OWN_LABEL), force); },
      (e) => log(`conversation links: ${(e && e.message) || e}`)).then(() => { asking = null; });
    return asking;
  };
  const unhook = () => {
    if (sub) { try { sub.dispose(); } catch (_) { /* gone */ } sub = null; }
    if (polling) { try { clearInterval(poll); } catch (_) { /* not a timer */ } poll = null; polling = false; }
  };
  const follow = () => {
    if (closed) return;
    if (!on()) { unhook(); return; }
    if (!usesCore() && !polling) {
      polling = true;
      poll = every(() => { if (!closed && on() && !usesCore()) fromOwn(false); }, pollMs);
      if (poll && typeof poll.unref === 'function') poll.unref();
    }
    if (usesCore()) {
      if (!sub) {
        try { sub = core.onDidChangeAllConversations(() => { if (!closed && on()) fromCore(false); }); } catch (e) { sub = null; log(`conversation links: ${(e && e.message) || e}`); }
      }
      fromCore(false);
    } else fromOwn(false);
  };
  return {
    /* The agentPlus interface once this extension is registered with it, or null. */
    attach(next) { unhook(); core = next || null; follow(); },
    /* The setting changed, or this extension's own conversations did. */
    refresh() { if (on() && !usesCore()) fromOwn(false); else follow(); },
    settingChanged() { follow(); },
    ask() {
      if (closed || !on()) return undefined;
      if (usesCore()) { if (!sub) follow(); fromCore(true); return undefined; }
      return fromOwn(true);
    },
    /* A link clicked in a panel. */
    async open(sourceId, sessionId) {
      if (typeof sourceId !== 'string' || typeof sessionId !== 'string' || !sessionId) return;
      const id = sessionId.toLowerCase();
      const c = list.find((e) => e.sourceId === sourceId && e.sessionId.toLowerCase() === id);
      const target = { sourceId, sessionId: c ? c.sessionId : sessionId, title: c ? c.title : '', cwd: c ? c.cwd : '' };
      if (core) { await open(target); return; }
      if (sourceId === OWN_SOURCE) await openOwn(target.sessionId);
    },
    list: () => list,
    rev: () => rev,
    dispose() { closed = true; unhook(); },
  };
}

module.exports = { create, entries, OWN_SOURCE, OWN_LABEL, MAX_LISTED, OWN_POLL_MS };
