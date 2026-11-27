// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The Supervisor panel, in VS Code's bottom panel. It is about the conversation in the active Claude Code panel: it lists
 * every other Claude Code conversation open in a VS Code window on this machine, grouped by window, then the open
 * conversations of the other agents the supervisor manages (keys.OTHER_SOURCES), one group per agent, and the ticked rows
 * are what that conversation manages (src/stewards.js). A conversation open in no window is not listed, since a
 * supervisor has no way to reach it; ticked ones among them are counted, with a button to untick them.
 *
 * The Claude Code candidates are the conversations `claude agents --json` reports, less `claude --bg` sessions and
 * `claude -p` workers, which belong to the conversation that started them; and the stopped conversations whose plans
 * still have open rows, as Agent Plus's Conversations view shows them. The other agents' come from Agent Plus
 * (src/steward-core.js), which lists only the open ones and does not say in which window; their states are read from
 * Agent Plus's attention files (src/agent-states.js). The managed ones come first, with what each is doing, how
 * many questions it has for the user, and when it was last active.
 *
 * The same pass tells a supervisor when one of its conversations stops (src/stewards.js changes), by a line posted to the
 * supervisor's inbox socket. Only the window that has the supervisor conversation open sends it.
 */
const fs = require('fs');
const path = require('path');
const stewards = require('./stewards');
const relay = require('./relay');
const watch = require('./steward-watch');
const duplicates = require('./duplicates');
const waiting = require('./waiting');
const conversations = require('./conversations');
const bgSessions = require('./bgsessions');
const { planQuestions } = require('./folders');
const { writeAtomic, SESSION, transcriptOf } = require('./claude-files');
const { liveRecords, readState } = require('./background');
const { OPEN_STATES, readPlanAt } = require('./workplan');
const activity = require('./activity');
const keys = require('./steward-keys');
const agentStates = require('./agent-states');
const stewardCore = require('./steward-core');
const titleMarks = require('./title-marks');
const { GREEN, RED } = require('./tabdot');
const envelope = require('./envelope');
const windowEntries = require('./window-entries');
const noticeTime = require('./notice-time');

const VIEW = 'claudeCodePlus.steward';
/* How often the list and the notices are refreshed. `claude agents --json` is asked at most every half minute
   (freshAgents in src/claude-source.js), so most passes only reread plans. */
const REFRESH_MS = 5000;
const NOTICE_GAP_MS = 60000;
/* How long a conversation managed under "All, including new ones" may be out of every window before it leaves the
   list (syncEvery). */
const GONE_MS = 10 * 60000;
/* Whether the newer notice entry x supersedes c. For a conversation's state only the newest change is kept; each ended
   job and each stopped process is kept; for the processes running a conversation, the newest set. */
const STATE_KINDS = new Set(['done', 'waiting']);
const replaces = (x, c) => x.id === c.id && (STATE_KINDS.has(c.what) ? STATE_KINDS.has(x.what)
  : x.what === c.what && (c.what === 'twice' || (c.what === 'ended' ? x.why === c.why : x.stop.pid === c.stop.pid)));
/* How often the background work of the conversations a supervisor manages is looked at. */
const WORK_CHECK_MS = 15000;
/* <plan dir>/windows/<pid>.json: what each window shows (src/window-entries.js). */
const WINDOWS_DIR = windowEntries.WINDOWS_DIR;
/* <plan dir>/windows/<pid>.open.json asks window <pid> to show a conversation. Requests older than OPEN_FRESH_MS are
   ignored, so a window that was busy or closing does not act on one much later. */
const OPEN_SUFFIX = '.open.json';
const OPEN_FRESH_MS = 30000;
const MAX_DOING = 2;
/* The questions a notice quotes for each conversation, and how much of each. */
const MAX_ASKS = 3;
const MAX_ASK = 300;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/* Agent Plus's page helpers (src/page/03-kit.js). The page uses their hover label to say why a control is greyed, since
   VS Code draws a webview's own title tooltips outside the page, slowly and not over a disabled control. */
const KIT = fs.readFileSync(path.join(__dirname, 'page', '03-kit.js'), 'utf8');

/* The titles of a plan's rows in progress, depth first. */
function doingRows(nodes, out = []) {
  for (const n of nodes || []) {
    if (out.length >= MAX_DOING) break;
    if (n.state === 'doing') out.push(n.title);
    doingRows(n.children, out);
  }
  return out.slice(0, MAX_DOING);
}

/* A conversation's state for the panel and the notices, from what it is doing (src/activity.js) and whether it has a
   reply not read yet. Without deps.activity, from Claude Code's states alone. */
const STATE_OF = { waiting: 'prompt', working: 'working', background: 'background' };
function rowState(s, live, unread, deps) {
  let act;
  try { act = typeof deps.activity === 'function' ? deps.activity(s.sessionId) : ''; } catch (_) { act = ''; }
  if (!act) {
    const st = conversations.stateOf(s, live, unread);
    act = st === 'prompt' ? 'waiting' : st === 'working' ? 'working' : 'stopped';
  }
  const unseen = !!(unread && unread.has(s.sessionId));
  let question = false;
  try { question = typeof deps.question === 'function' && act !== 'working' && act !== 'waiting' && deps.question(s.sessionId) === true; } catch (_) { question = false; }
  return { state: STATE_OF[act] || (unseen ? 'unread' : 'idle'), dot: activity.dotOf(act, question), unseen };
}

/*
 * Every conversation the panel can list, by key (src/steward-keys.js): { sessionId, title, cwd, state, dot, unseen,
 * running, lastActiveAt, doing, questions }, with the key as sessionId, and for another agent's conversation also
 * sourceId, label and waitingFor. `deps` are those of create() below, with others() for the other agents'
 * conversations (src/steward-core.js) and otherStates() for what they are doing (src/agent-states.js).
 */
function gather(records, deps) {
  const all = records ? waiting.merge(records) : new Map();
  const twice = (deps.duplicates && deps.duplicates()) || new Map();
  const running = new Map();
  for (const [id, s] of all) {
    if (s.kind === 'background' || !s.cwd || deps.isBackground(id, s.cwd)) continue;
    running.set(id, s);
  }
  const roots = [...new Set([...running.values()].map((s) => path.parse(s.cwd).root).concat(path.parse(deps.home).root))];
  const stopped = conversations.stoppedWithOpenRows(roots, new Set(all.keys()), { dir: deps.dir, readPlan: deps.readPlan });
  const live = deps.live(), unread = deps.unread();
  const out = new Map();
  const add = (s, on) => {
    const plan = deps.readPlan(s.sessionId);
    const nodes = plan && plan.nodes;
    const qs = planQuestions(nodes);
    const now = on ? rowState(s, live, unread, deps) : { state: 'idle', dot: '', unseen: !!(unread && unread.has(s.sessionId)) };
    out.set(s.sessionId, {
      sessionId: s.sessionId,
      title: titleMarks.withoutMarks(conversations.claudeTitle(s, deps.titles(s), () => plan)) || s.sessionId,
      cwd: s.cwd,
      state: now.state,
      dot: now.dot,
      unseen: now.unseen,
      running: on,
      processes: on && twice.get(s.sessionId) ? twice.get(s.sessionId).slice() : [],
      lastActiveAt: deps.since(s) || 0,
      doing: doingRows(nodes),
      questions: qs.length,
      asks: qs.slice(0, MAX_ASKS).map((q) => String(q.question || '').slice(0, MAX_ASK)),
      askRows: qs.map((q) => q.num + '\n' + String(q.question || '').slice(0, MAX_ASK)),
    });
  };
  for (const s of running.values()) add(s, true);
  for (const s of stopped.values()) add(s, false);
  const listed = deps.others ? deps.others() : [];
  const states = listed.length && deps.otherStates ? deps.otherStates() : new Map();
  for (const o of listed) {
    const plan = deps.readPlan(o.key), qs = planQuestions(plan && plan.nodes), st = states.get(o.key);
    // One in no attention file is stopped with its reply read, or its window writes none.
    const act = st ? st.activity : 'stopped', unseen = !!(st && st.unseen);
    out.set(o.key, { sessionId: o.key, sourceId: o.sourceId, label: o.label, title: o.title, cwd: o.cwd,
      state: STATE_OF[act] || (unseen ? 'unread' : 'idle'), dot: activity.dotOf(act, false), unseen, running: true, processes: [],
      lastActiveAt: o.lastActiveAt, doing: doingRows(plan && plan.nodes), questions: qs.length,
      asks: qs.slice(0, MAX_ASKS).map((q) => String(q.question || '').slice(0, MAX_ASK)),
      askRows: qs.map((q) => q.num + '\n' + String(q.question || '').slice(0, MAX_ASK)), waitingFor: act === 'waiting' && st ? st.waitingFor : null });
  }
  return out;
}

const twiceText = (procs) => `Claude Code runs this conversation in ${procs.length} processes at once, and what is sent to it can reach `
  + `any of them: ${procs.map(duplicates.describe).join('; ')}.`;
const stopText = (p) => `Stops ${duplicates.describe(p)}. The conversation stays in its transcript.`;

const STATE_TEXT = { working: 'working', background: 'running background work', prompt: 'waiting for you',
  unread: 'finished, not read yet', idle: 'idle' };
/* STATE_TEXT for the supervisor's notices, which speak of the user in the third person. */
const NOTICE_STATE = { working: 'working', background: 'running background work', prompt: 'waiting for the user',
  unread: 'finished, not read by the user', idle: 'idle' };
const DOT_TEXT = { working: 'working', background: 'turn ended; background work still running', waiting: 'waiting for you' };
/* The envelope's form follows the theme (src/envelope.js); it is written as character references, the page being ASCII. */
const htmlChars = (s) => [...String(s)].map((c) => `&#x${c.codePointAt(0).toString(16).toUpperCase()};`).join('');
const ENVELOPE_TEXT = 'Reply not read yet';

/* An eye at the row's text size, in the colour of the text around it (.eyes sets a fainter one). */
const EYE = '<svg viewBox="0 0 16 16" width="1.1em" height="1.1em" aria-hidden="true"><path fill="none" stroke="currentColor" '
  + 'stroke-width="1.3" d="M1.5 8C3.2 5 5.4 3.5 8 3.5S12.8 5 14.5 8C12.8 11 10.6 12.5 8 12.5S3.2 11 1.5 8Z"/>'
  + '<circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>';
const eyesText = (n) => `Also managed by ${n} other supervisor${n === 1 ? '' : 's'}`;

function ago(ms, now) {
  if (!ms) return '';
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/* Returns the managed conversations named in an open row of the supervisor's plan, by title, session id, or for a Claude
   Code conversation the id's first eight characters. Every key of another agent starts with its source's name.
   names: key -> title. */
function waitedOn(plan, ids, names) {
  const texts = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n && OPEN_STATES.includes(n.state)) texts.push(String(n.title || '') + ' ' + String(n.note || ''));
      if (n) walk(n.children);
    }
  };
  walk(plan && plan.nodes);
  const all = texts.join('\n');
  // Skip an eight-character prefix that more than one of them has.
  const prefix = (id) => keys.isClaude(id) && ids.filter((x) => x.slice(0, 8) === id.slice(0, 8)).length === 1 && all.includes(id.slice(0, 8));
  const session = (id) => keys.isOther(id) && all.includes(keys.parse(id).sessionId);
  return new Set(ids.filter((id) => all.includes(id) || prefix(id) || session(id)
    || (names[id] && names[id].trim().length >= 2 && all.includes(names[id].trim()))));
}

/* What a notice says another agent's conversation is waiting for (reasonOf in src/agent-states.js). The user answers it
   in that window, where Agent Plus refuses a message meanwhile. */
function otherWait(reason) {
  const what = reason && reason.kind === 'permission' ? `the user to approve ${reason.tool || 'a tool'} in its window`
    : reason && reason.kind === 'question' ? 'the user\'s answer to a question in its window' : 'the user in its window';
  return `${what}; only the user can answer it there, and a message from you does not reach it meanwhile`;
}

/* Signal 0 only checks; EPERM still means the process exists. */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

/*
 * Whether this window writes the supervisors table. A window running the installed build does, as it writes every shared
 * file. A window whose build was replaced by a later install (mine.replaced) leaves shared files to the windows running
 * the installed build, but until one of them is open nobody else keeps the table: a supervisor set to All would gain
 * nothing and no tick would be saved. So it writes the table while no live window's entry (`others`,
 * src/window-entries.js) says it runs the installed build. An entry that names this window's own build (mine.build) is
 * ignored: that build is no longer the installed one, and an entry says so only at its window's next pass after an
 * install. Builds older than this rule leave that out of their entries, and their windows never write the table.
 */
function writesTable(mine, others) {
  if (mine.canWrite) return true;
  return !!mine.replaced && !(others || []).some((w) => w && w.installed === true && !(mine.build && w.build === mine.build));
}

/* The window name without the " [SSH: host]" suffix VS Code adds for a remote window. */
const windowLabel = (w) => String(w.name || '').replace(/\s*\[[^\]]*\]\s*$/, '')
  || (w.folders[0] ? path.basename(w.folders[0]) : 'Window with no folder');

/* `rows` are all open in one of `wins`, or another agent's. Agent Plus does not report which window has another agent's
   conversation open. */
function grouped(rows, wins, front) {
  const groups = new Map();
  const frontWin = wins.find((w) => w.sessions.includes(front));
  for (const c of rows) {
    if (keys.isOther(c.sessionId)) {
      const key = 's:' + c.sourceId;
      if (!groups.has(key)) groups.set(key, { key, name: c.label || keys.labelOf(c.sessionId), rank: 2, rows: [] });
      groups.get(key).rows.push(c);
      continue;
    }
    const w = wins.find((x) => x.sessions.includes(c.sessionId)) || hostWindow(c, wins);
    if (!w) continue;
    const key = 'w:' + w.pid;
    if (!groups.has(key)) groups.set(key, { key, name: windowLabel(w), rank: w === frontWin ? 0 : 1, rows: [] });
    groups.get(key).rows.push(c);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/* For a conversation that two or more processes run, the window whose extension host runs one of them, or undefined.
   Such a conversation is in no window's entry: each host sees the other process as running elsewhere and leaves it out
   of what it shows (shownList in extension.js), yet its row is where the old process is stopped. */
function hostWindow(c, wins) {
  const procs = Array.isArray(c.processes) ? c.processes : [];
  return procs.length > 1 ? wins.find((w) => procs.some((p) => p.host === w.pid)) : undefined;
}

/* The panel's list, as HTML. */
function body(model) {
  const now = Date.now();
  const row = (c) => `
    <li class="row ${c.managed ? 'managed' : ''}">
      ${c.why ? `<span class="box" data-why="${esc(c.why)}">` : ''}<input type="checkbox" data-id="${esc(c.sessionId)}" ${c.managed ? 'checked' : ''} ${model.every || c.lock ? 'disabled' : ''}
        ${c.why ? `aria-label="${esc(c.why)}"` : 'title="Managed by this conversation"'}>${c.why ? '</span>' : ''}
      <span class="dot ${esc(c.dot || '')}" ${c.dot ? `title="${esc(DOT_TEXT[c.dot] || c.dot)}"` : ''}></span>
      <a href="#" class="name" data-open="${esc(c.sessionId)}" title="${esc(c.cwd)}">${esc(titleMarks.withMarks(c.title, { steward: !!c.steward }))}</a>
      ${c.by ? `<span class="by" data-why="${esc(c.why)}">${esc(c.by)}</span>` : ''}
      ${c.unseen ? `<span class="env" title="${ENVELOPE_TEXT}" aria-label="${ENVELOPE_TEXT}">${htmlChars(model.envelope || envelope.COLOUR)}</span>` : ''}
      ${c.processes.length > 1 ? `<span class="twice" title="${esc(twiceText(c.processes))}">${c.processes.length} processes</span>
      ${duplicates.oldOne(c.processes) ? `<button class="stop-old" data-stop-old="${esc(c.sessionId)}" title="${esc(stopText(duplicates.oldOne(c.processes)))}">Stop the old process</button>` : ''}` : ''}
      ${c.managed ? `<span class="doing">${esc(c.doing.join(' · ') || (c.running ? STATE_TEXT[c.state] : 'stopped'))}</span>
      ${c.questions ? `<span class="questions">${c.questions} question${c.questions === 1 ? '' : 's'} for you</span>` : ''}
      <span class="when">${esc(ago(c.lastActiveAt, now))}</span>` : `<span class="when">${esc(ago(c.lastActiveAt, now))}</span>`}
      ${c.eyes && c.eyes.length ? `<span class="eyes" tabindex="0" data-eyes="${esc(c.sessionId)}" aria-label="${esc(eyesText(c.eyes.length) + ': ' + c.eyes.map((e) => e.name).join(', '))}">${EYE}<span class="n">${c.eyes.length}</span>
        <span class="pop"><span class="pophead">${esc(eyesText(c.eyes.length))}</span>${c.eyes.map((e) => `<a href="#" data-open="${esc(e.id)}">${esc(e.name)}</a>`).join('')}</span></span>` : ''}
    </li>`;
  const group = (g) => {
    const on = g.rows.filter((c) => c.managed).length, free = g.rows.filter((c) => !c.lock).length;
    return `
    <div class="group">
      <label class="ghead" ${free ? '' : 'data-why="Every conversation here is a supervisor"'}><input type="checkbox" data-group="${esc(g.key)}"
        ${on && on === free ? 'checked' : ''} ${model.every || !free ? 'disabled' : ''} ${on && on < free ? 'data-mixed="1"' : ''}
        ${free ? `title="Every conversation in ${esc(g.name)} that is not a supervisor"` : ''}>
        <span class="gname">${esc(g.name)}</span><span class="count">${on}/${g.rows.length}</span></label>
      <ul>${g.rows.map(row).join('')}</ul>
    </div>`;
  };
  const stale = model.stale ? `<p class="stale">This window runs an earlier build of Claude Code Plus than the one now installed, so
      ticks made here are not saved${model.every ? ' and new conversations are not added to this supervisor' : ''}.
      <button data-act="reload">Reload Window</button></p>` : '';
  const away = model.hidden ? `<p class="away">${model.hidden} ticked conversation${model.hidden === 1 ? ' is' : 's are'} not open in any
      VS Code window, so the supervisor cannot send ${model.hidden === 1 ? 'it' : 'them'} anything; not listed.
      <button data-act="drop-hidden">Untick ${model.hidden === 1 ? 'it' : 'them'}</button></p>` : '';
  if (model.other) {
    const name = model.other.title ? `"${esc(model.other.title)}"` : 'The tab in front';
    return model.other.manageable
      ? `<p class="empty">${name} is an ${esc(model.other.agent)} conversation, which cannot be a supervisor. To have it managed, bring a Claude Code conversation to the front and tick it there.</p>`
      : `<p class="empty">${name} is a ${esc(model.other.agent)} conversation, which can neither be a supervisor nor be managed.</p>`;
  }
  return !model.front
    ? '<p class="empty">Open a Claude Code conversation. The conversations ticked here are the ones it manages.</p>'
    : `<div class="head"><span class="who"><span>Managed by </span><b><span class="t">${esc(titleMarks.withoutMarks(model.front.title))}</span>${
        model.managed || model.every || model.later ? `<span class="crown"> ${titleMarks.CROWN}</span>` : ''}</b><span>: ${model.managed}</span></span>
         <label class="every" title="Ticks every conversation listed and every one opened later. Supervisors are never ticked.">
           <input type="checkbox" data-every="1" ${model.every ? 'checked' : ''}> All, including new ones</label>
         <label class="every" title="Ticks every conversation that starts from now on, except supervisors. Conversations open now keep their ticks.">
           <input type="checkbox" data-later="1" ${model.later ? 'checked' : ''}> New conversations</label>
         <span class="acts"><button data-act="all" ${model.every ? 'disabled' : ''}>Select all</button><button data-act="none" ${model.every ? 'disabled' : ''}>Clear</button></span></div>${stale}${away}
       ${model.groups.length ? model.groups.map(group).join('') : '<p class="empty">No other conversation is open in a VS Code window.</p>'}`;
}

/*
 * The page, with `list` in it. It is set once per webview; later lists arrive as messages, since setting the page again
 * reloads it, which loses the scroll position and the focus.
 */
function shell(list, nonce) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 4px 8px; }
  .head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-bottom: 6px; }
  /* One line however narrow the panel: the supervisor's title gives way, its crown and the count stay. */
  .who { display: flex; align-items: baseline; flex: 1 1 14em; min-width: 0; white-space: nowrap; opacity: 0.85; }
  .who > span:first-child, .who .crown { white-space: pre; }
  .who b { display: inline-flex; min-width: 0; }
  .who .t { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .who .crown { flex: 0 0 auto; }
  .acts { display: inline-flex; gap: 8px; flex: 0 0 auto; }
  .head button { flex: 0 0 auto; white-space: nowrap; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 2px 8px; cursor: pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .every { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
  .every:has(input:disabled) { opacity: 0.6; }
  input:disabled { pointer-events: none; }
  .box { display: inline-flex; }
  .by { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.8; }
  /* As faint as the time beside it (.when) in every theme; the list it opens keeps its own colours. */
  .eyes { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 2px; color: color-mix(in srgb, var(--vscode-foreground) 60%, transparent); cursor: default; }
  .eyes .pop { display: none; position: absolute; right: 0; top: 100%; z-index: 10; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 4px;
    white-space: nowrap; background: var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, #252526));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, #454545)); color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground, #ccc)); }
  .eyes:hover .pop, .eyes:focus-within .pop { display: flex; }
  .eyes .pop a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  .box input:disabled, .ghead[data-why] input:disabled { opacity: 0.4; }
  ul { list-style: none; margin: 0; padding: 0; }
  .row { display: flex; align-items: center; gap: 6px; padding: 2px 0; white-space: nowrap; }
  .row:not(.managed) { opacity: 0.7; }
  /* A title is never cut. */
  .name { color: var(--vscode-textLink-foreground); text-decoration: none; flex: 0 1 auto; min-width: 4em; white-space: normal; overflow-wrap: anywhere; }
  .doing { overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; min-width: 0; opacity: 0.85; }
  .questions { color: var(--vscode-editorWarning-foreground, #cca700); }
  .twice { color: var(--vscode-errorForeground, #f14c4c); }
  .stop-old { padding: 0 6px; }
  .when { opacity: 0.6; margin-left: auto; }
  .dot { box-sizing: border-box; width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
  .dot.working { background: ${GREEN}; } .dot.background { border: 2px solid ${GREEN}; } .dot.waiting { background: ${RED}; }
  .env { flex: 0 0 auto; line-height: 1; }
  .empty, .away, .stale { opacity: 0.7; }
  .away button, .stale button { margin-left: 6px; }
  .group { margin-bottom: 6px; }
  .ghead { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-weight: 600; }
  .ghead .count { opacity: 0.6; font-weight: normal; }
  .group ul { padding-left: 18px; }
</style></head><body><div id="root">${list}</div>
<script nonce="${nonce}">${KIT}</script>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const tips = agentPlusKit.labels({ mark: ['data-steward-why', '1'], css: 'z-index:10;padding:6px 8px;border-radius:4px;font-size:.92em;'
    + 'background:var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background, #252526));'
    + 'border:1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, #454545));'
    + 'color:var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground, #ccc));' });
  let under = null;
  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-why]') : null;
    if (t === under) return;
    under = t;
    if (t) tips.show(t, t.dataset.why); else tips.hide();
  });
  const away = () => { under = null; tips.hide(); };
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) away(); });
  window.addEventListener('blur', away);
  // A group's box shows a part of its conversations ticked as neither ticked nor clear, which only a property can say.
  const mixed = () => { for (const b of document.querySelectorAll('input[data-mixed]')) b.indeterminate = true; };
  const apply = (html) => { under = null; tips.hide(); document.getElementById('root').innerHTML = html; mixed(); };
  /* A body that arrives while a pointer is down waits until the click is over: replacing the boxes between the press and
     the release would make that click land on nothing. */
  let pressed = false, held = null;
  const release = () => {
    pressed = false;
    if (held !== null) setTimeout(() => { if (held !== null && !pressed) { const h = held; held = null; apply(h); } }, 0);
  };
  document.addEventListener('pointerdown', () => { pressed = true; }, true);
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  window.addEventListener('blur', release);
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.type === 'body' && typeof m.html === 'string') { if (pressed || held !== null) held = m.html; else apply(m.html); }
  });
  mixed();
  vscode.postMessage({ type: 'ready' });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches('input[data-every]')) vscode.postMessage({ type: 'every', on: t.checked });
    else if (t.matches('input[data-later]')) vscode.postMessage({ type: 'later', on: t.checked });
    else if (t.matches('input[data-group]')) vscode.postMessage({ type: 'group', key: t.dataset.group, on: t.checked });
    else if (t.matches('input[type=checkbox]')) vscode.postMessage({ type: 'toggle', id: t.dataset.id, on: t.checked });
    else if (t.dataset && t.dataset.open) { e.preventDefault(); vscode.postMessage({ type: 'open', id: t.dataset.open }); }
    else if (t.dataset.stopOld) vscode.postMessage({ type: 'stop-old', id: t.dataset.stopOld });
    else if (t.dataset.act) vscode.postMessage({ type: t.dataset.act });
  });
</script></body></html>`;
}

/*
 * deps: activeChat(), freshAgents() -> { records }, readPlan(id), titles(s), since(s), live(), unread(), reveal(id),
 * optionally activity(id) and question(id) for a conversation's dot (src/activity.js), shownHere(id) -> whether this
 * window shows that conversation's panel, canWrite() -> whether this window may write shared files, canShare() ->
 * whether it may still publish its own entry and take relay requests (true also in a window whose build has been
 * replaced, which keeps showing its conversations until it is reloaded), replaced() -> whether a replaced build is the
 * only reason it may not write them (see writesTable), build() -> { code, installed } for its entry: the digest of the
 * code it runs (src/build-digest.js) and whether that is the installed build, offerReload(text) to say what it cannot
 * do with a Reload Window button, reload(), enabled(), log(message), home, dir (the plan directory), windowName(),
 * windowFolders() and shownList() for this window's name, folders and the conversations it shows, and optionally
 * isBackground(id, cwd), records() -> the live session records, alive(pid), post(address, text) in place of
 * stewards.post, changed(), which runs once this window has rewritten the supervisors table, focusWindow(), which brings
 * this window to the front, transcriptOf(id), and deliver(id, text), which types text into the conversation's message
 * input here (src/relay.js), rename(id, title), close(id, confirmed), open(folder, text) and resume(id, text) for a
 * supervisor's other requests (src/relay.js), with agentsFresh() -> Promise<{ records, error }> from a fresh
 * `claude agents --json` before a resume, readState(id) for a `claude --bg` session's state (src/background.js),
 * duplicates() for the conversations run by several processes, rereadDuplicates() to read them again and
 * stopDuplicate(id) to stop the old one (src/duplicates.js), pageAt() for the time of a page's last heartbeat, otherFront() -> { agent, title, manageable }
 * while another agent's conversation tab is in front (src/other-agents.js), or null, and optionally openOther(target)
 * and otherStates(). The agentPlus interface comes through attachCore() once this extension is registered with Agent
 * Plus.
 */
function create(vscode, deps) {
  deps = Object.assign({ isBackground: bgSessions.isBackground, records: () => liveRecords(), post: stewards.post, alive, readState,
    windowName: () => '', windowFolders: () => [], shownList: () => [], changed: () => {}, focusWindow: () => {}, transcriptOf,
    canShare: () => deps.canWrite(), otherFront: () => null, replaced: () => false, build: () => null, offerReload: () => {},
    reload: () => vscode.commands.executeCommand('workbench.action.reloadWindow'),
    openOther: (target) => vscode.commands.executeCommand('agentPlus.openConversation', target),
    deliver: () => Promise.resolve({ outcome: 'notReceived', reason: 'this window cannot type into a conversation' }) }, deps);
  let view = null, timer = 0, busy = false, last = new Map(), lastFront = '', shown = null;
  const frontKey = () => { const o = deps.otherFront(); return o ? 'other:' + o.agent + ':' + o.title : deps.activeChat(); };
  const states = new Map();
  const link = stewardCore.link({ changed: () => { pass(); }, log: deps.log });
  const core = () => link.core();
  /* Plan paths the supervisors table records for other agents' conversations, read once per pass. */
  let recorded = {};
  const recordedPaths = () => {
    const out = {};
    for (const t of Object.values(stewards.read(deps.dir))) Object.assign(out, t.paths || {});
    return out;
  };
  const planFile = (id) => (keys.isOther(id) ? stewardCore.planPathOf(core(), id) || recorded[id] || '' : path.join(deps.dir, id + '.json'));
  const plansOf = (list) => {
    const out = {};
    for (const id of list) { const f = keys.isOther(id) ? stewardCore.planPathOf(core(), id) : ''; if (f) out[id] = f; }
    return out;
  };
  /* A pass reads the plan of every conversation listed, every REFRESH_MS. A plan whose file has the same size and
     modification time as at the last read is taken from here instead. */
  const planSeen = new Map();
  const readPlan = (id) => {
    const other = keys.isOther(id), file = planFile(id);
    let st;
    try { st = fs.statSync(file); } catch (_) { planSeen.delete(id); return other ? null : deps.readPlan(id); }
    const key = file + ':' + st.mtimeMs + ':' + st.size, hit = planSeen.get(id);
    if (hit && hit.key === key) return hit.plan;
    const plan = other ? readPlanAt(file, keys.parse(id).sessionId) : deps.readPlan(id);
    planSeen.set(id, { key, plan });
    return plan;
  };
  const cached = Object.assign({}, deps, { readPlan, others: () => stewardCore.others(core()),
    otherStates: () => (deps.otherStates ? deps.otherStates() : agentStates.read()) });

  /* The Claude Code conversation the panel is for: none while another agent's conversation tab is in front. Agent Plus's
     work plan view has moved to that conversation, and a tick here would still change the last Claude Code one's list. */
  const frontNow = () => (deps.otherFront() ? '' : deps.activeChat());
  const model = (all, front, other = null) => {
    const table = stewards.read(deps.dir);
    const mine = new Set(front && table[front] ? table[front].manages : []);
    const every = !!(front && table[front] && table[front].all);
    const wins = windows();
    const open = (id) => (keys.isOther(id) ? !!(all.get(id)) : wins.some((w) => w.sessions.includes(id)));
    const steward = (id) => { const t = table[id] || table[String(id).toLowerCase()]; return !!(t && (t.all || (t.manages || []).length)); };
    const rows = [...all.values()].filter((c) => c.sessionId !== front && (open(c.sessionId) || hostWindow(c, wins)))
      .map((c) => Object.assign({ managed: mine.has(c.sessionId), steward: steward(c.sessionId) }, c, lockOf(table, c.sessionId),
        { eyes: stewards.stewardsOf(table, c.sessionId).filter((s) => s !== front).map((s) => ({ id: s, name: nameOf(s, all) })) }));
    rows.sort((a, b) => (b.managed - a.managed) || (b.lastActiveAt - a.lastActiveAt));
    const groups = grouped(rows, wins, front);
    const hidden = [...mine].filter((id) => !open(id) && !rows.some((c) => c.sessionId === id));
    const self = front && all.get(front);
    // The conversation in front may not be in the list yet: `claude agents --json` is read at most every half minute.
    const title = self ? self.title : front ? titleMarks.withoutMarks(conversations.claudeTitle({ sessionId: front, name: '', cwd: '' },
      deps.titles({ sessionId: front }), () => deps.readPlan(front))) : '';
    const later = !!(front && table[front] && table[front].newSince);
    return { front: front ? { id: front, title } : null, other, rows, groups, managed: mine.size, hidden: hidden.length, hiddenIds: hidden,
      every, later, envelope: envelope.envelope(vscode), stale: !!front && deps.replaced() && !writes() };
  };
  /* The title the panel uses when its text names a conversation. */
  const nameOf = (id, all = last) => (all.get(id) && all.get(id).title)
    || titleMarks.withoutMarks(conversations.claudeTitle({ sessionId: id, name: '', cwd: '' }, deps.titles({ sessionId: id }), () => deps.readPlan(id))) || id;
  /* Only the box of a supervisor is locked, since supervisors are never managed. */
  const lockOf = (table, id) => (table[id] ? { lock: true, why: 'This conversation is a supervisor, and a supervisor is not managed by another', by: 'a supervisor' }
    : { lock: false, why: '', by: '' });

  /* This window's entry in the windows folder, written when what it shows changes and once a minute besides. */
  let published = false;
  const writeEntry = windowEntries.publisher(deps.dir, () => {
    const entry = { name: deps.windowName(), folders: deps.windowFolders(), sessions: deps.shownList() };
    // Omitted until the first heartbeat, so a host with no heartbeat counts as having its window (src/duplicates.js).
    const heard = deps.pageAt ? deps.pageAt() : 0;
    if (heard) entry.pageAt = heard;
    const b = deps.build();
    if (b) { entry.build = b.code || ''; entry.installed = b.installed === true; }
    return entry;
  }, { log: (m) => deps.log('supervisor panel: ' + m) });
  const publish = (now = Date.now()) => {
    if (deps.canShare() && writeEntry(now)) published = true;
  };
  /* The windows on this machine, this one included, from their entries. */
  const windows = (now = Date.now()) => [{ pid: process.pid, name: deps.windowName(), folders: deps.windowFolders(), sessions: deps.shownList() }]
    .concat(windowEntries.others(deps.dir, { now, alive: deps.alive }).map((w) => ({ pid: w.pid, name: w.name, folders: w.folders, sessions: w.sessions })));
  const writes = () => writesTable({ canWrite: deps.canWrite(), replaced: deps.replaced(), build: (deps.build() || {}).code || '' },
    windowEntries.others(deps.dir, { alive: deps.alive }));
  /* Said once per window when a change made in the panel is not saved; the panel shows a line about it the whole time.
     */
  let toldStale = false;
  const tellStale = () => {
    if (toldStale) return;
    toldStale = true;
    deps.offerReload('The tick is not saved: this window is running an earlier build of Claude Code Plus than the one now '
      + 'installed, and a window running that one keeps the supervisors list. Reload the window to change what a supervisor manages.');
  };

  /* The list for a supervisor with "all" set: every conversation open in a window, another agent's included, except
     itself and other supervisors. */
  const everyIds = (steward, table) => {
    const wins = windows();
    return [...last.keys()].filter((id) => id !== steward && !table[id]
      && (keys.isOther(id) ? keys.allowed(id) : wins.some((w) => w.sessions.includes(id))));
  };
  /* When a Claude Code conversation started: the time of the first row of its transcript, which a copy made by
     continuing it in another folder keeps. 0 while there is no transcript yet. */
  const started = new Map();
  const startedAt = (id) => {
    if (started.has(id)) return started.get(id);
    const file = deps.transcriptOf(id);
    let at = 0, fd;
    try {
      fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(64 * 1024), n = fs.readSync(fd, buf, 0, buf.length, 0);
      const m = /"timestamp":"([^"]+)"/.exec(buf.toString('utf8', 0, n));
      at = m ? Date.parse(m[1]) || 0 : 0;
    } catch (_) { at = 0; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* closed */ } }
    if (at) { if (started.size > 2000) started.clear(); started.set(id, at); }
    return at;
  };
  /* The other agents' conversations listed now, which "New conversations" leaves alone when it is turned on. */
  const otherKeys = () => [...last.keys()].filter((id) => keys.isOther(id));
  /* Conversations that started after supervisor `t` turned "New conversations" on and are not on its list yet. */
  const newIds = (steward, t, table) => {
    const wins = windows();
    return [...last.keys()].filter((id) => id !== steward && !table[id] && !t.manages.includes(id) && !t.newSkip.includes(id)
      && (keys.isOther(id) ? keys.allowed(id) && !t.newBefore.includes(id)
        : wins.some((w) => w.sessions.includes(id)) && startedAt(id) >= t.newSince));
  };
  const titlesOf = (list) => {
    const names = {};
    for (const id of list) if (last.get(id)) names[id] = last.get(id).title;
    return names;
  };
  /*
   * For each supervisor with "all" set whose conversation is open in this window, adds the conversations everyIds finds
   * to its list. A conversation is removed only after GONE_MS outside every window. A window that has just woken up
   * or reconnected publishes its list a little late, and removing its conversations at once made the supervisor's
   * messages to them fail meanwhile.
   */
  const absentSince = new Map();
  const syncEvery = (now = Date.now()) => {
    const table = stewards.read(deps.dir);
    let changed = false;
    for (const [steward, t] of Object.entries(table)) {
      if (!t.all || !deps.shownHere(steward)) continue;
      const open = new Set(everyIds(steward, table));
      const kept = t.manages.filter((id) => {
        const k = steward + ' ' + id;
        if (open.has(id)) { absentSince.delete(k); return true; }
        if (table[id]) return false;
        if (!absentSince.has(k)) absentSince.set(k, now);
        return now - absentSince.get(k) < GONE_MS;
      });
      const want = kept.concat([...open].filter((id) => !kept.includes(id)));
      if (want.length === t.manages.length && want.every((id) => t.manages.includes(id))) continue;
      const names = titlesOf(want);
      for (const id of want) if (!names[id] && t.names && t.names[id]) names[id] = t.names[id];
      stewards.setManaged(steward, want, names, { dir: deps.dir, every: true, paths: plansOf(want), title: nameOf(steward) });
      changed = true;
    }
    for (const [steward, t] of Object.entries(stewards.read(deps.dir))) {
      if (!t.newSince || t.all || !deps.shownHere(steward)) continue;
      const add = newIds(steward, t, table);
      if (!add.length) continue;
      const want = t.manages.concat(add), names = Object.assign({}, t.names, titlesOf(add));
      stewards.setManaged(steward, want, names, { dir: deps.dir, paths: plansOf(add), title: nameOf(steward) });
      changed = true;
    }
    if (changed) deps.changed();
  };

  /* `shown` is the list the page has, or null when it needs the whole page. `again` sends it even when unchanged, so
     that a box the user clicked goes back to its state when the click was not saved. */
  const render = (again = false) => {
    if (!view || !view.visible) return;
    const other = deps.otherFront();
    const list = body(model(last, other ? '' : deps.activeChat(), other));
    if (shown === null) {
      view.webview.html = shell(list, Math.random().toString(36).slice(2) + Date.now().toString(36));
      shown = list;
    } else if (list !== shown || again) {
      shown = list;
      view.webview.postMessage({ type: 'body', html: list });
    }
  };

  /*
   * Notices for the supervisors whose panel this window shows. A notice starts a turn in an idle supervisor, so it is sent
   * only if a conversation began waiting for the user, has more questions for the user than at the last pass, ended a
   * turn that this supervisor's message started or while the supervisor's plan names it, or has background work that ended
   * without finishing. A wait or a new question wakes only one of the conversation's supervisors: of those some window
   * shows, the one the user typed to most recently (ownerOf). The record of which supervisor was given each one
   * (src/steward-watch.js given) keeps the others from putting it to the user again. A supervisor gets at most one notice
   * per NOTICE_GAP_MS; conversations often stop within a minute of each other. What a supervisor has been told is read
   * from its file once and written back as it changes.
   */
  const pending = new Map(), sentAt = new Map(), asked = new Map(), told = new Map(), workAt = new Map();
  /* When each conversation was first seen stopped after working or running background work. Its state counts as
     changed only once it is still stopped activity.STABLE_MS later, since a queued message or a relayed one starts the
     next turn right away. */
  const leftAt = new Map();
  const BUSY = new Set(['working', 'background']);
  const settled = (now) => {
    const after = new Map();
    for (const [id, c] of last) {
      const was = states.get(id);
      let state = c.state;
      if (BUSY.has(was) && !BUSY.has(state) && state !== 'prompt') {
        if (!leftAt.has(id)) leftAt.set(id, now);
        if (now - leftAt.get(id) < activity.STABLE_MS) state = was;
        else leftAt.delete(id);
      } else leftAt.delete(id);
      after.set(id, state);
    }
    for (const id of leftAt.keys()) if (!last.has(id)) leftAt.delete(id);
    return after;
  };
  const userAt = relay.lastUserCache();
  /* For another agent's conversation, the supervisor whose message it got last, read from the file beside its plan that
     its agent writes at the end of each turn (hooks/steward-peek.py reads the same file). */
  const otherStarter = (id) => {
    const file = planFile(id);
    let d = null;
    try { d = file ? JSON.parse(fs.readFileSync(file.replace(/\.json$/, '.reply.json'), 'utf8')) : null; } catch (_) { d = null; }
    const said = d && Array.isArray(d.said) ? d.said : [];
    const f = said.length && said[said.length - 1] ? stewards.senderOf(said[said.length - 1].text) : null;
    return f ? f.steward : '';
  };
  const toldOf = (steward) => {
    if (!told.has(steward)) told.set(steward, watch.load(deps.dir, steward));
    return told.get(steward);
  };
  const notify = async (now = Date.now()) => {
    const table = stewards.read(deps.dir);
    const after = settled(now);
    let records = null, shownSomewhere = null;
    const live = () => records || (records = deps.records());
    const owners = new Map(), starters = new Map();
    const ownerOf = (id) => {
      if (owners.has(id)) return owners.get(id);
      if (!shownSomewhere) shownSomewhere = new Set(windows().flatMap((w) => w.sessions || []));
      const o = stewards.byUser(stewards.stewardsOf(table, id).filter((s) => shownSomewhere.has(s)), (s) => userAt(deps.transcriptOf(s)))[0] || '';
      owners.set(id, o);
      return o;
    };
    const starterOf = (id) => {
      if (!starters.has(id)) starters.set(id, keys.isOther(id) ? otherStarter(id) : relay.turnStarter(deps.transcriptOf(id)));
      return starters.get(id);
    };
    for (const steward of Object.keys(table)) {
      if (!deps.shownHere(steward)) { pending.delete(steward); continue; }
      const manages = table[steward].manages;
      const more = (id) => last.get(id) && asked.has(id) && last.get(id).questions > asked.get(id) && ownerOf(id) === steward;
      const waited = waitedOn(readPlan(steward), manages, table[steward].names);
      const list = stewards.changes(states, after, manages)
        .filter((c) => (c.what === 'waiting' && ownerOf(c.id) === steward) || more(c.id) || waited.has(c.id)
          || (c.what === 'done' && starterOf(c.id) === steward));
      if (now - (workAt.get(steward) || 0) >= WORK_CHECK_MS) {
        workAt.set(steward, now);
        const t = toldOf(steward), running = {};
        for (const id of manages.filter(keys.isClaude)) {
          const cur = watch.runningWork(id, live(), deps.dir), was = t.running[id] || {};
          for (const key of Object.keys(was)) {
            if (cur.includes(key)) continue;
            const why = watch.howEnded(key, id, { transcriptOf: deps.transcriptOf, readState: deps.readState }, was[key]);
            if (why) list.push({ id, what: 'ended', why });
          }
          if (!cur.length) continue;
          running[id] = {};
          for (const key of cur) {
            const st = key.startsWith('job:') ? deps.readState(key.slice(4)) : null;
            running[id][key] = (st && st.state) || '';
          }
        }
        t.running = running;
        // Conversations run by several processes, reported once per set of pids, and old processes stopped since.
        const groups = (deps.duplicates && deps.duplicates()) || new Map(), twice = {};
        for (const id of manages.filter(keys.isClaude)) {
          const g = groups.get(id);
          if (!g) continue;
          twice[id] = g.map((p) => p.pid).join(' ');
          if (t.twice[id] !== twice[id]) list.push({ id, what: 'twice', procs: g });
        }
        t.twice = twice;
        for (const e of duplicates.stopped(deps.dir, t.stoppedAt, now)) {
          if (manages.includes(e.session)) list.push({ id: e.session, what: 'stopped', stop: e });
          t.stoppedAt = Math.max(t.stoppedAt, e.at);
        }
        watch.save(deps.dir, steward, t);
      }
      if (list.length) pending.set(steward, (pending.get(steward) || []).filter((c) => !list.some((x) => replaces(x, c))).concat(list));
    }
    states.clear();
    for (const [id, s] of after) states.set(id, s);
    asked.clear();
    for (const [id, c] of last) asked.set(id, c.questions);
    for (const [steward, list] of pending) {
      if (!table[steward] || now - (sentAt.get(steward) || 0) < NOTICE_GAP_MS) continue;
      const rec = live().find((r) => r && r.sessionId === steward && typeof r.messagingSocketPath === 'string');
      const t = toldOf(steward), names = Object.assign({}, table[steward].names), details = {}, asks = {};
      const given = watch.loadGiven(deps.dir), giving = [];
      // Another supervisor of the conversation that was given it, or ''.
      const holder = (id, k) => { const g = given[id] && given[id][k]; return g && g.steward !== steward && stewards.manages(table, g.steward, id) ? g.steward : ''; };
      for (const c of list) {
        const now = last.get(c.id);
        if (!now || details[c.id]) continue;
        names[c.id] = now.title;
        // Skip the questions this supervisor was given or told of before, and those given to another supervisor.
        const before = t.asked[c.id] || [], qs = now.asks || [], rows = now.askRows || [], mine = [], held = [];
        asks[c.id] = qs.slice();
        qs.forEach((q, i) => {
          if (before.includes(q)) return;
          const k = rows[i] || q, h = holder(c.id, k);
          if (h) held.push({ text: q, steward: h, title: nameOf(h) });
          else { mine.push(q); giving.push([c.id, k]); }
        });
        let waitingOn = now.state !== 'prompt' ? '' : keys.isOther(c.id) ? otherWait(now.waitingFor) : watch.waitingOn(deps.transcriptOf(c.id));
        if (waitingOn) {
          const k = 'wait\n' + waitingOn, h = holder(c.id, k);
          if (h) { held.push({ text: 'it waits on ' + waitingOn, steward: h, title: nameOf(h) }); waitingOn = ''; } else giving.push([c.id, k]);
        }
        details[c.id] = { state: NOTICE_STATE[now.state] || now.state, doing: now.doing, asks: mine, waitingOn, held };
      }
      // Taken off before the post is awaited: a second pass running meanwhile would otherwise send the same notice.
      pending.delete(steward);
      sentAt.set(steward, now);
      const sent = rec ? await deps.post(rec.messagingSocketPath, stewards.noticeText(list, names, details)) : false;
      if (sent) {
        Object.assign(t.asked, asks);
        for (const id of Object.keys(t.asked)) if (!table[steward].manages.includes(id)) delete t.asked[id];
        watch.save(deps.dir, steward, t);
        if (giving.length) {
          const fresh = watch.loadGiven(deps.dir);
          for (const [id, k] of giving) if (!fresh[id] || !fresh[id][k]) (fresh[id] = fresh[id] || {})[k] = { steward, at: now };
          watch.saveGiven(deps.dir, fresh, { now, current: (id) => (last.get(id) ? last.get(id).askRows || [] : null) });
        }
      }
      deps.log(`supervisor ${steward}: ${list.length} change(s) ${sent ? 'sent' : 'not sent, no inbox reached'}`);
    }
  };

  /* Shows a conversation: here if this window has its tab, otherwise by writing a request file for the window that has
     it; another agent's through Agent Plus, which itself says when no window has the conversation open. Returns 'here',
     'sent' or 'nowhere'. */
  const open = async (id) => {
    if (keys.isOther(id)) {
      const p = keys.parse(id), c = last.get(id);
      try { await deps.openOther({ sourceId: p.sourceId, sessionId: p.sessionId, title: c ? c.title : '', cwd: c ? c.cwd : '' }); return 'sent'; }
      catch (e) { deps.log('supervisor panel: ' + ((e && e.message) || e)); return 'nowhere'; }
    }
    if (typeof id !== 'string' || !SESSION.test(id)) return 'nowhere';
    if (deps.shownHere(id) && await deps.reveal(id)) return 'here';
    const w = windows().find((x) => x.pid !== process.pid && x.sessions.includes(id));
    if (!w) return 'nowhere';
    try {
      writeAtomic(path.join(deps.dir, WINDOWS_DIR, w.pid + OPEN_SUFFIX), JSON.stringify({ session: id, at: Date.now() }) + '\n');
      return 'sent';
    } catch (e) {
      deps.log('supervisor panel: ' + ((e && e.message) || e));
      return 'nowhere';
    }
  };
  /* Requests from other windows to show one of this window's conversations. The watch handles them at once; each pass
     also checks, in case the watch missed one. */
  const request = path.join(deps.dir, WINDOWS_DIR, process.pid + OPEN_SUFFIX);
  let requestWatch = null;
  const takeRequest = async (now = Date.now()) => {
    let d = null;
    try { d = JSON.parse(fs.readFileSync(request, 'utf8')); } catch (_) { return false; }
    try { fs.unlinkSync(request); } catch (_) { /* taken already */ }
    if (!d || typeof d.session !== 'string' || !(now - d.at < OPEN_FRESH_MS)) return false;
    if (!await deps.reveal(d.session)) return false;
    deps.focusWindow();
    return true;
  };
  const watchRequests = () => {
    if (requestWatch) return;
    try {
      requestWatch = fs.watch(path.join(deps.dir, WINDOWS_DIR), { persistent: false }, (event, name) => {
        if (name && name !== process.pid + OPEN_SUFFIX) return;
        takeRequest().catch((e) => deps.log('supervisor panel: ' + ((e && e.message) || e)));
      });
      requestWatch.on('error', () => { try { requestWatch.close(); } catch (_) { /* closed */ } requestWatch = null; });
    } catch (_) { requestWatch = null; }
  };

  /* Turns a supervisor's "All, including new ones" (`which` 'all') or "New conversations" ('new') on or off. */
  const setSwitch = (steward, which, on) => {
    const t = stewards.read(deps.dir)[steward];
    const mine = t ? t.manages : [];
    if (which === 'all') {
      const list = on ? everyIds(steward, stewards.read(deps.dir)) : mine;
      return stewards.setManaged(steward, list, titlesOf(list), { dir: deps.dir, every: on, ticked: t && t.all ? t.ticked : mine,
        paths: plansOf(list), title: nameOf(steward) });
    }
    return stewards.setManaged(steward, mine, titlesOf(mine), { dir: deps.dir, later: on, before: otherKeys(), paths: plansOf(mine), title: nameOf(steward) });
  };
  const named = (given, steward, table, onList) => {
    const g = String(given || '').trim(), key = keys.managedId(g);
    const t = table[steward] || { manages: [], names: {} };
    if (key) return { key };
    const titleOf = (id) => (last.get(id) && last.get(id).title) || (t && t.names[id]) || '';
    const pool = onList ? t.manages : [...new Set([...last.keys()].concat(t.manages))];
    const hits = pool.filter((id) => titleOf(id) === g);
    if (hits.length === 1) return { key: hits[0] };
    if (!hits.length) return { why: `no conversation${onList ? ' on this supervisor\'s list' : ' open in a VS Code window'} has the title "${g}"; give its session id` };
    return { why: `${hits.length} conversations have the title "${g}" (${hits.join(', ')}); give the session id of the one meant` };
  };
  /*
   * Archives conversations for a supervisor whose user asked for it in that supervisor conversation (src/relay.js checks
   * that). Of `ids`, those the supervisor manages that are not working, waiting for the user or running background work go
   * to Agent Plus's archive() (stewardCore.archiveIn); each of the others gets the reason it was not archived. A
   * conversation the panel does not list is checked in `claude agents --json`: one a process or a working claude --bg
   * job holds is left alone, since its state is not known here.
   */
  const BUSY_NOW = { working: 'it is working', prompt: 'it is waiting for the user', background: 'it is running background work' };
  const archiveFor = async (steward, ids) => {
    const table = stewards.read(deps.dir);
    let records = null;
    try { const got = await deps.freshAgents(); records = got && Array.isArray(got.records) ? got.records : null; } catch (_) { records = null; }
    const results = [], go = [];
    for (const id of ids) {
      const c = last.get(id), title = nameOf(id);
      const no = (reason) => results.push({ sessionId: id, title: title !== id ? title : '', outcome: 'refused', reason });
      if (!stewards.manages(table, steward, id)) { no('it is not a conversation this supervisor manages'); continue; }
      if (c && BUSY_NOW[c.state]) { no(`${BUSY_NOW[c.state]}; archive it once it has stopped`); continue; }
      if (!c && !records) { no('it could not be checked that nothing runs it, since `claude agents --json` gave no list'); continue; }
      const held = c ? '' : relay.heldBy(records, id, deps.alive);
      if (held) { no(`${held}, and whether it is working is not known here`); continue; }
      go.push(id);
      results.push({ sessionId: id, title: title !== id ? title : '', outcome: '' });
    }
    const got = go.length ? await stewardCore.archiveIn(core(), go) : [];
    for (const r of results) {
      if (r.outcome) continue;
      const g = got.find((x) => x.sessionId === r.sessionId) || { outcome: 'refused', reason: 'Agent Plus gave no answer for it' };
      r.outcome = g.outcome;
      r.reason = g.outcome === 'notListed' ? 'no session list in an open VS Code window shows it' : g.reason;
    }
    if (go.length) render(true);
    return { outcome: 'submitted', reason: '', results };
  };

  /*
   * Carries out a supervisor's request to change its own list: `take` or `drop` one conversation, or turn `all` or `new`
   * on or off. The user made the request in that supervisor conversation, which src/relay.js checks.
   */
  const listChange = (steward, action, target) => {
    const refuse = (reason) => ({ outcome: 'refused', reason });
    if (!writes()) return refuse('this window runs an earlier build of Claude Code Plus than the one now installed, so it does not save the list; reload the window');
    const table = stewards.read(deps.dir);
    if (!table[steward]) return refuse(stewards.stewardsOf(table, steward).length ? 'a supervisor manages this conversation' : 'this conversation is not a supervisor');
    const t = table[steward];
    const done = (reason) => { deps.changed(); render(true); return { outcome: 'submitted', reason }; };
    if (action === 'all' || action === 'new') {
      const on = target === 'on', name = action === 'all' ? 'All, including new ones' : 'New conversations';
      const was = action === 'all' ? t.all : !!t.newSince;
      if (was === on) return { outcome: 'submitted', reason: `${name} was already ${target}` };
      setSwitch(steward, action, on);
      return done(`${name} is now ${target} for this supervisor in the Supervisor panel`);
    }
    const n = named(target, steward, table, action === 'drop');
    if (n.why) return refuse(n.why);
    const id = n.key, label = `"${nameOf(id)}" (${id})`;
    if (action === 'take') {
      if (id === steward) return refuse('a supervisor does not manage itself');
      if (table[id]) return refuse(`${label} is a supervisor, so no supervisor can manage it`);
      if (!keys.isClaude(id) && !keys.allowed(id)) return refuse(`a supervisor cannot manage ${keys.labelOf(id)} conversations`);
      if (t.manages.includes(id)) return { outcome: 'submitted', reason: `${label} was already ticked for this supervisor` };
      if (t.all) return { outcome: 'submitted', reason: `All, including new ones, is on, so this supervisor manages ${label} already` };
      stewards.setManaged(steward, t.manages.concat(id), Object.assign(titlesOf(t.manages), { [id]: nameOf(id) }),
        { dir: deps.dir, ticked: t.ticked.concat(id), paths: plansOf([id]), title: nameOf(steward) });
      return done(`${label} is now ticked for this supervisor in the Supervisor panel`);
    }
    if (t.all) return refuse('All, including new ones, is on, so this supervisor manages every conversation; turn it off first with --all off');
    if (!t.manages.includes(id)) return refuse(`${label} is not on this supervisor's list`);
    stewards.setManaged(steward, t.manages.filter((x) => x !== id), titlesOf(t.manages), { dir: deps.dir, paths: plansOf(t.manages), title: nameOf(steward) });
    return done(`${label} is no longer ticked for this supervisor in the Supervisor panel`);
  };

  /* A supervisor's requests for a conversation this window shows, for a new one in a folder it has open, or to open one
     started in such a folder, and handoffs to a supervisor this window shows (src/relay.js).
     The folder is watched, and each pass also looks, in case the watch missed one or the folder did not exist yet when
     the watch was set. */
  let relayWatch = null, relaying = false;
  const takeRelays = async () => {
    if (relaying || !deps.canShare()) return;
    relaying = true;
    try {
      /* A conversation the list has not caught up with, such as one just opened, is named as the one in front is. */
      const titleOf = (id) => {
        const t = (last.get(id) && last.get(id).title)
          || conversations.claudeTitle({ sessionId: id, name: '', cwd: '' }, deps.titles({ sessionId: id }), () => deps.readPlan(id));
        return t && t !== id ? t : '';
      };
      for (const r of await relay.take(deps.dir, { shownHere: deps.shownHere, stewards: () => stewards.read(deps.dir),
        transcriptOf: deps.transcriptOf, deliver: deps.deliver, rename: deps.rename, close: deps.close, open: deps.open,
        resume: deps.resume, folders: deps.windowFolders, windows: () => windows(), agents: deps.agentsFresh || deps.freshAgents,
        records: deps.records, post: deps.post, titleOf, deliverOther: (key, text) => stewardCore.deliverTo(core(), key, text),
        later: (r) => deps.log(`supervisor relay to ${r.to}: ${r.outcome}${r.reason ? ' (' + r.reason + ')' : ''}`),
        manage: (steward, id) => {
          if (!writes()) return false;
          const t = stewards.read(deps.dir)[steward];
          if (!t) return false;
          const after = t.manages.includes(id) ? stewards.read(deps.dir)
            : stewards.setManaged(steward, t.manages.concat(id), Object.assign(titlesOf(t.manages), { [id]: titleOf(id) }),
              { dir: deps.dir, ticked: t.ticked.concat(id), title: nameOf(steward) });
          deps.changed();
          return !!(after[steward] && after[steward].manages.includes(id));
        },
        list: listChange,
        archive: archiveFor,
        pid: process.pid })) {
        deps.log(`supervisor ${r.action === 'send' ? 'relay' : r.action} to ${r.to}: ${r.outcome}${r.reason ? ' (' + r.reason + ')' : ''}`);
      }
    } catch (e) { deps.log('supervisor relay: ' + ((e && e.message) || e)); } finally { relaying = false; }
  };
  const watchRelays = () => {
    if (relayWatch) return;
    try {
      relayWatch = fs.watch(path.join(deps.dir, relay.RELAY_DIR), { persistent: false }, (event, name) => {
        if (name && !/^[0-9a-f-]{36}\.json$/i.test(name)) return;
        takeRelays();
      });
      relayWatch.on('error', () => { try { relayWatch.close(); } catch (_) { /* closed */ } relayWatch = null; });
    } catch (_) { relayWatch = null; }
  };

  /* Skipped while the panel is hidden and no supervisor here needs notices: a pass reads every plan and transcript end. */
  /* Said once per window. */
  let toldNewer = false;
  const pass = async () => {
    if (!deps.enabled()) { link.want(false); return; }
    if (busy) return;
    publish();
    watchRequests();
    await takeRequest();
    watchRelays();
    await takeRelays();
    // Listening keeps Agent Plus's list and attention files current (src/steward-core.js), so it is done only while
    // this window needs them.
    const needed = (view && view.visible) || Object.keys(stewards.read(deps.dir)).some((id) => deps.shownHere(id));
    link.want(needed);
    if (!needed) return;
    busy = true;
    try {
      const r = await deps.freshAgents();
      if (planSeen.size > 1000) planSeen.clear();
      recorded = recordedPaths();
      last = gather(r && r.records, cached);
      if (writes()) {
        const v = stewards.newer(deps.dir);
        if (v && !toldNewer) {
          toldNewer = true;
          deps.log(`supervisor panel: stewards.json is version ${v}, from a later build of Claude Code Plus; this window reads it and does not write it`);
        }
        if (stewards.migrate(deps.dir)) deps.log('supervisor panel: rewrote stewards.json so that no supervisor is on a list');
        const names = {};
        for (const [id, c] of last) names[id] = c.title;
        stewards.rename(names, { dir: deps.dir });
        syncEvery();
      }
      render();
      await notify();
    } catch (e) {
      deps.log('supervisor panel: ' + ((e && e.message) || e));
    } finally { busy = false; }
  };

  const onMessage = async (m) => {
    const front = frontNow();
    if (m && m.type === 'ready') { if (view) view.webview.postMessage({ type: 'body', html: shown || '' }); return; }
    if (m && m.type === 'stop-old' && typeof m.id === 'string') {
      const p = deps.stopDuplicate ? deps.stopDuplicate(m.id) : null;
      noticeTime.info(vscode, p ? `Stopped process ${p.pid} of that conversation.`
        : 'That conversation is no longer run by more than one process, or its old process could not be stopped.');
      /* Without this, the row would say two processes until the next poll: the list is read every half second until the
         stopped process has left it, for five seconds at most. */
      if (p && deps.rereadDuplicates) {
        let tries = 0;
        const again = () => {
          try { deps.rereadDuplicates(); } catch (_) { /* the next poll reads it */ }
          render();
          const group = deps.duplicates ? deps.duplicates().get(m.id) : null;
          if (group && group.some((x) => x && x.pid === p.pid) && ++tries < 10) setTimeout(again, 500);
        };
        setTimeout(again, 300);
      }
      return;
    }
    if (m && m.type === 'open' && typeof m.id === 'string') {
      if (await open(m.id) === 'nowhere') noticeTime.info(vscode, 'That conversation is not open in any VS Code window on this machine.');
      return;
    }
    if (m && m.type === 'reload') { await deps.reload(); return; }
    if (!m || !front) return;
    if (!writes()) {
      if (deps.replaced()) { tellStale(); render(true); }
      return;
    }
    const table = stewards.read(deps.dir);
    const mine = new Set(table[front] ? table[front].manages : []);
    if (m.type === 'every' || m.type === 'later') {
      setSwitch(front, m.type === 'every' ? 'all' : 'new', m.on === true);
      render(true);
      deps.changed();
      return;
    }
    // While it manages all, nothing can be unticked or ticked by hand.
    if (table[front] && table[front].all) return;
    const free = (id) => !lockOf(table, id).lock;
    if (m.type === 'toggle' && typeof m.id === 'string') { if (!m.on) mine.delete(m.id); else if (free(m.id)) mine.add(m.id); }
    else if (m.type === 'group' && typeof m.key === 'string') {
      const g = model(last, front).groups.find((x) => x.key === m.key);
      for (const c of g ? g.rows : []) { if (!m.on) mine.delete(c.sessionId); else if (!c.lock) mine.add(c.sessionId); }
    }
    else if (m.type === 'all') for (const c of model(last, front).rows) { if (!c.lock) mine.add(c.sessionId); }
    else if (m.type === 'none') mine.clear();
    else if (m.type === 'drop-hidden') for (const id of model(last, front).hiddenIds) mine.delete(id);
    else return;
    stewards.setManaged(front, [...mine], titlesOf(mine), { dir: deps.dir, paths: plansOf(mine), title: nameOf(front) });
    render(true);
    deps.changed();
  };

  const provider = {
    resolveWebviewView(v) {
      view = v;
      v.webview.options = { enableScripts: true };
      v.webview.onDidReceiveMessage((m) => { onMessage(m).catch((e) => deps.log('supervisor panel: ' + ((e && e.message) || e))); });
      v.onDidChangeVisibility(() => { shown = null; render(); });
      v.onDidDispose(() => { if (view === v) view = null; });
      shown = null;
      render();
      pass();
    },
  };
  const reg = vscode.window.registerWebviewViewProvider(VIEW, provider, { webviewOptions: { retainContextWhenHidden: false } });
  const themeWatch = envelope.onEnvelopeChange(vscode, () => render());
  timer = setInterval(() => {
    const now = frontKey();
    if (now !== lastFront) { lastFront = now; render(); }
    pass();
  }, REFRESH_MS);
  return {
    dispose() {
      clearInterval(timer);
      link.dispose();
      reg.dispose();
      themeWatch.dispose();
      if (requestWatch) { try { requestWatch.close(); } catch (_) { /* closed */ } }
      if (relayWatch) { try { relayWatch.close(); } catch (_) { /* closed */ } }
      if (published) windowEntries.withdraw(deps.dir);
    },
    refresh() { render(); },
    /* Given null when the registration with Agent Plus ends. */
    attachCore(next) { link.attach(next); },
    open,
    /* Whether this window keeps the files every window shares; writesTable decides. */
    keepsShared: () => writes(),
    /* The title the panel uses for a conversation. */
    titleOf: (id) => nameOf(id),
    _gather: gather, _model: model, _notify: notify, _pass: pass, _onMessage: onMessage, _takeRequest: takeRequest, _syncEvery: syncEvery,
    _takeRelays: takeRelays, _archive: archiveFor, _writes: writes, _last: () => last, _listening: () => link.listening(), _listChange: listChange,
  };
}

module.exports = { create, gather, grouped, doingRows, waitedOn, otherWait, body, shell, writesTable, VIEW, REFRESH_MS, NOTICE_GAP_MS, WORK_CHECK_MS, WINDOWS_DIR };
