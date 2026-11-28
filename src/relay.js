// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Claude Code does not count a message from another session as the user's consent, but it does count text typed into
 * the conversation's input. A supervisor speaks for the user in the conversations it manages, so the plugin's
 * hooks/steward-relay.py leaves its message as a request in RELAY_DIR of the plan directory, and a window showing the
 * conversation types it into the input (src/page/91-answer.js).
 *
 * The same requests carry the supervisor's other actions on the conversations it manages: `rename` gives one a new title,
 * `close` closes its editor tab, and `open` starts a new conversation in the window that has the folder `to` open,
 * typing `text` as its first message. A conversation is only closed, never deleted.
 *
 * `resume` opens a stored conversation that no window shows, in an editor tab of the window whose first folder is the
 * one Claude Code files the conversation under (Claude Code looks for a window's conversations only there, src/
 * claude-files.js filedUnder), and then sends it `text` if there is any. `open` likewise goes to a window whose first
 * folder is `to`, since Claude Code starts a new conversation there. It is refused while a window shows the
 * conversation or a process runs it, so that it never runs twice. `handoff` goes the other way: a conversation hands
 * something it thinks belongs elsewhere to one of its supervisors (`from` is then the one asking, and `to` the supervisor it
 * named, or empty). A window showing that supervisor takes it and posts it, as a notice and never as the user's message,
 * to the supervisor's inbox; handOff says which supervisor that is when the conversation named none.
 *
 * Every message a supervisor sends starts with a line naming that supervisor (fromLine in src/stewards.js). A window that
 * sends one records it in SENDS_FILE, where steward-relay.py looks for another supervisor's recent message to the same
 * conversation before it sends.
 *
 * An `archive` request names Claude Code conversations in `ids`, the first of them also in `to`. deps.archive decides for
 * each whether it may be archived in Agent Plus's session list and says why not. As with the list actions below, the
 * request is carried out only when the user asked for it. No request deletes a conversation: only the user does that,
 * by hand, in the session list.
 *
 * `take`, `drop`, `all` and `new` change the asking supervisor's own list: they tick or untick one conversation, or turn
 * "All, including new ones" or "New conversations" on or off (`to` is the conversation, or "on" or "off"). Only the
 * user may ask for that, in the supervisor conversation itself: the window that shows the supervisor carries one out only
 * when the latest message before the tool call is one the user typed there (typedBefore). Messages from another
 * session, notices, handoffs, rows Claude Code wrote and texts Claude Code Plus typed into the panel for someone else
 * (TYPED_DIR) do not count.
 *
 * Any process can write a request file. A window carries one out only if the conversation is one the supervisor manages
 * (for `open`, `resume` and the list actions, only if the one asking is a supervisor; for `handoff`, only if a supervisor
 * manages the one asking), and the asker's own transcript has the tool call that ran steward-relay.py for it in the
 * last RAN_MS (ranBy), with the action's flag, and at most once per call. For an archive, that call names every
 * conversation in the request.
 *
 * Another agent's conversation takes only a plain send; its `to` is a key `<source id>:<session id>`
 * (src/steward-keys.js), and Agent Plus's deliver() passes the text on to the window that can type into it
 * (src/steward-core.js). The window
 * that shows the supervisor takes such a request, since it can read the supervisor's transcript for the tool call; the
 * deliver() it then awaits can take some 40 seconds, so take() goes on to the other requests meanwhile.
 *
 * A conversation a supervisor opened with `open` or `resume` is then ticked for it in stewards.json, as the user would
 * tick it in the Supervisor panel. The window that opened it does this, if that window may write the table (writesTable in
 * src/steward-view.js); a supervisor of all conversations gets the tick too, which would otherwise wait for the next pass
 * of the panel in its own window.
 *
 *   <plan dir>/relay/<id>.json          { id, steward, from, action, to, text, confirmed, at }   written by steward-relay.py
 *   <plan dir>/relay/<id>.taken-<pid>   the request, claimed by window <pid> with a rename
 *   <plan dir>/relay/<id>.result.json   { outcome, reason, sessionId, opened, ticked, window, steward, stewardTitle }
 *                                       read and removed by steward-relay.py
 *   <plan dir>/relay/sent.json          { "<asker> <to> <tool call id> <action>": <ms> }
 *   <plan dir>/relay/sends.json         { "<key>": [{ steward, title, at, text }] }, the last SENDS_KEEP_MS
 *   <plan dir>/typed/<hash>             the time Claude Code Plus typed a text with that hash (textHash in
 *                                       src/stewards.js) into a panel for someone else; kept TYPED_KEEP_MS
 */
const fs = require('fs');
const path = require('path');
const { SESSION, writeAtomic, filedUnder } = require('./claude-files');
const { realPath } = require('./folders');
const os = require('os');
const sentCheck = require('./sent-check');
const stewardTable = require('./stewards');
const keys = require('./steward-keys');
const { typedAt } = require('./activity');

const RELAY_DIR = 'relay';
const REQUEST = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;
/* Requests older than this are dropped; steward-relay.py stops waiting before then. */
const MAX_AGE_MS = 60000;
const RAN_MS = 5 * 60000;
/* Bytes read from the end of the supervisor's transcript to find that call. */
const TAIL_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 4000;
const MAX_TITLE = 200;
/* The flag each action is run with; a plain message has none. */
const FLAGS = { rename: '--rename', close: '--close', open: '--open', resume: '--resume', handoff: '--handoff',
  take: '--take', drop: '--drop', all: '--all', new: '--new', archive: '--archive' };
const ACTIONS = ['send', ...Object.keys(FLAGS)];
const LIST = ['take', 'drop', 'all', 'new'];
const USER_ONLY = [...LIST, 'archive'];
/* Agent Plus archives at most this many in one call (src/steward-core.js). */
const ARCHIVE_MAX = 50;
const SWITCHES = ['all', 'new'];
const CONFIRMED = '--confirmed';
const SENT_FILE = 'sent.json';
/* Claude Code writes a tool call to the transcript a moment after the command starts, and a window can read the
   script's request before that; so the transcript is read again after each of these waits before refusing. */
const RAN_WAITS_MS = [500, 1000, 2000, 3000];
const SENT_KEEP_MS = 24 * 3600000;
const SENDS_FILE = 'sends.json';
/* steward-relay.py looks back 30 minutes; the record keeps a little more. */
const SENDS_KEEP_MS = 60 * 60000;
const MAX_SENT_TEXT = 300;
const TYPED_DIR = 'typed';
const TYPED_KEEP_MS = 24 * 3600000;
const SCRIPT = 'steward-relay.py';
/* How long a resumed conversation's panel may take to show it, and then to have a message input that takes the text. */
const RESUME_SHOW_MS = 30000;
/* How long a long conversation may take to load once its tab is open. */
const RESUME_LOAD_MS = 180000;
const RESUME_SEND_MS = 20000;
/* How long steward-relay.py waits for a resume's answer, as RESUME_WAIT_SECONDS there. After that it tells the
   supervisor that the message will be typed once the conversation loads. */
const RESUME_SCRIPT_WAIT_MS = 110000;
/* How much of an unsent message the notice quotes. */
const MAX_LATE_TEXT = 600;
const RESUME_ASK_MS = 500;
const RESUME_RETRY_MS = 1000;

/*
 * The tool call in the asker's transcript that ran steward-relay.py for this request, as { id, at }, or null: the
 * supervisor's, or for a handoff that of the conversation handing off. It must be the asker's own, not a subagent's, at
 * most RAN_MS old, and its command must contain `to` (a session id; for `open`, the folder; for `take` and `drop`, what
 * the supervisor named), the text and each of `also`; the line that runs the script must carry the flag of `action` and none of the
 * others, with --confirmed when `confirmed` is set and, for a switch, the value right after the flag. A subagent's call
 * that would otherwise match sets found.sidechain. Claude Code writes a tool call to the transcript before running it,
 * so the call is already there while the script waits for an answer.
 */
function ranBy(file, to, text, now = Date.now(), action = 'send', confirmed = false, found = {}, also = []) {
  let tail = '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    const got = fs.readSync(fd, buf, 0, buf.length, from);
    tail = buf.toString('utf8', 0, got);
    if (from > 0) tail = tail.slice(tail.indexOf('\n') + 1);
  } catch (_) { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.indexOf('"tool_use"') === -1 || line.indexOf(SCRIPT) === -1) continue;
    let r;
    try { r = JSON.parse(line); } catch (_) { continue; }
    if (!r || r.type !== 'assistant' || !r.message || !Array.isArray(r.message.content)) continue;
    const at = Date.parse(r.timestamp);
    if (!(now - at <= RAN_MS) || at > now + 60000) continue;
    for (const b of r.message.content) {
      const c = b && b.type === 'tool_use' && b.input && typeof b.input.command === 'string' ? b.input.command.replace(/\r\n/g, '\n') : '';
      if (!c.includes(SCRIPT) || !c.toLowerCase().includes(to.toLowerCase()) || !c.includes(text)) continue;
      if (also.some((x) => !c.toLowerCase().includes(x))) continue;
      // Flags are read from the line that runs the script, not from the text after it.
      const line = c.slice(c.lastIndexOf('\n', c.indexOf(SCRIPT)) + 1).split('\n')[0];
      if (Object.entries(FLAGS).some(([a, flag]) => new RegExp(`(^|\\s)${flag}(\\s|$)`).test(line) !== (a === action))) continue;
      if (confirmed && !line.includes(CONFIRMED)) continue;
      if (SWITCHES.includes(action) && !new RegExp(`(^|\\s)${FLAGS[action]}\\s+${to}(\\s|$)`).test(line)) continue;
      if (r.isSidechain) { found.sidechain = true; continue; }
      return { id: String(b.id || r.uuid || ''), at };
    }
  }
  return null;
}

function readSent(dir, now) {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(path.join(dir, SENT_FILE), 'utf8')) || {}; } catch (_) { /* none yet */ }
  for (const [k, at] of Object.entries(d)) if (!(typeof at === 'number' && now - at < SENT_KEEP_MS)) delete d[k];
  return d;
}

/* A supervisor's recent messages to each conversation, for steward-relay.py, which holds back a message while another
   supervisor's is recent. */
function noteSend(dir, key, steward, title, text, now) {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(path.join(dir, SENDS_FILE), 'utf8')) || {}; } catch (_) { /* none yet */ }
  const out = {};
  for (const [k, list] of Object.entries(d && typeof d === 'object' ? d : {})) {
    const kept = (Array.isArray(list) ? list : []).filter((e) => e && typeof e.at === 'number' && now - e.at < SENDS_KEEP_MS);
    if (kept.length) out[k] = kept;
  }
  out[key] = (out[key] || []).concat([{ steward, title: title || '', at: now, text: String(text).slice(0, MAX_SENT_TEXT) }]);
  try { writeAtomic(path.join(dir, SENDS_FILE), JSON.stringify(out) + '\n'); } catch (_) { /* the next send is then not held back */ }
}

/*
 * Records each text that Claude Code Plus types into a Claude Code panel when the user of that panel did not write it,
 * so that a supervisor's list does not change for a message the user never typed (typedBefore). `planDir` is the plan
 * directory. Entries older than TYPED_KEEP_MS are removed now and then.
 */
let typedPruned = 0;
function noteTyped(planDir, text, now = Date.now()) {
  const dir = path.join(planDir, TYPED_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(path.join(dir, stewardTable.textHash(text)), String(now) + '\n');
  } catch (_) { return false; }
  if (now - typedPruned > 3600000) {
    typedPruned = now;
    try {
      for (const n of fs.readdirSync(dir)) {
        const f = path.join(dir, n);
        try { if (now - fs.statSync(f).mtimeMs > TYPED_KEEP_MS) fs.unlinkSync(f); } catch (_) { /* taken meanwhile */ }
      }
    } catch (_) { /* pruned next time */ }
  }
  return true;
}

function typedForOthers(planDir, text, now) {
  let at = 0;
  try { at = Number(fs.readFileSync(path.join(planDir, TYPED_DIR, stewardTable.textHash(text)), 'utf8')) || 0; } catch (_) { return false; }
  return now - at < TYPED_KEEP_MS;
}

/* Sends to other agents' conversations still waiting for deliver(). */
const inFlight = new Set();
/* The sent.json keys of the requests being carried out in this window, so that a second request from the same call is
   refused while the first is still being carried out. */
const carrying = new Set();
/* Resolves once those have their results, for tests. */
const settled = () => Promise.all([...inFlight]);

/*
 * Carries out the requests in `planDir` for conversations this window shows, the `open` requests for its first folder,
 * the `resume` requests for a conversation that Claude Code in this window can open (opensHere), and the `handoff`
 * requests to a supervisor it shows. deps: shownHere(id), folders() -> this window's folders, first first, stewards() ->
 * the supervisors table (src/stewards.js), transcriptOf(id), deliver(id, text), rename(id, title), close(id, confirmed),
 * open(folder, text) and resume(id, text) -> Promise<{ outcome, reason, sessionId, opened }> (open's sessionId is the
 * new conversation's, when known), manage(steward, id) to tick a conversation for the supervisor, which returns false when
 * this window may not, windows() -> the windows' entries { pid, name, folders, sessions }, agents() -> Promise<{
 * records, error }> from `claude agents --json`, records() -> the live session records and post(address, text) for a
 * handoff, deliverOther(key, text) -> Promise<{ outcome, reason }> for another agent's conversation, later(result),
 * called when such a send has its result, titleOf(id), pid, now(), and sleep(ms) for tests. Returns the results it
 * wrote; a send to another agent's conversation reports to later() instead.
 */
async function take(planDir, deps) {
  const dir = path.join(planDir, RELAY_DIR);
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const now = deps.now ? deps.now() : Date.now();
  const done = [];
  for (const name of names) {
    const m = REQUEST.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    let req;
    try { req = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { continue; }
    if (!req || typeof req.to !== 'string' || !(now - req.at < MAX_AGE_MS)) {
      if (req && now - req.at >= MAX_AGE_MS) { try { fs.unlinkSync(file); } catch (_) { /* taken meanwhile */ } }
      continue;
    }
    const action = req.action === undefined ? 'send' : req.action;
    const to = action === 'open' || LIST.includes(action) ? req.to : keys.managedId(req.to) || req.to.toLowerCase();
    if (!takesHere(action, to, deps, req)) continue;
    const taken = path.join(dir, `${m[1]}.taken-${deps.pid}`);
    try { fs.renameSync(file, taken); } catch (_) { continue; }
    const finish = (result) => {
      if (action === 'resume') result.window = deps.pid;
      try { writeAtomic(path.join(dir, m[1] + '.result.json'), JSON.stringify(result) + '\n'); } catch (_) { /* the script reports no answer */ }
      try { fs.unlinkSync(taken); } catch (_) { /* gone */ }
      return Object.assign({ id: m[1], action, to }, result);
    };
    if (keys.isOther(to)) {
      const p = carryOut(req, action, to, dir, deps, now)
        .catch((e) => ({ outcome: 'uncertain', reason: String((e && e.message) || e).slice(0, 200) }))
        .then((result) => { const r = finish(result); try { if (deps.later) deps.later(r); } catch (_) { /* not logged */ } });
      inFlight.add(p);
      p.then(() => inFlight.delete(p));
      continue;
    }
    const r = finish(await carryOut(req, action, to, dir, deps, now));
    if (action === 'resume') await tellLate(req, r, dir, deps);
    done.push(r);
  }
  return done;
}

function lateText(id, title, reason, text) {
  const words = String(text || '');
  return `${stewardTable.NOTICE_HEAD}, not a message from the user: the message you gave with --resume for `
    + `${title ? `"${title}" (${id})` : id} was not sent: ${reason}. Your command had stopped waiting for the answer by then. `
    + 'Send the message again; once a window shows the conversation, a plain send reaches it there. The message was:\n'
    + (words.length > MAX_LATE_TEXT ? words.slice(0, MAX_LATE_TEXT) + '...' : words);
}

/* Once its command has stopped waiting, the supervisor learns that the message was not sent only from this notice. */
async function tellLate(req, r, dir, deps) {
  const at = deps.now ? deps.now() : Date.now();
  if (!req.text || r.outcome === 'submitted' || r.outcome === 'refused' || !(at - req.at >= RESUME_SCRIPT_WAIT_MS)) return;
  const asker = String(req.steward || '').toLowerCase();
  if (!SESSION.test(asker)) return;
  const title = (deps.titleOf && deps.titleOf(r.to)) || '';
  const told = await postHandoff(asker, lateText(r.to, title, r.reason || r.outcome, req.text), deps);
  r.told = told.outcome === 'submitted';
  /* No command reads it now. */
  if (r.told) { try { fs.unlinkSync(path.join(dir, r.id + '.result.json')); } catch (_) { /* gone */ } }
}

/*
 * Whether Claude Code in a window with `folders` open finds the stored conversation `id`. It looks only in the
 * projects/ folder named after the window's first folder (after the home folder in a window with none), going by that
 * folder's path or by the path its symbolic links lead to.
 */
function opensHere(id, folders, find) {
  const file = find ? find(id) : '';
  if (!file) return false;
  const first = (folders || [])[0] || os.homedir();
  const dir = path.basename(path.dirname(file));
  return filedUnder(dir, first) || filedUnder(dir, realPath(first));
}

/* Whether this window's first folder is `folder`, through symbolic links on either side. */
const caseOf = process.platform === 'win32' || process.platform === 'darwin' ? (s) => s.toLowerCase() : (s) => s;
const firstFolderIs = (folders, folder) => !!(folders || [])[0] && caseOf(realPath(folders[0])) === caseOf(realPath(folder));

/* Whether this window is the one to carry out a request for `action` to `to`. */
function takesHere(action, to, deps, req) {
  if (action === 'open') return path.isAbsolute(to) && !!deps.folders && firstFolderIs(deps.folders(), to);
  if (action === 'handoff') {
    const theirs = stewardTable.stewardsOf(deps.stewards() || {}, String(req.from || '').toLowerCase());
    return to ? theirs.includes(to) && deps.shownHere(to) : theirs.some((s) => deps.shownHere(s));
  }
  if (USER_ONLY.includes(action)) return deps.shownHere(String(req.steward || '').toLowerCase());
  if (keys.isOther(to)) return deps.shownHere(String(req.steward || '').toLowerCase());
  if (!SESSION.test(to)) return false;
  if (action === 'resume') return !!deps.folders && opensHere(to, deps.folders(), deps.transcriptOf);
  return deps.shownHere(to);
}

/* Why a process other than a window's panel holds conversation `id`, from `claude agents --json`, or ''. A `claude --bg`
   job with no process of its own counts only while it is working or blocked on an answer: one done, stopped or failed
   holds nothing. `alive(pid)`, when given, drops a process that has ended since the list was read. */
function heldBy(records, id, alive) {
  for (const r of records || []) {
    if (!r || String(r.sessionId || '').toLowerCase() !== id) continue;
    const job = r.kind === 'background' ? `the claude --bg job ${r.id || '(no id)'}` : '';
    if (Number.isInteger(r.pid) && r.pid > 0 && (typeof alive !== 'function' || alive(r.pid))) return `process ${r.pid} runs it${job ? ` (${job})` : ''}`;
    if (job && (r.state === 'working' || r.state === 'blocked')) return `${job} holds it (${r.state})`;
  }
  return '';
}

/* A plain send's reach, said where a window already shows the conversation. */
const sendThere = (managed) => `a plain send reaches it there${managed ? '' : ' once the user ticks it for this supervisor in the Supervisor panel'}`;

/* Why conversation `id` must not be opened: a window shows it, or a process runs it. '' when neither. */
async function heldElsewhere(id, deps, managed) {
  const w = (deps.windows ? deps.windows() : []).find((x) => x && Array.isArray(x.sessions) && x.sessions.includes(id));
  if (w) return `the VS Code window "${w.name || 'untitled'}" (process ${w.pid}) already shows it; ${sendThere(managed)}`;
  let got;
  try { got = deps.agents ? await deps.agents() : null; } catch (e) { got = { records: null, error: (e && e.message) || String(e) }; }
  if (!got || !Array.isArray(got.records)) {
    return `it could not be checked that no other process runs it: ${(got && got.error) || '`claude agents --json` gave no list'}`;
  }
  const held = heldBy(got.records, id);
  return held ? `${held}, and opening it here as well would run it twice` : '';
}

/*
 * Opens a stored conversation in an editor tab of this window and, given `text`, sends the text once a panel of this
 * window shows the conversation. deps: open(id), shows(id) -> whether a panel here has the conversation and its page
 * takes answers, tabOpen(id) -> whether this window has a tab for it, loaded or still loading, deliver(id, text) -> a
 * send's result, giveUp(id) -> Promise<boolean>, which closes the tab of a conversation that did not load, and loadMs,
 * sleep(ms) and now() for tests. A tab must appear within RESUME_SHOW_MS; once it has, the conversation may take up to
 * RESUME_LOAD_MS to load. The result has opened: true while a tab of this window holds the conversation, even if the
 * text was not sent after that.
 */
async function resume(id, text, deps) {
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  try { await deps.open(id); } catch (e) { return { outcome: 'notReceived', reason: 'Claude Code could not open it: ' + ((e && e.message) || e) }; }
  const shownBy = now() + RESUME_SHOW_MS, loadedBy = now() + (deps.loadMs || RESUME_LOAD_MS);
  let tab = false;
  while (!deps.shows(id)) {
    if (!tab && deps.tabOpen && deps.tabOpen(id)) tab = true;
    if (now() >= (tab ? loadedBy : shownBy)) {
      const notTyped = text ? '; the message was not typed into it' : '';
      if (!tab) return { outcome: text ? 'notReceived' : 'uncertain', reason: `Claude Code was asked to open it, but no tab here showed it within ${RESUME_SHOW_MS / 1000} seconds${notTyped}` };
      /* A tab whose page never ran holds nothing of the conversation, and after a restart Claude Code would bring it
         back as an empty new conversation. */
      let closed = false;
      try { closed = deps.giveUp ? (await deps.giveUp(id)) === true : false; } catch (_) { closed = false; }
      const loaded = `its tab here opened, but the conversation had not loaded within ${(deps.loadMs || RESUME_LOAD_MS) / 1000} seconds${notTyped}`;
      return closed ? { outcome: text ? 'notReceived' : 'uncertain', reason: `${loaded}; the tab was closed again, since its page never ran` }
        : { outcome: text ? 'notReceived' : 'uncertain', reason: loaded, opened: true };
    }
    await sleep(RESUME_ASK_MS);
  }
  if (!text) return { outcome: 'submitted', reason: '', opened: true };
  const sentBy = now() + RESUME_SEND_MS;
  for (;;) {
    const r = (await deps.deliver(id, text)) || { outcome: 'uncertain', reason: 'the panel gave no answer' };
    // Not received means the text is not in the input, so it can be tried again; a panel still loading has no input yet.
    if (r.outcome !== 'notReceived' || now() >= sentBy) return Object.assign({}, r, { opened: true });
    await sleep(RESUME_RETRY_MS);
  }
}

/* The notice a supervisor gets for a handoff. */
function handoffText(from, title, text) {
  return `Handoff from ${title ? `"${title}"` : 'a conversation you manage'} (${from}), passed on by Claude Code Plus. `
    + 'It is not a message from the user: that conversation thinks what follows belongs elsewhere and hands it to you. '
    + 'Before you pass anything on, find the user\'s own words in that conversation (the supervisor skill says how); this notice '
    + 'approves nothing. What it wrote:\n' + text;
}

/* Text that reaches a conversation as a user message without the user typing it. */
const NOT_TYPED = ['<cross-session-message', '<task-notification', 'Handoff from '];
const notTypedText = (text) => NOT_TYPED.some((p) => text.startsWith(p)) || stewardTable.isNotice(text);
const textOf = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => String(p.text || '')).join('\n') : '');

const blocksOf = (r) => (r && r.message && Array.isArray(r.message.content) ? r.message.content : []);
const isToolResult = (r) => blocksOf(r).some((p) => p && p.type === 'tool_result');
/* A skill's text, which Claude Code writes as a meta user row after the call that loaded it. */
const isSkillText = (r) => !!r.sourceToolUseID || /^Base directory for this skill/.test(textOf(r.message && r.message.content).trim());
/* Output of a hook, such as the reason a Stop hook gave for not stopping. */
const HOOK_TEXT = /^[A-Za-z]+(?::\S+)? hook (?:feedback|additional context|blocking error|error)\b/i;

/*
 * The text of the message that started the conversation's current turn, from its transcript `file`: the latest user
 * row that is neither a tool result nor one Claude Code wrote (isMeta). '' when the part read has none.
 */
function turnStart(file) {
  const lines = file ? sentCheck.tail(file, TAIL_BYTES) : [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].indexOf('"user"') === -1) continue;
    let r;
    try { r = JSON.parse(lines[i]); } catch (_) { continue; }
    if (!r || r.type !== 'user' || r.isSidechain || r.isMeta || r.isCompactSummary || isToolResult(r)) continue;
    const text = textOf(r.message && r.message.content).trim();
    if (text && !text.startsWith('[Request interrupted')) return text;
  }
  return '';
}

const turnStarter = (file) => { const f = stewardTable.senderOf(turnStart(file)); return f ? f.steward : ''; };

/* Says why `text` (in transcript row `line`) does not count as typed by the user in this conversation; '' when it
   does. */
function notTyped(line, text, planDir, now) {
  if (stewardTable.isNotice(text)) return 'it is a supervisor notice from Claude Code Plus';
  if (text.startsWith('Handoff from ')) return 'it is a handoff from a managed conversation';
  if (text.startsWith('<cross-session-message')) return 'it is a message from another session';
  if (text.startsWith('<task-notification')) return 'it is a task notification';
  if (HOOK_TEXT.test(text)) return 'it is a hook\'s output';
  if (typedForOthers(planDir, text, now)) {
    return 'Claude Code Plus typed it into this conversation, as it does for an answer from Agent Plus\'s Answer view '
      + 'or a message from another agent\'s conversation';
  }
  if (!typedAt(line)) return 'it was not typed by the user: Claude Code marks it as coming from elsewhere';
  return '';
}

/*
 * '' if the user, typing in the conversation of transcript `file`, asked for the tool call `callId`; else the reason.
 * The message that counts is the latest one before the call: the row that started the turn, or a message queued while
 * it ran. A row Claude Code wrote right after the user's message, as for an attached image, belongs to that message; a
 * skill's text is part of the turn's work.
 */
function typedBefore(file, callId, planDir, now = Date.now()) {
  const lines = file ? sentCheck.tail(file, TAIL_BYTES) : [];
  const rows = lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } });
  let i = rows.length - 1;
  for (; i >= 0; i--) {
    const r = rows[i];
    if (r && r.type === 'assistant' && !r.isSidechain && blocksOf(r).some((b) => b && b.type === 'tool_use' && String(b.id) === callId)) break;
  }
  if (i < 0) return 'its call was not found in the supervisor conversation\'s transcript';
  for (let j = i - 1; j >= 0; j--) {
    const r = rows[j];
    if (!r || r.isSidechain) continue;
    if (r.type === 'system' && r.subtype === 'compact_boundary') break;
    if (r.type === 'attachment') {
      const a = r.attachment;
      if (a && a.type === 'queued_command') return notTyped(lines[j], textOf(a.prompt).trim(), planDir, now);
      continue;
    }
    if (r.type !== 'user' || isToolResult(r)) continue;
    if (r.isCompactSummary) break;
    const text = textOf(r.message && r.message.content).trim();
    if (r.isMeta) {
      if (isSkillText(r)) continue;
      let k = j - 1;
      while (k >= 0 && rows[k] && rows[k].type === 'attachment') k--;
      const before = k >= 0 ? rows[k] : null;
      if (before && before.type === 'user' && !before.isMeta && !before.isSidechain && !isToolResult(before)) { j = k + 1; continue; }
      return 'the turn was started by text Claude Code wrote';
    }
    if (!text || text.startsWith('[Request interrupted')) continue;
    return notTyped(lines[j], text, planDir, now);
  }
  return 'there is no message before it in the turn';
}

/* When the user last typed a message in the conversation of transcript `file`, also while a turn ran, or 0. */
function lastUserAt(file) {
  const lines = file ? sentCheck.tail(file) : [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].indexOf('"user"') === -1 && lines[i].indexOf('queued_command') === -1) continue;
    let d;
    try { d = JSON.parse(lines[i]); } catch (_) { continue; }
    if (!d || d.isSidechain || d.isMeta) continue;
    let text = '';
    if (d.type === 'user' && d.message) {
      const c = d.message.content;
      if (Array.isArray(c) && c.some((p) => p && p.type === 'tool_result')) continue;
      text = textOf(c);
    } else if (d.type === 'attachment' && d.attachment && d.attachment.type === 'queued_command') text = textOf(d.attachment.prompt);
    text = text.trim();
    if (!text || notTypedText(text)) continue;
    const at = Date.parse(d.timestamp);
    if (at > 0) return at;
  }
  return 0;
}

/* lastUserAt, read again only once the file's size or modification time changes. */
function lastUserCache() {
  const seen = new Map();
  return (file) => {
    if (!file) return 0;
    let st;
    try { st = fs.statSync(file); } catch (_) { return 0; }
    const k = st.size + ':' + st.mtimeMs, hit = seen.get(file);
    if (hit && hit.k === k) return hit.at;
    if (seen.size > 500) seen.clear();
    const at = lastUserAt(file);
    seen.set(file, { k, at });
    return at;
  };
}

/* Posts a handoff to supervisor `to`'s inbox socket, which its live session record names. */
async function postHandoff(to, text, deps) {
  let records = [];
  try { records = deps.records ? deps.records() || [] : []; } catch (_) { records = []; }
  const rec = records.find((r) => r && String(r.sessionId || '').toLowerCase() === to && typeof r.messagingSocketPath === 'string');
  if (!rec || !deps.post) return { outcome: 'notReceived', reason: 'the supervisor conversation\'s inbox was not found' };
  return await deps.post(rec.messagingSocketPath, text) ? { outcome: 'submitted', reason: '' }
    : { outcome: 'notReceived', reason: 'the supervisor conversation\'s inbox did not take it' };
}

/* The request's text for `action`, or a reason to refuse it. A title is one line. */
function textFor(action, raw) {
  const text = String(raw || '').trim();
  if (action === 'close') return text ? { why: 'closing takes no text' } : { text };
  if (action === 'resume' && !text) return { text };
  if (action === 'rename') {
    const title = text.replace(/\s+/g, ' ');
    return title && title.length <= MAX_TITLE ? { text: title } : { why: `there is no title, or it is longer than ${MAX_TITLE} characters` };
  }
  return text && text.length <= MAX_TEXT ? { text } : { why: `there is no text, or it is longer than ${MAX_TEXT} characters` };
}

const { manages } = stewardTable;

async function carryOut(req, action, to, dir, deps, now) {
  if (!ACTIONS.includes(action)) return { outcome: 'refused', reason: `there is no action "${action}"` };
  const handoff = action === 'handoff';
  const asker = String((handoff ? req.from : req.steward) || '').toLowerCase();
  if (!SESSION.test(asker)) {
    return { outcome: 'refused', reason: `the request does not say which ${handoff ? 'conversation' : 'supervisor'} sent it` };
  }
  const table = deps.stewards() || {}, t = table[asker];
  const theirs = handoff ? stewardTable.stewardsOf(table, asker) : [];
  const listing = LIST.includes(action), archiving = action === 'archive';
  const ids = archiving && Array.isArray(req.ids) ? [...new Set(req.ids.map((x) => String(x).toLowerCase()))] : [];
  if (handoff) {
    if (!theirs.length) return { outcome: 'refused', reason: 'no supervisor manages the conversation asking' };
    if (to && !theirs.includes(to)) return { outcome: 'refused', reason: `${to} is not a supervisor of the conversation asking` };
  } else if (action === 'open' || action === 'resume') {
    if (!t) return { outcome: 'refused', reason: 'the one asking is not a supervisor' };
  } else if (archiving) {
    if (!t) return { outcome: 'refused', reason: 'the one asking is not a supervisor' };
    if (!ids.length || ids.some((x) => !SESSION.test(x)) || ids[0] !== to) return { outcome: 'refused', reason: 'the request names no Claude Code conversations' };
    if (ids.length > ARCHIVE_MAX) return { outcome: 'refused', reason: `it names ${ids.length} conversations; at most ${ARCHIVE_MAX} go in one request` };
  } else if (listing) {
    if (!t) {
      return { outcome: 'refused', reason: stewardTable.stewardsOf(table, asker).length
        ? 'a supervisor manages this conversation, so it cannot have a list of its own this way; the user ticks conversations for it in the Supervisor panel'
        : 'the one asking is not a supervisor; ticking conversations for it in the Supervisor panel makes it one' };
    }
    if (SWITCHES.includes(action) && to !== 'on' && to !== 'off') return { outcome: 'refused', reason: `${FLAGS[action]} takes on or off` };
    if (!SWITCHES.includes(action) && !String(to || '').trim()) return { outcome: 'refused', reason: 'no conversation was named' };
  } else if (!manages(table, asker, to)) {
    return { outcome: 'refused', reason: 'that conversation is not one this supervisor manages' };
  }
  if (keys.isOther(to)) {
    const label = keys.labelOf(to);
    if (!keys.allowed(to)) return { outcome: 'refused', reason: `a supervisor cannot send to ${label} conversations` };
    if (action !== 'send') {
      return { outcome: 'refused', reason: `${label} conversations take only a plain message; the user renames, closes or reopens one in ${label}` };
    }
  }
  const { text, why } = listing || archiving ? { text: '' } : textFor(action, req.text);
  if (why) return { outcome: 'refused', reason: why };
  const confirmed = action === 'close' && req.confirmed === true;
  const file = deps.transcriptOf(asker);
  const seen = {};
  const needle = action === 'rename' ? String(req.text || '').trim() : text;
  let call = file ? ranBy(file, to, needle, now, action, confirmed, seen, ids) : null;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; file && !call && i < RAN_WAITS_MS.length; i++) {
    await sleep(RAN_WAITS_MS[i]);
    call = ranBy(file, to, needle, deps.now ? deps.now() : Date.now(), action, confirmed, seen, ids);
  }
  if (!call && (listing || archiving) && seen.sidechain) {
    return { outcome: 'refused', reason: archiving ? 'a subagent ran it; only the supervisor conversation itself, at the user\'s request, archives conversations'
      : 'a subagent ran it; only the supervisor conversation itself, at the user\'s request, changes its list' };
  }
  if (!call) {
    const what = action === 'open' ? ' for that folder' : handoff || SWITCHES.includes(action) ? '' : ' for that conversation';
    return { outcome: 'refused', reason: `the ${handoff ? 'conversation asking' : 'supervisor conversation'} has not run `
      + `${SCRIPT}${FLAGS[action] ? ' ' + FLAGS[action] : ''}${SWITCHES.includes(action) ? ' ' + to : ''}${what}${text ? ' with this text' : ''} `
      + 'in its command in the last 5 minutes; put the text in a here-document inside that command' };
  }
  if (listing || archiving) {
    const not = typedBefore(file, call.id, path.dirname(dir), deps.now ? deps.now() : Date.now());
    if (not) {
      return { outcome: 'refused', reason: archiving
        ? `conversations are archived only when the user asks for it, typing in this supervisor conversation. The message before the call does not count: ${not}`
        : `only the user, typing in this supervisor conversation, can change its list. The message before the call does not count: ${not}` };
    }
  }
  const key = [asker, to, call.id, action].join(' ');
  if (readSent(dir, now)[key] || carrying.has(key)) return { outcome: 'refused', reason: 'that call has already been carried out' };
  carrying.add(key);
  let r;
  try {
    if (action === 'resume') {
      const held = await heldElsewhere(to, deps, manages(table, asker, to));
      if (held) return { outcome: 'refused', reason: held };
    }
    const missing = { outcome: 'notReceived', reason: 'this window cannot do that' };
    const title = (deps.titleOf && deps.titleOf(asker)) || '';
    const signed = text && (action === 'send' || action === 'resume' || action === 'open') ? stewardTable.withFrom(asker, title, text) : text;
    r = action === 'send' && keys.isOther(to) ? (deps.deliverOther ? await deps.deliverOther(to, signed) : missing)
      : action === 'send' ? await deps.deliver(to, signed)
      : action === 'rename' ? (deps.rename ? await deps.rename(to, text) : missing)
        : action === 'close' ? (deps.close ? await deps.close(to, confirmed) : missing)
          : action === 'resume' ? (deps.resume ? await deps.resume(to, signed) : missing)
            : handoff ? await handOff(theirs, asker, text, table, deps, to)
              : listing ? (deps.list ? await deps.list(asker, action, to) : missing)
                : archiving ? (deps.archive ? await deps.archive(asker, ids) : missing)
                : (deps.open ? await deps.open(to, signed) : missing);
    if (r && r.outcome === 'submitted' && text && (action === 'send' || action === 'resume')) noteSend(dir, to, asker, title, text, now);
  } finally { carrying.delete(key); }
  if (r && (r.outcome === 'submitted' || r.opened === true)) {
    // Read again: sends to other agents run alongside this one and may have recorded theirs meanwhile.
    const sent = readSent(dir, now);
    sent[key] = now;
    try { writeAtomic(path.join(dir, SENT_FILE), JSON.stringify(sent) + '\n'); } catch (_) { /* a repeat is then not caught */ }
  }
  /* A conversation the supervisor has just opened, new or stored, is ticked for it as the user would tick it in the
     Supervisor panel; a resumed one once it is open, also when its text was then not sent. */
  const opened = action === 'open' ? (r && r.outcome === 'submitted' && typeof r.sessionId === 'string' && SESSION.test(r.sessionId) ? r.sessionId.toLowerCase() : '')
    : action === 'resume' && r && r.opened === true ? to : '';
  let ticked = false;
  if (opened && deps.manage) {
    try { ticked = deps.manage(asker, opened) !== false; } catch (_) { /* the user ticks it in the panel */ }
  }
  const out = { outcome: (r && r.outcome) || 'uncertain', reason: (r && r.reason) || '' };
  if (r && typeof r.sessionId === 'string' && r.sessionId) out.sessionId = r.sessionId;
  if (r && r.opened === true) out.opened = true;
  if (ticked) out.ticked = true;
  if (r && Array.isArray(r.results)) out.results = r.results;
  if (r && typeof r.steward === 'string' && r.steward) { out.steward = r.steward; out.stewardTitle = r.stewardTitle || ''; }
  return out;
}

/* Gives a handoff to one of `stewards`. When the conversation named one (`to`), only that one is tried. Otherwise the
   one whose message started the conversation's current turn goes first, then the others from the one the user typed
   to most recently; the first that can be reached takes it. */
async function handOff(stewards, from, text, table, deps, to = '') {
  let order = to ? [to] : stewardTable.byUser(stewards, (s) => lastUserAt(deps.transcriptOf(s)));
  const starter = to ? '' : turnStarter(deps.transcriptOf(from));
  if (starter && order.includes(starter)) order = [starter].concat(order.filter((s) => s !== starter));
  const missed = [];
  for (const s of order) {
    const title = (table[s].names && table[s].names[from]) || (deps.titleOf && deps.titleOf(from)) || '';
    const r = await postHandoff(s, handoffText(from, title, text), deps);
    if (r.outcome === 'submitted') return { outcome: 'submitted', reason: '', steward: s, stewardTitle: (deps.titleOf && deps.titleOf(s)) || '' };
    missed.push(`${s}: ${r.reason}`);
  }
  return { outcome: 'notReceived', reason: `no supervisor of this conversation could be reached (${missed.join('; ')})` };
}

module.exports = { take, settled, ranBy, resume, heldBy, opensHere, handoffText, lastUserAt, lastUserCache, turnStart, turnStarter,
  typedBefore, noteTyped, typedForOthers, RELAY_DIR, MAX_AGE_MS, RAN_MS, RAN_WAITS_MS, SENT_FILE, SENDS_FILE, SENDS_KEEP_MS, TYPED_DIR,
  TYPED_KEEP_MS, FLAGS, LIST, USER_ONLY, ARCHIVE_MAX, RESUME_LOAD_MS, MAX_TITLE, RESUME_SHOW_MS, RESUME_SEND_MS, RESUME_SCRIPT_WAIT_MS, lateText, tellLate };
