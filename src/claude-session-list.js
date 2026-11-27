// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The rows Agent Plus's session list shows for Claude Code (its protocol, Session list): the members the Claude Code
 * source adds when the core has the list.
 *
 * The rows come from the transcripts Claude Code files for this window's first folder, the only folder whose
 * conversations Claude Code opens in this window. Each transcript is read at its head (when it started, its first
 * prompt, its kind) and its tail (its titles, its last message and the last reply, its branch), and read again only
 * when its size or modification time changes. The time of its last message is what the list sorts by: the file's
 * modification time is moved forward to keep conversations from Claude Code's own cleanup (src/sessionpins.js).
 *
 * Everything that reaches outside goes through `deps` (listed at create()), so the module can be checked against
 * made-up transcripts.
 */
const fs = require('fs');
const path = require('path');
const { projectFolders, projectsDir, filedUnder, SESSION } = require('./claude-files');
const bgSessions = require('./bgsessions');
const titleMarks = require('./title-marks');
const { withoutFrom } = require('./stewards');

const HEAD_BYTES = 65536;
const TAIL_BYTES = 256 * 1024;
/* A tail holding no whole message, as when the last records are long tool results, is read again at this size. */
const LONG_TAIL_BYTES = 4 << 20;
const MAX_PROMPT = 200;
const MAX_TITLE = 500;
const PAGE = 500;
/* Changes from the watched folders and from the source are collected for this long, then the core is told once. */
const SETTLE_MS = 400;
/* How long the first page waits for a fresh list of the conversations that run; a page settles within 10 seconds. */
const READY_MS = 3000;

const timeOf = (rec) => { const t = rec && Date.parse(rec.timestamp); return t > 0 ? t : 0; };
const isMessage = (rec) => !!rec && (rec.type === 'user' || rec.type === 'assistant') && rec.isSidechain !== true && !rec.isMeta;
const textOf = (rec) => {
  const c = rec && rec.message && rec.message.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ') : '';
};
/* A message the user wrote: not a tool's result, which Claude Code also files as a user record. */
const isTyped = (rec) => isMessage(rec) && rec.type === 'user' && rec.toolUseResult === undefined && !!textOf(rec).trim();
/* The text of a user record's message, for a conversation with no title yet. */
/* Why the section has no figures: Claude Code reports them for a conversation that runs in this window. */
const NO_FIGURES = 'The cost, time and code changes are shown for a Claude Code conversation that runs in this window.';
const NOT_YET = 'Claude Code reports the cost, time and code changes of a conversation once it has had a turn in this window.';
function promptOf(rec) {
  const line = withoutFrom(String(textOf(rec) || '')).replace(/<[^>]+>[^<]*<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length > MAX_PROMPT ? line.slice(0, MAX_PROMPT - 1) + '\u2026' : line;
}
const parse = (l) => { try { return JSON.parse(l); } catch (_) { return null; } };

/* What the list shows of one transcript. The head gives when it started and the first prompt; the tail gives its
   titles, which Claude Code writes again every turn, its last message, the user's last message and the agent's last
   reply. */
function summarize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const read = (at, len) => { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, at); return b.toString('utf8', 0, n); };
    const out = { createdAt: 0, lastActiveAt: 0, lastReplyAt: 0, lastUserAt: 0, firstPrompt: '', custom: '', ai: '', branch: '', cwd: '', messages: false };
    const headLen = Math.min(size, HEAD_BYTES);
    const head = read(0, headLen).split('\n');
    if (headLen < size) head.pop();
    for (const l of head) {
      if (!l || l[0] !== '{') continue;
      if (out.createdAt && out.cwd && out.firstPrompt) break;
      const r = parse(l);
      if (!r) continue;
      if (!out.createdAt) out.createdAt = timeOf(r);
      if (!out.cwd && typeof r.cwd === 'string' && r.cwd) out.cwd = r.cwd;
      if (isMessage(r)) out.messages = true;
      if (!out.firstPrompt && isTyped(r)) out.firstPrompt = promptOf(r);
    }
    const scan = (len) => {
      const lines = read(size - len, len).split('\n');
      if (len < size) lines.shift();
      let last = false;
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (!l || l[0] !== '{') continue;
        if (!out.custom && l.includes('"type":"custom-title"')) { const r = parse(l); if (r && typeof r.customTitle === 'string') out.custom = r.customTitle.trim(); continue; }
        if (!out.ai && l.includes('"type":"ai-title"')) { const r = parse(l); if (r && typeof r.aiTitle === 'string') out.ai = r.aiTitle.trim(); continue; }
        const user = l.includes('"type":"user"'), agent = l.includes('"type":"assistant"');
        if (!user && !agent) continue;
        if (last && out.lastReplyAt && out.lastUserAt) continue;
        if (agent && last && out.lastReplyAt) continue;
        if (user && last && (out.lastUserAt || !l.includes('"text"') && !/"content":"/.test(l))) continue;
        const r = parse(l);
        if (!isMessage(r)) continue;
        out.messages = true;
        const t = timeOf(r);
        if (!last) {
          last = true;
          out.lastActiveAt = t;
          if (typeof r.gitBranch === 'string' && r.gitBranch) out.branch = r.gitBranch;
          if (typeof r.cwd === 'string' && r.cwd) out.cwd = r.cwd;
        }
        if (r.type === 'assistant' && !out.lastReplyAt) out.lastReplyAt = t;
        if (!out.lastUserAt && isTyped(r)) out.lastUserAt = t;
      }
      return last;
    };
    if (!scan(Math.min(size, TAIL_BYTES)) && size > TAIL_BYTES) scan(Math.min(size, LONG_TAIL_BYTES));
    return out;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

/* The kind the list gives a session, from the kind Claude Code records for it; null for one the list leaves out. */
function kindFor(claudeKind) {
  if (claudeKind === 'daemon' || claudeKind === 'daemon-worker') return null;
  if (claudeKind === 'bg' || claudeKind === 'sdk') return 'background';
  if (claudeKind === 'empty') return 'empty';
  return 'user';
}

/* The worktree's name when `cwd` is one of Claude Code's worktrees of `folder`. */
function worktreeOf(cwd, folder) {
  const m = /[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)[/\\]?$/.exec(String(cwd || ''));
  return m && path.resolve(cwd, '..', '..', '..') === path.resolve(folder) ? m[1] : '';
}

/* Whether Claude Code files the conversations of `folder`, or of one of its worktrees, in the project folder named
   `dir`. A folder whose name is too long for Claude Code's naming gets a hash, and its worktrees are not matched. */
function projectOf(dir, folder) {
  if (filedUnder(dir, folder)) return true;
  const fold = process.platform === 'win32' || process.platform === 'darwin' ? (t) => t.toLowerCase() : (t) => t;
  const name = fold(String(folder || '').replace(/[^a-zA-Z0-9]/g, '-'));
  return !!name && name.length <= 200 && fold(String(dir || '')).startsWith(name + '--claude-worktrees-');
}

/*
 * `deps`:
 *   projects()                    Claude Code's projects folder
 *   started()                     optional: called once, when the list first asks for this window's conversations
 *   ready()                       optional: Promise, settled once the states below are fresh
 *   state(sessionId)              { activity, waitingFor } of a conversation that runs, or null for one that does not
 *   lastUserAt(file)              optional: when the user last wrote in transcript `file`, answers on a question card and
 *                                 messages typed while a turn ran included (src/activity.js), or 0
 *   elsewhere()                   Map of session id to { elsewhere, processes } (src/claude-elsewhere.js)
 *   isSteward(sessionId)
 *   open(sessionId, where)        Promise; opens it in a tab or the sidebar of this window
 *   create(where)                 Promise<session id or ''>
 *   rename(sessionId, title)      Promise<{ outcome, reason }>
 *   remove(sessionIds)            Promise<[{ sessionId, outcome, reason }]>
 *   describe(sessionIds)          Promise<[{ sessionId, what }]>
 *   officialLists()               { archived, groups } from Claude Code, or null while it cannot be read
 *   pinned(), colors()            this extension's pins and title colours
 *   setUnread(sessionId, on)      Claude Code's own unread mark
 *   unseen(sessionId)             optional: whether Claude Code holds that mark now
 *   totals(sessionId)             the Account & usage rows of a conversation running here (src/session-totals.js)
 *   front()                       the session id in front in this window, or ''
 *   titleOf(sessionId)            its title, for the Account & usage section
 *   notice()                      the note to show above the list, { text, actions }, or null
 */
function create(deps) {
  const seenLog = [];
  const cache = new Map();
  const listeners = new Set(), accountListeners = new Set(), closeListeners = new Set(), noticeListeners = new Set();
  let timer = null, started = false;
  const fire = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; for (const l of [...listeners]) { try { l(); } catch (_) { /* the listener's own */ } } }, SETTLE_MS);
    if (timer.unref) timer.unref();
  };
  /* vscode.Event's shape. */
  const event = (set) => (listener, thisArgs, disposables) => {
    const fn = (v) => listener.call(thisArgs, v);
    set.add(fn);
    const d = { dispose: () => { set.delete(fn); } };
    if (Array.isArray(disposables)) disposables.push(d);
    return d;
  };
  const call = async (fn, ...a) => { try { return await fn(...a); } catch (e) { return { error: (e && e.message) || String(e) }; } };
  const safe = (fn, fallback, ...a) => { try { return fn ? fn(...a) : fallback; } catch (_) { return fallback; } };

  /* The transcripts of `folder` and its worktrees, by session id. */
  const transcripts = (folder) => {
    const out = new Map();
    const projects = deps.projects ? deps.projects() : projectsDir();
    for (const dir of projectFolders(projects) || []) {
      if (!projectOf(path.basename(dir), folder)) continue;
      let names = [];
      try { names = fs.readdirSync(dir); } catch (_) { continue; }
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        const id = n.slice(0, -6);
        if (SESSION.test(id) && !out.has(id)) out.set(id, path.join(dir, n));
      }
    }
    return out;
  };
  /* The summary and kind of one transcript, read again only when the file changed. A kind is kept once Claude Code's
     record of it is whole (src/bgsessions.js): it does not change. */
  const read = (id, file) => {
    let st;
    try { st = fs.statSync(file); } catch (_) { return null; }
    const key = st.size + ':' + st.mtimeMs, hit = cache.get(id);
    if (hit && hit.key === key) return hit;
    const sum = summarize(file);
    if (!sum) return null;
    let kind = hit && hit.sure ? hit.kind : bgSessions.kindOf(file);
    const sure = kind !== null && kind !== 'empty';
    if (kind === null) kind = sum.messages ? '' : 'empty';
    const entry = { key, sum, kind, sure };
    cache.delete(id);
    cache.set(id, entry);
    return entry;
  };
  const row = (id, entry, folder, where, file) => {
    const { sum } = entry;
    const kind = kindFor(sum.messages ? entry.kind : 'empty');
    if (!kind) return null;
    const title = titleMarks.withoutMarks(sum.custom || sum.ai || sum.firstPrompt || '').slice(0, MAX_TITLE);
    const s = { sessionId: id, title, cwd: sum.cwd || folder, createdAt: sum.createdAt || 0, lastActiveAt: sum.lastActiveAt || sum.createdAt || 0,
      lastReplyAt: sum.lastReplyAt || 0, kind, activity: 'stopped', running: false };
    /* Read the way the tab's dot reads it, so the row and the tab agree on whether a plan question is answered. */
    const typed = deps.lastUserAt ? Number(safe(deps.lastUserAt, 0, file)) || 0 : sum.lastUserAt || 0;
    if (typed) s.lastUserAt = typed;
    if (sum.branch) s.branch = sum.branch;
    const wt = worktreeOf(sum.cwd, folder);
    if (wt) s.worktree = wt;
    const st = safe(deps.state, null, id);
    if (st && typeof st === 'object') {
      s.running = true;
      if (typeof st.activity === 'string' && st.activity) s.activity = st.activity;
      if (s.activity === 'waiting' && st.waitingFor) s.waitingFor = st.waitingFor;
    }
    const w = where && where.get(id);
    if (w) {
      if (w.elsewhere && w.elsewhere.length) s.elsewhere = w.elsewhere;
      if (w.processes) s.processes = w.processes;
    }
    if (safe(deps.isSteward, false, id) === true) s.steward = true;
    /* Claude Code's own mark, which can outlast a moment the tab spent in front, such as while restored tabs load. */
    if (safe(deps.unseen, false, id) === true) s.unseen = true;
    return s;
  };
  const projectIds = (folder) => new Set(transcripts(folder).keys());

  return {
    async listSessions({ folders, cursor, limit } = {}) {
      const folder = Array.isArray(folders) && typeof folders[0] === 'string' ? folders[0] : '';
      if (!folder) return { sessions: [], cursor: null };
      if (!started) { started = true; safe(deps.started); }
      /* The first page waits a little for a fresh list of running conversations: the rows' states come from it. */
      if (!cursor && deps.ready) await new Promise((resolve) => { const t = setTimeout(resolve, READY_MS); Promise.resolve().then(deps.ready).then(() => { clearTimeout(t); resolve(); }, () => { clearTimeout(t); resolve(); }); });
      const ids = [...transcripts(folder).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const start = Math.max(0, Number.parseInt(cursor, 10) || 0), size = Math.max(1, Math.min(Number(limit) || PAGE, PAGE));
      let where = null;
      try { where = deps.elsewhere ? deps.elsewhere() : null; } catch (_) { where = null; }
      const sessions = [];
      let at = start;
      for (; at < ids.length && sessions.length < size; at++) {
        const [id, file] = ids[at];
        const entry = read(id, file);
        const s = entry && row(id, entry, folder, where, file);
        if (s) sessions.push(s);
      }
      return { sessions, cursor: at < ids.length ? String(at) : null };
    },
    onDidChangeSessions: event(listeners),
    /* For the source: a transcript, a state or a place changed. */
    changed: fire,
    sessionActions: Object.freeze({ open: ['tab', 'sidebar'], create: ['tab', 'sidebar'], rename: true, delete: true, own: [] }),
    async runSessionAction(action, sessionIds, args = {}) {
      const ids = Array.isArray(sessionIds) ? sessionIds.filter((id) => typeof id === 'string' && SESSION.test(id)) : [];
      const where = args && args.where === 'sidebar' ? 'sidebar' : 'tab';
      const each = async (fn) => {
        const results = [];
        for (const id of ids) {
          const r = await call(fn, id);
          results.push(r && r.error ? { sessionId: id, outcome: 'failed', reason: r.error } : Object.assign({ sessionId: id, outcome: 'done', reason: '' }, r || {}));
        }
        return { results };
      };
      if (action === 'open') return each((id) => deps.open(id, where).then(() => ({})));
      if (action === 'create') {
        const r = await call(() => deps.create(where));
        return { results: [r && r.error ? { sessionId: '', outcome: 'failed', reason: r.error } : { sessionId: typeof r === 'string' ? r : '', outcome: 'done', reason: '' }] };
      }
      if (action === 'rename') {
        const title = titleMarks.withoutMarks(String((args && args.title) || '')).trim();
        if (!title) return { results: ids.map((id) => ({ sessionId: id, outcome: 'refused', reason: 'a title needs at least one character' })) };
        return each(async (id) => {
          const r = await deps.rename(id, title);
          if (!r || r.outcome === 'submitted' || r.outcome === 'done') return {};
          return { outcome: r.outcome === 'refused' ? 'refused' : 'failed', reason: r.reason || '' };
        });
      }
      if (action === 'delete') {
        const r = await call(() => deps.remove(ids));
        if (r && r.error) return { results: ids.map((id) => ({ sessionId: id, outcome: 'failed', reason: r.error })) };
        return { results: Array.isArray(r) ? r : [] };
      }
      return { results: ids.map((id) => ({ sessionId: id, outcome: 'refused', reason: `Claude Code Plus has no action ${String(action)}` })) };
    },
    async describeDeletion(sessionIds) {
      const r = await call(() => deps.describe(sessionIds));
      return Array.isArray(r) ? r : [];
    },
    wantSessionDetail() { fire(); },
    async importSessions({ folders } = {}) {
      const folder = Array.isArray(folders) && typeof folders[0] === 'string' ? folders[0] : '';
      let lists = null;
      try { lists = deps.officialLists ? deps.officialLists() : null; } catch (_) { lists = null; }
      if (!folder || !lists || typeof lists !== 'object') return null;
      const mine = projectIds(folder);
      const ours = (id) => typeof id === 'string' && mine.has(id);
      const pinned = (() => { try { return deps.pinned ? deps.pinned() : []; } catch (_) { return []; } })();
      const colors = (() => { try { return deps.colors ? deps.colors() : {}; } catch (_) { return {}; } })();
      return {
        archived: (Array.isArray(lists.archived) ? lists.archived : []).filter(ours).map((sessionId) => ({ sessionId })),
        groups: (Array.isArray(lists.groups) ? lists.groups : []).map((g) => ({ name: String((g && g.name) || '').trim(), sessionIds: (g && Array.isArray(g.sessionIds) ? g.sessionIds : []).filter(ours) }))
          .filter((g) => g.name && g.sessionIds.length),
        pinned: (Array.isArray(pinned) ? pinned : []).filter(ours),
        colors: Object.fromEntries(Object.entries(colors && typeof colors === 'object' ? colors : {}).filter(([id]) => ours(id))),
      };
    },
    /* Always given, so that the section shows Claude Code as there: how it signs in unless with a claude.ai account,
       and the figures of the conversation in front, or a line saying that it has none yet or that none runs here. The
       core asks with the last conversation it saw in front, which can have closed since with no other taking its place;
       figures are given only for a conversation that still runs here, this window's own one in front otherwise. */
    accountInfo({ sessionId } = {}) {
      const runs = (x) => SESSION.test(x) && !!safe(deps.state, null, x);
      const asked = typeof sessionId === 'string' ? sessionId : '';
      const front = String(safe(deps.front, '') || '');
      const id = runs(asked) ? asked : runs(front) ? front : '';
      const rows = id ? safe(deps.totals, [], id) : [];
      const login = safe(deps.login, null);
      const top = login && login.method !== 'claudeAi' && login.label ? [{ label: 'Sign-in', value: login.label }] : [];
      if (!Array.isArray(rows) || !rows.length) {
        const why = id ? { label: 'This conversation', value: 'No figures yet', tooltip: NOT_YET } : { label: 'This window', value: 'No conversation running', tooltip: NO_FIGURES };
        return { rows: top.concat([why]), bars: [], links: [] };
      }
      const hit = cache.get(id), sum = hit && hit.sum;
      const title = String(safe(deps.titleOf, '', id) || (sum && (sum.custom || sum.ai || sum.firstPrompt)) || '');
      return { rows: top, bars: [], links: [], conversation: { title: titleMarks.withoutMarks(title), rows } };
    },
    onDidChangeAccountInfo: event(accountListeners),
    /* For the source: the figures, or the conversation in front, changed. */
    accountChanged() { for (const l of [...accountListeners]) { try { l(); } catch (_) { /* the listener's own */ } } },
    /* The last calls of noteSeen, [time, id, seen], for a test to read through the source's focusState(). */
    seenLog: () => seenLog.slice(),
    noteSeen(sessionIds, seen) {
      for (const id of Array.isArray(sessionIds) ? sessionIds : []) {
        if (typeof id !== 'string' || !SESSION.test(id)) continue;
        seenLog.push([Date.now(), id, seen === true]);
        if (seenLog.length > 30) seenLog.shift();
        /* Only a mark that changes goes to the host. Each call there first reads all its marks back from VS Code's
           global state, which can briefly still hold the value from before its last write; a call that changes
           nothing would then drop a reply it marked unread a moment earlier. */
        const on = seen !== true;
        if (typeof deps.unseen === 'function' && safe(deps.unseen, !on, id) === on) continue;
        try { if (deps.setUnread) deps.setUnread(id, on); } catch (_) { /* the host is not patched */ }
      }
    },
    sessionsNotice() {
      const n = safe(deps.notice, null);
      if (!n || typeof n !== 'object' || typeof n.text !== 'string' || !n.text) return null;
      return { text: n.text.slice(0, 300), actions: (Array.isArray(n.actions) ? n.actions : []).slice(0, 3) };
    },
    onDidChangeSessionsNotice: event(noticeListeners),
    /* For the source: the note above the list changed. */
    noticeChanged() { for (const l of [...noticeListeners]) { try { l(); } catch (_) { /* the listener's own */ } } },
    onDidCloseSession: event(closeListeners),
    /* For the source: a tab of this window that showed `sessionId` was closed. */
    closed(sessionId, where = 'tab') {
      if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) return;
      for (const l of [...closeListeners]) { try { l({ sessionId, where }); } catch (_) { /* the listener's own */ } }
    },
    dispose() { if (timer) clearTimeout(timer); listeners.clear(); accountListeners.clear(); closeListeners.clear(); noticeListeners.clear(); },
  };
}

/*
 * Renames a conversation that no process has open to `title`, the way Claude Code's own rename does: a custom-title
 * record at the end of its transcript, which its list and its next run read. If the transcript's last record is still
 * being written, the title record goes on a new line after it.
 */
function appendTitle(file, sessionId, title) {
  let fd;
  try {
    fd = fs.openSync(file, 'r+');
    const size = fs.fstatSync(fd).size;
    let lead = '';
    if (size > 0) {
      const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, size - 1);
      if (b[0] !== 0x0a) lead = '\n';
    }
    fs.writeSync(fd, lead + JSON.stringify({ type: 'custom-title', customTitle: title, sessionId }) + '\n', size);
    return true;
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

/*
 * Deletes the conversations the list asks to, after checking once more that nothing has one open: a panel of this
 * window (`shown`), another VS Code window (`elsewhere`, a Map of id to the names of the windows that show it), or a
 * Claude Code process (`running`, a Set). With `shown` null, when this window cannot tell, nothing is deleted.
 * `findAll` and `remove` are src/deletesession.js's; `forget(id)` drops this extension's own records of a deleted one.
 */
function deleteChecked(sessionIds, { shown, running, elsewhere, findAll, remove, forget = () => {} }) {
  const ids = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).filter((id) => typeof id === 'string' && SESSION.test(id)))];
  if (!Array.isArray(shown)) {
    return ids.map((sessionId) => ({ sessionId, outcome: 'refused', reason: 'this window could not tell which conversations are open, so none was deleted' }));
  }
  const why = (id) => {
    if (shown.includes(id)) return 'it is open in this window';
    const names = elsewhere && elsewhere.get(id);
    if (names && names.length) return `the VS Code window ${names.map((n) => `"${n}"`).join(', ')} shows it`;
    if (running && running.has(id)) return 'a Claude Code process has it open';
    return '';
  };
  const free = ids.filter((id) => !why(id));
  const found = free.length ? findAll(free) : new Map();
  return ids.map((sessionId) => {
    const busy = why(sessionId);
    if (busy) return { sessionId, outcome: 'refused', reason: busy };
    const parts = found.get(sessionId) || [];
    if (!parts.length) return { sessionId, outcome: 'done', reason: 'nothing of it was left on disk' };
    const failed = remove(parts);
    try { forget(sessionId); } catch (_) { /* nothing kept for it */ }
    return failed.length ? { sessionId, outcome: 'failed', reason: `${failed.length} of its files could not be deleted: ${failed[0]}` }
      : { sessionId, outcome: 'done', reason: '' };
  });
}

/*
 * For src/sessionpins.js: which conversations to keep from Claude Code's own cleanup for the session list, given when the
 * list will delete each (`due`, the core's sessionDeletionDue: epoch milliseconds, or null for one it will not delete).
 * A conversation the list does not know of is kept as well; one it will delete within `soonMs` is left to the cleanup,
 * and so are those the list does not keep: background runs, daemons' sessions and transcripts with no message yet.
 * Null with no `due`.
 */
function keepsFor(due, { now = Date.now(), soonMs = 0, kindOf = bgSessions.kindOf } = {}) {
  if (!due || typeof due !== 'object') return null;
  return (id, file) => {
    const at = Object.prototype.hasOwnProperty.call(due, id) ? due[id] : null;
    if (typeof at === 'number' && Number.isFinite(at) && at <= now + soonMs) return false;
    return kindOf(file) === '';
  };
}

const FEATURES = ['sessions', 'sessionImport', 'accountInfo', 'sessionSeen', 'sessionClose', 'sessionsNotice'];

module.exports = { create, summarize, kindFor, worktreeOf, projectOf, appendTitle, deleteChecked, keepsFor, FEATURES, PAGE };
