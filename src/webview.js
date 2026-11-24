// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * First patch target: the Claude Code chat panel (webview/index.js inside the Claude Code extension).
 *
 * The panel is an ordinary web page. Everything this file adds is either information the panel already receives and
 * throws away, or a control built from data it already holds — nothing is fetched, guessed or persisted.
 *
 * Nine edits, each matching a code SHAPE rather than a name, because identifiers in a minified bundle change with
 * every build:
 *
 *   message builder    Each chat message is rebuilt from the CLI message, but `timestamp` is dropped, so a rebuilt
 *                      message falls back to Date.now() and reopened history would read "now". Pass the real time.
 *   tool result        When a tool result arrives, record its time on the tool row, so a call can show start and end.
 *   session createdAt  Carry the session's creation time into the session-list model.
 *   session time       Wrap the relative time in the list with the absolute date range, and for a pinned
 *                      conversation whose files were given a later time, the time it was really last active.
 *   session pin        A pin at the start of every row of the session list (src/sessionpins.js says what
 *                      pinning does).
 *   context meter      Two: move the thresholds of the three artwork states to the limit each arc can show, and drop
 *                      the guard that hides the meter while more than half the window is free. Both apply only
 *                      while the meter switch is on (70-meter.js).
 *   agent map          Four: a section for this session's scheduled prompts, the footer button opening for a
 *                      schedule even with no agent, a label that then does not read "0 agents" and a dot that is
 *                      green while any of its background work runs, and the conversation's own row in the map
 *                      drawn with the dot its tab has.
 *   open finished      Opening a conversation counts as finished in a background tab too, where the page gets no
 *                      animation frames, so a tab loaded behind others is still reopened after later reloads.
 *   wait notices       Two: Claude Code's own notice of a permission request (which also covers a question and a plan
 *                      to review) and of auto mode's Continue or Stop dialog is left out while Agent Plus tells of the
 *                      same waits (src/waiting-for.js); the panel's state report says what it waits for.
 *
 * Then this file appends a script that reads those times back out of React props and marks rows through an attribute,
 * plus the table of contents, the view filter, the context breakdown and the chime. A row whose real time it cannot
 * read shows nothing rather than a guessed time.
 *
 * NOTHING OF OURS GOES INSIDE A NODE THE PANEL OWNS. Reading a node's position, adding a sibling, setting an attribute
 * or an inline style are all fine; appending a child is not. One line appended to the panel's own usage tooltip
 * collided with its next redraw, and after that throw the page stopped handling clicks and keys altogether - the stop
 * button and Escape died together, with nothing visible to say why. Where a section really has to sit among the
 * panel's own children, an edit hands our code the panel's element factory and the panel renders what we return.
 *
 * LIVE SETTINGS, NO RELOAD. How the marks look — on or off, and the user's message color — is not baked into the
 * script. It lives in a stylesheet next to the panel that the extension rewrites when a setting changes. The panel's
 * security policy allows stylesheets and images from its own folder, so the script polls a one-pixel SVG whose WIDTH
 * is a revision number and reloads the stylesheet only when that number changes. Only installing or upgrading the
 * patch itself needs a reload.
 *
 * NEITHER OF THOSE LOADS MAY BLOCK THE FIRST PAINT. Both files are on a remote file system here, so a naive load holds
 * the panel blank for a round trip every time it opens. The stylesheet goes in under media=print and is switched to all
 * once it has arrived; its address carries the revision rather than the clock, so a panel can reuse one it already has;
 * and the probe is an image, which never blocked anything.
 *
 * DISCIPLINE. Every edit must match exactly once or nothing at all is written; the result must parse; the untouched
 * original is saved beside the file before the first write; the replacement is atomic; and Remove or uninstall puts
 * the original back. A build whose shape does not match is left alone with a warning rather than patched on a guess.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const { applyEdits, shapesOf } = require('./edits');
const files = require('./files');
const { patchTarget } = require('./patch-target');
const tabdot = require('./tabdot');
const envelope = require('./envelope');

const VERSION = 37;

/* The marker written into the patched file has to answer one question: is the code in
 * the panel the code this tree produces? A hand-maintained number answers it only while
 * someone remembers to change it, and forgetting is silent in the worst way -- packaging,
 * installing and reloading all report success while the panel keeps running the old code,
 * so the symptom is an edit that has no effect anywhere and no step that complained.
 *
 * So the number is decoration and the digest is the answer: it covers the injected script
 * and the edits made inside the bundle, which is everything patching changes. Nothing to
 * remember, and a stale patch cannot look current. VERSION stays because a human reading
 * the file wants a number, not a hash. */
const MARK_PREFIX = '/* CLAUDE-CODE-EXTRAS-WEBVIEW ';
const ANY_MARK = MARK_PREFIX;
const BACKUP_SUFFIX = '.claude-code-extras-webview.bak';
/*
 * Live settings. How the marks look - on or off, and the colour of the user's own messages - is not baked into the
 * injected script. It lives in a stylesheet written into the panel's own folder, which the page reloads when a
 * revision number changes. The indirection exists because the panel's content security policy refuses an injected
 * <style> element but does allow a stylesheet served from that folder.
 */
const ATTR = 'data-cce-ts';
const LIVE_CSS = 'claude-code-extras.css';
const LIVE_REV = 'claude-code-extras.rev.svg';
/* One per conversation: where each reply's effort changed, written by src/efforts.js and read by the page. */
const EFFORT_PREFIX = 'claude-code-extras.effort.';
const EFFORT_FILE = /^claude-code-extras\.effort\.([0-9a-f-]{36})\.css$/i;
/*
 * How often the page re-checks that revision number. Every check is a file request, and on a remote host that is a
 * round trip over the remote channel - once per open panel, whether or not anyone is looking at it. So this trades how
 * quickly a changed setting shows up against how much traffic idle panels generate; a couple of seconds still reads as
 * immediate to someone who just flipped a switch.
 */
const POLL_MS = 3000;

/** How the panel marks the user's own messages. */
const USER_SELECTOR = '[class*="userMessage_"]';

/*
 * The stamp wraps when its column is too narrow, but only at a normal space: 35-marks.js puts no-break spaces inside
 * each part. white-space is normal rather than the pre-wrap of the reply text it sits in, which would keep the two spaces
 * after the time; overflow-wrap breaks inside a part only when that part alone is wider than the column.
 *
 * Its size is the panel's text size, the one its body is set in, rather than the size of the element it goes on: on a
 * reply that starts with a heading, that element is the heading.
 */
const STAMP_CSS = `[${ATTR}]::before{content:attr(${ATTR});display:inline-block;margin-inline-end:.7em;`
  + 'unicode-bidi:isolate;vertical-align:baseline;font-family:var(--vscode-editor-font-family,monospace);'
  + 'font-size:calc(var(--vscode-chat-font-size, 13px) * .8);font-weight:normal;font-style:normal;opacity:.6;white-space:normal;'
  + 'overflow-wrap:anywhere;}';

/*
 * A bar down the left edge of what you said - carried by the injected script rather than by the live stylesheet.
 *
 * The panel does tell your messages apart already, with a one pixel border and a background from theme variables, and in
 * most themes both land within a shade of the editor's own background, so a question and the reply to it read as one
 * stream. This raises the contrast of the distinction that is there instead of adding a second one, and it does it on an
 * edge rather than as a fill: a coloured block behind text competes with the text, and every hue this panel uses already
 * means something - green succeeded, red failed, amber warned - so a tinted message would read as one carrying a status.
 *
 * It lives here because the live stylesheet is a single file shared by every window, and the rule kept appearing and
 * disappearing: a window still running an older build of this extension overwrites that file without knowing the rule
 * exists, and nothing can be written today that stops a host already running. The injected script comes from the patched
 * bundle, which every host patches to the same bytes, so this is the same for all of them.
 *
 * Which leaves the switch, and the switch is a multiplier: an absent custom property counts as 1, so the bar is on unless
 * the stylesheet says otherwise, and a stylesheet written by a build that knows nothing about it cannot turn it off.
 */
const EDGE_CSS = `${USER_SELECTOR}{`
  + 'border-left:calc(3px * var(--cce-edge, 1) * var(--cce-on, 1)) solid '
  + 'var(--vscode-focusBorder, var(--vscode-textLink-foreground)) !important;'
  + 'padding-left:calc(6px + 2px * var(--cce-edge, 1) * var(--cce-on, 1)) !important;}';

/* The session list's dots in the tab icons' green and red (src/tabdot.js), and a steward's crown and the envelope
   between the title and the time, in that order (src/page/84-row-marks.js): the row lays its children out in a row and
   the title takes the space left, so the crown and the envelope keep their size beside a title cut short, and moving
   the time after them keeps the times of all rows lined up at the right. The envelope is drawn here, in the form src/envelope.js gives for the page's theme class, so a theme change redraws it. */
const cssChars = (s) => [...String(s)].map((c) => '\\' + c.codePointAt(0).toString(16).toUpperCase() + ' ').join('').trim();
const LIGHT_BODY = ['body.vscode-light', 'body.vscode-high-contrast-light'];
const LIST_DOTS_CSS = `[class*="sessionItem_"]{--app-status-busy:${tabdot.GREEN};--app-status-pending:${tabdot.RED};}`
  + '[class*="sessionItem_"]>[data-cce-envelope]{order:1;flex:none;line-height:1;}'
  + '[class*="sessionItem_"]>[class*="sessionMeta_"]{order:2;}'
  + `[data-cce-envelope]::after{content:"${cssChars(envelope.COLOUR)}";}`
  + `${LIGHT_BODY.map((b) => `${b} [data-cce-envelope]::after`).join(',')}{content:"${cssChars(envelope.TEXT)}";}`
  + '[class*="sessionItem_"]>[data-cce-crown]{order:1;flex:none;line-height:1;}';
/* The same green and red for the dot on the footer's agents button and for every dot in the agent map it opens, whose
   tree of rows (rowMain_ is the conversation's own row) is drawn in every view of it. Two rules, so a browser that
   cannot read :has() still colours the button. */
const DOT_COLOURS = `{--app-status-busy:${tabdot.GREEN};--app-status-pending:${tabdot.RED};}`;
const MAP_DOTS_CSS = `[class*="agentsPill_"]${DOT_COLOURS}[role="dialog"]:has([class*="rowMain_"])${DOT_COLOURS}`;

/** A CSS colour the user typed, or '' when it is not a plain colour - nothing else may reach the stylesheet. */
function safeColor(value) {
  const v = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]{3,30}$/.test(v) || /^(rgb|rgba|hsl|hsla)\([0-9.,%\s/deg]+\)$/.test(v)) return v;
  return '';
}

/*
 * The scheduled prompts, carried to the page as a custom property.
 *
 * Base64, because the value has to survive as a CSS string and a prompt is full of quotes and newlines that a
 * stylesheet would reject; base64 is nothing but letters, digits and three punctuation marks. The page is the only
 * consumer, so this is a private encoding between the two halves rather than anything a user sees.
 */
function scheduleProperty(tasks) {
  if (!Array.isArray(tasks) || !tasks.length) return '';
  return `:root{--cce-schedule:"${Buffer.from(JSON.stringify(tasks), 'utf8').toString('base64')}";}\n`;
}

/* The detached sessions each conversation started, for the same section of the agent map - same encoding, same reason. */
function backgroundProperty(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return `:root{--cce-background:"${Buffer.from(JSON.stringify(list), 'utf8').toString('base64')}";}\n`;
}

function detachedProperty(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const rows = list.map((j) => ({ session: j.session, pid: j.pid, startedAt: j.startedAt, command: j.command,
    ...(typeof j.title === 'string' && j.title ? { title: j.title } : {}),
    ...(Array.isArray(j.workers) && j.workers.length ? { workers: j.workers } : {}) }));
  return `:root{--cce-detached:"${Buffer.from(JSON.stringify(rows), 'utf8').toString('base64')}";}\n`;
}

/* The `claude -p` workers each conversation started (workerRows in src/background.js) - same encoding. */
function workersProperty(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return `:root{--cce-workers:"${Buffer.from(JSON.stringify(list), 'utf8').toString('base64')}";}\n`;
}

/*
 * The pinned conversations, for the pins on the session list - same encoding. Written while pinning is on, even with
 * nothing pinned, because its presence is what tells the page to draw the pins: a stylesheet without it comes from a
 * host that would not act on a click.
 */
function pinsProperty(data) {
  if (!Array.isArray(data)) return '';
  return `:root{--cce-pins:"${Buffer.from(JSON.stringify(data), 'utf8').toString('base64')}";}\n`;
}

/* The conversations run by several editor processes at once (src/duplicates.js), as [[session ID, count], ...] in
   session ID order, for a mark on their rows in the session list - same encoding. Absent while there are none. */
function duplicatesProperty(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return `:root{--cce-dups:"${Buffer.from(JSON.stringify(list), 'utf8').toString('base64')}";}\n`;
}

/*
 * The session list's text colors, in the same encoding: [1, [[session ID, name], ...]] in session ID order. The leading
 * 1 keeps the property present when nothing is colored, and the page offers Text color only while the property is
 * there.
 */
function colorsProperty(colors) {
  if (!colors || typeof colors !== 'object') return '';
  const pairs = Object.keys(colors).sort().map((id) => [id, colors[id]]);
  return `:root{--cce-colors:"${Buffer.from(JSON.stringify([1, pairs]), 'utf8').toString('base64')}";}\n`;
}

/*
 * This extension's own version and id, taken from its manifest rather than passed in by a caller, so that forgetting to
 * thread them through could not quietly disable the rule in writeLive that depends on them.
 */
const SELF = (() => {
  try {
    const p = require('../package.json');
    return { version: String(p.version || ''), id: String(p.publisher || '') + '.' + String(p.name || '') };
  } catch (_) { return { version: '', id: '' }; }
})();
const OURS = SELF.version;
const VERSION_LINE = /^\/\* Claude Code Extras ([0-9][0-9.]*) live settings/m;

/** Whether the first version is behind the second, comparing dot-separated numbers. */
function older(a, b) {
  const pa = String(a).split('.'), pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i]) || 0, y = Number(pb[i]) || 0;
    if (x !== y) return x < y;
  }
  return false;
}

/*
 * Whether a build of this extension carrying `version` is one the editor currently has installed.
 *
 * Read from the editor's own registry of installed extensions, not from the directory names beside it: a replaced
 * version's folder is left on disk, so a name scan answers yes for a build nobody runs. `null` means the registry could
 * not be read, which a caller has to tell apart from a plain no.
 */
function installedHere(extensionsDir, version) {
  let list;
  try { list = JSON.parse(fs.readFileSync(path.join(extensionsDir, 'extensions.json'), 'utf8')); } catch (_) { return null; }
  if (!Array.isArray(list)) return null;
  return list.some((e) => e && e.identifier && e.identifier.id === SELF.id && String(e.version || '') === String(version));
}

/*
 * The additions that can be switched off one at a time, and what each is expected to stop doing.
 *
 * A switch has to stop the work and not only the drawing. Hiding a figure the sweep still computes for every row on
 * every refresh leaves the whole cost in place and gives a person a switch that appears to do something - which is worse
 * than having no switch, because the next question is why turning things off did not help.
 */
const SWITCHES = [
  'timestamps',       // the time in front of your messages and every block of a reply
  'replyDuration',    // how long a reply took, at the front of its figures
  'contextShare',     // ctx N% in those figures
  'cost',             // cost $N in those figures
  'modelName',        // which model, effort and fast mode produced the reply
  'subAgentTags',     // which sub-agent a row came from
  'toc',              // the handle on the right edge, and the list of your messages behind it
  'contextMeter',     // the usage meter kept on screen after the panel would have hidden it
  'chime',            // the three sounds at the end of a turn
  'sessionDates',     // how long each session ran, on the session list
  'footerInfo',       // the info button and what it shows
  'footerPlainView',  // the button that turns Claude Code's Focus view on and off
  'footerViewFilter', // main thread versus one sub-agent
  'footerMute',       // the button that silences the chimes
  'backgroundSessions', // the `claude --bg` sessions a conversation started, in its agent map
  'detachedCommands', // the commands a conversation left running detached, in its agent map
  'replyImages',      // image files and data: images in a reply drawn as images
  'openSessions',     // OPEN SESSIONS at the top of the session list
  'openInTabOrSidebar', // New in tab / New in sidebar, and Resume in tab / Resume in sidebar on the session list
  'deleteArchived',   // Delete in the Archived sessions menu
  'sessionHoverDetails', // a session list row's group and session ID on hover
  'sessionIdSearch',  // the session list's search also matching part of a session ID
  'sessionColors',    // a conversation's text color in the session list, and Text color in its menu
  'conversationLinks', // another conversation's title or session id in a reply drawn as a link that opens it
  'planBar',          // the line above the input box saying where the conversation's work plan stands
];

/** The live stylesheet for one set of settings. */
function liveCss(opts = {}) {
  const on = opts.enabled !== false;
  const color = safeColor(opts.userColor);
  const off = SWITCHES.filter((k) => (opts.off || []).includes(k));
  let css = `/* Claude Code Extras ${OURS} live settings - written by the extension */\n:root{--cce-on:${on ? 1 : 0};}\n`;
  /* Kept whenever anything is on: this one rule renders the attribute that carries the time, the sub-agent tag, the
     duration and the figures, so dropping it would switch off four things instead of one. */
  if (on) css += STAMP_CSS + '\n';
  if (on) css += LIST_DOTS_CSS + '\n' + MAP_DOTS_CSS + '\n';
  /* Claude Code (2.1.284 and later) draws its own time on your messages and on replies with text: at the top right, in
     its own format, and on those two kinds only. Shown beside this script's, the same message carried two times in two
     places, and a reply's tool calls a third format - so while this script's times are on, Claude Code's are hidden and
     one kind of time is shown everywhere. Its date line where the day changes is another element and stays. */
  if (on && !off.includes('timestamps')) css += '[data-message-stamp] time{display:none !important;}\n';
  if (color) css += `${USER_SELECTOR},${USER_SELECTOR} *{color:${color} !important;}\n`;
  /* The bar itself is in the injected script; this is only the switch that turns it off, written as nothing at all when
     it is on so that a stylesheet carries no trace of a setting left at its default. */
  if (opts.userEdge === false) css += ':root{--cce-edge:0;}\n';
  /* One property per addition switched off; absent means on, so the stylesheet lists only departures from the defaults
     and a build that predates a switch treats it as on. Written in SWITCHES order so that every window produces the
     same bytes.

     `on` switches only the marks; the off flags, the agent map's detached commands, scheduled prompts and background
     sessions, the pins and the text colors below are written either way. */
  if (off.length) css += ':root{' + off.map((k) => `--cce-off-${k}:1;`).join('') + '}\n';
  css += scheduleProperty(opts.tasks);
  if (!off.includes('backgroundSessions')) css += backgroundProperty(opts.background) + workersProperty(opts.workers);
  if (!off.includes('detachedCommands')) css += detachedProperty(opts.detached);
  css += pinsProperty(opts.pins);
  if (!off.includes('sessionColors')) css += colorsProperty(opts.colors);
  css += duplicatesProperty(opts.dups);
  return css;
}

/*
 * The in-page script is assembled from the fragments in src/page, in file-name order, inside one closure.
 *
 * They are real .js files rather than one template literal on purpose. In a template literal every backslash has to be
 * doubled to survive evaluation, and getting that wrong fails only at runtime: `/\s+/` evaluated to `/s+/` that way
 * and quietly replaced the letter s in every label it passed through. As files, an editor, a linter and `node --check`
 * all read them as the code they are.
 *
 * They are fragments, not modules: no imports, no exports, and every binding one declares is visible to all the
 * others. File-name order is load order, so anything that runs on load belongs in the last fragment - by then every
 * function it calls has been assigned.
 */
const PAGE_DIR = path.join(__dirname, 'page');

function pageFragments() {
  return fs.readdirSync(PAGE_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => ({ name: f, code: fs.readFileSync(path.join(PAGE_DIR, f), 'utf8').replace(/\s+$/, '') }));
}

/** What the extension decides and the page cannot: the mark attribute, the live stylesheet, the fallback rules. */
/* The marks src/title-marks.js takes off a title, each with its variation selector: the page strips a title typed in the
   session list's rename box the same way (84-row-marks.js). The page itself names no mark, since the envelope it draws
   comes from the stylesheet in the form for the theme. */
const TITLE_MARKS = String.raw`(?:\u{1F451}|\u{1F6CE}|\u{1F4E9}|\u2709)[\uFE0E\uFE0F]?`;

function configBlock() {
  return [
    `  var TITLE_MARKS = new RegExp(${JSON.stringify(TITLE_MARKS)}, 'gu');`,
    `  var ATTR = ${JSON.stringify(ATTR)};`,
    `  var STAMP_CSS = ${JSON.stringify(STAMP_CSS)};`,
    `  var EDGE_CSS = ${JSON.stringify(EDGE_CSS)};`,
    `  var LIVE_CSS = ${JSON.stringify(LIVE_CSS)};`,
    `  var LIVE_REV = ${JSON.stringify(LIVE_REV)};`,
    `  var EFFORT_PREFIX = ${JSON.stringify(EFFORT_PREFIX)};`,
    `  var POLL_MS = ${POLL_MS};`,
  ].join('\n');
}

/** The injected script without its marker: the marker is a digest of this, so it cannot
 *  also be part of it. */
function buildBody() {
  const parts = pageFragments().map((p) => `  /* ${p.name} */\n${p.code}`);
  return [';(function(){try{',
    '  if (window.__claudeCodeExtras) return; window.__claudeCodeExtras = true;',
    configBlock(), ...parts, '}catch(e){}})();'].join('\n');
}

const SCRIPT_BODY = buildBody();

/* The check the two meter edits insert into the meter's render: whether the meter is kept on screen (70-meter.js).
   Without the page's function the meter behaves as in Claude Code. */
const METER_KEPT = '(typeof window.__cceMeterKept==="function"&&window.__cceMeterKept())';

/* The tool of the permission request in front, or the kind of the panel's dialog (src/waiting-for.js reads it). `s` is
   the expression for the panel's session. */
const WAIT_OF = (s) => `(()=>{try{let cceR=${s}.permissionRequests.value[0];if(cceR)return{tool:String(cceR.toolName??"")};`
  + `let cceD=${s}.userDialogRequests.value[0];if(cceD)return{dialog:String(cceD.dialogKind??"")}}catch(cceE){}return void 0})()`;
/* The check the two notice edits insert: whether the page knows that Agent Plus shows the notices of waits
   (95-wait-notices.js). Without the page's function the notice is shown as in Claude Code. */
const WAITS_LEFT = '(typeof window.__cceWaitsAnnounced==="function"&&window.__cceWaitsAnnounced()===!0)';

/* Regex source for a steward link; 93-steward-links.js accepts the same form. */
const STEWARD_HREF = String.raw`/^vscode:\/\/xnervwang\.claude-code-plus\/open\?session=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:&|$)/i`;

const EDITS = [
  {
    /* OPEN SESSIONS reads what the session list itself reads: the store of sessions, the context that opens one, and the
       connection that reports which are open in a tab and which in the sidebar. They are named in one place only, where
       the list is mounted, so they are handed to the page there. */
    name: 'session list sources for open sessions',
    re: /([\w$]+)\(([\w$]+),\{sessions:([\w$]+),context:([\w$]+),sessionStates:([\w$]+)\.sessionStates,openSessionIds:\5\.openSessionIds,/g,
    to: (m, jsx, list, store, ctx, comms) => `${jsx}(${list},{sessions:(window.__cceSessionList={sessions:${store},context:${ctx},comms:${comms}},${store}),context:${ctx},sessionStates:${comms}.sessionStates,openSessionIds:${comms}.openSessionIds,`,
  },
  {
    /* The section itself, between Account & usage and Session manager, drawn with the list's own element factories,
       section classes and chevron so it looks like the two around it; Recently closed (84-recent-closed.js) comes before it. */
    name: 'open sessions section',
    re: /(onViewUsage:[\w$]+\}\)),([\w$]+)\("div",\{className:([\w$]+)\.sectionHeader,children:([\w$]+)\("button",\{className:\3\.sectionToggle,onClick:\(\)=>([\w$]+)\("sessions",!([\w$]+)\),"aria-expanded":!\6,title:\6\?"Expand session manager":"Collapse session manager",children:\[\2\(([\w$]+),/g,
    to: (m, usage, jsx, cls, jsxs, toggle, collapsed, chevron) => `${usage},`
      + `(typeof window.__cceRecentClosedSection==="function"?window.__cceRecentClosedSection({jsx:${jsx},jsxs:${jsxs},cls:${cls},Chevron:${chevron}}):null),`
      + `(typeof window.__cceOpenSessions==="function"?window.__cceOpenSessions({jsx:${jsx},jsxs:${jsxs},cls:${cls},Chevron:${chevron}}):null),${jsx}("div",{className:${cls}.sectionHeader,children:${jsxs}("button",{className:${cls}.sectionToggle,onClick:()=>${toggle}("sessions",!${collapsed}),"aria-expanded":!${collapsed},title:${collapsed}?"Expand session manager":"Collapse session manager",children:[${jsx}(${chevron},`,
  },
  {
    // The status dot the list draws on its rows, so a row in OPEN SESSIONS carries the same one. A function declaration
    // is hoisted, so naming it before its line is fine.
    name: 'status dot for open sessions',
    re: /function ([\w$]+)\(\{state:([\w$]+),ring:([\w$]+)=!1,title:([\w$]+),className:([\w$]+)\}\)\{/g,
    to: (m, fn, state, ring, title, cls) => `window.__cceStatusDot=${fn};function ${fn}({state:${state},ring:${ring}=!1,title:${title},className:${cls}}){`,
  },
  {
    // The component the list draws a row with, so a row in OPEN SESSIONS is one: pin, time, rename and archive included.
    name: 'session row component for open sessions',
    re: /([\w$]+)=([\w$]+)\(function\(\{session:([\w$]+),id:([\w$]+),isActive:/g,
    to: (m, name, wrap, session, id) => `${name}=window.__cceSessionRow=${wrap}(function({session:${session},id:${id},isActive:`,
  },
  {
    // The row component tells the page when the pointer enters and leaves a row, for its hover text (84-row-hover.js).
    name: 'session row hover',
    re: /(\(function\(\{session:([\w$]+),id:([\w$]+),isActive:[^]{0,4000}?return [\w$]+\("button",\{ref:[\w$]+,id:\3,)(className:`\$\{[\w$]+\.sessionItem\} )/g,
    to: (m, head, session, id, cls) => `${head}`
      + `onMouseEnter:(cceE)=>{typeof window.__cceRowHover==="function"&&window.__cceRowHover(${session},cceE.currentTarget,!0)},`
      + `onMouseLeave:(cceE)=>{typeof window.__cceRowHover==="function"&&window.__cceRowHover(${session},cceE.currentTarget,!1)},${cls}`,
  },
  {
    /* The row's dot and envelope (84-row-marks.js), in place of the one dot the list draws, which shows an unread reply
       only once nothing runs. The page returning null draws the list's own dot. The where text is the list's own words
       for where the conversation is open, for the dot's title. */
    name: 'session row marks',
    re: /(\(function\(\{session:([\w$]+),id:[\w$]+,isActive:[^]{0,6000}?children:\[)([\w$]+)&&([\w$]+)\(([\w$]+),\{state:\3,ring:([\w$]+)!==void 0&&\3!=="unread",title:([\w$]+)\(\3,\6\)\}\),/g,
    to: (m, head, session, state, jsx, dot, where, title) => `${head}(typeof window.__cceRowMarks==="function"&&window.__cceRowMarks({`
      + `jsx:${jsx},Dot:${dot},session:${session},state:${state},`
      + `where:${state}==="running"||${state}==="waiting"||${state}==="idle"?${title}("idle",${where}):""})`
      + `||${state}&&${jsx}(${dot},{state:${state},ring:${where}!==void 0&&${state}!=="unread",title:${title}(${state},${where})})),`,
  },
  {
    /* A rename typed in the session list's box is shown at once, before the title is stored, and the stored one
       replaces it only when the list is next read back; that read does not happen when the stored title has not
       changed. So the marks this extension draws are taken off what is shown too (84-row-marks.js), as the host takes
       them off what is stored (src/host.js). */
    name: 'session list renames show no marks',
    re: /renameSession\(([\w$]+),([\w$]+)\)\{this\.lastLocalRenameAt\.set\(\1,Date\.now\(\)\);/g,
    to: (m, id, title) => `${m}${title}=typeof window.__cceCleanTitle==="function"?window.__cceCleanTitle(${title}):${title};`,
  },
  {
    /* The panel's report of its conversation's state carries whether a turn runs and whether background tasks run,
       which its state alone does not tell apart (src/activity.js). Claude Code reads only the fields it knows; the
       patched host passes these two to this extension (src/host.js). The panel's own set of background tasks holds
       only subagents and workflows; a command put in the background is in its list of tasks, which counts too. */
    name: 'panel state says whether a turn runs',
    re: /(let [\w$]+=\(([\w$]+)\.permissionRequests\.value\.length\?\?0\)>0\|\|\2\.userDialogRequests\.value\.length>0,([\w$]+)=\2\.busy\.value,([\w$]+)=\2\.backgroundTaskIds\.value\.size>0,[\w$]+;[^;]*;else if\(\3\|\|\4\)[^;]*;else [^;]*;[\w$]+\.updateSessionState\([\w$]+,[\w$]+,\2\.summary\.value,\{)/g,
    to: (m, head, session, busy, bg) => `${head}cceBusy:${busy},cceBg:${bg}||((${session}.backgroundTasks&&${session}.backgroundTasks.value&&${session}.backgroundTasks.value.size)>0),`
      + `cceWait:${WAIT_OF(session)},`,
  },
  {
    /* Claude Code's notice that a conversation asks for permission to use a tool, which it shows for AskUserQuestion's
       question and ExitPlanMode's plan too, in the conversation's window while its panel is not on screen. While Agent
       Plus shows notices of the same waits in the window the user is in, it is left out; otherwise it is shown as
       before. The notice's own text and buttons are not touched. */
    name: 'permission notice left to Agent Plus',
    // Two shapes: from 2.1.331 the request goes through a function that waits a second and, while the panel's place
    // is hidden, names the conversation in the notice; before that, the notice was shown right where it was asked for.
    shapes: [
      {
        note: '2.1.331 and later: a function shows the notice, given whether the request is still open',
        re: /([\w$]+)\(([\w$]+),([\w$]+)\(([\w$]+)\),\(\)=>\2\.permissionRequests\.peek\(\)\.includes\(\4\)\)/g,
        to: (m) => `(${WAITS_LEFT}?void 0:${m})`,
      },
      {
        note: 'through 2.1.330: the notice is shown in place',
        re: /([\w$]+)\.showNotification\(([\w$]+)\(([\w$]+)\),"info",\["View"\],!0\)/g,
        to: (m) => `(${WAITS_LEFT}?void 0:${m})`,
      },
    ],
  },
  {
    // The same for auto mode's dialog asking to Continue or Stop, in the same two shapes.
    name: 'auto mode notice left to Agent Plus',
    shapes: [
      {
        note: '2.1.331 and later: a function shows the notice, given whether the dialog is still open',
        re: /[\w$]+\(this,"Auto mode is waiting for you to choose Continue or Stop",\(\)=>this\.userDialogRequests\.peek\(\)\.includes\([\w$]+\)\)/g,
        to: (m) => `(${WAITS_LEFT}?void 0:${m})`,
      },
      {
        note: 'through 2.1.330: the notice is shown in place',
        re: /this\.showNotification\("Auto mode is waiting for you to choose Continue or Stop","info",\["View"\],!0\)/g,
        to: (m) => `(${WAITS_LEFT}?void 0:${m})`,
      },
    ],
  },
  {
    // The session list's search: a conversation also matches when part of its session ID was typed. The page decides
    // whether the query reads as part of an ID (84-search-by-id.js).
    name: 'session search by id',
    re: /(\.filter\(\(([\w$]+)\)=>[\w$]+\(\2\)\.toLowerCase\(\)\.includes\(([\w$]+)\)\|\|\(\2\.gitBranch\.value\?\.toLowerCase\(\)\.includes\(\3\)\?\?!1\))/g,
    to: (m, head, session, query) => `${head}||(typeof window.__cceIdMatch==="function"&&window.__cceIdMatch(${session},${query}))`,
  },
  {
    // The panel's signal constructor, for the one piece of state OPEN SESSIONS keeps: which of its rows is being renamed.
    name: 'signal constructor for open sessions',
    re: /sessionStates=([\w$]+)\(\[\]\);sessionArchiveChanged=/g,
    to: (m, signal) => `sessionStates=(window.__cceSignal=${signal},${signal}([]));sessionArchiveChanged=`,
  },
  {
    /* The list scrolls to the active conversation and selects it whenever the active one changes. A switch made from
       OPEN SESSIONS asks it not to, so the long list stays where the person left it. */
    name: 'session list keeps its place after a switch from open sessions',
    re: /if\(([\w$]+)\.current!==null\)return;let ([\w$]+)=([\w$]+)\.findIndex\(\(([\w$]+)\)=>\4===([\w$]+)\);if\(\2<0\|\|\5===null\)return;([\w$]+)\.anchor\(\5\)/g,
    to: (m, busy, idx, rows, x, active, list) => `if(${busy}.current!==null)return;if(typeof window.__cceSkipFollow==="function"&&window.__cceSkipFollow(${active}))return;let ${idx}=${rows}.findIndex((${x})=>${x}===${active});if(${idx}<0||${active}===null)return;${list}.anchor(${active})`,
  },
  {
    // Delete after Unarchive in the Archived sessions menu (89-delete-archived.js); the page returning null leaves it out.
    name: 'delete in the archived list',
    re: /if\(([\w$]+)\.unarchiveSelection\)([\w$]+)\.push\(\{label:([\w$]+)\.length>1\?`Unarchive \$\{\3\.length\} sessions`:"Unarchive session",separatorBefore:\2\.length>0,onSelect:\1\.unarchiveSelection\}\);return \2\}/g,
    to: (m, act, items, keys) => m.slice(0, -(`return ${items}}`).length)
      + `{let cceD=typeof window.__cceDeleteItem==="function"?window.__cceDeleteItem(${keys}):null;if(cceD)${items}.push(cceD)}return ${items}}`,
  },
  {
    // Text color before Archive in a conversation's menu (84-session-colors.js); the page returning null leaves it out.
    name: 'text color in the session list menu',
    re: /if\(([\w$]+)\.archiveSelection\)([\w$]+)\.push\(\{label:([\w$]+)\.length>1\?`Archive \$\{\3\.length\} sessions`:"Archive session",/g,
    to: (m, act, items, keys) => `{let cceC=typeof window.__cceColorItem==="function"?window.__cceColorItem(${keys},${items}.length>0,${act}.cceClearSelection):null;`
      + `if(cceC)${items}.push(cceC)}${m}`,
  },
  {
    // The same in the Archived sessions menu, before Unarchive.
    name: 'text color in the archived list menu',
    re: /if\(([\w$]+)\.unarchiveSelection\)([\w$]+)\.push\(\{label:([\w$]+)\.length>1\?`Unarchive \$\{\3\.length\} sessions`:"Unarchive session",/g,
    to: (m, act, items, keys) => `{let cceC=typeof window.__cceColorItem==="function"?window.__cceColorItem(${keys},${items}.length>0,${act}.cceClearSelection):null;`
      + `if(cceC)${items}.push(cceC)}${m}`,
  },
  {
    // A right-click selects the row it is on, and Claude Code's own menu items clear that selection once they have run.
    // The list's menu is handed a way to do the same, for Text color, which would otherwise leave the row outlined as
    // selected.
    name: 'row menu can clear the selection',
    re: /(\{resumeSession:\(\)=>\{([\w$]+)\(new Set\),([\w$]+)\([\w$]+\),[\w$]+\([\w$]+,[\w$]+\([\w$]+\)\)\},)(createGroupFromSelection:)/g,
    to: (m, head, set, anchor, next) => `${head}cceClearSelection:()=>{${set}(new Set),${anchor}(null)},${next}`,
  },
  {
    // The same for the Archived sessions menu.
    name: 'archived row menu can clear the selection',
    re: /(\{resumeSession:\(\)=>\{([\w$]+)\(new Set\),([\w$]+)\([\w$]+\),[\w$]+\([\w$]+,[\w$]+\([\w$]+\)\)\},)(unarchiveSelection:)/g,
    to: (m, head, set, anchor, next) => `${head}cceClearSelection:()=>{${set}(new Set),${anchor}(null)},${next}`,
  },
  {
    /* Right-clicking a row the list has not picked makes that row the list's selection (the set an action on several
       rows works on). Claude Code's own items end it once they have run, but a menu closed with nothing picked keeps
       it, drawn outlined for as long as the list stays open. The one handler that opens the list's menu and the
       Archived sessions menu leaves a way to end the selection its right-click made; a selection there before the
       right-click stays. */
    name: 'row menu ends the selection it made',
    re: /(function ([\w$]+)\(([\w$]+),([\w$]+)\)\{if\(![\w$]+\|\|![\w$]+\)return;let ([\w$]+)=[\w$]+\(\4\);if\(!\5\)return;)(if\(\3\.preventDefault\(\),\3\.stopPropagation\(\),[\w$]+\(\4\)\)\{let [\w$]+=new Set\([\w$]+\),[\w$]+=([\w$]+)\.has\(\5\)\?\[\.\.\.\7\]\.filter\(\(([\w$]+)\)=>[\w$]+\.has\(\8\)\):\[\5\];if\(!\7\.has\(\5\)\)([\w$]+)\(new Set\(\[\5\]\)\),)/g,
    to: (m, head, fn, ev, item, key, rest, sel, x, set) => `${head}window.__cceMenuSelection=${sel}.has(${key})?void 0:()=>${set}((cceS)=>cceS.size===1&&cceS.has(${key})?new Set:cceS);${rest}`,
  },
  {
    // Closing the menu, with an item picked or not, ends that selection.
    name: 'row menu close ends the selection it made',
    re: /([\w$]+)&&([\w$]+)&&([\w$]+)\(([\w$]+),\{items:\2,x:\1\.x,y:\1\.y,onClose:\(\)=>([\w$]+)\(null\)\}\)/g,
    to: (m, menu, items, jsx, Menu, setMenu) => `${menu}&&${items}&&${jsx}(${Menu},{items:${items},x:${menu}.x,y:${menu}.y,onClose:()=>{${setMenu}(null);`
      + 'let cceE=window.__cceMenuSelection;window.__cceMenuSelection=void 0;if(typeof cceE==="function")cceE()}})',
  },
  {
    /* Dragging a row the list has not picked also makes it the selection. A drop on a group ends it; a drag let go
       anywhere else keeps it. The drag's record holds a function (cceEnd) that ends the selection it made. */
    name: 'row drag remembers the selection it made',
    re: /if\(!([\w$]+)\.has\(([\w$]+)\)\)([\w$]+)\(new Set\(\[\2\]\)\),([\w$]+)\(\2\);(let ([\w$]+)=`\$\{Date\.now\(\)\.toString\(36\)\}[^]{0,300}?)([\w$]+)\.current=\{nonce:\6,keys:([\w$]+),sourceKey:\2\}/g,
    to: (m, sel, key, set, anchor, mid, nonce, ref, keys) => `if(!${sel}.has(${key}))${set}(new Set([${key}])),${anchor}(${key});${mid}`
      + `${ref}.current={nonce:${nonce},keys:${keys},sourceKey:${key},cceEnd:${sel}.has(${key})?void 0:()=>${set}((cceS)=>cceS.size===1&&cceS.has(${key})?new Set:cceS)}`,
  },
  {
    // Every way a drag ends goes through this.
    name: 'row drag end ends the selection it made',
    re: /function ([\w$]+)\(\)\{([\w$]+)\.current=null,([\w$]+)\(null\)\}/g,
    to: (m, fn, ref, setTarget) => `function ${fn}(){let cceE=${ref}.current&&${ref}.current.cceEnd;${ref}.current=null,${setTarget}(null);if(typeof cceE==="function")cceE()}`,
  },
  {
    // The panel's open request, carrying where the session list's two buttons and two Resume items asked for.
    name: 'open request says where',
    re: /openInEditor\(([\w$]+),([\w$]+),([\w$]+)\)\{return this\.sendRequest\(\{type:"open_in_editor",sessionId:\1,newSessionGroupId:\2,usage:\3\}\)\}/g,
    to: (m, id, group, usage) => `openInEditor(${id},${group},${usage}){let cceW=window.__cceOpenWhere;window.__cceOpenWhere=void 0;`
      + `return this.sendRequest({type:"open_in_editor",sessionId:${id},newSessionGroupId:${group},usage:${usage},cceWhere:cceW})}`,
  },
  {
    // Whether the sidebar's conversation can be seen and the tabs closed recently, as the patched host sends them; OPEN
    // SESSIONS and Recently closed read them as they draw. With them, the dot of each conversation and the stewards
    // (84-row-marks.js).
    name: 'sidebar shown for open sessions',
    re: /case"session_states_update":if\(this\.sessionStates\.value=([\w$]+)\.request\.sessions,/g,
    to: (m, msg) => `case"session_states_update":if(window.__cceSidebarShown=${msg}.request.cceSidebarShown,`
      + `window.__cceRecentClosed=${msg}.request.cceRecentClosed,`
      + `(()=>{try{typeof window.__cceSetActivity==="function"&&window.__cceSetActivity(${msg}.request.cceActivity,${msg}.request.cceStewards)}catch(cceE){}})(),`
      + `this.sessionStates.value=${msg}.request.sessions,`,
  },
  {
    // New session becomes New in tab and New in sidebar (86-open-in-tab-or-sidebar.js); the page returning null keeps it.
    name: 'new session in a tab or the sidebar',
    re: /([\w$]+)\("button",\{className:([\w$]+)\.newSessionButton,onClick:\(\)=>\{([\w$]+)\.openInEditor\(\)\},children:\[([\w$]+)\(([\w$]+),\{className:\2\.newSessionIcon\}\),"New session"\]\}\)/g,
    to: (m, jsxs, cls, ctx, jsx, icon) => `(typeof window.__cceNewSessionButtons==="function"&&window.__cceNewSessionButtons({jsx:${jsx},jsxs:${jsxs},cls:${cls},Icon:${icon},ctx:${ctx}})||${m})`,
  },
  {
    /* Resume session, for a conversation that is not open, becomes Resume in tab and Resume in sidebar, each doing what
       Resume session does with where to open it added. The live list's menu and the archived list's menu each build it,
       with one more argument in the first. */
    name: 'resume in a tab or the sidebar, live list',
    re: /function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)\{let ([\w$]+)=\[\];if\(\2\.length===1\)\6\.push\(\{label:\5\?\.sessionIsOpen\?"Switch to session":"Resume session",onSelect:\4\.resumeSession\}\);/g,
    to: (m, fn, keys, groups, act, info, items) => `function ${fn}(${keys},${groups},${act},${info}){let ${items}=[];if(${keys}.length===1){let cceR=!${info}?.sessionIsOpen&&typeof window.__cceResumeItems==="function"?window.__cceResumeItems(${keys}[0],${act}.resumeSession):null;if(cceR)${items}.push(...cceR);else ${items}.push({label:${info}?.sessionIsOpen?"Switch to session":"Resume session",onSelect:${act}.resumeSession})}`,
  },
  {
    name: 'resume in a tab or the sidebar, archived list',
    re: /function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{let ([\w$]+)=\[\];if\(\2\.length===1\)\5\.push\(\{label:\4\?\.sessionIsOpen\?"Switch to session":"Resume session",onSelect:\3\.resumeSession\}\);/g,
    to: (m, fn, keys, act, info, items) => `function ${fn}(${keys},${act},${info}){let ${items}=[];if(${keys}.length===1){let cceR=!${info}?.sessionIsOpen&&typeof window.__cceResumeItems==="function"?window.__cceResumeItems(${keys}[0],${act}.resumeSession):null;if(cceR)${items}.push(...cceR);else ${items}.push({label:${info}?.sessionIsOpen?"Switch to session":"Resume session",onSelect:${act}.resumeSession})}`,
  },
  {
    // The list's row classes, so a row in OPEN SESSIONS is laid out like a row of the list.
    name: 'session list row classes',
    re: /([\w$]+)=(\{root:"root_[\w$]+",sessionListOnly:"sessionListOnly_[\w$]+",[^{}]*\})/g,
    to: (m, name, obj) => `${name}=(window.__cceListCls=${obj})`,
  },
  {
    name: 'message builder',
    re: /return new ([\w$]+)\(([\w$]+)\.type,([\w$]+),\{uuid:\2\.uuid,foldedIntoTurn:/g,
    to: (m, cls, msg, content) => `return new ${cls}(${msg}.type,${content},{uuid:${msg}.uuid,timestamp:(typeof ${msg}.timestamp==="string"&&Date.parse(${msg}.timestamp))||void 0,foldedIntoTurn:`,
  },
  {
    name: 'tool result',
    /* Two shapes, because 2.1.285 gave setToolResult a second argument and put a statement in front of the call. The
       body between `if(row){` and the call is captured and written back untouched rather than described, so another
       statement appearing there does not need a third shape - only a change to the call itself would.

       Both shapes run to the end of the loop body and put its two closing braces back, which is what keeps the count
       right. Where the call stands alone the brace after it closes the outer `if`; where the call sits inside a block
       that same brace closes the block instead. A shape stopping at the call would have to know which of the two it
       had just eaten, and getting it wrong leaves a file that is one brace out and no longer parses. */
    shapes: [
      {
        note: '2.1.285 and later: setToolResult takes options',
        re: /for\(let ([\w$]+) of ([\w$]+)\.message\.content\)if\(\1\.type==="tool_result"\)\{let ([\w$]+)=([\w$]+)\(([\w$]+),\1\.tool_use_id\);if\(\3\)\{((?:(?!setToolResult)[\s\S])*?)\3\.setToolResult\(\1,(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\)\}\}/g,
        to: (m, item, msg, row, find, sess, before, opts) => `for(let ${item} of ${msg}.message.content)if(${item}.type==="tool_result"){let ${row}=${find}(${sess},${item}.tool_use_id);if(${row}){${before}${row}.setToolResult(${item},${opts});${row}.cceResultAt=(typeof ${msg}.timestamp==="string"&&Date.parse(${msg}.timestamp))||void 0}}`,
      },
      {
        note: 'through 2.1.284: setToolResult takes the result alone',
        re: /for\(let ([\w$]+) of ([\w$]+)\.message\.content\)if\(\1\.type==="tool_result"\)\{let ([\w$]+)=([\w$]+)\(([\w$]+),\1\.tool_use_id\);if\(\3\)\3\.setToolResult\(\1\)\}/g,
        to: (m, item, msg, row, find, sess) => `for(let ${item} of ${msg}.message.content)if(${item}.type==="tool_result"){let ${row}=${find}(${sess},${item}.tool_use_id);if(${row}){${row}.setToolResult(${item});${row}.cceResultAt=(typeof ${msg}.timestamp==="string"&&Date.parse(${msg}.timestamp))||void 0}}`,
      },
    ],
  },
  {
    // Three sibling factories assign sessionId and transcriptOnDisk the same way; what tells this one apart is that
    // it goes on to set lastModifiedTime. The match stops at that field name and does not look at what it is set
    // to, because that expression is the kind of thing a release changes.
    name: 'session list createdAt',
    re: /([\w$]+)\.sessionId\.value=([\w$]+)\.id,\1\.transcriptOnDisk=!0,\1\.lastModifiedTime\.value=/g,
    to: (m, y, s) => `${y}.sessionId.value=${s}.id,${y}.transcriptOnDisk=!0,${y}.cceCreatedAt=${s}.createdAt,${y}.lastModifiedTime.value=`,
  },
  {
    /* The row's id and the panel's own relative-time function go along, so a pinned row can show its real time in the
       panel's own form. */
    name: 'session list time render',
    re: /children:([\w$]+)\(([\w$]+)\.lastModifiedTime\.value\)/g,
    to: (m, f, j) => `children:(typeof window.__cceSpan==="function"?window.__cceSpan(${f}(${j}.lastModifiedTime.value),${j}.lastModifiedTime.value,${j}.cceCreatedAt,${j}.sessionId&&${j}.sessionId.value,${f}):${f}(${j}.lastModifiedTime.value))`,
  },
  {
    /* The pin, at the start of every row of the session list. It goes into the row right after the title - the one place
       where the element factory and the row are both named - and the page's stylesheet moves it in front of the status
       dot, so the pins of all rows line up. */
    name: 'session list pin',
    re: /(([\w$]+)\("span",\{className:([\w$]+)\.sessionName,children:[\w$]+\([\w$]+\(([\w$]+)\),[\w$]+\)\},"view"\))/g,
    to: (m, title, jsx, cls, j) => `${title},(typeof window.__ccePin==="function"?window.__ccePin(${jsx},${j}):null)`,
  },
  {
    // The three artwork states cover half, three quarters and almost all of the circle, but the component picks them at
    // 62.5% and 87%, so between 50% and 62.5% used it draws a half arc that cannot express the figure, and the reading
    // stalls. Switching states at the limit each arc can show removes both stalls, and the in-page script trims the
    // chosen arc to the exact figure. With the meter switch off, __cceMeterKept returns false (70-meter.js) and the
    // component's own thresholds apply.
    name: 'context meter state thresholds',
    re: /if\(([\w$]+)<([\d.]+)\)return 50;if\(\1<([\d.]+)\)return 75;return 99/g,
    to: (m, pct, half, most) =>
      `if(${METER_KEPT}?${pct}<=50:${pct}<${half})return 50;if(${METER_KEPT}?${pct}<=75:${pct}<${most})return 75;return 99`,
  },
  {
    // The meter hides itself while more than half the window is free. Only that check is disabled, and only while the
    // meter switch is on; the check that hides it until a real window size has arrived stays, since the figure means
    // nothing without one.
    name: 'context meter always visible',
    // Three shapes: 2.1.317 dropped the debug override around both checks, and 2.1.330 hides the meter while the share
    // used is at or below a threshold its caller passes.
    shapes: [
      {
        note: '2.1.330 and later: one check against the threshold',
        re: /if\(([\w$]+)===0\|\|([\w$]+)<=([\w$]+)\)return null;return ([\w$]+)\(([\w$]+),\{percentageUsed:/g,
        to: (m, window, used, limit, make, meter) =>
          `if(${window}===0||!${METER_KEPT}&&${used}<=${limit})return null;return ${make}(${meter},{percentageUsed:`,
      },
      {
        note: '2.1.317 and later: the checks stand alone',
        re: /if\(([\w$]+)===0\)return null;if\(([\w$]+)>=(\d+)\)return null;return ([\w$]+)\(([\w$]+),\{percentageUsed:/g,
        to: (m, window, free, limit, make, meter) =>
          `if(${window}===0)return null;if(!${METER_KEPT}&&${free}>=${limit})return null;return ${make}(${meter},{percentageUsed:`,
      },
      {
        note: 'through 2.1.314: the checks sit inside a debug override',
        re: /if\(([\w$]+)===null\)\{if\(([\w$]+)===0\)return null;if\(([\w$]+)>=(\d+)\)return null\}/g,
        to: (m, override, window, free, limit) =>
          `if(${override}===null){if(${window}===0)return null;if(!${METER_KEPT}&&${free}>=${limit})return null}`,
      },
    ],
  },
  {
    /*
     * This extension's part of the agent map, as the first child of the dialog's content: the heading over the
     * conversation's own row and a section for each kind of work Claude Code does not list (src/page/82-scheduled-tasks.js).
     *
     * The page gets the element factory from this scope and returns a real element tree with it. If the page is missing
     * or fails, the child is null and the dialog stays as Claude Code draws it.
     *
     * The anchor is the panel's own title and its children array, with whatever props sit between them skipped: the
     * dialog's size and scrolling have been reshaped upstream before, and none of that changes where a child goes.
     */
    name: 'agent map scheduled section',
    re: /([\w$]+)\(([\w$]+),\{title:"Agent map",([^[]*?)children:\[/g,
    to: (m, h, dialog, between) =>
      `${h}(${dialog},{title:"Agent map",${between}children:[(typeof window.__cceSchedule==="function"?window.__cceSchedule(${h}):null),`,
  },
  {
    // The footer's agent button appears only once an agent exists. A scheduled prompt is the same kind of thing -
    // something this conversation set running in the background - and the map is where it is shown, so it opens the
    // button too. The original condition is kept first so the button behaves exactly as before whenever an agent is up.
    name: 'agent button also for schedules',
    re: /([\w$]+)&&([\w$]+)\(([\w$]+),\{session:([\w$]+),onOpen:([\w$]+)\}\)/g,
    to: (m, gate, h, button, session, onOpen) =>
      `(${gate}||(typeof window.__cceScheduleCount==="function"&&window.__cceScheduleCount()>0))&&${h}(${button},{session:${session},onOpen:${onOpen}})`,
  },
  {
    /* With the button open for schedules alone, its label would read "0 agents". The label is built from the count in
       one place, so the page gets to amend the finished text - the only field that needs to know about both kinds.
       Its dot follows the agents alone, so a conversation whose only work running is a command, a worker or a
       session it started had a grey dot beside a label counting that work; the page gets to amend the dot too, and
       the hover text that names the dot's state. Parameters after onOpen (2.1.331 adds `failed`) are kept as they are. */
    name: 'agent button label and dot',
    re: /function ([\w$]+)\(\{count:([\w$]+),dot:([\w$]+),onOpen:([\w$]+)((?:,[\w$]+:[\w$]+(?:=[\w$.!"]+)?)*)\}\)\{let ([\w$]+)=([\w$]+)\(\2\),([\w$]+)=([\w$]+)\(\3\);/g,
    to: (m, fn, count, dot, onOpen, rest, label, make, title, says) =>
      `function ${fn}({count:${count},dot:${dot},onOpen:${onOpen}${rest}}){let cceDotWas=${dot};`
      + `${dot}=(typeof window.__cceAgentsDot==="function"?window.__cceAgentsDot(${dot}):${dot});`
      + `let ${label}=(typeof window.__cceAgentsLabel==="function"?window.__cceAgentsLabel(${make}(${count}),${count}):${make}(${count})),`
      + `${title}=(typeof window.__cceAgentsTitle==="function"?window.__cceAgentsTitle(${says}(${dot}),${dot},cceDotWas):${says}(${dot}));`,
  },
  {
    /* The conversation's own row in the agent map has a green dot only while a turn runs. The page draws it as the
       conversation's tab does, from the same account of its work (84-row-marks.js), and returns the dot's props. */
    name: 'agent map own row dot',
    re: /(let ([\w$]+)=([\w$]+)\.summary\.value\|\|"This session",([\w$]+)=\3\.visiblyBusy\.value;return [^;]{0,400}?)([\w$]+)\(([\w$]+),\{state:\4\?"running":"idle"\}\)/g,
    to: (m, head, summary, session, busy, jsx, dot) =>
      `${head}${jsx}(${dot},(typeof window.__cceMainDot==="function"?window.__cceMainDot(${busy},${session}):{state:${busy}?"running":"idle"}))`,
  },
  {
    /* The model pill relabels itself after the first reply whenever the model that answered differs from the one picked,
       so that a real fallback is visible. The comparison strips the 1M marker from both sides but not the provider's
       prefix, and on Bedrock the two never agree on that: the pick is `global.anthropic.claude-opus-5-5[1m]` and the reply
       says `claude-opus-5-5`. Every reply therefore looks like a fallback, and the pill is rebuilt from the reply's name -
       which carries no 1M marker - so "Opus (1M context)" turns into "Opus 5.5" a few seconds after being chosen, while
       every request is still being sent as the 1M model.

       Stripping the prefix as well makes only that difference disappear. A reply from a genuinely different model still
       differs after it, so a real fallback is still shown; and whether the pill says 1M is decided elsewhere, from the
       pick itself, so a 200K pick stays 200K. */
    name: 'model pill ignores provider prefix',
    re: /([\w$]+)\(([\w$]+)\)!==\1\(([\w$]+)\.resolvedModel\?\?""\)/g,
    to: (m, strip, served, pick) =>
      `${strip}(${served}).replace(/^(?:[a-z]+\\.)?anthropic\\./i,"")!==${strip}(${pick}.resolvedModel??"").replace(/^(?:[a-z]+\\.)?anthropic\\./i,"")`,
  },
  {
    /* react-markdown's default urlTransform keeps only http, https, irc, ircs, mailto and xmpp URLs and returns ""
       for the rest, so a steward's vscode://xnervwang.claude-code-plus/open?session=<id> link ended up with href=""
       and clicking it did nothing. This lets that one form through. */
    name: 'steward links pass the link check',
    re: /function ([\w$]+)\(([\w$]+)\)\{(let [\w$]+=\2\.indexOf\(":"\),[\w$]+=\2\.indexOf\("\?"\),[\w$]+=\2\.indexOf\("#"\),[\w$]+=\2\.indexOf\("\/"\);)/g,
    to: (m, fn, url, rest) => `function ${fn}(${url},cceKey){if(typeof ${url}==="string"&&${STEWARD_HREF}.test(${url}))return ${url};`
      + `if(cceKey==="src"&&typeof window.__cceImageSrc==="function"&&window.__cceImageSrc(${url}))return ${url};${rest}`,
  },
  {
    /* On Windows the markdown link filter is a wrapper: it keeps local paths in links and passes everything else to the
       filter above, but without the attribute name. */
    name: 'image sources reach the link check on Windows',
    re: /function ([\w$]+)\(([\w$]+),([\w$]+)\)\{if\(\3==="href"&&([\w$]+)\(\2\)!==null\)return \2;return ([\w$]+)\(\2\)\}/g,
    to: (m, fn, url, key, local, check) => `function ${fn}(${url},${key}){if(${key}==="href"&&${local}(${url})!==null)return ${url};return ${check}(${url},${key})}`,
  },
  {
    /* src/page/95-conversation-links.js adds a rehype plugin that puts a link where a reply names another
       conversation; `links` is "text" where Claude Code draws links as plain text, and gets none. */
    name: 'conversation links in replies',
    re: /(\{source:([\w$]+),fileOpener:[\w$]+,platform:[\w$]+,links:([\w$]+),[^{}]*\}\)\{let\{remarkPlugins:[\w$]+,urlTransform:[\w$]+\}=[\s\S]{0,1600}?)rehypePlugins:([\w$]+)\.rehypePlugins,/g,
    to: (m, head, source, links, f) => `${head}rehypePlugins:(typeof window.__cceMentionPlugins==="function"`
      + `?window.__cceMentionPlugins(${f}.rehypePlugins,${links}):${f}.rehypePlugins),`,
  },
  {
    /* A reply's blocks are memoized, so the plugin above would run again only when a block's text changed. Each block
       also gets a revision number that the page bumps when the conversations it can link, this panel's conversation or
       the switch change (95-conversation-links.js); the reply reads it in its own render. */
    name: 'conversation links redraw the reply',
    re: /([\w$]+)\.map\(\(([\w$]+),([\w$]+)\)=>([\w$]+)\(([\w$]+),\{source:\2,fileOpener:([\w$]+)\?\.fileOpener,/g,
    to: (m, list, block, i, h, comp, ctx) => `${list}.map((${block},${i})=>${h}(${comp},{cceMentions:(typeof window.__cceMentionsRev==="function"`
      + `?window.__cceMentionsRev():0),source:${block},fileOpener:${ctx}?.fileOpener,`,
  },
  {
    /* src/page/94-reply-images.js draws a reply's markdown images; when it returns null, Claude Code's own code below
       runs. */
    name: 'images in replies',
    re: /img:\(\{src:([\w$]+),alt:([\w$]+)\}\)=>\{if\(\1\?\.startsWith\("data:"\)\)return ([\w$]+)\("img",/g,
    to: (m, src, alt, h) => `img:({src:${src},alt:${alt}})=>{let cceImg=typeof window.__cceImage==="function"?window.__cceImage(${h},${src},${alt}):null;`
      + `if(cceImg)return cceImg;if(${src}?.startsWith("data:"))return ${h}("img",`,
  },
  {
    /*
     * The panel marks opening a conversation unfinished when it starts to load it, and once two opens in a row were
     * left so, does not reopen that tab after a reload. It counts an open as finished 3 s after loading ends, waiting
     * first for two animation frames, so that the conversation has been drawn, unless the page is hidden. A webview in
     * a background tab gets no frames yet says it is visible, so a conversation that finished loading there stayed
     * unfinished until its tab was shown, and claudeCodePlus.loadRestoredTabs, which loads background tabs, had them
     * refused at the third window start. If no frame has come within a second, the wait continues as it does for a
     * hidden page; a page that is drawn gets its two frames long before that.
     */
    name: 'open counted finished without frames',
    re: /function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+),([\w$]+),([\w$]+)=\(\)=>\{\3=void 0,\4=setTimeout\(\2,([\w$]+)\)\};if\(document\.visibilityState==="hidden"\)\5\(\);else \3=requestAnimationFrame\(\(\)=>\{\3=requestAnimationFrame\(\5\)\}\);return\(\)=>\{if\(\3!==void 0\)cancelAnimationFrame\(\3\);clearTimeout\(\4\)\}\}/g,
    to: (m, fn, done, frame, timer, go, ms) => `function ${fn}(${done}){let ${frame},${timer},cceNoFrame,${go}=()=>{clearTimeout(cceNoFrame),${frame}=void 0,`
      + `${timer}=setTimeout(${done},${ms})};if(document.visibilityState==="hidden")${go}();else ${frame}=requestAnimationFrame(()=>{${frame}=requestAnimationFrame(${go})}),`
      + `cceNoFrame=setTimeout(()=>{if(${frame}!==void 0)cancelAnimationFrame(${frame});${go}()},1000);`
      + `return()=>{if(${frame}!==void 0)cancelAnimationFrame(${frame});clearTimeout(${timer});clearTimeout(cceNoFrame)}}`,
  },
];

/* Hash every shape of every edit; a multi-shape edit has no top-level pattern or replacement, so a change to one of its
   shapes would otherwise go unnoticed. */
const MARK = MARK_PREFIX + 'v' + VERSION + '-' + crypto.createHash('sha256')
  .update(SCRIPT_BODY).update('\n')
  .update(EDITS.map((e) => [e.name, ...shapesOf(e).map((s) => [String(s.re), String(s.to), s.note || ''].join('\0'))]
    .join('\0')).join('\n'))
  .digest('hex').slice(0, 12) + ' */';

const SCRIPT = ['', MARK, SCRIPT_BODY, ''].join('\n');


/* The panel loads this file as a module, and from 2.1.331 it reads import.meta, which only a module may. The file has
   no import or export statement, so it is parsed as a script with an object in place of import.meta. Throws when it
   does not parse. */
function parseScript(text, filename) {
  new vm.Script(text.replace(/\bimport\.meta\b/g, '({url:""})'), { filename });
}

/** Pure transform. Returns { out, chosen } or { error }. Never partially applies. */
function patchSource(src) {
  if (src.includes(ANY_MARK)) return { error: 'the source to patch already carries a panel patch' };
  const r = applyEdits(src, EDITS, 'Claude Code');
  if (r.error) return { error: r.error };
  const out = r.out + '\n' + SCRIPT;
  try { parseScript(out, 'index.js'); }
  catch (err) { return { error: `patched code does not parse: ${err.message}` }; }
  return { out, chosen: r.chosen };
}

function webviewFile(claudeExtensionPath) { return path.join(claudeExtensionPath, 'webview', 'index.js'); }
function liveFiles(claudeExtensionPath) {
  const dir = path.join(claudeExtensionPath, 'webview');
  return { css: path.join(dir, LIVE_CSS), rev: path.join(dir, LIVE_REV) };
}

/*
 * TESTED AND RULED OUT as the cause of the panel that takes minutes to open. Kept because it looked convincing, and the
 * next person to see the evidence below will be tempted the same way.
 *
 * The suspicion: the rename gives a reader the whole old file or the whole new one, but cannot help a reader that has
 * already begun reading the old one, and the panel's bundle has such a reader - the editor's service worker reads it for
 * the webview iframe. Both start with the window, so a window opened with the patch out of date replaces the file as the
 * panel reads it. A console log of 2026-10-01 03:05 seemed to fit: this file's mtime was 03:05:54 beside a run of slow
 * opens, the stalled panel logged ten service-worker `Could not find parent client for request` and took 136 seconds to
 * reach the end of its bundle, and a panel in the same window took 334ms and logged none.
 *
 * The test, two restarts on 2026-10-01: the first had the panel file restored to Claude Code's original so that this
 * function had to run - it wrote 16ms into startup and took 744ms - and the panel opened quickly. The second wrote
 * nothing and was quick as well. Replacing the bundle during startup does not, on its own, produce the stall.
 *
 * And the 03:05 reading was backwards: the write came three seconds AFTER the slow opens had begun, so it could not
 * have started them. A timestamp beside a symptom is not a cause, and the order of the two was there to be read.
 *
 * What remains: that same 03:05 log has VS Code auto-updating extensions, Claude Code among them, at the time - which
 * replaces a whole extension directory the panel serves from - and neither test restart did. That is the open lead.
 */
/* Every window writes these files, so each write has a temporary name of its own (src/files.js), carrying this tag. A
   rename that fails is tried once more from scratch. */
const TMP_TAG = '.claude-code-extras-webview';
function writeAtomic(file, text) {
  files.writeAtomic(file, text, undefined, { tag: TMP_TAG, tries: 2 });
}

/*
 * The revision image carries two counters: width for the live stylesheet, height for the efforts. Different code in
 * different windows writes them, so each writer updates its own counter and copies the other from the file just before
 * writing; an earlier read could undo another window's update. One image lets the page see both with the request it
 * already makes every few seconds.
 */
function readRev(rev) {
  let text = '';
  try { text = fs.readFileSync(rev, 'utf8'); } catch (_) {}
  const num = (re) => Number((text.match(re) || [])[1]) || 0;
  return { w: num(/width="(\d+)"/), h: num(/height="(\d+)"/) };
}
/*
 * Counters that could not be moved, by image. The file the counter announces was written first, so the next write of the
 * same content finds nothing to do, and without this the panel would never load it. Windows refuses to rename over a
 * file another process holds open, and the panel fetches this image every few seconds.
 */
const owedRev = new Map();
/** Moves one of the two counters, `w` or `h`, plus any move a failed write still owes; the other counter is left as
    it is. */
function bumpRev(rev, which) {
  const owed = new Set(owedRev.get(rev) || []);
  if (which) owed.add(which);
  const r = readRev(rev);
  const next = (n) => (n % 60000) + 1;
  const w = owed.has('w') ? next(r.w) : r.w || 1, h = owed.has('h') ? next(r.h) : r.h || 1;
  try {
    writeAtomic(rev, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`);
  } catch (e) {
    owedRev.set(rev, owed);
    throw e;
  }
  owedRev.delete(rev);
}

/** Write the live settings. Bumps the revision only when the stylesheet actually changed. Returns true if changed. */
function writeLive(claudeExtensionPath, opts = {}) {
  const { css, rev } = liveFiles(claudeExtensionPath);
  if (!fs.existsSync(path.dirname(css))) return false;
  const next = liveCss(opts);
  let current = null;
  try { current = fs.readFileSync(css, 'utf8'); } catch (_) {}
  if (current === next && fs.existsSync(rev)) {
    if (!owedRev.has(rev)) return false;
    bumpRev(rev);
    return true;
  }
  /*
   * Leave alone what a newer build of this extension wrote.
   *
   * One VS Code window is one extension host, each with its own copy of this code loaded when it activated, and this
   * file belongs to the Claude Code install rather than to a window - so all of them write it. Installing an upgrade
   * therefore leaves older hosts running until every window has been reloaded, and without this rule the old and the
   * new one would put their own version back in turn, for as long as that took: the panel reloads the stylesheet
   * whenever it changes, so a setting would appear and disappear on a timer.
   *
   * It is the rule the patched bundles already follow - a marker carries a version, and an older patcher does not touch
   * what a newer one owns. The cost is that a setting changed in a window running the older build does not reach the
   * panel until that window is reloaded.
   *
   * Yielding is conditional on that newer build still being installed, because a version number can also go down: a
   * build that was packaged and installed, then withdrawn in favour of a lower number, leaves its stamp behind with no
   * host anywhere that could rewrite the file. Every host then reads a version above its own and backs off, and the
   * stylesheet is frozen for good - the panel keeps whatever was in it, so a conversation's background sessions and
   * scheduled prompts stop appearing and nothing reports an error. Measured: a file stamped 1.0.9 held two Claude Code
   * installs at two days stale. When the registry cannot be read there is no way to tell a withdrawn build from a
   * running one, and yielding is the safer of the two.
   */
  const there = (VERSION_LINE.exec(current || '') || [])[1];
  if (there && OURS && older(OURS, there)
      && installedHere(path.dirname(claudeExtensionPath), there) !== false) return false;
  writeAtomic(css, next);
  // The width carries the revision: the page polls this image and reloads the stylesheet when it changes.
  bumpRev(rev, 'w');
  return true;
}

/** Write one conversation's efforts, and move the height of the revision image when they changed. Returns true then. */
function writeEffort(claudeExtensionPath, session, text) {
  if (!/^[0-9a-f-]{36}$/i.test(String(session || '')) || typeof text !== 'string') return false;
  const dir = path.join(claudeExtensionPath, 'webview');
  if (!fs.existsSync(dir)) return false;
  const file = path.join(dir, EFFORT_PREFIX + session + '.css');
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch (_) {}
  const { rev } = liveFiles(claudeExtensionPath);
  if (current === text) {
    if (!owedRev.has(rev)) return false;
    bumpRev(rev);
    return true;
  }
  writeAtomic(file, text);
  bumpRev(rev, 'h');
  return true;
}

/** Remove the efforts of every conversation `keep` does not name. Returns how many went. */
function pruneEfforts(claudeExtensionPath, keep) {
  const dir = path.join(claudeExtensionPath, 'webview');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return 0; }
  let gone = 0;
  for (const n of names) {
    const m = EFFORT_FILE.exec(n);
    if (!m || (keep && keep.has(m[1]))) continue;
    try { fs.unlinkSync(path.join(dir, n)); gone++; } catch (_) { /* gone meanwhile */ }
  }
  return gone;
}

/* A write that fails on a full disk can leave the backup empty or truncated. Moving that over the bundle would break
   Claude Code, so a backup has to parse before it is put back. */
function wholeScript(text, filename) {
  if (!text) return false;
  try { parseScript(text, filename); return true; } catch (_) { return false; }
}

const target = patchTarget({
  file: webviewFile, mark: MARK, anyMark: ANY_MARK, backupSuffix: BACKUP_SUFFIX, tmpTag: TMP_TAG, tries: 2,
  transform: patchSource,
  usableBackup: (text) => wholeScript(text, 'index.js'),
  /* The live files go whether or not there is a backup to put back. */
  beforeRestore: (claudeExtensionPath) => {
    const { css, rev } = liveFiles(claudeExtensionPath);
    for (const f of [css, rev]) { try { fs.unlinkSync(f); } catch (_) {} }
    pruneEfforts(claudeExtensionPath, null);
  },
  say: {
    missing: (file) => `Claude Code webview not found at ${file}`,
    noBackup: 'an older patch is present but its backup is missing; reinstall Claude Code',
    markedBackup: 'an older patch is present and its backup carries one too; reinstall Claude Code',
    badBackup: 'backup is empty or cut off; not restored',
  },
});

/** Apply (or upgrade) the patch and, once it is in, write the live settings. Returns { changed, liveChanged, current, message }. */
function apply(claudeExtensionPath, opts = {}) {
  const r = target.apply(claudeExtensionPath);
  return { ...r, liveChanged: r.current ? writeLive(claudeExtensionPath, opts) : false };
}

/** Every Claude Code install under an extensions directory: the active version plus any siblings left behind. */
function findInstalls(extensionsDir) {
  let names = [];
  try { names = fs.readdirSync(extensionsDir); } catch (_) { return []; }
  return names.filter((n) => n.toLowerCase().startsWith('anthropic.claude-code-')).map((n) => path.join(extensionsDir, n));
}

module.exports = {
  SWITCHES,
  id: 'anthropic.claude-code', name: 'Claude Code panel',
  VERSION, MARK, ANY_MARK, BACKUP_SUFFIX, EDITS, SCRIPT, TITLE_MARKS, WAITS_LEFT,
  safeColor, patchSource, status: target.status, apply, restore: target.restore, wholeScript, findInstalls, webviewFile, targetFile: webviewFile,
  writeLive, liveCss,
  writeEffort, pruneEfforts, EFFORT_PREFIX, pinsProperty,
};
