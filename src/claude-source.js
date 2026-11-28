// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Claude Code as a conversation source of Agent Plus (xnervwang.agent-plus, protocol 1; its docs/protocol.md).
 *
 *   conversations    `claude agents --json` for the running ones (src/waiting.js), recent plans with open rows for the
 *                    stopped ones (src/conversations.js), states from the patched host (src/host.js); for Agent Plus's
 *                    notices, every running one on the machine (listAllConversations). Each carries `activity`
 *                    ('working', 'background', 'waiting' or 'stopped', src/activity.js), `unseen` (the host's mark of a
 *                    reply not read yet) and `lastUserAt` (the time, in milliseconds, of the user's last message to it,
 *                    if known). Agent Plus decides its notices from these three. `state` is still sent for Agent Plus
 *                    builds older than them. A waiting one also carries `waitingFor` (src/waiting-for.js)
 *   open             in this window, or in the window that shows the conversation (src/steward-view.js open)
 *   plans            <session id>.json in the companion plugin's data directory (src/workplan.js)
 *   focus            a change of the host's activeSessionId; a panel's onDidChangeViewState; sessionForTab(); and the
 *                    page getting focus (src/page/92-focus.js), the only signal a sidebar conversation gives
 *   answers          typed into the panel showing the conversation (src/page/91-answer.js)
 *   prefill          Agent Plus's pen on a Work plan row: the text goes into the message input of the panel showing the
 *                    conversation, opened in a tab here first if no panel shows it, and is not sent
 *   plan notice      the plugin that writes plans failed to install, or there is no Python 3 to run the hooks
 *
 * The host also writes activeSessionId back unchanged, for example when a background panel's state changes, so only a
 * change counts; otherwise the view would jump away from a Codex tab. Switching back to the same Claude Code tab from a
 * Codex tab leaves activeSessionId unchanged, which is why the panel's view state is followed too.
 */
const vscode = require('vscode');
const path = require('path');
const waiting = require('./waiting');
const conversations = require('./conversations');
const { SESSION } = require('./claude-files');
const { oncePerDelivery } = require('./core-link');
const { opensHere, heldBy } = require('./relay');
const titleMarks = require('./title-marks');
const waitingFor = require('./waiting-for');
const { FEATURES: LIST_FEATURES } = require('./claude-session-list');

/* The protocol major this source implements; package.json repeats it under "agentPlus". */
const PROTOCOL = 1;
const ID = 'claude-code';
const EXTENSION_ID = 'xnervwang.claude-code-plus';
const AGENTS_FRESH_MS = 30000;
/* Whether process `pid` still runs; a process this user may not signal (EPERM) counts as running. */
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } };
/* Shorter than Agent Plus's 20-second wait, after which it reports the answer as uncertain and drops a late
   "not received". */
const ANSWER_WAIT_MS = 15000;
/*
 * A panel whose page waits for a go (src/page/91-answer.js) is given ANSWER_READY_MS to say it is ready, and
 * ANSWER_GO_MS after that for its result. The message tells the page to wait ANSWER_GO_WAIT_MS for the go after it says
 * it is ready, and to press Enter within ANSWER_SEND_MS of saying so or take the text back out; it then waits up to
 * 800 ms for the input to empty. A panel out of sight, in a window in the background, gets its messages and runs its
 * timers a second or more late, so each of these leaves room for that, and ANSWER_SEND_MS is well inside ANSWER_GO_MS so
 * that the page's result arrives while the host still waits. No go is sent after ANSWER_READY_MS, so such a panel types
 * nothing once the host has reported.
 */
const ANSWER_READY_MS = 10000;
const ANSWER_GO_WAIT_MS = 6000;
const ANSWER_SEND_MS = 8000;
const ANSWER_GO_MS = 12000;

/*
 * The reasons the panel script (src/page/91-answer.js) gives for not sending. In each of these the answer is not in the
 * message input. Any other reason, such as 'error', maps to uncertain, since the input may still hold the answer.
 */
const NOT_RECEIVED = {
  'not-shown': 'the panel had switched to another conversation',
  'no-input': 'the panel has no message input',
  draft: 'the message input already had text in it',
  insert: 'the answer could not be typed into the message input',
  'left-in-input': 'Enter did not send it, so it was taken back out of the message input',
  late: 'the panel answered too late, so it dropped the text without typing it',
};
/* Earlier than the hand-over, for a transcript entry stamped a moment before this host read its clock. */
const SENT_SLACK_MS = 1000;

/*
 * A prefill settles within PREFILL_MS, inside the 10 seconds Agent Plus waits for one. The page answers a prefill with
 * 'ready' and types it on the host's go, as it does a confirmed answer; the go is sent only while PREFILL_READY_MS and
 * PREFILL_GO_MS are still left, so a panel that answers late types nothing. Whether a conversation that no panel here
 * shows may be opened here is decided within PREFILL_CHECK_MS. A panel that has the conversation but no message input
 * yet, such as a tab still loading, is asked again every PREFILL_RETRY_MS, and a tab opened for the prefill is checked
 * every PREFILL_ASK_MS until it listens.
 */
const PREFILL_MS = 9000;
const PREFILL_READY_MS = 1500;
const PREFILL_GO_MS = 1500;
const PREFILL_CHECK_MS = 4000;
const PREFILL_RETRY_MS = 250;
const PREFILL_ASK_MS = 100;
/* The page's reasons for not typing a prefill (src/page/91-answer.js). In each of these the input is as it was. */
const PREFILL_NOT_RECEIVED = {
  'not-shown': 'the panel had switched to another conversation',
  'no-input': 'the panel has no message input',
  insert: 'the text could not be typed into the message input',
  late: 'the panel answered too late, so it dropped the text without typing it',
};

function outcomeOf(sent, reason) {
  if (sent === true) return { outcome: 'submitted' };
  if (Object.prototype.hasOwnProperty.call(NOT_RECEIVED, reason)) return { outcome: 'notReceived', reason: NOT_RECEIVED[reason] };
  return { outcome: 'uncertain', reason: reason ? `the panel reported "${reason}"` : 'the panel gave no reason' };
}

/* What the page's answer to a prefill means for Agent Plus. 'unconfirmed': it typed the text, but afterwards the input
   did not hold the user's own text followed by the prefill. */
function prefillOutcomeOf(reason) {
  if (reason === 'drafted') return { outcome: 'drafted' };
  if (Object.prototype.hasOwnProperty.call(PREFILL_NOT_RECEIVED, reason)) return { outcome: 'notReceived', reason: PREFILL_NOT_RECEIVED[reason] };
  if (reason === 'unconfirmed') return { outcome: 'uncertain', reason: 'the text was typed into the message input, but what the input then held was not its earlier text followed by the new one' };
  return { outcome: 'uncertain', reason: reason ? `the panel reported "${reason}"` : 'the panel gave no reason' };
}

/* Same shape as vscode.Event. */
function emitter() {
  const listeners = new Set();
  return {
    event(listener, thisArgs, disposables) {
      const fn = (v) => listener.call(thisArgs, v);
      listeners.add(fn);
      const d = { dispose: () => { listeners.delete(fn); } };
      if (Array.isArray(disposables)) disposables.push(d);
      return d;
    },
    fire(v) {
      for (const fn of [...listeners]) { try { fn(v); } catch (_) { /* the other listeners still run */ } }
    },
    dispose() { listeners.clear(); },
  };
}

/* VS Code prefixes a webview panel's viewType (mainThreadWebview-...), so only the end is compared. */
const isPanelTab = (tab) => !!tab && tab.input instanceof vscode.TabInputWebview && String(tab.input.viewType).endsWith('claudeVSCodePanel');

/*
 * `deps`:
 *   planDir()                       the companion plugin's data directory
 *   enabled()                       claudeCodePlus.workPlan: off, no conversation has a plan
 *   listAgents()                    `claude agents --json`, as { records, error, at }, `at` when the list was read
 *                                   (when the call started if not given)
 *   readPlan(sessionId)             for titles taken from the plan, and for stopped conversations
 *   titles(s), since(s)             from waiting.reader()
 *   replyAt(s)                      optional, from waiting.reader(): when its last reply was written, in milliseconds
 *   live(), unread()                the host's latest states by session id; ids with an unread reply
 *   activity(sessionId)             optional: what it is doing (src/activity.js); 'stopped' when not given
 *   lastUserAt(sessionId)           optional: when the user last wrote to it, in milliseconds, or 0 when unknown
 *   activeChat()                    the host's activeSessionId, or ''
 *   canDeliver(sessionId)           whether a panel in this window shows it, in a tab or the sidebar
 *   waitingFor(sessionId)           optional: the request or dialog this window's panel last reported showing,
 *                                   { tool } or { dialog }, or null
 *   hand(sessionId, text, key, confirm)  gives the answer to the panel; its result comes back through answered().
 *                                   With `confirm` the panel says when it is ready and waits for go(key) to type it
 *   confirms(sessionId)             optional: whether the panel showing it waits for a go (src/page/91-answer.js)
 *   go(key)                         optional: tells the panel holding that answer to type it; false if none got it
 *   typedFor(text)                  optional: whether this extension typed that text into a panel for someone else in
 *                                   the last day (typedForOthers in src/relay.js)
 *   typed(text)                     optional: told of each text before it is handed to a panel, since that text was
 *                                   not typed by the person who sees the panel (noteTyped in src/relay.js)
 *   sentSince(sessionId, text, ms)  optional: Promise of 'sent', 'queued' or '' from the transcript (src/sent-check.js)
 *   log(line)                       optional
 *   reveal(sessionId)               Promise<boolean>
 *   shown()                         optional: ids of the conversations open in this window
 *   open(sessionId)                 optional: Promise of 'here', 'sent' or 'nowhere'
 *   logo()                          { light, dark } Uris, or null
 *   timeZone()                      the zone a panel reported, or ''
 *   isSteward(sessionId)            optional: whether the conversation is a supervisor, which gets the crown
 *   stewardsOf(sourceId, sessionId) optional: the supervisors that look after that conversation, as [{ sessionId, title }],
 *                                   ordered by when the user last typed to each, most recent first
 *   prefillTo(sessionId, text, key) optional, with go(): gives a prefill to the panel showing the conversation, which
 *                                   says when it is ready, through answered(), and types it on go(key); false if no
 *                                   panel was given it. Without both, 'prefill' is not among the features
 *   listens(sessionId)              optional: whether its panel here has reported that it listens (src/page/91-answer.js);
 *                                   canDeliver when not given
 *   openTab(sessionId)              optional: Promise; asks Claude Code to open the conversation in an editor tab here
 *   transcriptOf(sessionId)         optional: the path of its transcript, or ''
 *   elsewhere(sessionId)            optional: the names of the other VS Code windows that show it
 *   prefillTimes                    optional, for tests: { all, ready, go, check, retry, ask } in place of the PREFILL_ waits
 *   isBackground(id, cwd)           optional, for tests
 *   sessionList                     optional: the members for Agent Plus's session list (src/claude-session-list.js),
 *                                   which this source then has, with their features
 */
function createClaudeSource(deps) {
  const focused = emitter(), changed = emitter(), noticeChanged = emitter(), stewardsChanged = emitter();
  let stale = true, agentsAt = 0, agentsLast = { records: null, error: '' }, stoppedLast = new Map(), pidsAsk = null;
  let lastChat = null;
  /* The session id of the latest focus signal: Agent Plus asks isFocused() a moment after each one, and only the
     latest is still in front. It is cleared when another tab, such as a Codex one, becomes active after it. */
  let front = '';
  let frontTab;
  let notice = null;
  /* panel -> { sessionId, subs } */
  const panels = new Map();
  /* Panels gone in the last CLOSED_MS, as { title, column, sessionId, at }: VS Code can report a tab closed after its panel
     has gone, and the tab is then known only by its label and group. */
  const closedPanels = [];
  const CLOSED_MS = 10000;
  const unsubscribe = (subs) => { for (const d of subs) { try { d.dispose(); } catch (_) { /* already disposed */ } } };
  const pending = new Map();
  let keys = 0;
  const enabled = () => { try { return deps.enabled ? deps.enabled() !== false : true; } catch (_) { return true; } };
  const briefOn = () => { try { return deps.brief ? deps.brief() !== false : false; } catch (_) { return false; } };
  /* The last changes of `front` and what made each, for a test to read through focusState(). */
  const frontLog = [];
  const logFront = (why, value) => { frontLog.push([Date.now(), why, value]); if (frontLog.length > 50) frontLog.shift(); };
  const say = (sessionId, why = 'say') => { front = sessionId; logFront(why, sessionId); focused.fire({ sessionId }); };

  /* listConversations and freshAgents can each have a read of `claude agents` in flight, and the one that started
     earlier can return later with an older list. So a list read before the one held is dropped, and agentsAt records
     when the held list was read, so its age counts from then. A failed read from listConversations replaces the
     list, so that it reports the error; one from freshAgents keeps it. */
  const take = (started, r, keep) => {
    const at = r && Number.isFinite(r.at) ? r.at : started;
    if (r.records && agentsLast.records && at < agentsAt) return agentsLast;
    if (r.records || !keep) { agentsLast = r; agentsAt = at; }
    return r;
  };
  const read = (keep) => { const started = Date.now(); return deps.listAgents().then((r) => take(started, r, keep)); };
  const ask = () => read(false);
  const freshAgents = () => {
    if (agentsLast.records && Date.now() - agentsAt < AGENTS_FRESH_MS) return Promise.resolve(agentsLast);
    if (!pidsAsk) pidsAsk = read(true).finally(() => { pidsAsk = null; });
    return pidsAsk;
  };
  const activityOf = (id) => { try { return typeof deps.activity === 'function' ? deps.activity(id) || 'stopped' : 'stopped'; } catch (_) { return 'stopped'; } };
  const lastUserOf = (id) => { try { return typeof deps.lastUserAt === 'function' ? Number(deps.lastUserAt(id)) || 0 : 0; } catch (_) { return 0; } };
  const replyOf = (s) => { try { return typeof deps.replyAt === 'function' ? Number(deps.replyAt(s)) || 0 : 0; } catch (_) { return 0; } };
  const isSteward = (id) => { try { return typeof deps.isSteward === 'function' && deps.isSteward(id) === true; } catch (_) { return false; } };
  /* The panel here knows the tool; `claude agents` only the kind of wait. */
  const reasonOf = (s) => {
    let raw = null;
    try { raw = typeof deps.waitingFor === 'function' ? deps.waitingFor(s.sessionId) : null; } catch (_) { raw = null; }
    return waitingFor.fromPanel(raw) || waitingFor.fromAgents(s.waitingFor);
  };
  /* The title as every view shows it: without the marks an older build or a rename box left in the stored name, and
     with the crown first for a supervisor (src/title-marks.js). A view that draws the crown itself reads `steward`. */
  const listed = (s, on, live, unread) => {
    const steward = isSteward(s.sessionId);
    const out = {
      sessionId: s.sessionId,
      title: titleMarks.withMarks(conversations.claudeTitle(s, deps.titles(s), () => deps.readPlan(s.sessionId)), { steward }),
      cwd: s.cwd,
      state: on ? conversations.stateOf(s, live, unread) : 'idle',
      activity: on ? activityOf(s.sessionId) : 'stopped',
      unseen: !!(unread && unread.has(s.sessionId)),
      running: on,
      lastActiveAt: deps.since(s) || 0,
      hasPlan: false,
    };
    const at = lastUserOf(s.sessionId);
    if (at > 0) out.lastUserAt = at;
    const reply = replyOf(s);
    if (reply > 0) out.lastReplyAt = reply;
    if (steward) out.steward = true;
    if (out.activity === 'waiting') { const why = reasonOf(s); if (why) out.waitingFor = why; }
    return out;
  };

  const log = (line) => { try { if (deps.log) deps.log(line); } catch (_) { /* not logged */ } };
  /* Called when the panel kept the answer in its input or did not report, since it may have been sent anyway. */
  const recheck = async (sessionId, text, since, r) => {
    if (typeof deps.sentSince !== 'function') return r;
    let got = '';
    try { got = await deps.sentSince(sessionId, text, since - SENT_SLACK_MS); } catch (_) { got = ''; }
    if (got === 'sent') return { outcome: 'submitted' };
    if (got === 'queued') {
      return { outcome: 'uncertain', reason: 'the panel still showed it in the message input, but the conversation queued a message just then' };
    }
    return r;
  };
  const yes = (name, ...a) => { try { return typeof deps[name] === 'function' && deps[name](...a) === true; } catch (_) { return false; } };
  /* When the input still holds a text this extension typed there earlier, the refusal says so; the one asking would
     otherwise take it for the user's own draft. */
  const refused = (reason, detail) => {
    const r = outcomeOf(false, reason);
    if (reason === 'draft' && detail && yes('typedFor', detail)) {
      r.reason = 'the message input already had text in it, which Claude Code Plus typed into a panel for a supervisor or for Agent Plus in the last day; check whether the conversation received it, and the user can clear the input there';
    }
    return r;
  };
  const deliver = (sessionId, text) => {
    const key = 'cc-' + Date.now().toString(36) + '-' + (++keys);
    const since = Date.now();
    let handed = false;
    try { if (typeof deps.typed === 'function') deps.typed(text); } catch (_) { /* a supervisor's list check then lets it through */ }
    const confirm = yes('confirms', sessionId);
    try { handed = deps.hand(sessionId, text, key, confirm) === true; } catch (_) { handed = false; }
    if (!handed) return Promise.resolve({ outcome: 'notReceived', reason: 'no Claude Code panel in this window shows the conversation' });
    return new Promise((resolve) => {
      let went = false, timer = 0;
      const expire = () => {
        pending.delete(key);
        if (confirm && !went) {
          resolve({ outcome: 'notReceived', reason: `the panel showing it did not answer within ${ANSWER_READY_MS / 1000} seconds, as when its window has lost its connection, and it never types the text after that` });
          return;
        }
        resolve(recheck(sessionId, text, since, { outcome: 'uncertain', reason: went
          ? `the panel was told to type it but did not report back within ${ANSWER_GO_MS / 1000} seconds; it will not type it after this, so check the conversation's latest messages before sending it again`
          : `the panel did not report within ${ANSWER_WAIT_MS / 1000} seconds; check the conversation's latest messages before sending it again` }));
      };
      timer = setTimeout(expire, confirm ? ANSWER_READY_MS : ANSWER_WAIT_MS);
      const result = (sent, reason, detail) => {
        if (confirm && !went && !sent && reason === 'ready') {
          went = true;
          clearTimeout(timer);
          if (!yes('go', key)) { resolve({ outcome: 'notReceived', reason: 'the panel holding the text could not be reached, so it did not type it' }); return; }
          pending.set(key, result);
          timer = setTimeout(expire, ANSWER_GO_MS);
          return;
        }
        clearTimeout(timer);
        if (!sent && detail && reason !== 'draft') log(`answer to ${sessionId}: ${reason || 'not sent'} (${detail.slice(0, 300)})`);
        const r = sent ? outcomeOf(true, reason) : refused(reason, detail);
        resolve(!sent && reason === 'left-in-input' ? recheck(sessionId, text, since, r) : r);
      };
      pending.set(key, result);
    });
  };
  /* Agent Plus can hand over one answer twice under the same delivery id; it is typed once, even while the first try runs.
     An answer that never reached a panel can be handed over again (src/core-link.js). */
  const deliverOnce = oncePerDelivery(deliver);

  const prefills = typeof deps.prefillTo === 'function' && typeof deps.go === 'function';
  const times = () => Object.assign({ all: PREFILL_MS, ready: PREFILL_READY_MS, go: PREFILL_GO_MS, check: PREFILL_CHECK_MS,
    retry: PREFILL_RETRY_MS, ask: PREFILL_ASK_MS }, deps.prefillTimes || {});
  const notReceived = (reason) => ({ outcome: 'notReceived', reason });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  /* `p`'s value, or `late` once `ms` have passed without it; a rejection is { failed }. */
  const within = (p, ms, late) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(late), Math.max(0, ms));
    Promise.resolve().then(() => p()).then((v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); resolve({ failed: String((e && e.message) || e || 'it failed') }); });
  });
  /* The page's next answer for `key`, as { reason }, or null after `ms`. */
  const answerOf = (key, ms) => new Promise((resolve) => {
    const timer = setTimeout(() => { if (pending.get(key) === take) pending.delete(key); resolve(null); }, Math.max(0, ms));
    const take = (sent, reason) => { clearTimeout(timer); resolve({ reason }); };
    pending.set(key, take);
  });
  const shownHere = (id) => {
    try { return typeof deps.shown === 'function' && (deps.shown() || []).includes(id); } catch (_) { return false; }
  };
  const listens = (id) => (typeof deps.listens === 'function' ? yes('listens', id) : yes('canDeliver', id));
  /* Why Claude Code in this window must not open the conversation, which no panel here shows; '' when it may. It finds
     only conversations filed under this window's first folder, and opening one that another window or process runs
     would run it twice. */
  const whyNotHere = async (id) => {
    let file = '';
    try { file = typeof deps.transcriptOf === 'function' ? deps.transcriptOf(id) || '' : ''; } catch (_) { file = ''; }
    if (!file) return 'Claude Code has no transcript of it on this machine';
    if (!opensHere(id, deps.folders(), () => file)) {
      return 'it was started in a folder other than this window\'s first one, and Claude Code opens it only in a window with that folder first';
    }
    let where = [];
    try { where = typeof deps.elsewhere === 'function' ? deps.elsewhere(id) || [] : []; } catch (_) { where = []; }
    if (where.length) return `the VS Code window ${where.map((n) => `"${n}"`).join(', ')} shows it, and opening it here as well would run it twice`;
    const got = await freshAgents();
    if (!got || !Array.isArray(got.records)) return `this window could not tell whether another process runs it: ${(got && got.error) || '`claude agents --json` gave no list'}`;
    /* The list can be up to AGENTS_FRESH_MS old: a tab closed since then had a process that has ended. */
    const held = heldBy(got.records, id, typeof deps.alive === 'function' ? deps.alive : pidAlive);
    return held ? `${held}, and opening it here as well would run it twice` : '';
  };
  /*
   * Agent Plus's pen on a Work plan row (its docs/protocol.md, Writing about a row): the conversation comes to the
   * front in this window and `text` goes into its message input after whatever is there, unsent, with the focus in the
   * input. A panel here that shows it is brought to the front and given the text at once. A conversation that no panel
   * here shows is opened in an editor tab the way a supervisor's --resume opens one (src/relay.js), and the text waits
   * until that tab's page says it listens. The text is not noted as typed for someone else (deps.typed): the user sends
   * it, with words of their own.
   */
  const prefill = async (sessionId, text) => {
    const T = times(), by = Date.now() + T.all, handBy = by - T.ready - T.go;
    const id = typeof sessionId === 'string' ? sessionId : '';
    if (!SESSION.test(id)) return notReceived('it is not the id of a Claude Code conversation');
    if (typeof text !== 'string' || !text) return notReceived('there was no text to put in');
    if (yes('canDeliver', id)) {
      await within(() => deps.reveal(id), T.check, false);
    } else {
      if (typeof deps.openTab !== 'function') return notReceived('no Claude Code panel in this window shows the conversation');
      /* A tab of this window that holds it but has not loaded is opened like any other, without the checks. */
      if (!shownHere(id)) {
        const why = await within(() => whyNotHere(id), T.check, null);
        if (why === null) return notReceived(`this window could not tell within ${T.check / 1000} seconds whether another process runs it`);
        if (typeof why === 'object') return notReceived('this window could not tell whether another process runs it: ' + why.failed);
        if (why) return notReceived(why);
      }
      const opened = await within(() => deps.openTab(id), handBy - Date.now(), null);
      if (opened && typeof opened === 'object' && opened.failed) return notReceived('Claude Code could not open it: ' + opened.failed);
      while (!listens(id)) {
        if (Date.now() >= handBy) {
          return notReceived(shownHere(id) ? `its tab here opened, but the conversation had not loaded within ${Math.round(T.all / 1000)} seconds`
            : `Claude Code was asked to open it, but no panel here showed it within ${Math.round(T.all / 1000)} seconds`);
        }
        await pause(T.ask);
      }
    }
    for (;;) {
      const key = 'cc-pf-' + Date.now().toString(36) + '-' + (++keys);
      const ready = answerOf(key, by - T.go - Date.now());
      let handed = false;
      try { handed = deps.prefillTo(id, text, key) === true; } catch (_) { handed = false; }
      if (!handed) { pending.delete(key); return notReceived('no Claude Code panel in this window shows the conversation'); }
      const first = await ready;
      if (!first) {
        return notReceived(`the panel showing it did not answer within ${Math.round(T.all / 1000)} seconds, perhaps because its window lost its connection; nothing was typed, and the text will not be typed later`);
      }
      if (first.reason === 'ready') {
        const done = answerOf(key, by - Date.now());
        if (Date.now() > by - T.go || !yes('go', key)) {
          pending.delete(key);
          return notReceived('the panel was ready to type the text, but the go-ahead could not be sent to it in time');
        }
        const r = await done;
        if (!r) return { outcome: 'uncertain', reason: `the panel was told to type it but did not report back within ${T.go / 1000} seconds; look at its message input before writing again` };
        return prefillOutcomeOf(r.reason);
      }
      if (first.reason === 'no-input' && Date.now() + T.retry < handBy) { await pause(T.retry); continue; }
      return prefillOutcomeOf(first.reason);
    }
  };
  /* Never rejects, and settles within PREFILL_MS. Each outcome other than drafted is logged with its reason. */
  const prefillSafe = (sessionId, text) => Promise.resolve().then(() => prefill(sessionId, text))
    .catch((e) => ({ outcome: 'uncertain', reason: 'it failed here: ' + String((e && e.message) || e).slice(0, 160) }))
    .then((r) => {
      if (r.outcome !== 'drafted') log(`prefill for ${String(sessionId).slice(0, 36)}: ${r.outcome} (${r.reason || ''})`);
      return r;
    });

  const list = deps.sessionList && typeof deps.sessionList === 'object' ? deps.sessionList : null;
  const source = {
    protocol: PROTOCOL,
    /* 'brief': Agent Plus shows the conversation's brief when its row is clicked. 'shows': it asks shows(). 'stewards'
       and 'stewardList': it asks stewardOf() and stewardsOf(), for any agent's conversation. 'prefill': its Work plan
       view's rows get a pen that calls prefill(). */
    get features() {
      const on = enabled();
      return ['shows'].concat(on && briefOn() ? ['brief'] : [], on && typeof deps.stewardsOf === 'function' ? ['stewards', 'stewardList'] : [],
        prefills ? ['prefill'] : [], list ? LIST_FEATURES : []);
    },
    id: ID,
    label: 'Claude Code',
    extensionId: EXTENSION_ID,
    get logo() { try { return deps.logo(); } catch (_) { return null; } },
    planDir: () => deps.planDir(),
    planPath: (sessionId) => (enabled() && SESSION.test(String(sessionId || '')) ? path.join(deps.planDir(), sessionId + '.json') : null),
    onDidFocus: focused.event,
    onDidChangeConversations: changed.event,
    onDidChangePlanNotice: noticeChanged.event,
    onDidChangeStewards: stewardsChanged.event,

    /* Agent Plus asks these so that another agent's conversation is told which supervisor leads it and hands that one
       its messages: every supervisor of the conversation, its lead first and marked (`lead: true`, which a core with
       'stewardLead' keeps), and the lead alone, or null when it has none. */
    stewardsOf(sourceId, sessionId) {
      if (!enabled() || typeof deps.stewardsOf !== 'function') return [];
      let list = [];
      try { list = deps.stewardsOf(String(sourceId || ''), String(sessionId || '')) || []; } catch (_) { list = []; }
      const out = [];
      for (const x of Array.isArray(list) ? list : []) {
        const id = x && typeof x.sessionId === 'string' ? x.sessionId.toLowerCase() : '';
        if (!SESSION.test(id) || out.some((o) => o.sessionId === id)) continue;
        const e = { sourceId: ID, sessionId: id, title: typeof x.title === 'string' && x.title !== id ? x.title : '' };
        if (x.lead === true && !out.some((o) => o.lead)) e.lead = true;
        out.push(e);
      }
      return out.filter((o) => o.lead).concat(out.filter((o) => !o.lead));
    },
    stewardOf(sourceId, sessionId) {
      const lead = source.stewardsOf(sourceId, sessionId).find((o) => o.lead);
      return lead ? { sourceId: ID, sessionId: lead.sessionId } : null;
    },

    /* The session of the tab's panel; '' for a Claude Code tab with no conversation yet, or whose panel has not been
       reported yet; null for any other tab. A tab in front is the visible panel of its group. As a tab comes to the
       front, the panel it covers can still count as visible and active for a moment, so when panels of the group carry
       the tab's label as their title, only those are the tab's own. A tab behind another in its group has a panel that
       is not visible, which can only be one of the group's panels titled with the tab's label. */
    sessionForTab(tab) {
      if (!isPanelTab(tab)) return null;
      const column = tab.group && tab.group.viewColumn;
      const label = typeof tab.label === 'string' ? tab.label : '';
      /* Only a tab no longer in its group is matched to a panel gone by its label: one still open can carry the same
         label, as every new conversation's tab is labelled Claude Code. */
      const open = () => { try { return vscode.window.tabGroups.all.some((g) => g.tabs.includes(tab)); } catch (_) { return false; } };
      const closed = () => {
        if (!label || open()) return '';
        const now = Date.now();
        for (let i = closedPanels.length - 1; i >= 0; i--) {
          const g = closedPanels[i];
          if (now - g.at <= CLOSED_MS && g.title === label && (g.column === undefined || g.column === column)) return g.sessionId;
        }
        return '';
      };
      if (tab.isActive === false) {
        let own = '';
        for (const [panel, { sessionId }] of panels) {
          if (!sessionId || !label || panel.viewColumn !== column || panel.title !== label) continue;
          if (!own || !panel.visible) own = sessionId;
        }
        return own || closed();
      }
      const inGroup = [...panels].filter(([panel]) => panel.visible && panel.viewColumn === column);
      const named = label ? inGroup.filter(([panel]) => panel.title === label) : [];
      let best = '';
      for (const [panel, { sessionId }] of named.length ? named : inGroup) {
        if (!sessionId) continue;
        if (!best || panel.active) best = sessionId;
      }
      return best || closed();
    },

    isFocused(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId) return false;
      if (sessionId === front) return true;
      for (const [panel, entry] of panels) if (entry.sessionId === sessionId && panel.active) return true;
      return false;
    },

    async listConversations() {
      const fresh = stale || !agentsAt;
      stale = false;
      if (fresh) await ask();
      const { records, error } = agentsLast;
      const folders = deps.folders();
      const all = records ? waiting.merge(records) : new Map();
      const running = waiting.inFolders(all, folders, deps.isBackground ? { isBackground: deps.isBackground } : undefined);
      if (fresh) {
        stoppedLast = enabled() ? conversations.stoppedWithOpenRows(folders, new Set(all.keys()), { readPlan: deps.readPlan }) : new Map();
      }
      const live = deps.live(), unread = deps.unread();
      const out = [...running.values()].map((s) => listed(s, true, live, unread))
        .concat([...stoppedLast.values()].map((s) => listed(s, false, live, unread)));
      if (!records) out.problem = error;
      return out;
    },

    /*
     * Like listConversations, but for every folder: Agent Plus uses it for the notices it shows in every window. An
     * unread reply counts only for a conversation this window shows. The host rereads the shared unread set only when it
     * changes a mark itself or matches up its tabs, so its copy can still hold a conversation that another window shows
     * and the user has since read there.
     */
    async listAllConversations() {
      const { records, error } = await freshAgents();
      if (!records) { const none = []; none.problem = error; return none; }
      const all = waiting.foreground(waiting.merge(records), deps.isBackground ? { isBackground: deps.isBackground } : undefined);
      /* `claude agents` is read at most every half minute, and a conversation opened since is missing from it. Until
         then, a panel of this window that shows such a conversation stands in for it; that panel reports what the
         conversation waits for. */
      for (const [id] of deps.live()) {
        if (all.has(id) || !SESSION.test(String(id))) continue;
        let here = false;
        try { here = deps.canDeliver(id) === true; } catch (_) { here = false; }
        if (here) all.set(id, { sessionId: id, id: '', kind: '', cwd: (deps.folders() || [])[0] || '', name: '', waitingFor: '', busy: false, processes: 1 });
      }
      let mine = null;
      try { mine = typeof deps.shown === 'function' ? new Set(deps.shown()) : null; } catch (_) { mine = null; }
      const unread = new Set([...deps.unread()].filter((id) => !mine || mine.has(id)));
      const live = deps.live();
      return [...all.values()].map((s) => listed(s, true, live, unread));
    },

    reveal: (sessionId) => deps.reveal(sessionId),

    open(sessionId) {
      if (typeof deps.open !== 'function') return Promise.resolve('nowhere');
      return Promise.resolve().then(() => deps.open(sessionId))
        .then((r) => (r === 'here' || r === 'sent' ? r : 'nowhere'), () => 'nowhere');
    },

    canDeliver: (sessionId) => deps.canDeliver(sessionId) === true,

    /* A panel of this window holds the conversation, in a tab behind others or in the sidebar, where sessionForTab, which
       knows only the panels on screen, cannot see it. Agent Plus shows no notice of it in this window. */
    shows(sessionId) { try { return typeof sessionId === 'string' && !!sessionId && deps.canDeliver(sessionId) === true; } catch (_) { return false; } },

    deliverAnswer(sessionId, text, opts) { return deliverOnce(sessionId, text, opts); },

    prefill(sessionId, text) { return prefills ? prefillSafe(sessionId, text) : Promise.resolve(notReceived('this window cannot put text into a panel')); },

    planNotice: () => notice,
    timeZone: () => { try { return deps.timeZone ? deps.timeZone() || '' : ''; } catch (_) { return ''; } },
  };
  if (list) {
    Object.assign(source, {
      listSessions: (a) => list.listSessions(a),
      onDidChangeSessions: list.onDidChangeSessions,
      sessionActions: list.sessionActions,
      runSessionAction: (action, sessionIds, args) => list.runSessionAction(action, sessionIds, args),
      describeDeletion: (sessionIds) => list.describeDeletion(sessionIds),
      wantSessionDetail: (sessionIds) => list.wantSessionDetail(sessionIds),
      importSessions: (a) => list.importSessions(a),
      accountInfo: (a) => list.accountInfo(a),
      onDidChangeAccountInfo: list.onDidChangeAccountInfo,
      noteSeen: (sessionIds, seen) => list.noteSeen(sessionIds, seen),
      onDidCloseSession: list.onDidCloseSession,
      sessionsNotice: () => list.sessionsNotice(),
      onDidChangeSessionsNotice: list.onDidChangeSessionsNotice,
    });
  }
  /* Session id to what runs, from the newest `claude agents` list; worked out again only when that list changes. */
  let runningAt = -1, runningNow = new Map();

  return {
    source,
    invalidate() { stale = true; agentsAt = 0; },
    changed() { changed.fire(); if (list) list.changed(); },
    /*
     * For the session list's rows: { activity, waitingFor } of a conversation that some process has open, by the latest
     * `claude agents` list and what this window's panels report, or null for one that none has open. A conversation a panel
     * here shows that the list does not have yet counts as open.
     */
    stateOf(sessionId) {
      if (runningAt !== agentsAt) {
        runningNow = agentsLast.records ? waiting.merge(agentsLast.records) : new Map();
        runningAt = agentsAt;
      }
      const id = typeof sessionId === 'string' ? sessionId : '';
      let s = runningNow.get(id);
      if (!s) {
        if (!SESSION.test(id) || !yes('canDeliver', id)) return null;
        s = { sessionId: id, id: '', kind: '', cwd: '', name: '', waitingFor: '', busy: false, processes: 1 };
      }
      const out = { activity: activityOf(id) };
      if (out.activity === 'waiting') { const why = reasonOf(s); if (why) out.waitingFor = why; }
      return out;
    },
    stewardsChanged() { stewardsChanged.fire(); },
    /* `next` is { title, description, detail, command, arguments } or null. */
    setNotice(next) {
      const was = JSON.stringify(notice);
      notice = next || null;
      if (JSON.stringify(notice) !== was) noticeChanged.fire();
    },
    answered(key, sent, reason, detail) {
      const done = pending.get(key);
      if (!done) return;
      pending.delete(key);
      done(sent === true, typeof reason === 'string' ? reason : '', typeof detail === 'string' ? detail : '');
    },
    /* Returns whether the host's active session moved. The move is reported as focus only while the active tab is a
       Claude Code panel or there is none: the host keeps that id while another agent's tab is in front, as it is at
       start-up after a reload, and a sidebar panel getting focus reports itself (pageFocus). */
    followChat() {
      const id = deps.activeChat() || '';
      if (id === lastChat) return false;
      lastChat = id;
      if (!frontTab || isPanelTab(frontTab)) say(id, 'host');
      return true;
    },
    pageFocus(sessionId) {
      if (typeof sessionId === 'string' && sessionId) say(sessionId, 'page');
    },
    /* Called with the active tab whenever tabs change. Another agent's tab in front drops the focus signal; so does
       another Claude Code tab, whose own panel is then the one in front, or none until that panel is known. A sidebar
       panel taking the focus leaves the active tab as it was, so its signal stands. */
    tabsChanged(tab) {
      /* A panel's title changes with no event of its own, but its tab's label changing is one. The title is kept for
         when the panel has gone and can no longer be read (closedPanels). */
      for (const [panel, entry] of panels) { try { entry.title = panel.title; entry.column = panel.viewColumn; } catch (_) { /* gone */ } }
      if (tab === frontTab) return;
      frontTab = tab;
      if (!tab) return;
      front = isPanelTab(tab) ? source.sessionForTab(tab) || '' : '';
      logFront('tab', front);
    },
    /* What decides which conversation is in front: the focus signal, the active tab's label, the host's active session,
       each panel's conversation and whether it is active and visible, and the last changes of the signal. */
    focusState() {
      return { front, tab: frontTab ? frontTab.label : null, chat: lastChat,
        panels: [...panels].map(([panel, entry]) => [entry.sessionId, panel.active, panel.visible]), log: frontLog.slice(),
        seen: list && typeof list.seenLog === 'function' ? list.seenLog() : [] };
    },
    /* Fires onDidFocus again for the conversation in front; called once registration with Agent Plus completes, which
       can be after the first signal. */
    refocus() {
      if (front) focused.fire({ sessionId: front });
    },
    /* Called from the tab icon hook (src/host.js). When the active panel is first reported with a session id, or gets a new
       one as a new conversation does, that session is reported as the conversation in front. */
    track(panel, sessionId) {
      if (!panel || typeof panel !== 'object') return;
      const id = typeof sessionId === 'string' ? sessionId : '';
      /* Agent Plus's session list asks sessionForTab only when it reads the list again, and a panel can report its
         session after the read that opening its tab set off, so every change of a panel's session has the list read
         again. */
      const moved = () => { if (list) list.changed(); };
      const known = panels.get(panel);
      if (known) {
        if (known.sessionId === id) return;
        known.sessionId = id;
        if (id && panel.active) say(id, 'panel');
        moved();
        return;
      }
      const entry = { sessionId: id, subs: [] };
      panels.set(panel, entry);
      const seen = () => { try { entry.title = panel.title; entry.column = panel.viewColumn; } catch (_) { /* gone */ } };
      seen();
      const keep = (d) => { if (d && typeof d.dispose === 'function') entry.subs.push(d); };
      try {
        if (typeof panel.onDidChangeViewState === 'function') {
          keep(panel.onDidChangeViewState(() => {
            seen();
            if (panel.active && entry.sessionId) say(entry.sessionId, 'view');
          }));
        }
        if (typeof panel.onDidDispose === 'function') {
          keep(panel.onDidDispose(() => {
            let title = '', column;
            try { title = panel.title; column = panel.viewColumn; } catch (_) { /* read below from what was seen */ }
            title = typeof title === 'string' && title ? title : entry.title || '';
            if (column === undefined) column = entry.column;
            if (entry.sessionId && title) {
              closedPanels.push({ title, column, sessionId: entry.sessionId, at: Date.now() });
              if (closedPanels.length > 20) closedPanels.shift();
            }
            if (panels.get(panel) === entry) panels.delete(panel);
            unsubscribe(entry.subs);
          }));
        }
      } catch (_) { /* focus then comes from the other signals */ }
      if (id && panel.active) say(id, 'panel');
      if (id) moved();
    },
    /* The tab showing the conversation, or null when it is in the sidebar or not shown here. */
    panelFor(sessionId) {
      for (const [panel, entry] of panels) if (sessionId && entry.sessionId === sessionId) return panel;
      return null;
    },
    freshAgents,
    /* The newest `claude agents` list fetched, without fetching: { records (null if none yet), at: when it was read }. */
    agentsNow: () => ({ records: agentsLast.records, at: agentsAt }),
    dispose() {
      focused.dispose();
      changed.dispose();
      noticeChanged.dispose();
      for (const done of pending.values()) done(false, '');
      pending.clear();
      for (const { subs } of panels.values()) unsubscribe(subs);
      panels.clear();
    },
  };
}

module.exports = { createClaudeSource, isPanelTab, outcomeOf, prefillOutcomeOf, emitter, PROTOCOL, ID, EXTENSION_ID, ANSWER_WAIT_MS, ANSWER_READY_MS, ANSWER_GO_MS,
  ANSWER_GO_WAIT_MS, ANSWER_SEND_MS,
  PREFILL_MS };
