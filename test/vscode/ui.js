// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The window stage of run.js: a real VS Code window with Claude Code, Agent Plus and this extension freshly installed,
 * driven through Playwright. It checks, in order:
 *
 *   the patch      both of Claude Code's patched files are written on the first start and VS Code says to reload; the
 *                  tab bar keeps the one Claude button, Claude Code's own, before the reload and after it
 *   session list   Claude Code's session list as the patch changes it: New in tab and New in sidebar, a pin and the
 *                  dates on every row, the Resume in tab, Resume in sidebar and Text color items of the right-click
 *                  menu, clicking a pin, the hover text of a row, and claude --bg, claude -p and daemon sessions left
 *                  out, with the first two listed once claudeCodePlus.hideBackgroundSessions is off
 *   a tab          a conversation resumed in a tab: its title, the times on every message and reply, the bar on your
 *                  messages, the rail and its list, the footer's buttons, their hover text and the information box,
 *                  OPEN SESSIONS, and which times show while the extension is off and once it is on again
 *   a fold opened by hand
 *                  in Focus view, a tool call's fold opened by hand: the button is drawn unfolded, and a press folds
 *                  the row again with Focus view still on
 *   the dots       the filled dot on the tab's logo while a turn sent through fake-model.js runs, and on both its
 *                  session list rows; the envelope after the tab's title once its reply lands with the tab in the
 *                  background, after the name and before the time on its rows, and still whole when a narrow side bar
 *                  cuts the name short, and Agent Plus marking that reply unread without counting it in the status bar;
 *                  the red dot while Claude Code waits for permission to run a command, with no notice and no count for
 *                  the conversation in front; no blue
 *   the agent map's sections
 *                  with nothing running, only the conversation's row, under its own heading; then a helper, a command
 *                  in the background and a scheduled prompt, each section after that row under a heading in capitals
 *                  with its count and a line above it, Claude Code's two headings among them; each card of this
 *                  extension's a dot, a title line and a line under it; Claude Code's rows still there and still
 *                  opening their dialogs, and its Stop still ending the command
 *   work left running
 *                  the hollow green ring, kept after the turn ends while a command it put in the background runs, a
 *                  helper (subagent) it started in the background, or, on Linux, a program it left running with setsid,
 *                  with an envelope when the turn ended out of sight, and gone once that work has ended; the agents
 *                  button's count and green dot and the agent map's own row, grey again; the detached program in the
 *                  agent map, and the notice once it is gone;
 *                  on Linux, a `claude -p` worker left running under a detached shell beside a command in the
 *                  background: the agents button with a green dot and a label that counts each of them once, the map
 *                  listing the worker by name in place of its shell and its own row a green ring, until both end and
 *                  all of it turns grey;
 *                  a claude --bg session the conversation starts (a stand-in of the CLI, on every platform): the agents
 *                  button's 1 bg and its green dot, the tab's ring, the map's row, the notice when it ends, 1 bg done
 *                  and grey, and the setting that leaves it out; and a second session the conversation launches from a
 *                  command it put in the background, piped through tail, with the CLI's words in that command's output
 *                  file only: it shows the same marks as the first session
 *   what needs you a question the plan put to the user and a choice box: the red dot, Agent Plus's notice with Open and
 *                  Dismiss and its count, Open bringing the conversation forward, and no notice with either of the
 *                  agentPlus.notifications settings off; a question put while the turn runs: no notice, no count and a
 *                  green dot until the turn ends, then all three
 *   a question answered in its turn
 *                  a question the plan puts to the user during a turn, the turn ending behind another editor: with
 *                  nothing more from the user, a red dot on the tab and both its session list rows and Agent Plus
 *                  counting it; answered on a question card later in the turn, or typed while the turn runs and taken
 *                  into it, no red dot, and for the card no wait in Agent Plus
 *   conversation links
 *                  another conversation named in a reply by its title, in corner brackets and by its short id: a link
 *                  for each, drawn by Claude Code's own link component, its hover label, a click bringing its tab
 *                  forward, and none while claudeCodePlus.show.conversationLinks is off; with a source registered with
 *                  Agent Plus from the helper as another agent: a full id in prose is linked, an id in a code block is
 *                  not, in inline code only the id is linked, the conversation's own title and id and a placeholder
 *                  title are not, a reply that gets its link once the conversation it names is listed, the same link in
 *                  a panel opened later, and a click opening the conversation in that agent's own view
 *   the steward    the Steward panel, a steward's crown on its tab, on every session list row and in the panel's header
 *                  with no bell even where an older build stored one, renames through both of Claude Code's rename
 *                  boxes with marks typed anywhere, a managed conversation's dot and envelope in the panel while it
 *                  works, has a reply unread, waits for permission and runs work in the background, and each of the
 *                  steward's requests: a message passed on, a rename, close (refused while busy without --confirmed),
 *                  --windows, a new conversation, one reopened (refused while another process runs it or no window has
 *                  its folder, and ticked again), a handoff, a notice, a second steward's crown, and a link. On Linux,
 *                  also a conversation two processes run: the marks, and Stop the old process
 *   restored tabs  after a reload, a Claude Code tab behind another left unloaded, and loaded with
 *                  claudeCodePlus.loadRestoredTabs on, the tab that was in front staying in front; two such tabs with
 *                  replies not read keep their envelopes, on the tabs, the session list rows and in the host's marks,
 *                  through a reload with the setting on; a restored tab first clicked 45 s after a reload loads and
 *                  takes a message; through three reloads with the setting on, each background tab still opens its
 *                  conversation rather than Claude Code's notice that it was not reopened
 *   two windows    a second window of the same VS Code on a folder of its own: a conversation open there comes to the
 *                  front, in that window, from the first window's Steward panel, from a steward's link and from the
 *                  first window's session list when a copy of it is kept under that window's folder, and no copy of it
 *                  opens; a link to a conversation open nowhere reports that; its title in a reply in the first
 *                  window, linked and clicked, does the same; once that window has reloaded with the conversation's tab
 *                  restored behind another and not loaded, deleting it from the first window is refused and names the
 *                  second
 *   several stewards
 *                  two stewards in two windows ticking one conversation: its box stays free in the other's panel, a
 *                  steward's own box is still greyed, the eye at the end of its row names the other steward, and a
 *                  click on that name brings that steward up in its window
 *   closed, sidebar, archived
 *                  RECENTLY CLOSED once the tab is closed; Resume in sidebar, New in sidebar and New in tab; Delete
 *                  session… on an archived conversation: refused while it is open in a tab, then its confirmation
 *   light theme    the envelope's text form on the tab, the session list rows and the Steward panel, and the colour form
 *                  back in a dark theme
 *   the old bell   a steward whose stored name ends in the bell of an older build: Agent Plus's notice, its count's hover,
 *                  its list of what needs you and its Conversations view name it with the crown after it and no bell
 *   the focused window
 *                  a conversation of a second window that starts to wait: the focused window shows the notice,
 *                  the other does not, and both count it
 *   what it waits for
 *                  a permission prompt behind another editor of the focused window: no notice at all, and Claude
 *                  Code's own back with Agent Plus's waiting notices off; in a second window, a permission prompt and a
 *                  question each named in one notice in the focused window and none from Claude Code, Open
 *                  bringing that window forward; both at once: a notice for each, and Open on each brings its own
 *                  conversation forward; two waits that start while no window has the focus are shown once, a notice
 *                  for each, in the first window to get the focus
 *   token mode     each of Agent Plus's token modes in turn: Show Status, the status bar, the information box, the hooks'
 *                  settings, Claude Code's list of plugins, the notice for a feature's own setting, what the fake model
 *                  receives, a detached command's end, and the four settings in the Settings editor
 *   installed again
 *                  the same version rebuilt with one file changed, installed over the running copy with a second window
 *                  open: a steward of all conversations still gains the one it opens, in stewards.json and its panel;
 *                  after a reload that window keeps the table, and the other, still on the earlier build, saves no tick
 *                  and says so with a Reload Window button
 *   commands       Show Status, Settings and the confirmation of Stop Loading the Work Plan Plugin
 *   rows no longer open
 *                  the session list's rows after each way of opening and closing a conversation, a menu closed with
 *                  nothing picked and a drag let go over no group: none of a conversation open nowhere drawn picked or
 *                  highlighted, and only the conversation in a tab in front drawn as the current one
 *   the plan bar   the bar above the input box, as wide as it and with the same height however many rows the plan has,
 *                  compact in a narrow panel, redrawn when the plan changes, gone when there is no plan and when
 *                  claudeCodePlus.show.planBar is off, its questions part in the status bar's warning colour, and its
 *                  two clicks opening Agent Plus's Work plan view and Answer view at this conversation
 *   writing about a work plan row
 *                  Agent Plus's pen on a Work plan row: the conversation's tab comes to the front with the row's text in
 *                  its input, after the user's own text with one space between (none when that text ends in a space),
 *                  with the focus and the caret after it, and nothing sent; a conversation that no tab shows opens here
 *                  first; one started in another folder is not opened, and Agent Plus puts the text on the clipboard and
 *                  says why
 *   removal        last: Remove from Claude Code restores both files, and turning the extension on puts the patch back
 *   self-check     no page of a Claude Code panel drew the warning that its messages are no longer found, all through the run
 *
 * Every step saves a screenshot to <out>/shots, and crops of the parts this extension draws are compared with the
 * approved copies (lib/baseline.js). Claude Code's own parts are never cropped: where one of ours sits between two of
 * Claude Code's, each of ours is cropped on its own.
 */
const fs = require('fs');
const path = require('path');
const win = require('./lib/window');
const { baselines } = require('./lib/baseline');
const pixels = require('./lib/pixels');
const fakeHome = require('./lib/fake-home');
const { folderName } = fakeHome;
const { ASK_TO_RUN, RUN, ASK_TO_BACKGROUND, BG_RUN, ASK_TO_BACKGROUND_LONG, BG_LONG_RUN, ASK_FOR_HELPER, ASK_TO_DETACH, ASK_TO_DETACH_SHORT, LINK_TEXT, IMAGE_ALT, IMAGE_WEB,
  ASK_FOR_WORKER, WORKER_NAME, WORKER_SCRIPT, ASK_FOR_CHOICE, CHOICE } = require('./lib/fake-model');
const { ASK_FOR_BG_SESSION, BG_SESSION_NAME, BG_SESSION_SCRIPT, ASK_FOR_BG_OUTPUT } = require('./lib/fake-model');
const { ECHO_REQUEST, ASK_TO_PAUSE, PAUSE_RUN } = require('./lib/fake-model');
/* An 8x8 red PNG. */
const SQUARE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mO4YGCAFTEMLQkA2ntMAZZ5tYQAAAAASUVORK5CYII=';
const tabdot = require('../../src/tabdot');

const { sleep, until } = win;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/* Blue is the colour of Claude Code's own dot, which this extension draws over and never uses (src/tabdot.js). */
const BLUE = '#3b82f6';
const DOTS = { running: rgb(tabdot.GREEN), waiting: rgb(tabdot.RED), blue: rgb(BLUE) };
const ENVELOPE = ' \u{1F4E9}';
/* The envelope's one-colour text form, which a light theme gets (src/envelope.js). */
const ENVELOPE_TEXT = ' \u2709\uFE0E';
const PANEL_VIEW = 'mainThreadWebview-claudeVSCodePanel';
const CLAUDE_BUTTON = 'Claude Code: Open';
const RELOAD = /^Claude Code Plus is installed in Claude Code panel and Claude Code host\. Reload the window once to start/;
/* What Text color's Red and a pinned pin are drawn in, in the Dark Modern theme run.js sets. */
const RED_TITLE = 'rgb(241, 76, 76)';
const PIN_PURPLE = 'rgb(177, 128, 215)';
const COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Cyan'];
const LABELS = {
  info: 'About this conversation: its session id, process id, the directory it started in, where its transcripts are kept, their size, and the token mode',
  focusOff: 'Showing thinking and tool calls - click for Focus view: only your messages and the replies',
  focusOn: 'Focus view is on: only your messages and the replies - click to show thinking and tool calls',
  focusOpened: 'Focus view is on, with tool calls you opened - click to fold them again',
  mute: 'A chime when a turn finishes, and when Claude is waiting for you - click to mute',
  muted: 'Chimes are muted - click to hear a chime when a turn finishes',
  rail: 'Your messages in this conversation - click one to jump to it',
};
/* A stamp as the page writes it: a no-break space inside each part, so it can wrap only after a "·" and after the time. */
const NB = '\u00a0', SEP = `${NB}\u00b7 `;
const STAMP = `(?:\\d\\d/\\d\\d${NB})?\\d\\d:\\d\\d:\\d\\d`;
/* The marks this extension draws with a title and never stores (src/title-marks.js): the crown, the envelope in either
   form, and the bell older builds drew. */
const CROWN = '\u{1F451}', BELL = '\u{1F6CE}\uFE0F';
const MARK_RE = /\u{1F451}|\u{1F6CE}|\u{1F4E9}|\u2709/u;
/* The crown and the envelope a tab's label ends in. */
const TRAILING_MARKS = /(?: (?:\u{1F451}|\u{1F4E9}|\u2709[\uFE0E\uFE0F]?))+$/u;
/* Conversations a steward opens again: one started in a folder below the window's, one in a folder no window has open. */
const FOLDER_THREADS = [
  { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6fa', title: 'Tidy the helper scripts in the sub folder', days: 0,
    turns: [['Tidy the helper scripts in the sub folder.', 'Moved the two helpers into scripts/ and removed the unused one.']] },
  { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6fb', title: 'Draft the migration notes for the other project', days: 0,
    turns: [['Draft the migration notes for the other project.', 'Drafted them in docs/migration.md.']] },
];

async function run({ exe, vsix, profile, env, playwright, model, threads, background = [], out, check, note }) {
  const shotsDir = path.join(out, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const base = baselines({ out, check, note });
  let shotNo = 0;
  const w = await win.open({ exe, profile, env, playwright, log: path.join(out, 'vscode-window.log') });
  const { page, call } = w;
  const shot = (name) => page.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-${name}.png`) }).catch(() => {});
  /* CLAUDE_CODE_PLUS_UI_STEPS, step names separated by commas, runs only those, after the two that patch Claude Code and
     reload the window: for trying one step without the whole run. */
  const only = (process.env.CLAUDE_CODE_PLUS_UI_STEPS || '').split(',').map((x) => x.trim()).filter(Boolean);
  /* Playwright's error lists every attempt in its call log, and the reason an action kept failing (an element in the
     way, or one that kept moving) is in the last lines, so those are kept with the first one. Any other error keeps the
     top of its stack. */
  const failure = (e) => {
    const lines = String((e && e.stack) || e).replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    const log = lines.indexOf('Call log:');
    if (log < 0) return lines.slice(0, 4).join(' | ');
    const calls = lines.slice(log + 1).filter((l) => l.startsWith('- '));
    return [lines[0], ...calls.slice(0, 2), ...(calls.length > 8 ? ['...'] : []), ...calls.slice(Math.max(2, calls.length - 6))].join(' | ');
  };
  const step = async (name, fn) => {
    if (only.length && !only.includes(name) && name !== 'the patch' && name !== 'the reload') return;
    console.log(`\n── ${name}`);
    try { await fn(); } catch (e) { check(false, `${name}: ran to its end`, failure(e)); await shot(`${name.replace(/\W+/g, '-')}-error`); }
  };
  const notes = path.join(profile.folder, 'notes.txt');
  const transcriptOf = (t) => path.join(profile.home, '.claude', 'projects', folderName(profile.folder), `${t.id}.jsonl`);

  /* ── what the window and the extension host say ── */
  const patchState = () => call(`
    const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus'), cc = vscode.extensions.getExtension('anthropic.claude-code');
    if (!mine || !cc) return null;
    const A = require(require('path').join(mine.extensionPath, 'src', 'adapters'));
    return { active: mine.isActive, targets: A.map((a) => [a.name, a.status(cc.extensionPath)]) };`);
  const tabs = () => call(`return vscode.window.tabGroups.all.map((g) => ({ column: g.viewColumn, active: g.isActive,
    tabs: g.tabs.map((t) => ({ label: t.label, active: t.isActive, view: (t.input && t.input.viewType) || '' })) }));`);
  const claudeTabs = async () => (await tabs()).flatMap((g) => g.tabs.map((t) => ({ ...t, column: g.column })))
    .filter((t) => t.view === PANEL_VIEW);
  const exec = (command, ...a) => call(`await vscode.commands.executeCommand(${JSON.stringify(command)}, ...arg); return true;`, a);
  /* Started and not waited for: the command opens a dialog that is answered through the window. */
  const start = (command) => call(`vscode.commands.executeCommand(${JSON.stringify(command)}); return true;`);
  const openNotes = (column = 0) => call(`await vscode.window.showTextDocument(vscode.Uri.file(${JSON.stringify(notes)}),
    { preview: false, ...(arg ? { viewColumn: arg } : {}) }); return true;`, column);
  /* A tab's label as Claude Code shortens it: the title's first characters and an ellipsis. */
  const titled = (label, title) => !!label && title.startsWith(label.replace(/…$/, '')) && label.length >= 12;

  /* The Claude buttons in the active editor group's tool bar, by their labels. */
  const claudeButtons = () => page.evaluate(() => [...document.querySelectorAll('.editor-group-container.active .editor-actions .action-item .action-label')]
    .map((a) => a.getAttribute('aria-label') || a.title || '').filter((t) => /Claude/.test(t)));
  const claudeButton = () => page.locator('.editor-group-container.active .editor-actions .action-item .action-label[aria-label*="Claude"]').first();
  /* A page that gets no frames still runs its timers, but input whose effect needs the next frame does nothing until
     the page draws again. */
  const paints = (f) => f.evaluate(() => new Promise((r) => {
    const now = (raf) => r({ raf, visibility: document.visibilityState, focus: document.hasFocus(),
      active: String((document.activeElement && (document.activeElement.className || document.activeElement.tagName)) || '').slice(0, 50) });
    let done = false;
    requestAnimationFrame(() => { done = true; now(true); });
    setTimeout(() => { if (!done) now(false); }, 1500);
  })).catch((e) => ({ error: String(e).slice(0, 80) }));
  /* VS Code starts a hover when the pointer enters an element, so an element drawn again under a resting pointer never
     shows one: the helper marks the element it hovered and hovers the new copy when the mark is gone. */
  let hoverWhy = null;
  const hoverText = async (loc) => {
    hoverWhy = null;
    const hoverOver = async () => {
      await page.mouse.move(5, 300);
      await sleep(300);
      await loc.hover();
      await loc.evaluate((e) => e.setAttribute('data-cce-hovered', '')).catch(() => {});
    };
    const shown = () => page.evaluate(() => {
      const h = [...document.querySelectorAll('.monaco-hover, .workbench-hover')].find((e) => e.offsetParent && e.innerText.trim());
      return h ? h.innerText.trim() : '';
    });
    await hoverOver();
    const before = await loc.boundingBox().catch(() => null);
    let again = 0, text = '';
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      text = await shown().catch(() => '');
      if (text) break;
      if (again < 2 && !await page.evaluate(() => !!document.querySelector('[data-cce-hovered]')).catch(() => true)) {
        again++;
        note('the element under the pointer was drawn again before its hover showed, so it was hovered once more');
        await hoverOver();
      }
      await sleep(200);
    }
    if (!text) {
      const after = await loc.boundingBox().catch(() => null);
      const centre = before && [before.x + before.width / 2, before.y + before.height / 2];
      hoverWhy = { again, before, after, marked: await page.evaluate(() => !!document.querySelector('[data-cce-hovered]')).catch(() => null),
        under: centre ? await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? String(e.className || e.tagName).slice(0, 60) + (e.id ? ' #' + e.id : '') : null; }, centre).catch(() => null) : null,
        hovers: await page.evaluate(() => [...document.querySelectorAll('.monaco-hover, .workbench-hover')].map((e) => ({ shown: !!e.offsetParent, text: (e.innerText || '').slice(0, 40) }))).catch(() => null),
        paints: await paints(page.mainFrame()) };
    }
    await loc.evaluate((e) => e.removeAttribute('data-cce-hovered')).catch(() => {});
    await page.mouse.move(5, 300);
    await sleep(300);
    return text || '';
  };
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.notification-list-item-message')].map((e) => e.innerText));
  /*
   * Agent Plus's notices of conversations that need the user (its src/attention.js), each as what it says: its text and
   * the labels of its buttons. A notice shows as a toast at first and moves to the notification list after a while, and
   * Agent Plus never takes one back. These helpers recognize them by their text and button labels, so a change to how
   * they look needs changes here only.
   */
  const NEED = (n) => / (finished|is waiting for you)\.$/.test(n.text) || (n.buttons.includes('Dismiss') && n.buttons.includes('Open'));
  const notificationItems = (p, where) => p.evaluate((where) => [...document.querySelectorAll(`${where} .notification-list-item`)].filter((n) => n.offsetParent).map((n) => {
    const m = n.querySelector('.notification-list-item-message');
    return { text: m ? m.innerText.replace(/\s+/g, ' ').trim() : '', buttons: [...n.querySelectorAll('.monaco-button')].map((b) => b.innerText.trim()).filter(Boolean) };
  }), where).catch(() => []);
  /* The toasts among them in the window of `p`. */
  const needNotices = async (p = page) => (await notificationItems(p, '.notifications-toasts')).filter(NEED);
  /* All of them in the notification list of the window of `p` (whose extension host has `folder` open), toasts
     included: the list is opened to read it, and closed again. `kind` picks other notices. */
  const listedNotices = async (p = page, folder, kind = NEED) => {
    await call('await vscode.commands.executeCommand("notifications.showList"); return true;', undefined, 60000, folder);
    /* Drawn once the list is open and holds its items, or says it has none. */
    const drawn = await until(() => p.evaluate(() => {
      const c = document.querySelector('.notifications-center');
      if (!c || !c.offsetParent) return false;
      return !!c.querySelector('.notification-list-item') || /\bNo New Notifications\b/i.test((c.querySelector('.notifications-center-header-title') || {}).innerText || '');
    }), 5000, 200);
    const got = drawn ? await notificationItems(p, '.notifications-center') : null;
    await call('await vscode.commands.executeCommand("notifications.hideList"); return true;', undefined, 60000, folder);
    if (!got) throw new Error('the notification list did not open');
    return got.filter(kind);
  };
  /* Claude Code's own notices of a wait, which its panel shows in the conversation's window while the panel is not on
     screen, with a View button (src/waiting-for.js). */
  /* Strips the conversation's name from the front of a notice's text: Claude Code writes it as `In "<title>": ` while the
     panel is off screen, and from 2.1.332 while it is on screen too. */
  const ccText = (t) => String(t || '').replace(/^In (?:".*?"|another conversation): /, '');
  const CC_WAIT = (n) => /^(Claude is requesting permission to |Claude is asking you a question|Claude has finished a plan|Auto mode is waiting for you)/.test(ccText(n.text));
  /* Claude Code's own notices of waits in the window of `p`: its toasts, or else its notification list. */
  const ccWaitNotices = async (p = page, folder) => {
    const shown = (await notificationItems(p, '.notifications-toasts')).filter(CC_WAIT);
    return shown.length ? shown : listedNotices(p, folder, CC_WAIT);
  };
  /* Whether the Agent Plus this run installed names what a conversation waits for, shows no notice of a conversation the
     window with the focus shows, and keeps what comes while no window has the focus: its 'waitingFor' feature. Without
     it, Claude Code's own notices of waits stay, and the steps expect that. */
  const apWaits = (() => {
    try {
      const dir = fs.readdirSync(profile.exts).find((n) => n.startsWith('xnervwang.agent-plus-'));
      return require(path.join(profile.exts, dir, 'src', 'sources.js')).FEATURES.includes('waitingFor');
    } catch (_) { return false; }
  })();
  /* Under xvfb-run every window VS Code has once focused says it is focused for good, so a step says for itself which
     window has the focus, to Agent Plus alone, through a global of that window's extension host: lib/window.js starts the
     windows with AGENT_PLUS_TEST_FOCUS=1, without which Agent Plus does not read it. null hands the window back to VS
     Code's own word. */
  const testFocus = (on, folder) => call('if (arg === null) delete globalThis.__agentPlusTestFocused; else globalThis.__agentPlusTestFocused = arg; return true;',
    on, 60000, folder);
  /* What each window of Agent Plus wrote to the folder they share, for a failure's details: its items' activity and
     reason, and which of them it recorded as already told to the user. Also what a window's extension host makes of its
     focus. */
  const attentionFiles = () => {
    const dir = path.join(profile.home, '.agent-work-plan', 'attention');
    try {
      return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
        try { const d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); return { n, age: Date.now() - d.at, items: (d.items || []).map((x) => [x.sessionId.slice(0, 8), x.activity, x.waitingFor]), front: d.front, settled: (d.settled || []).map((x) => [x[1].slice(0, 8), Date.now() - x[2]]) }; } catch (_) { return { n }; }
      });
    } catch (_) { return null; }
  };
  /* Records the activity and reason that each window's file gives for conversation `id` every time they change, with
     the time since recording started; stop() returns the records. */
  const fileTimeline = (id) => {
    const dir = path.join(profile.home, '.agent-work-plan', 'attention'), t0 = Date.now(), seen = [], last = new Map();
    const timer = setInterval(() => {
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) { return; }
      for (const n of names) {
        let it = null;
        try { it = (JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')).items || []).find((x) => x.sessionId === id) || null; } catch (_) { continue; }
        const k = JSON.stringify(it ? [it.activity, it.waitingFor] : null);
        if (last.get(n) !== k) { last.set(n, k); seen.push([Date.now() - t0, n.slice(0, 8), k]); }
      }
    }, 200);
    return () => { clearInterval(timer); return seen; };
  };
  const focusOf = (folder) => call('return { env: process.env.AGENT_PLUS_TEST_FOCUS || null, said: globalThis.__agentPlusTestFocused === undefined ? null : globalThis.__agentPlusTestFocused, state: vscode.window.state.focused };',
    undefined, 60000, folder).catch((e) => String(e));
  /* What the page of `frame` was last told: whether Claude Code's own notices of waits are left to Agent Plus. */
  const waitsLeft = (frame) => frame.evaluate(() => (typeof window.__cceWaitsAnnounced === 'function' ? window.__cceWaitsAnnounced() : null)).catch(() => null);
  /* Whether VS Code counts the window whose extension host has `folder` open as the one with the focus. */
  const focused = (folder) => call('return vscode.window.state.focused;', undefined, 60000, folder).catch(() => null);
  /* This window brought to the front, once VS Code counts it as focused; Agent Plus shows its notices only then. Under
     xvfb-run there is no window manager, and a window counts as focused only after something focuses it. The test
     stage's environment has no other VS Code's VSCODE_IPC_HOOK_CLI (lib/env.js). */
  const focusWindow = async () => {
    if ((await focused()) === true) return true;
    win.frontWindow(exe, profile.user, profile.folder, process.env);
    return !!await until(async () => (await focused()) === true, 15000, 300);
  };
  const about = (t) => (n) => n.text.includes(`"${t.title}"`);
  const noticeOf = async (t, p = page) => (await needNotices(p)).find(about(t)) || null;
  /* Presses `label` on the toast of the notice about `t`. */
  const pressNotice = (t, label, p = page) => p.locator('.notifications-toasts .notification-list-item').filter({ hasText: `"${t.title}"` }).first()
    .locator('.monaco-button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click({ timeout: 5000 });
  /* Agent Plus's Conversations entry lists the conversations waiting for the user to approve something or answer last
     in its hover, under this heading. */
  const WAITS_HEAD = 'Waiting for you to approve something or answer:';
  /* In the window of `p`, how many conversations of the WAITS_HEAD group Agent Plus counts in the status bar; null
     while it counts none. VS Code puts the entry's hover after its text in the entry's aria-label, one line for each
     conversation, with "and N more" after the tenth. */
  const needCount = (p = page) => p.evaluate((head) => {
    const e = [...document.querySelectorAll('.statusbar-item')].find((x) => /agentPlus\.conversations$/.test(x.id) && x.offsetParent);
    const label = (e && e.getAttribute('aria-label')) || '', at = label.indexOf(head);
    if (at < 0) return null;
    const lines = label.slice(at + head.length).split('\n').map((l) => l.trim()).filter(Boolean);
    const more = /^and (\d+) more$/.exec(lines[lines.length - 1] || '');
    const n = more ? lines.length - 1 + Number(more[1]) : lines.length;
    return n ? { n, text: e.innerText.trim(), label } : null;
  }, WAITS_HEAD).catch(() => undefined);
  /* The status bar entry needCount reads. */
  const needEntry = async (p = page) => p.locator('.statusbar-item[id$="agentPlus.conversations"]').first();
  /* What Agent Plus's windows wrote of conversation `id` to the folder they share (its src/attention.js): its activity,
     whether its reply is unread, and whether a window that has the focus shows it in front. */
  const attentionOf = (id) => {
    const dir = path.join(profile.home, '.agent-work-plan', 'attention');
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
    const out = { activity: '', unseen: false, front: false };
    for (const n of names) {
      let d = null;
      try { d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { continue; }
      const it = (d.items || []).find((x) => x.sessionId === id);
      if (it) { out.activity = out.activity === 'waiting' ? 'waiting' : it.activity; out.unseen = out.unseen || !!it.unseen; }
      if ((d.front || []).some((p) => p[1] === id)) out.front = true;
    }
    return out;
  };
  /* Records every change of attentionOf(`id`), with the time since recording started; stop() returns the records. */
  const attentionTimeline = (id) => {
    const t0 = Date.now(), seen = [];
    let last = '';
    const timer = setInterval(() => {
      const a = attentionOf(id), k = JSON.stringify(a);
      if (k !== last) { last = k; seen.push([Date.now() - t0, a]); }
    }, 250);
    return () => { clearInterval(timer); return seen; };
  };
  /* What the page's own functions make of the agents button now, whatever the button last drew. */
  const footerNow = (frame = conv) => frame.evaluate(() => ({ dot: typeof window.__cceAgentsDot === 'function' ? window.__cceAgentsDot('idle') : null,
    label: typeof window.__cceAgentsLabel === 'function' ? window.__cceAgentsLabel('0 agents', 0) : null })).catch(() => null);
  /* How long Agent Plus can take to see a conversation's new activity: it lists every source at least once a refresh
     (REFRESH_MS in its src/views.js, 30 s), and this extension's list waits on `claude agents --json`, read again
     after 30 s (src/claude-source.js). Two refreshes. */
  const SEEN_MS = 60000;
  /* The delay before Agent Plus shows a notice after it sees the change behind it, read from the copy this run
     installed: it gathers changes for BATCH_MS, and holds back the notice of an unread reply until the reply has stayed
     unread for STABLE_MS. */
  const noticeDelay = (() => {
    try {
      const dir = fs.readdirSync(profile.exts).find((n) => n.startsWith('xnervwang.agent-plus-'));
      const a = require(path.join(profile.exts, dir, 'src', 'attention.js'));
      return { waiting: a.BATCH_MS, finished: a.STABLE_MS + a.BATCH_MS };
    } catch (_) { return { waiting: 2000, finished: 7000 }; }
  })();
  /* The notices about `t` that appear, as toasts or in the list, within the time Agent Plus takes to show one of
     `kind`. Call it only after something shows that Agent Plus has seen the state the notice would report. */
  const noticesWithin = async (t, kind = 'waiting', p = page, folder) => {
    let n = null;
    await until(async () => { n = await noticeOf(t, p); return !!n; }, (noticeDelay[kind] || 7000) + 2500, 250);
    return n ? [n] : (await listedNotices(p, folder)).filter(about(t));
  };
  const visibleNativeMenu = () => page.evaluate(() => !![...document.querySelectorAll('.context-view .monaco-menu, .monaco-menu-container')].find((e) => e.offsetParent));
  const auxiliaryVisible = () => page.evaluate(() => {
    const part = document.getElementById('workbench.parts.auxiliarybar');
    return !!(part && part.offsetWidth > 0 && part.offsetHeight > 0);
  });
  /* VS Code's modal dialog, drawn in the page with window.dialogStyle "custom". */
  const dialog = () => page.evaluate(() => {
    const d = [...document.querySelectorAll('.monaco-dialog-box')].find((e) => e.offsetParent);
    return d ? { text: d.innerText, buttons: [...d.querySelectorAll('.monaco-button')].map((b) => b.innerText.trim()).filter(Boolean) } : null;
  });
  const answerDialog = async (label) => {
    await page.locator('.monaco-dialog-box .monaco-button').filter({ hasText: label }).first().click();
    return until(async () => !(await dialog()), 5000, 200);
  };

  /* A frame of the window's webviews in which `test` (a function of document) is true. */
  const frameWhere = async (test, ms, arg) => until(async () => {
    for (const f of page.frames()) {
      try { if (await f.evaluate(test, arg)) return f; } catch (_) { /* not ready, or gone */ }
    }
    return null;
  }, ms, 500);
  /* The crop of `box` (in the window's CSS pixels) as a PNG, with each of its four edges rounded to the nearest pixel, as
     the page itself snaps them: a size such as 258.5 px rounded alone comes out as 258 in one run and 259 in the next. */
  const crop = (box) => {
    const x = Math.round(box.x), y = Math.round(box.y);
    return page.screenshot({ animations: 'disabled', clip: { x, y, width: Math.round(box.x + box.width) - x, height: Math.round(box.y + box.height) - y } });
  };
  /* Resolves once `loc` has stopped changing: its animations have finished and two readings of its box agree. */
  const still = async (loc) => {
    let last = '';
    return until(async () => {
      const busy = await loc.evaluate((e) => e.getAnimations({ subtree: true }).some((a) => a.playState === 'running'));
      const box = JSON.stringify(await loc.boundingBox());
      const same = !busy && box === last;
      last = box;
      return same;
    }, 3000, 100);
  };
  /* Compares the crop of `loc` once it is still, with `masks` (boxes in the window's pixels) left out. */
  const compareAt = async (name, loc, { masks = [], pad = 0 } = {}) => {
    await still(loc);
    /* Agent Plus's first-install token mode notice stays at the bottom right until it is answered, over the footer. */
    await exec('notifications.hideToasts');
    const b = await loc.boundingBox();
    if (!b) { check(false, `${name} can be cropped`, 'the element has no box'); return; }
    const box = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
    base.compare(name, await crop(box), { masks: within(box, masks) });
  };
  /* Rectangles of `boxes` relative to `outer`, for the masks of a crop. */
  const within = (outer, boxes) => boxes.filter(Boolean).map((b) => ({ x: Math.floor(b.x - Math.round(outer.x)), y: Math.floor(b.y - Math.round(outer.y)),
    w: Math.ceil(b.width) + 1, h: Math.ceil(b.height) + 1 }));
  /* How many pixels of each dot colour a PNG holds. */
  const dotColours = (png) => {
    const img = pixels.decode(png);
    const count = {};
    for (const [k, c] of Object.entries(DOTS)) {
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (Math.abs(img.data[i] - c[0]) <= 24 && Math.abs(img.data[i + 1] - c[1]) <= 24 && Math.abs(img.data[i + 2] - c[2]) <= 24) n++;
      }
      count[k] = n;
    }
    return count;
  };
  /* The green dot in a PNG: the box its pixels span, and the share of the pixels round the box's middle that are green,
     all of them for a filled dot and none for a ring; null when there are too few green pixels to be a dot. */
  const dotShape = (png) => {
    const img = pixels.decode(png), c = DOTS.running;
    const green = (x, y) => { const i = (y * img.width + x) * 4; return [0, 1, 2].every((k) => Math.abs(img.data[i + k] - c[k]) <= 24); };
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) if (green(x, y)) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    if (n < 6) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(0.75, (x1 - x0 + 1) / 4);
    let inner = 0, hit = 0;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        inner++;
        if (green(x, y)) hit++;
      }
    }
    return { width: x1 - x0 + 1, height: y1 - y0 + 1, pixels: n, middle: inner ? Math.round((hit / inner) * 100) / 100 : 0 };
  };
  const filled = (shape) => !!shape && shape.middle >= 0.75;
  const ringed = (shape) => !!shape && shape.middle <= 0.25;
  /* The crop of the logo on the tab whose label starts with `label`, how many pixels of each dot colour it holds, and the
     shape of its green dot, or null if the tab bar does not show that tab. */
  const tabLogo = async (label) => {
    const tab = page.locator('.tabs-container .tab').filter({ hasText: label.slice(0, 16) }).first();
    const box = await tab.boundingBox().catch(() => null);
    const bar = await page.locator('.editor-group-container:has(.tabs-container .tab) .tabs-and-actions-container').filter({ has: tab }).first()
      .boundingBox().catch(() => null);
    if (!box || !bar || box.x < bar.x || box.x + 40 > bar.x + bar.width) return null;
    const area = { x: box.x + 4, y: box.y + 4, width: 24, height: box.height - 8 };
    const png = await crop(area);
    return { count: Object.assign(dotColours(png), { shape: dotShape(png) }), png };
  };
  const dotsOn = async (label) => { const l = await tabLogo(label); return l && l.count; };
  /* The hover label this extension draws in `frame` while the pointer rests on `loc`, as { text, box }. */
  const labelOf = async (frame, loc) => {
    await exec('notifications.hideToasts');
    await page.mouse.move(5, 5);
    await sleep(200);
    await loc.hover();
    const got = await until(() => frame.evaluate(() => {
      const b = document.querySelector('[data-cce-label="1"]');
      return b && b.innerText.trim() ? b.innerText.trim() : '';
    }), 3000, 100);
    const box = got ? await frame.locator('[data-cce-label="1"]').first().boundingBox() : null;
    const png = box ? await crop(box) : null;
    await page.mouse.move(5, 5);
    await sleep(200);
    return { text: got || '', box, png };
  };

  /* ── the session list, Claude Code's own webview ── */
  let list = null;
  /* A conversation's row below OPEN SESSIONS and RECENTLY CLOSED, which show the same conversations again. */
  const row = (t) => list.locator(`[class*="sessionItem_"]:has([data-cce-pin="${t.id}"]):not([data-cce-section] *)`).first();
  const menus = () => list.evaluate(() => [...document.querySelectorAll('[role="menu"]')].filter((m) => m.getClientRects().length)
    .map((m) => [...m.querySelectorAll('[role="menuitem"]')].map((i) => i.innerText.replace(/\s*›\s*$/, '').trim())));
  const item = (label, level = 0) => list.locator('[role="menu"]').nth(level).locator('[role="menuitem"]').filter({ hasText: label }).first();
  /* A press on an empty corner of the list closes its menus and does nothing else. In a short window a menu opened low
     in the list reaches its bottom, so the corner is one that no menu covers. */
  const closeMenus = async () => {
    if (!(await menus()).length) return;
    const box = await (await list.frameElement()).boundingBox();
    const at = await list.evaluate(({ w, h }) => {
      const rects = [...document.querySelectorAll('[role="menu"]')].map((m) => m.getBoundingClientRect());
      const free = ([x, y]) => !rects.some((r) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4);
      return [[w - 12, h - 12], [40, h - 12], [w - 12, h / 2]].find(free) || [w - 12, h - 12];
    }, { w: box.width, h: box.height });
    await page.mouse.click(box.x + at[0], box.y + at[1]);
    await until(async () => !(await menus()).length, 3000, 100);
  };
  const openMenu = async (t) => {
    await closeMenus();
    await row(t).click({ button: 'right' });
    return until(async () => { const m = await menus(); return m.length ? m : null; }, 5000, 100);
  };
  /*
   * Right-clicks `t`'s row and clicks the menu item labels[0], or, given labels[1], that item of its submenu. The list
   * closes its menu when its page loses the focus, and another webview of the window (a Claude Code page that has just
   * opened) can take the focus at any moment; a click then lands on whatever was under the menu, with no error. So the
   * page records where each click lands, and a click that missed its item while the page lost the focus is tried again,
   * at most twice. A click that missed while the page kept the focus fails the check.
   */
  const pick = async (t, labels) => {
    await list.evaluate(() => {
      window.__cceLanded = [];
      if (window.__cceLandedHook) return;
      window.__cceLandedHook = true;
      window.addEventListener('click', (e) => {
        const it = e.target.closest && e.target.closest('[role="menuitem"]');
        window.__cceLanded.push(it ? it.innerText.replace(/\s*›\s*$/, '').trim() : `outside the menu (${e.target.tagName})`);
      }, true);
      window.addEventListener('blur', () => window.__cceLanded.push('the page lost the focus'));
    });
    const said = [];
    const wanted = labels[labels.length - 1];
    for (let attempt = 1; attempt <= 3; attempt++) {
      /* The dialog an item opens can come up a moment after the check below; the click before this one did land then. */
      if (attempt > 1 && await dialog().catch(() => null)) return attempt - 1;
      await list.evaluate(() => { window.__cceLanded = []; });
      const opened = await openMenu(t);
      try {
        if (!opened) throw new Error('no menu opened');
        if (labels.length > 1) {
          await item(labels[0]).hover({ timeout: 3000 });
          await item(labels[1], 1).click({ timeout: 3000 });
        } else await item(labels[0]).click({ timeout: 3000 });
      } catch (e) { said.push(e.message.split('\n')[0]); }
      const landed = await list.evaluate(() => window.__cceLanded.slice());
      if (landed.some((x) => x.startsWith(wanted))) return attempt;
      /* A dialog the item opens can take the focus before its click is recorded (seen on macOS); then it did land, and
         opening the menu again would click behind the dialog. */
      if (await dialog().catch(() => null)) return attempt;
      said.push(landed.join(', ') || 'no click recorded');
      if (!landed.includes('the page lost the focus')) throw new Error(`the click on ${labels.join(' > ')} landed elsewhere: ${said.join('; ')}`);
      await sleep(1000);
    }
    throw new Error(`the menu kept closing before ${labels.join(' > ')} could be clicked: ${said.join('; ')}`);
  };
  const retried = (n, what) => { if (n > 1) note(`${what} took ${n} tries: the session list's menu closed before the click landed`); };
  const openList = async () => {
    await exec('workbench.view.extension.claude-sessions-sidebar');
    list = await frameWhere(() => !!document.querySelector('[data-cce-new-session]'), 60000);
    return list;
  };
  /* OPEN SESSIONS and RECENTLY CLOSED, with the conversations each shows: a row drawn by the list's own component has an
     id that ends in the session id, and one drawn by this extension says it in data-cce-open-row. */
  const sections = () => list.evaluate(() => [...document.querySelectorAll('[data-cce-section]')].map((s) => ({
    open: s.hasAttribute('data-cce-open-sessions'), closed: s.hasAttribute('data-cce-recent-closed'), collapsed: s.getAttribute('data-cce-collapsed') === '1',
    head: ((s.querySelector('[data-cce-section-head]') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    rows: [...s.querySelectorAll('[class*="sessionItem_"][id], [data-cce-open-row]')]
      .map((r) => r.getAttribute('data-cce-open-row') || (/[0-9a-f-]{36}$/.exec(r.id) || [''])[0]) })));

  /* The dot colours on the left of a conversation's row in OPEN SESSIONS, where the list draws its status dot. */
  const listDot = async (t) => {
    const b = await list.locator(`[data-cce-open-sessions] [class*="sessionItem_"][id$="${t.id}"]`).first().boundingBox().catch(() => null);
    return b ? dotColours(await crop({ x: b.x, y: b.y, width: Math.min(60, b.width), height: b.height })) : null;
  };
  /* The dot the session list draws on a conversation's row, as its element has it: on the row under OPEN SESSIONS, or
     with `main` on its row in the list below. { state: '' } for a row with no dot; null with no such row. */
  const listDotState = (t, main) => list.evaluate(({ id, main }) => {
    const r = [...document.querySelectorAll('[class*="sessionItem_"]')].find((x) => (main ? !x.closest('[data-cce-section]') && x.querySelector(`[data-cce-pin="${id}"]`)
      : x.closest('[data-cce-open-sessions]') && x.id.endsWith(id)));
    if (!r) return null;
    const d = r.querySelector('[data-status-dot]');
    if (!d) return { state: '' };
    const s = getComputedStyle(d);
    return { state: d.getAttribute('data-status-dot'), ring: /statusDotElsewhere/.test(d.className), background: s.backgroundColor, border: s.borderTopColor };
  }, { id: t.id, main: !!main }).catch(() => null);
  /* Where the parts of a conversation's row in the list below OPEN SESSIONS lie, each [left, right]: its name, its
     envelope and its time; whether the name is cut short, and the character the envelope is drawn with. */
  const rowParts = (t) => list.evaluate((id) => {
    const r = [...document.querySelectorAll('[class*="sessionItem_"]')].find((x) => !x.closest('[data-cce-section]') && x.querySelector(`[data-cce-pin="${id}"]`));
    if (!r) return null;
    const at = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left * 10) / 10, Math.round(b.right * 10) / 10]; };
    const name = r.querySelector('span[class*="sessionName_"]'), env = r.querySelector('[data-cce-envelope]'), time = r.querySelector('[class*="sessionMeta_"]');
    const cut = (e) => { for (let x = e; x && x !== r; x = x.parentElement) if (x.scrollWidth > x.clientWidth + 1) return true; return false; };
    return { row: at(r), name: at(name), envelope: at(env), time: at(time), cut: !!name && cut(name),
      form: env ? getComputedStyle(env, '::after').content : '', envelopes: r.querySelectorAll('[data-cce-envelope]').length };
  }, t.id).catch(() => null);
  /* Whether the envelope comes after the name and before the time, and is not cut. */
  const envelopeBetween = (p) => !!p && !!p.name && !!p.envelope && !!p.time && p.envelopes === 1 && p.envelope[0] >= p.name[1] - 0.5
    && p.envelope[1] <= p.time[0] + 0.5 && p.envelope[1] - p.envelope[0] >= 8 && p.envelope[1] <= p.row[1];
  /* A press on the empty bottom of the list, which takes the focus off its rows and does nothing else. */
  const clickEmpty = async () => {
    const box = await (await list.frameElement()).boundingBox();
    await page.mouse.click(box.x + 40, box.y + box.height - 12);
    await page.mouse.move(5, 880);
    await sleep(300);
  };
  /*
   * Every row of the session list as a person sees it, by what the list's own styles draw: the class it gives the
   * conversation it counts as in front, the class of the rows selected together for a multi-row action, the row the
   * arrow keys are on, the keyboard focus, the background and the outline, and whether the row's buttons show. These
   * are the rows of the list's own row component, whose id ends in the session id: the list's, OPEN SESSIONS' and
   * RECENTLY CLOSED's, and those of the list a conversation's page opens from its header.
   */
  const rowLooks = (frame = list) => frame.evaluate(() => [...document.querySelectorAll('button[class*="sessionItem_"][id]')].map((r) => {
    const s = getComputedStyle(r), buttons = r.querySelector('[class*="sessionActions_"]');
    return {
      id: (/[0-9a-f-]{36}$/.exec(r.id) || [''])[0],
      where: r.closest('[data-cce-open-sessions]') ? 'open sessions' : r.closest('[data-cce-recent-closed]') ? 'recently closed' : 'list',
      title: ((r.querySelector('[class*="sessionName_"]') || {}).textContent || '').trim().slice(0, 32),
      active: /(^|\s)active_/.test(r.className), selected: /(^|\s)selected_/.test(r.className), highlighted: r.hasAttribute('data-highlighted'),
      focus: document.hasFocus() && (r.matches(':focus-visible') || r.matches(':has(:focus-visible)')), hover: r.matches(':hover'), background: s.backgroundColor,
      outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? `${s.outlineWidth} ${s.outlineColor}` : '',
      buttons: !!buttons && getComputedStyle(buttons).visibility === 'visible',
    };
  })).catch(() => []);
  /* A row drawn other than plain: with a background, an outline or its buttons showing. */
  const drawnRow = (r) => r.background !== 'rgba(0, 0, 0, 0)' || !!r.outline || r.buttons;
  /* The rows of `looks` drawn wrong, given the ids of the open conversations in `open` and the conversation Claude Code
     counts as in front in `front` (an id, or null). A row is wrong when its conversation is open nowhere and it is
     drawn as the one in front, as picked or as the row the arrow keys are on, or drawn other than plain away from the
     keyboard focus (a list with the focus draws that row as it draws the row under the mouse). A row is also wrong when
     it is drawn as the one in front but is not `front`, or is `front` and is not drawn so. */
  const misdrawn = (looks, open, front) => looks.filter((r) => r.id
    && ((!open.includes(r.id) && (r.active || r.selected || r.highlighted || (!r.focus && drawnRow(r)))) || r.active !== (r.id === front)));

  /* ── the conversation's page ── */
  let conv = null;
  const conversation = (t, ms = 90000) => frameWhere((q) => document.querySelectorAll('[class*="userMessage_"]').length >= q.n
    && document.body.innerText.includes(q.ask), ms, { n: t.turns.length, ask: t.turns[0][0] });
  /* The stamps as they read: the word joiners the page puts after each hyphen show nothing. */
  const stampsIn = (frame) => frame.evaluate(() => {
    const of = (sel) => [...document.querySelectorAll(sel)].map((m) => {
      const s = m.hasAttribute('data-cce-ts') ? m : m.querySelector('[data-cce-ts]');
      return s ? s.getAttribute('data-cce-ts').replace(/\u2060/g, '') : null;
    });
    return { user: of('[class*="userMessage_"]'), reply: of('[data-testid="assistant-message"]'), all: document.querySelectorAll('[data-cce-ts]').length };
  });
  /* Reads the footer's agents button: the state and colour of its dot, and its label. */
  const GREEN = `rgb(${DOTS.running.join(', ')})`;
  const footer = (frame = conv) => frame.evaluate(() => {
    const b = document.querySelector('button[data-agents-dot]');
    if (!b) return null;
    const dot = b.querySelector('[data-status-dot]');
    return { dot: b.getAttribute('data-agents-dot'), label: b.getAttribute('aria-label') || '', colour: dot ? getComputedStyle(dot).backgroundColor : '' };
  });
  /* The text of the agent map once open, and the dot of the conversation's own row in it. */
  const mapState = (frame = conv) => frame.evaluate(() => {
    const own = document.querySelector('[class*="rowMain_"] [data-status-dot]'), s = own && getComputedStyle(own);
    return { text: document.body.innerText.slice(-3000), own: own ? { state: own.getAttribute('data-status-dot'),
      ring: /statusDotElsewhere/.test(own.className), border: s.borderTopColor, background: s.backgroundColor } : null };
  });
  /* Opens the agent map from the footer's button, returns what `read` finds in it, and closes the map. */
  const inMap = async (read, frame = conv) => {
    await frame.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
    const got = await until(async () => { const m = await mapState(frame); return read(m) || null; }, 10000, 500);
    const last = got || await mapState(frame);
    await page.keyboard.press('Escape');
    await sleep(500);
    return { got, last };
  };

  /* The agent map's look while it is open (src/page/82-scheduled-tasks.js): its headings, this page's and the two of
     Claude Code's that get theirs from attributes, each with what it reads, its count and how it is drawn; this page's
     cards, each with its dot and its two lines; and Claude Code's own rows. null while no map is open. */
  const mapLook = (frame = conv) => frame.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => [...d.querySelectorAll('h3')].some((h) => h.textContent.trim() === 'Agent map'));
    if (!dialog) return null;
    const px = (v) => parseFloat(v) || 0;
    const rect = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }; };
    const shown = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
    const oneLine = (e) => shown(e) && !!e.textContent.trim() && rect(e).height > 0 && rect(e).height < 2 * px(getComputedStyle(e).fontSize);
    const heads = [...dialog.querySelectorAll('.cce-map-head, [data-cce-map-cc]')].filter(shown).map((e) => {
      const theirs = e.hasAttribute('data-cce-map-cc');
      const label = theirs ? getComputedStyle(e, '::before') : getComputedStyle(e.querySelector('.cce-map-label') || e);
      return { theirs, me: e.hasAttribute('data-cce-map-me'), label: theirs ? e.getAttribute('data-cce-map-cc') : (e.getAttribute('data-cce-map-head') || e.textContent.trim()),
        count: theirs ? e.getAttribute('data-cce-map-count') : ((e.querySelector('.cce-map-count') || {}).textContent || null),
        size: px(label.fontSize), weight: Number(label.fontWeight) || 400, upper: label.textTransform === 'uppercase',
        border: px(getComputedStyle(e).borderTopWidth), hint: e.getAttribute('aria-label') || '', ...rect(e) };
    }).sort((x, y) => x.top - y.top);
    const cards = [...dialog.querySelectorAll('.cce-map-card')].map((c) => {
      const dot = c.querySelector('[data-cce-map-dot]'), title = c.querySelector('.cce-map-text'), meta = c.querySelector('.cce-map-meta');
      const d = dot && rect(dot);
      return { kind: c.getAttribute('data-cce-map-card'), parts: c.children.length, title: title ? title.textContent : '', meta: meta ? meta.textContent : '',
        dot: !!dot && d.width === 8 && d.height === 8 && getComputedStyle(dot).backgroundColor !== 'rgba(0, 0, 0, 0)' ? dot.getAttribute('data-cce-map-dot') : null,
        lines: oneLine(title) && oneLine(meta), size: title ? px(getComputedStyle(title).fontSize) : 0, hint: c.getAttribute('aria-label') || '', ...rect(c) };
    }).sort((x, y) => x.top - y.top);
    const main = dialog.querySelector('[class*="rowMain_"]');
    const content = dialog.querySelector('[class*="content_"]');
    return { heads, cards, main: shown(main) ? rect(main) : null,
      rows: [...dialog.querySelectorAll('button[class*="row_"]')].filter(shown).map((r) => ({ text: r.textContent.trim().slice(0, 80), ...rect(r) })),
      hiddenZero: [...dialog.querySelectorAll('[data-cce-map-cc][data-cce-map-count="0"]')].every((e) => !shown(e)),
      sideways: content ? content.scrollWidth - content.clientWidth : null };
  });
  /* The section headed `label` in a map read by mapLook, with the cards under it, or null. Cards come in the order of
     their sections, so those under a heading are the ones between it and the next one. */
  const mapSection = (look, label) => {
    if (!look) return null;
    const at = look.heads.findIndex((x) => x.label === label);
    if (at < 0) return null;
    const head = look.heads[at], next = look.heads[at + 1];
    return { head, cards: look.cards.filter((c) => c.top > head.top && (!next || c.top < next.top)) };
  };
  /* Every card of this page in Claude Code's form: a dot, a title line and a line under it. */
  const cardsInForm = (look) => !!look && look.cards.length > 0 && look.cards.every((c) => c.parts === 2 && !!c.dot && c.lines);

  /* The pages that drew this extension's warning that the panel's messages are no longer found (src/page/90-self-check.js).
     Once drawn it stays in the page, hidden or not, so every page of every window is looked at every few seconds. */
  const warned = new Map();
  let warnBusy = false;
  const warnWatch = setInterval(async () => {
    if (warnBusy) return;
    warnBusy = true;
    try {
      for (const p of w.browser.contexts().flatMap((c) => c.pages())) {
        for (const f of p.frames()) {
          const said = await f.evaluate(() => {
            const e = document.getElementById('cce-warn');
            return e ? `${e.style.display === 'none' ? 'drawn, now hidden' : 'showing'}: ${(document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 80)}` : null;
          }).catch(() => null);
          if (said && !warned.has(f.url())) warned.set(f.url(), said);
        }
      }
    } finally { warnBusy = false; }
  }, 5000);

  try {
    await w.hostUp();

    await step('the patch', async () => {
      const st = await until(async () => { const s = await patchState(); return s && s.targets.length === 2 && s.targets.every(([, x]) => x === 'patched') && s; }, 120000, 1000);
      check(!!st, 'Claude Code Plus patches Claude Code\'s panel and its host on the first start', await patchState());
      const toast = await until(async () => (await toasts()).find((t) => RELOAD.test(t)) || '', 30000, 500);
      check(!!toast, 'and VS Code shows its prompt to reload the window', toast || await toasts());
      const actions = await page.evaluate(() => {
        const n = [...document.querySelectorAll('.notification-list-item')].find((e) => /Claude Code Plus is installed/.test(e.innerText));
        return n ? [...n.querySelectorAll('.monaco-button')].map((b) => b.innerText.trim()).filter(Boolean) : null;
      });
      check(!!actions && actions.includes('Reload Window'), 'with a Reload Window button on it', actions);
      await shot('patched-reload-prompt');
      await openNotes();
      await until(async () => (await claudeButtons()).length > 0, 15000);
      const before = await claudeButtons();
      check(before.length === 1 && before[0] === CLAUDE_BUTTON, 'the tab bar has one Claude button, Claude Code\'s own', before);
      const hover = before.length ? await hoverText(claudeButton()) : '';
      check(hover.startsWith(CLAUDE_BUTTON), `and its hover reads "${CLAUDE_BUTTON}"`, hover);
      await shot('tab-bar-before-reload');
    });

    await step('the reload', async () => {
      await exec('notifications.clearAll');
      await w.reload();
      const st = await until(async () => { const s = await patchState(); return s && s.active && s; }, 60000, 1000);
      check(!!st && st.targets.every(([, x]) => x === 'patched'), 'after the reload the extension is active and both files are still patched', st);
      await sleep(3000);
      const again = (await toasts()).filter((t) => RELOAD.test(t));
      check(!again.length, 'and VS Code does not ask for a reload again', again);
      /* Claude Code opens itself in the secondary sidebar on its first start; the editor area is wanted whole. */
      await exec('workbench.action.closeAuxiliaryBar');
      await exec('workbench.action.closeAllEditors');
      await openNotes();
      const after = await until(async () => { const b = await claudeButtons(); return b.length ? b : null; }, 15000, 500);
      check(!!after && after.length === 1 && after[0] === CLAUDE_BUTTON, 'after the reload the tab bar still has one Claude button, Claude Code\'s own', after);
      await shot('reloaded');
    });

    await step('session list', async () => {
      check(!!await openList(), 'Claude Code\'s session list opens with this extension\'s buttons in it');
      if (!list) return;
      const top = await list.evaluate(() => ({
        ours: [...document.querySelectorAll('[data-cce-new-session]')].map((b) => [b.getAttribute('data-cce-new-session'), b.innerText.trim(), b.title]),
        theirs: [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'New session').length }));
      check(JSON.stringify(top.ours) === JSON.stringify([['tab', 'New in tab', 'Start a conversation in a new editor tab'],
        ['sidebar', 'New in sidebar', 'Start a conversation in the sidebar']]) && top.theirs === 0,
      'New in tab and New in sidebar stand in place of Claude Code\'s New session', top);
      /* Each keeps its 16 px icon however narrow the list is; macOS and Windows open the window narrow enough to test it. */
      const icons = await list.evaluate(() => [...document.querySelectorAll('[data-cce-new-session]')].map((b) => {
        const i = b.querySelector('svg') || (b.firstElementChild && b.firstElementChild.firstElementChild);
        return i ? Math.round(i.getBoundingClientRect().width) : 0;
      }));
      check(icons.length === 2 && icons.every((x) => x === 16), 'and each keeps its icon whole', icons);
      const listed = await until(async () => {
        const got = await list.evaluate(() => [...document.querySelectorAll('[class*="sessionItem_"] span[class*="sessionName_"]')].map((e) => e.textContent.trim()));
        return threads.every((t) => got.includes(t.title)) && got;
      }, 30000, 500);
      check(!!listed, `it lists the ${threads.length} fake conversations by their titles`, listed || undefined);
      const pins = await until(async () => {
        const p = await list.evaluate((ids) => ids.map((id) => {
          const e = [...document.querySelectorAll(`[data-cce-pin="${id}"]`)].find((x) => !x.closest('[data-cce-section]'));
          const r = e && e.closest('[class*="sessionItem_"]');
          return e && { off: e.hasAttribute('data-cce-pin-off'), pinned: e.getAttribute('data-cce-pinned'), label: e.getAttribute('aria-label'),
            shown: getComputedStyle(e).display !== 'none', row: r ? r.innerText.replace(/\s+/g, ' ') : '' };
        }), threads.map((t) => t.id));
        return p.every((x) => x && !x.off && x.shown) && p;
      }, 20000, 500);
      check(!!pins && pins.every((p) => p.pinned === '0' && /^Pin this conversation/.test(p.label)), 'every row has a hollow pin, not pinned', pins);
      check(!!pins && pins.every((p) => /\b(?:now|\d+[smhd]) · \d\d\/\d\d\b/.test(p.row)), 'and every row shows how long its conversation ran and its date', pins && pins.map((p) => p.row));
      await page.mouse.move(5, 880);
      await sleep(300);
      await shot('session-list');
      await compareAt('new-session-buttons', list.locator('div:has(> [data-cce-new-session="tab"])').first());
      await compareAt('pin', list.locator(`[data-cce-pin="${threads[2].id}"]:not([data-cce-section] *)`).first());

      /* The menu: what this extension puts in it, and no menu of VS Code's over it. */
      const menu = await openMenu(threads[1]);
      check(!!menu && menu.length === 1 && ['Resume in tab', 'Resume in sidebar', 'Text color'].every((l) => menu[0].includes(l))
        && !menu[0].includes('Resume session'), 'a right-click on a row opens the list\'s menu with Resume in tab, Resume in sidebar and Text color, in place of Resume session', menu);
      check(!await visibleNativeMenu(), 'and no menu of VS Code\'s opens over it');
      await page.mouse.move(5, 880);
      await sleep(300);
      await shot('session-row-menu');
      const resume = await Promise.all([item('Resume in tab').boundingBox(), item('Resume in sidebar').boundingBox()]);
      if (resume[0] && resume[1]) {
        const box = { x: resume[0].x, y: resume[0].y, width: resume[0].width, height: resume[1].y + resume[1].height - resume[0].y };
        base.compare('row-menu-resume', await crop(box));
      }
      await compareAt('row-menu-text-color', item('Text color'));
      await item('Text color').hover();
      const sub = await until(async () => { const m = await menus(); return m.length > 1 ? m[1] : null; }, 5000, 200);
      check(!!sub && sub[0] === 'Default ✓' && JSON.stringify(sub.slice(1)) === JSON.stringify(COLORS),
        'resting on Text color opens its submenu: Default, checked, and the eight colours', sub);
      await shot('session-text-color');
      if (sub) await compareAt('text-color-submenu', list.locator('[role="menu"]').nth(1));
      const colourOf = () => row(threads[1]).locator('span[class*="sessionName_"]').first().evaluate((e) => getComputedStyle(e).color);
      const was = await colourOf();
      await item('Red', 1).click();
      const now = await until(async () => { const c = await colourOf(); return c === RED_TITLE && c; }, 15000, 300);
      check(!!now && !(await menus()).length, 'clicking Red closes the menu and draws that row\'s title in the theme\'s red', { was, now: await colourOf() });
      await shot('session-row-red');

      /* A pin clicked. */
      const pin = list.locator(`[data-cce-pin="${threads[2].id}"]:not([data-cce-section] *)`).first();
      await pin.click();
      const pinned = await until(async () => {
        const p = await pin.evaluate((e) => ({ pinned: e.getAttribute('data-cce-pinned'), label: e.getAttribute('aria-label'), color: getComputedStyle(e).color }));
        return p.pinned === '1' && p.color === PIN_PURPLE && p;
      }, 20000, 500);
      check(!!pinned && /^Unpin this conversation/.test(pinned.label), 'clicking a pin pins the conversation: the pin turns purple and offers to unpin',
        pinned || await pin.evaluate((e) => [e.getAttribute('data-cce-pinned'), getComputedStyle(e).color]));
      await clickEmpty();
      await shot('session-pinned');
      await compareAt('pin-pinned', pin);

      /* The hover text of a row. */
      const hover = await labelOf(list, row(threads[2]).locator('span[class*="sessionName_"]').first());
      check(hover.text === `Group: Ungrouped\nSession ID: ${threads[2].id}`, 'resting on a row shows its group and its session ID', hover.text);
      if (hover.png) base.compare('row-hover-label', hover.png);

      /* The transcripts of a `claude --bg`, a `claude -p` and a daemon session that lib/fake-home.js wrote with the
         others. claudeCodePlus.hideBackgroundSessions, on by default, leaves all three out; turned off, without a reload,
         the first two are listed and the daemon session still is not. */
      const titles = () => list.evaluate(() => [...document.querySelectorAll('[class*="sessionItem_"] span[class*="sessionName_"]')].map((e) => e.textContent.trim()));
      const backgroundShown = async () => { const got = await titles(); return background.filter((b) => got.includes(b.title)).map((b) => b.title); };
      const setHide = (v) => call(`await vscode.workspace.getConfiguration('claudeCodePlus').update('hideBackgroundSessions', arg === null ? undefined : arg,
        vscode.ConfigurationTarget.Global); return true;`, v);
      const listedWhenShown = background.filter((b) => b.listedWhenShown).map((b) => b.title);
      check(background.length === 3 && !(await backgroundShown()).length,
        'with claudeCodePlus.hideBackgroundSessions on, the list leaves out the claude --bg, claude -p and daemon sessions', await backgroundShown());
      await setHide(false);
      try {
        const shown = await until(async () => { const b = await backgroundShown(); return listedWhenShown.every((x) => b.includes(x)) && b; }, 30000, 500);
        check(!!shown && JSON.stringify(shown.slice().sort()) === JSON.stringify(listedWhenShown.slice().sort()),
          'turned off, without a reload, the list shows the claude --bg and claude -p sessions, and still not the daemon session', shown || await backgroundShown());
        await page.mouse.move(5, 880);
        await sleep(300);
        await shot('session-list-background-shown');
      } finally { await setHide(null); }
      const hiddenAgain = await until(async () => !(await backgroundShown()).length, 30000, 500);
      check(!!hiddenAgain, 'and turned back on, it leaves them out again', await backgroundShown());
    });

    const tab0 = threads[0];
    await step('a conversation in a tab', async () => {
      if (!list) throw new Error('the session list did not open');
      const before = await tabs();
      retried(await pick(tab0, ['Resume in tab']), 'Resume in tab');
      const opened = await until(async () => { const t = await claudeTabs(); return t.find((x) => x.active && titled(x.label, tab0.title)); }, 30000, 500);
      check(!!opened, 'Resume in tab opens the conversation in an editor tab titled by the conversation', opened || await tabs());
      check(!await auxiliaryVisible(), 'and not in the sidebar', { before, after: await tabs() });
      conv = await conversation(tab0);
      check(!!conv, 'Claude Code draws every turn of the conversation in that tab');
      if (!conv) return;
      const st = await until(async () => { const s = await stampsIn(conv); return s.user.every(Boolean) && s.reply.every(Boolean) && s.user.length === tab0.turns.length && s; }, 20000, 500);
      const s = st || await stampsIn(conv);
      check(!!st && s.user.every((x) => new RegExp(`^${STAMP}$`).test(x)), 'each of your messages carries its time', s.user);
      check(!!st && s.reply.length === tab0.turns.length && s.reply.every((x) => new RegExp(`^${STAMP} {2}\\d+s(${SEP}ctx${NB}\\d+%)?${SEP}sonnet-5-5$`).test(x)),
        'each reply carries its time, how long it took and its model', s.reply);
      const edges = await conv.evaluate(() => [...document.querySelectorAll('[class*="userMessage_"]')].map((e) => getComputedStyle(e).borderLeftWidth));
      check(edges.length === tab0.turns.length && edges.every((x) => x === '3px'), 'your messages have the bar down their left edge', edges);
      await shot('conversation-tab');

      /* OPEN SESSIONS in the list. */
      const open = await until(async () => (await sections()).find((x) => x.open && x.rows.includes(tab0.id)), 15000, 500);
      check(!!open && /^OPEN SESSIONS 1$/i.test(open.head) && open.rows.length === 1, 'OPEN SESSIONS at the top of the list holds the conversation now open', open || await sections());
      if (open) await compareAt('open-sessions-head', list.locator('[data-cce-open-sessions] [data-cce-section-head]').first());

      /* The rail and its list. */
      const rail = await conv.evaluate(() => {
        const r = document.getElementById('cce-toc-rail');
        if (!r) return null;
        const b = r.getBoundingClientRect();
        return { display: r.style.display, parts: r.children.length, top: b.top, off: Math.abs(b.top + b.height / 2 - innerHeight / 2) };
      });
      check(!!rail && rail.display === 'flex' && rail.parts === 5, 'the rail is drawn at the right edge: to the top, up, the handle, down, to the bottom', rail);
      check(!!rail && Number.isInteger(rail.top) && rail.off <= 1, 'centred on a whole pixel, so its arrows are drawn sharp', rail);
      await page.mouse.move(5, 5);
      await sleep(300);
      if (rail) await compareAt('rail', conv.locator('#cce-toc-rail'));
      const handle = await labelOf(conv, conv.locator('#cce-toc-handle'));
      check(handle.text === LABELS.rail, 'resting on the handle says what it opens', handle.text);
      await conv.locator('#cce-toc-handle').click();
      const frameBox = await (await conv.frameElement()).boundingBox();
      const toc = await until(() => conv.evaluate(() => {
        const p = document.getElementById('cce-toc');
        if (!p || p.style.display !== 'block') return null;
        const rows = [...(p.children[1] || { children: [] }).children];
        return { filter: !!p.querySelector('input[placeholder="Filter your messages"]'), rows: rows.map((r) => r.textContent),
          times: rows.map((r) => {
            const t = r.firstElementChild;
            if (!t) return null;
            const b = t.getBoundingClientRect();
            return { x: b.left, y: b.top, width: b.width, height: b.height, end: Math.round(b.right) };
          }) };
      }), 5000, 200);
      const asked = tab0.turns.map(([q]) => (q.length > 44 ? q.slice(0, 44) + '\u2026' : q));
      check(!!toc && toc.filter && toc.rows.length === asked.length && toc.rows.every((r, i) => /^\d\d:\d\d:\d\d {2}/.test(r) && r.endsWith(asked[i])),
        'the handle opens the list of your messages, each with its time, under a filter box', toc && toc.rows);
      const ends = toc ? toc.times.map((b) => b && b.end) : [];
      check(ends.length > 1 && ends.every((x) => x && x === ends[0]), 'and the times are all one width, so every question starts at the same place', ends);
      await page.mouse.move(5, 5);
      await sleep(300);
      await shot('conversation-rail-list');
      if (toc) {
        const masks = toc.times.filter(Boolean).map((b) => ({ x: frameBox.x + b.x, y: frameBox.y + b.y, width: b.width, height: b.height }));
        await compareAt('rail-list', conv.locator('#cce-toc'), { masks });
        /* A helper of the same name in another fragment would replace the one that draws this preview (see the
           duplicate-name check in check.js). */
        await conv.locator('#cce-toc > div:nth-child(2) > div').first().hover();
        const full = await until(() => conv.evaluate(() => {
          const t = document.getElementById('cce-toc-tip');
          return t && t.style.display === 'block' ? t.textContent : null;
        }), 3000, 200);
        check(!!full && full.endsWith(tab0.turns[0][0].slice(0, 220)), 'resting on a message in the list shows it in full', full);
        await page.mouse.move(5, 5);
        await sleep(300);
      }
      await conv.locator('#cce-toc-handle').click();

      /* The footer's buttons. */
      const footer = await conv.evaluate(() => {
        const send = document.querySelector('button[type="submit"][data-permission-mode]');
        const mode = send && send.previousElementSibling;
        const kids = mode && mode.parentElement ? [...mode.parentElement.children] : [];
        const at = (sel) => kids.findIndex((k) => k.matches(sel));
        return { info: at('[data-cce-info]'), focus: at('[data-cce-focus-btn]'), mute: at('[data-cce-mute]'), mode: kids.indexOf(mode) };
      });
      check(footer.info >= 0 && footer.focus >= 0 && footer.mute >= 0 && Math.max(footer.info, footer.focus, footer.mute) < footer.mode,
        'the information, Focus view and chime buttons are in the footer, left of the permission mode', footer);
      for (const [name, sel] of [['footer-info', '[data-cce-info]'], ['footer-focus', '[data-cce-focus-btn]'], ['footer-mute', '[data-cce-mute]']]) {
        if (footer[name.slice(7)] >= 0) await compareAt(name, conv.locator(sel).first());
      }
      const hovers = {};
      for (const [k, sel] of [['info', '[data-cce-info]'], ['focusOff', '[data-cce-focus-btn]'], ['mute', '[data-cce-mute]']]) {
        const l = await labelOf(conv, conv.locator(sel).first());
        hovers[k] = l.text;
        if (k === 'info' && l.png) base.compare('footer-info-label', l.png);
      }
      check(Object.entries(hovers).every(([k, v]) => v === LABELS[k]), 'resting on each of them shows what it does', hovers);
      await shot('conversation-footer-hover');

      /* Hovering the usage meter, exactly one box is visible at a time: the panel's own tooltip, and after two seconds the
         breakdown in its place. */
      const meter = conv.locator('button[class*="usageButtonV2"]').first();
      if (await meter.count()) {
        const boxesNow = () => conv.evaluate(() => [...document.querySelectorAll('[data-footer-overlay], #cce-ctx')]
          .filter((e) => { const st = getComputedStyle(e), r = e.getBoundingClientRect(); return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0 && r.width > 0; })
          .map((e) => `${e.id || 'panel tooltip'}: ${String(e.textContent).slice(0, 80)}`));
        await meter.hover();
        await sleep(500);
        const soon = await boxesNow();
        await shot('conversation-meter-hover');
        await sleep(2600);
        const later = await boxesNow();
        await shot('conversation-meter-hover-later');
        check(soon.length === 1 && soon[0].indexOf('panel tooltip') === 0 && later.length === 1,
          'hovering the usage meter shows only the panel\'s tooltip at first, and one box after two seconds', { soon, later });
        const inside = await conv.evaluate(() => ['cce-ctx'].map((id) => document.getElementById(id))
          .filter((e) => e && e.style.display === 'block').map((e) => { const r = e.getBoundingClientRect(); return { id: e.id, left: r.left, right: r.right, page: innerWidth }; }));
        check(inside.every((b) => b.left >= 0 && b.right <= b.page), 'and that box lies inside the page', inside);
        await page.mouse.move(5, 5);
        await sleep(300);
      } else note('no usage meter in this conversation\'s footer, so its hover was not looked at');

      await conv.locator('[data-cce-info]').first().click();
      const info = await until(() => conv.evaluate(() => {
        const b = document.getElementById('cce-info');
        return b && b.style.display === 'block' && Object.fromEntries([...b.children].map((r) => [r.children[0].textContent, r.children[1].textContent]));
      }), 5000, 200);
      /* Windows paths are compared without case: VS Code hands the folder over with its drive letter in lower case. */
      const samePath = (a, b) => (process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);
      check(!!info && info.Session === tab0.id && samePath(info.Project, profile.folder)
        && samePath(info.Transcripts, `~/.claude/projects/${folderName(profile.folder)}`) && /^\d/.test(info['On disk'] || ''),
      'the information button opens the conversation\'s session id, folder, transcripts and their size', info);
      const fits = await conv.evaluate(() => { const r = document.getElementById('cce-info').getBoundingClientRect(); return { left: r.left, right: r.right, page: innerWidth }; });
      check(fits.left >= 0 && fits.right <= fits.page, 'and the box lies inside the page', fits);
      await page.mouse.move(5, 5);
      await shot('conversation-info');
      if (info) await compareAt('info-session-row', conv.locator('#cce-info > div').first());
      await conv.locator('[data-cce-info]').first().click();
      check(!!await until(() => conv.evaluate(() => { const b = document.getElementById('cce-info'); return !b || b.style.display === 'none'; }), 3000, 200),
        'and a second click closes it');

      const mute = conv.locator('[data-cce-mute]').first();
      await mute.click();
      const muted = await until(() => mute.evaluate((e, want) => e.getAttribute('aria-label') === want && e.style.textDecoration === 'line-through'
        && { label: e.getAttribute('aria-label'), style: e.style.cssText }, LABELS.muted), 5000, 200);
      check(!!muted, 'the chime button mutes the chimes and is drawn struck through', muted || await mute.evaluate((e) => [e.getAttribute('aria-label'), e.style.cssText]));
      await page.mouse.move(5, 5);
      await sleep(300);
      if (muted) await compareAt('footer-mute-off', mute);
      await mute.click();
      check(!!await until(() => mute.evaluate((e, want) => e.getAttribute('aria-label') === want, LABELS.mute), 5000, 200), 'and a second click brings them back');

      const focus = conv.locator('[data-cce-focus-btn]').first();
      await focus.click();
      const folded = await until(() => focus.evaluate((e, want) => e.getAttribute('data-cce-fold') === 'folded' && e.getAttribute('aria-label') === want, LABELS.focusOn), 5000, 200);
      check(!!folded, 'the Focus view button turns Claude Code\'s Focus view on', await focus.evaluate((e) => [e.getAttribute('data-cce-fold'), e.getAttribute('aria-label')]));
      await shot('conversation-focus-view');
      await focus.click();
      check(!!await until(() => focus.evaluate((e) => e.getAttribute('data-cce-fold') === 'open'), 5000, 200), 'and off again');

      /* Turned off and on: the times go, Claude Code's own come back, and the other way round, without a reload. */
      const theirTimes = () => conv.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.children.length
        && /^\d{1,2}:\d\d\s?(AM|PM)$/i.test((e.textContent || '').trim()) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length);
      const edgesNow = () => conv.evaluate(() => [...document.querySelectorAll('[class*="userMessage_"]')].map((e) => getComputedStyle(e).borderLeftWidth));
      check(await theirTimes() === 0, 'while it is on, Claude Code\'s own message times are hidden', await theirTimes());
      await exec('claudeCodePlus.disable');
      const gone = await until(async () => (await stampsIn(conv)).all === 0, 15000, 500);
      check(gone, 'turned off, the times leave the page without a reload', await stampsIn(conv));
      const own = await until(async () => { const n = await theirTimes(); return n >= tab0.turns.length * 2 && n; }, 10000, 500);
      check(!!own, 'and Claude Code\'s own message times show again', await theirTimes());
      const plain = await until(async () => { const x = await edgesNow(); return x.every((v) => v !== '3px') && x; }, 10000, 500);
      check(!!plain, 'and your messages lose the bar down their edge', await edgesNow());
      await shot('conversation-turned-off');
      await exec('claudeCodePlus.enable');
      const back = await until(async () => { const x = await stampsIn(conv); return x.user.every(Boolean) && x.reply.every(Boolean) && x; }, 15000, 500);
      check(!!back && await until(async () => await theirTimes() === 0, 10000, 500), 'turned back on, they are back, and Claude Code\'s are hidden again', await stampsIn(conv));
    });

    /* Agent Plus has a message typed into a conversation, as its Answer view and a steward's messages are, while the
       user types in another conversation's panel beside it. The panel says it is ready and types only on the host's
       go, and the user's focus and keys stay in the other panel. */
    await step('a message typed for someone else', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t1 = threads[1];
      const SEL = '[role="textbox"][aria-label="Message input"]';
      const inputOf = (f) => f.evaluate((sel) => { const b = document.querySelector(sel); return b ? b.textContent : null; }, SEL).catch(() => null);
      const groupOf = async (t) => { const g = (await tabs()).find((x) => x.tabs.some((y) => y.active && titled(y.label.replace(ENVELOPE, ''), t.title))); return g ? g.column : 0; };
      await exec('claude-vscode.editor.open', t1.id);
      if (!await conversation(t1, 60000)) throw new Error('the second conversation did not open');
      await exec('workbench.action.moveEditorToRightGroup');
      await exec('claude-vscode.editor.open', tab0.id);
      const apart = await until(async () => { const a = await groupOf(tab0), b = await groupOf(t1); return a && b && a !== b && [a, b]; }, 15000, 500);
      if (!apart) throw new Error(`the two conversations are not side by side: ${JSON.stringify(await tabs())}`);
      conv = await conversation(tab0, 30000) || conv;
      const side = await conversation(t1, 30000);
      if (!side) throw new Error('the second conversation\'s page was not found');
      try {
        await side.locator(SEL).first().click();
        await page.keyboard.type('my own words ');
        await call(`const prev = globalThis.__cceAnswerHook, seen = globalThis.__cceTestAnswers = [];
          globalThis.__cceAnswerHook = (key, sent, reason, detail) => { if (key !== 'cce-answers-ready') seen.push([sent, reason]); return prev(key, sent, reason, detail); };
          globalThis.__cceTestAnswersBack = () => { globalThis.__cceAnswerHook = prev; };
          return true;`);
        const text = 'Look at the retry delay once more.\nThen stop.';
        let got = null, seen = null;
        try {
          got = await call(`return await vscode.extensions.getExtension('xnervwang.agent-plus').exports.agentPlus.deliver({ sourceId: 'claude-code', sessionId: arg.id, text: arg.text });`,
            { id: tab0.id, text }, 60000);
        } finally {
          seen = await call('const s = globalThis.__cceTestAnswers || []; if (globalThis.__cceTestAnswersBack) globalThis.__cceTestAnswersBack(); return s;');
        }
        const arrived = await until(() => {
          try { return fs.readFileSync(transcriptOf(tab0), 'utf8').split(JSON.stringify(text).slice(1, -1)).length - 1; } catch (_) { return 0; }
        }, 30000, 500);
        check(!!got && got.outcome === 'submitted' && JSON.stringify(seen) === JSON.stringify([[false, 'ready'], [true, '']]) && arrived >= 1,
          'a message for a conversation is sent from its panel only after the panel said it was ready and the host said go; it arrives with its line break', { got, seen, arrived });
        check(await inputOf(conv) === '' && await inputOf(side) === 'my own words ', 'its input is empty again, and what the user was typing in the panel beside it is untouched',
          { here: await inputOf(conv), beside: await inputOf(side) });
        await page.keyboard.type('and more');
        const kept = await until(async () => (await inputOf(side)) === 'my own words and more', 5000, 200);
        check(!!kept && await inputOf(conv) === '', 'and the user\'s next keys still go to the panel they were typing in, not to the one the message went to',
          { here: await inputOf(conv), beside: await inputOf(side) });
        await shot('typed-for-someone-else');
      } finally {
        await side.locator(SEL).first().click().catch(() => {});
        await page.keyboard.press('Control+a').catch(() => {});
        await page.keyboard.press('Delete').catch(() => {});
        await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)} && x.label.startsWith(arg));
          if (t) await vscode.window.tabGroups.close(t); return true;`, t1.title.slice(0, 12));
        await exec('claude-vscode.editor.open', tab0.id);
        conv = await conversation(tab0, 30000) || conv;
      }
    });

    await step('the dots on a tab', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const idle = await dotsOn(t.label);
      check(!!idle && idle.running === 0 && idle.waiting === 0 && idle.blue === 0 && !t.label.endsWith(ENVELOPE), 'an idle conversation\'s tab has no dot and no envelope', idle);
      check(await needCount() === null && !(await noticeOf(tab0)), 'and Agent Plus counts nothing in the status bar and shows no notice of it', { count: await needCount(), notices: await needNotices() });
      check(await focusWindow(), 'the window has the focus, which Agent Plus needs before it shows a notice', { focused: await focused() });
      const timeline = attentionTimeline(tab0.id);
      model.hold();
      const turns = model.turns();
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type('Run the tests again.');
      await page.keyboard.press('Enter');
      check(!!await until(() => model.turns() > turns, 30000, 300), 'a message sent from the tab reaches the fake model', model.seen.slice(-3));
      const running = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && d.waiting === 0 && d; }, 20000, 500);
      check(!!running, 'while the turn runs the tab\'s logo carries the green dot', await dotsOn(t.label));
      check(!!running && filled(running.shape) && running.blue === 0, 'a filled dot, green in the middle too, with no blue in it', running);
      const listRunning = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
      check(!!listRunning && listRunning.blue === 0, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      const rowRunning = [await listDotState(tab0), await listDotState(tab0, true)];
      check(rowRunning.every((s) => s && s.state === 'running' && !s.ring && s.background === GREEN),
        'both its rows in the session list draw a filled dot, not a ring, in the tabs\' green', rowRunning);
      await shot('tab-dot-running');
      const green = await tabLogo(t.label);
      if (running && green) base.compare('tab-dot-running', green.png);
      /* Agent Plus tells of a reply left unread only in a conversation it has seen working. */
      const working = await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'working' && a; }, SEEN_MS, 300);
      check(!!working, 'Agent Plus sees the conversation working, in the folder its windows share', attentionOf(tab0.id));
      /* The tab's group is locked by Claude Code, so the file is opened into that group by name. */
      await openNotes(t.column);
      const hidden = await until(async () => { const x = (await claudeTabs()).find((y) => y.label === t.label); return x && !x.active; }, 5000, 200);
      check(!!hidden, 'another editor in the same group puts the tab in the background', await tabs());
      await sleep(800);
      model.release();
      const unread = await until(async () => {
        const x = (await claudeTabs()).find((y) => titled(y.label.replace(ENVELOPE, ''), tab0.title)), d = x && await dotsOn(x.label);
        return x && x.label.endsWith(ENVELOPE) && d && d.running === 0 && d.waiting === 0 && { label: x.label, dots: d };
      }, 30000, 500);
      check(!!unread, 'once the reply lands with the tab in the background, the dot goes and the tab\'s title ends in an envelope', await claudeTabs());
      /* Agent Plus marks the reply unread once it has seen the turn end. The window with the focus shows the
         conversation, behind another editor, so Agent Plus shows no notice of it there; an Agent Plus without
         'waitingFor' does. The toast moves to the notification list after a while, so the list is read when no toast is found. */
      const seenUnread = await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'stopped' && a.unseen && a; }, SEEN_MS, 300);
      if (apWaits) {
        const none = seenUnread ? await noticesWithin(tab0, 'finished') : null;
        check(!!seenUnread && !none.length, 'Agent Plus sees the reply left unread in a tab hidden behind another editor, in the window with the focus, and shows no notice of it there',
          { agentPlus: timeline(), notices: none });
      } else {
        const told = await until(() => noticeOf(tab0), 30000, 250) || (await listedNotices()).find(about(tab0));
        check(!!told && told.text === `"${tab0.title}" finished.` && ['Open', 'Dismiss'].every((b) => told.buttons.includes(b)),
          'Agent Plus shows a notice that the conversation finished, with Open and Dismiss', told || { toasts: await needNotices(), listed: await listedNotices(), agentPlus: timeline() });
      }
      timeline();
      check(!!seenUnread && (await needCount()) === null, 'and leaves it out of the status bar count',
        { agentPlus: seenUnread || attentionOf(tab0.id), count: await needCount() });
      await shot('tab-dot-unread-notice');
      const listUnread = await until(async () => {
        const d = await listDot(tab0), env = await list.locator(`[data-cce-open-sessions] [class*="sessionItem_"][id$="${tab0.id}"] [data-cce-envelope]`).count();
        return d && d.running === 0 && env === 1 && d;
      }, 10000, 500);
      check(!!listUnread, 'and its row in OPEN SESSIONS has an envelope and no dot', await listDot(tab0));
      /* In the list below OPEN SESSIONS too: after the name and before the time, and whole while a side bar too narrow for
         the name cuts the name short. */
      const parts = await until(async () => { const p = await rowParts(tab0); return envelopeBetween(p) && p; }, 10000, 500);
      check(!!parts && parts.form === `"${ENVELOPE.trim()}"`, 'its row in the list below has one envelope, in its colour form, after the name and before the time',
        parts || await rowParts(tab0));
      const wide = await win.sideWidth(page);
      await win.sideTo(page, 230);
      const cut = await until(async () => { const p = await rowParts(tab0); return p && p.cut && envelopeBetween(p) && p; }, 10000, 500);
      check(!!cut, 'in a side bar too narrow for the name, the name is cut short and the envelope stays whole after it, before the time',
        { parts: cut || await rowParts(tab0), side: await win.sideWidth(page) });
      await shot('tab-dot-unread-narrow');
      if (wide) await win.sideTo(page, wide);
      await page.mouse.move(5, 880);
      await shot('tab-dot-unread');
      await page.locator('.tabs-container .tab').filter({ hasText: t.label.slice(0, 16) }).first().click();
      await page.bringToFront().catch(() => {});
      const read = await until(async () => { const d = await dotsOn(t.label); return d && d.running === 0 && !(await claudeTabs()).some((y) => y.label.endsWith(ENVELOPE)) && d; }, 20000, 500);
      check(!!read, 'and bringing the tab to the front clears it', { dots: await dotsOn(t.label), windowFocused: await call('return vscode.window.state.focused;') });
      check(!!await until(() => !(attentionOf(tab0.id) || {}).unseen, 20000, 300), 'and Agent Plus no longer marks its reply unread', attentionOf(tab0.id));
      /* A notice is never taken back; these would otherwise lie over the panel's buttons. */
      await exec('notifications.clearAll');
      const after = await stampsIn(conv);
      const latest = after.reply[after.reply.length - 1] || '';
      check(new RegExp(`^${STAMP} {2}\\d+s${SEP}ctx${NB}[1-9]\\d*%${SEP}cost${NB}\\$\\d+\\.\\d{3}${SEP}sonnet-5-5(${NB}\\w+)?$`).test(latest),
        'the new reply carries its time, how long it took, the context share, the estimated cost and the model', latest);
      await shot('tab-dot-read');

      /* A tool call, so Claude Code waits for permission. */
      const before = model.seen.length;
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type(`Please ${ASK_TO_RUN}.`);
      await page.keyboard.press('Enter');
      check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), 'a message asking to run the tests gets a Bash tool call from the fake model', model.seen.slice(before));
      const asking = await until(() => conv.evaluate((cmd) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(cmd), RUN), 20000, 500);
      check(!!asking, `Claude Code asks for permission to run ${RUN}`);
      /* The tool call's stamp is on its block, a line above Claude Code's header, which keeps its description whole. */
      const toolRow = await until(() => conv.evaluate(() => {
        const head = [...document.querySelectorAll('[class*="toolSummary_"]')].pop();
        const block = head && head.closest('[data-testid="assistant-message"] > *');
        const desc = head && head.querySelector('[class*="toolNameTextSecondary"]');
        if (!block || !desc || !block.hasAttribute('data-cce-ts')) return null;
        return { stamp: block.getAttribute('data-cce-ts'), inHeader: !!head.querySelector('[data-cce-ts]'),
          below: Math.round(head.getBoundingClientRect().top - block.getBoundingClientRect().top), descLines: desc.getClientRects().length };
      }), 10000, 500);
      check(!!toolRow && !toolRow.inHeader && toolRow.below >= 8 && toolRow.descLines === 1,
        'the tool call\'s stamp has a line of its own above Claude Code\'s header, whose description stays on one line', toolRow);
      const waiting = await until(async () => { const d = await dotsOn(t.label); return d && d.waiting >= 6 && d.running === 0 && d; }, 20000, 500);
      check(!!waiting, 'and while it waits the tab\'s logo carries the red dot', await dotsOn(t.label));
      check(!!waiting && waiting.blue === 0, 'and nothing blue, the colour of Claude Code\'s own dot for this', waiting);
      const listWaiting = await until(async () => { const d = await listDot(tab0); return d && d.waiting >= 4 && d; }, 10000, 500);
      check(!!listWaiting && listWaiting.blue === 0, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      /* The conversation in front of the window that has the focus is the one the user is looking at, so Agent Plus
         neither tells of it nor counts it. Checked only after Agent Plus has written that it sees the conversation
         waiting in front. */
      const inSight = await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'waiting' && a.front && a; }, 20000, 300);
      const quiet = inSight ? await noticesWithin(tab0) : null;
      check(!!inSight && !quiet.length && (await needCount()) === null,
        'Agent Plus sees it waiting in the front tab of the window with the focus, so it shows no notice of it and counts nothing',
        { agentPlus: attentionOf(tab0.id), notices: quiet, count: await needCount() });
      await shot('tab-dot-waiting');
      const red = await tabLogo(t.label);
      if (waiting && red) base.compare('tab-dot-red', red.png);
      const no = conv.locator('button, [role="button"]').filter({ hasText: /^\s*3\s*No\s*$/ }).first();
      await no.click({ timeout: 5000 });
      const answered = await until(() => conv.evaluate(() => !/Allow this bash command\?/.test(document.body.innerText)), 15000, 500);
      const cleared = await until(async () => { const d = await dotsOn(t.label); return d && d.waiting === 0 && d.running === 0 && d; }, 30000, 500);
      check(answered && !!cleared, 'answering No closes the question and the dot goes', { answered, dots: await dotsOn(t.label) });
      await shot('tab-permission-answered');
    });

    /* A command the conversation put in the background keeps its dot green after the turn is over: found in /proc on
       Linux, and on macOS and Windows from what Claude Code's Stop hook tells the work plan plugin. */
    /* The agent map's layout on every platform, for a conversation that has had no background work yet: first with
       nothing else in it, then with the conversation's row at the top under its own heading and, after it, a section
       for each kind of work, with a thin line above it and a heading that gives a label and a count: here a helper, a
       command in the background and a scheduled prompt. Claude Code's own two headings are found by their words and
       given the same look; its rows stay, each opening its details on a click. */
    await step('the agent map\'s sections', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const sessions = path.join(profile.home, '.claude', 'sessions');
      const status = () => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === tab0.id && d.kind !== 'bg') return d.status || null; } catch (_) { /* being written */ }
        }
        return null;
      };
      const dialogs = () => conv.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getClientRects().length).map((d) => {
        const h = d.querySelector('h3');
        return h ? h.textContent.trim() : '';
      }));
      const box = () => conv.locator('[contenteditable][role="textbox"]').first();
      /* With nothing running, /tasks opens the map: the conversation's heading and row only. */
      await box().click();
      await page.keyboard.type('/tasks');
      /* The box leaves Enter to the command menu as soon as the menu counts as open, but the menu only starts listening
         for keys in an effect after it has drawn. An Enter pressed in between reaches neither and becomes a new line.
         The menu makes the box point at its /tasks row once it has drawn, so wait for that. */
      const picked = () => conv.evaluate(() => {
        const b = document.querySelector('[contenteditable][role="textbox"]');
        const id = b && b.getAttribute('aria-activedescendant');
        const row = id && document.getElementById(id);
        return !!row && /\btasks\b/i.test(row.textContent || '');
      }).catch(() => false);
      await until(picked, 5000, 100);
      await page.keyboard.press('Enter');
      const alone = await until(async () => { const l = await mapLook(); return l && l.main && l && l; }, 10000, 500);
      /* `states`: the first states of the component that draws the message box, in the order it declares them. Its key
         handler leaves Enter alone, so that the box takes it as a new line, while one of its menus or command views is
         open; the state of whichever was open is true or non-empty here. */
      const noMap = async () => ({ box: await conv.evaluate(() => {
        const b = document.querySelector('[contenteditable][role="textbox"]');
        let states = null;
        const key = b && Object.keys(b).find((k) => k.indexOf('__reactFiber$') === 0);
        for (let f = key ? b[key] : null; f && !states; f = f.return) {
          if (typeof f.type !== 'function') continue;
          const out = [];
          for (let h = f.memoizedState; h && out.length < 80; h = h.next) {
            const v = h.memoizedState;
            out.push(v === null || ['boolean', 'number', 'string', 'undefined'].includes(typeof v) ? (typeof v === 'string' ? v.slice(0, 20) : v === undefined ? 'u' : v)
              : Array.isArray(v) ? 'array' : typeof v === 'function' ? 'fn' : 'obj');
          }
          if (out.length >= 40) states = out;
        }
        return { text: b ? b.innerText : null, states, open: [...document.querySelectorAll('[role="listbox"], [role="menu"], [role="dialog"]')]
          .filter((d) => d.getClientRects().length).map((d) => String(d.getAttribute('aria-label') || d.className).slice(0, 40)) };
      }).catch((e) => String(e).slice(0, 80)), window: await paints(page.mainFrame()), panel: await paints(conv), status: status() });
      check(!!alone && alone.heads.length === 1 && alone.heads[0].me && alone.heads[0].label === 'This conversation' && alone.heads[0].top < alone.main.top
        && alone.hiddenZero && !alone.cards.length,
        'with no background work the map shows the conversation\'s row under THIS CONVERSATION and nothing else: Claude Code\'s "0 agents" is hidden, no empty section is drawn', alone || await noMap());
      await shot('agent-map-alone');
      await page.keyboard.press('Escape');
      await until(async () => !(await mapLook()), 5000, 200);

      const dir = path.join(profile.folder, '.claude'), file = path.join(dir, 'scheduled_tasks.json');
      fs.mkdirSync(dir, { recursive: true });
      const prompt = 'Check whether the nightly build has finished.';
      fs.writeFileSync(file, JSON.stringify({ tasks: [{ id: 'cafe5678', cron: '*/20 * * * *', prompt, createdAt: Date.now(), recurring: true,
        createdBySessionId: tab0.id, createdInProject: profile.folder }] }, null, 2));
      const ask = async (text, shown) => {
        const before = model.seen.length;
        await box().click();
        await page.keyboard.type(`Please ${text}.`);
        await page.keyboard.press('Enter');
        check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), `the fake model answers "${text}" with a tool call`, model.seen.slice(before));
        if (shown) {
          const asking = await until(() => conv.evaluate((c) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(c), shown), 8000, 500);
          if (asking) await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
        }
        return before;
      };
      await ask(ASK_TO_BACKGROUND_LONG, BG_LONG_RUN);
      check(!!await until(() => status() === 'idle', 60000, 500), 'the turn that put the command in the background ends', { status: status() });
      model.holdHelper();
      try {
        const before = await ask(ASK_FOR_HELPER, '');
        check(!!await until(() => model.seen.slice(before).some((x) => x.helping), 30000, 300), 'Claude Code starts the helper, whose turns the fake model holds back', model.seen.slice(before).length);
        const counted = await until(async () => { const f = await footer(); return f && /\b1 agent\b/.test(f.label) && /\b1 task\b/.test(f.label) && /\b1 timer\b/.test(f.label) && f; }, 60000, 500);
        check(!!counted, 'the agents button counts the helper, the command and the scheduled prompt', await footer());
        await conv.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
        const look = await until(async () => { const l = await mapLook(); return l && l.heads.length >= 4 && l.rows.some((r) => r.text.includes('Look through the notes')) && l; }, 15000, 500);
        await shot('agent-map-sections');
        const labels = look ? look.heads.map((x) => [x.label, x.count, x.theirs]) : null;
        check(!!look && JSON.stringify(labels) === JSON.stringify([['This conversation', null, false], ['Subagents', '1', true], ['Background tasks', '1', true],
          ['Scheduled prompts', '1', false]]),
          'the map\'s headings, from the top: THIS CONVERSATION, then Claude Code\'s SUBAGENTS 1 and BACKGROUND TASKS 1, then SCHEDULED PROMPTS 1', labels);
        const rest = look ? look.heads.filter((x) => !x.me) : [];
        const bodySize = look && look.cards.length ? look.cards[0].size : 0;
        check(rest.length === 3 && rest.every((x) => x.upper && x.weight >= 600 && x.size > 0 && x.size < bodySize && x.border >= 1),
          'every section heading is in capitals, bold and smaller than a card\'s title, with a thin line above it', { rest, bodySize });
        const sub = look && look.heads.find((x) => x.label === 'Subagents'), tasks = look && look.heads.find((x) => x.label === 'Background tasks');
        check(!!sub && !!tasks && sub.hint === 'Click an agent for details.' && tasks.hint === 'Click a task for details.' && rest.every((x) => !!x.hint),
          'the "click ... for details" of Claude Code\'s headings is their hover text, and every heading has one', rest.map((x) => [x.label, x.hint.slice(0, 60)]));
        check(!!look && !!look.main && look.heads[0].top < look.main.top && rest.every((x) => x.top > look.main.top + look.main.height),
          'the conversation\'s own row comes first, under its heading, and every section after it', look && { main: look.main, heads: look.heads.map((x) => [x.label, x.top]) });
        const helperRow = look && look.rows.find((r) => r.text.includes('Look through the notes'));
        const taskRow = look && look.rows.find((r) => r.text.includes('Start the nightly build'));
        check(!!helperRow && !!taskRow && helperRow.top > sub.top && helperRow.top < tasks.top && taskRow.top > tasks.top && helperRow.left <= look.main.left + 1,
          'Claude Code\'s rows are all there, the helper\'s under SUBAGENTS in line with the conversation\'s row and the command\'s under BACKGROUND TASKS', look && look.rows);
        check(cardsInForm(look) && look.cards.length === 1 && look.cards[0].title === prompt && look.cards[0].dot === 'idle',
          'the scheduled prompt is a card in the form of Claude Code\'s: a dot, its title on one line and one line under it', look && look.cards);
        check(!!look && look.sideways !== null && look.sideways <= 0, 'nothing in the map runs past its right edge', look && look.sideways);
        /* Claude Code's own rows, for the helper, the conversation and the command, still open their details, and the
           command's Stop still ends it. */
        for (const [hasText, name] of [['Look through the notes', 'the helper\'s'], [tab0.title.slice(0, 20), 'the conversation\'s']]) {
          await conv.locator('[role="dialog"] button[class*="row_"]').filter({ hasText }).first().click({ timeout: 5000 });
          const opened = await until(async () => { const d = await dialogs(); return d.length >= 2 && d; }, 5000, 200);
          check(!!opened && opened.some((x) => x.includes(hasText.slice(0, 16))), `clicking ${name} row opens Claude Code's dialog for it`, opened || await dialogs());
          await page.keyboard.press('Escape');
          check(!!await until(async () => (await dialogs()).length === 1, 5000, 200), 'and Escape takes it back to the map', await dialogs());
        }
        await conv.locator('[role="dialog"] button[class*="row_"]').filter({ hasText: 'Start the nightly build' }).first().click({ timeout: 5000 });
        const stop = conv.locator('[role="dialog"] button').filter({ hasText: /^Stop$/ }).first();
        check(!!await until(() => stop.isVisible().catch(() => false), 5000, 200), 'clicking the command\'s row opens its dialog, with a Stop button', await dialogs());
        await stop.click({ timeout: 5000 }).catch(() => {});
        const stopped = await until(async () => { const f = await footer(); return f && !/\btasks?\b/.test(f.label) && f; }, 30000, 500);
        check(!!stopped, 'and Stop ends the command: the agents button no longer counts it', await footer());
        for (let i = 0; i < 3 && (await dialogs()).length; i++) { await page.keyboard.press('Escape'); await sleep(300); }
      } finally { model.releaseHelper(); fs.rmSync(file, { force: true }); }
      const cleared = await until(async () => {
        const f = await footer(), d = await dotsOn(t.label);
        return status() === 'idle' && d && d.running === 0 && (!f || !/\b[1-9]\d* (agent|task|timer)s?\b/.test(f.label)) && { f, d };
      }, 120000, 1000);
      check(!!cleared, 'once the helper has finished and the conversation has answered, nothing is counted any more', { footer: await footer(), dots: await dotsOn(t.label), status: status() });
    });

    await step('work left running after a turn', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const sessions = path.join(profile.home, '.claude', 'sessions');
      const status = () => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === tab0.id) return d.status || null; } catch (_) { /* being written */ }
        }
        return null;
      };
      const tasks = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', `${tab0.id}.tasks`);
      const seen = () => ({ dots: null, status: status(), tasksFile: fs.existsSync(tasks) });
      const before = model.seen.length;
      /* The tab goes behind another editor before the turn ends. With work left running Claude Code does not mark the
         reply unread, and this extension does (src/activity.js, marksUnread). */
      model.hold();
      let hidden = false;
      try {
        await conv.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(`Please ${ASK_TO_BACKGROUND}.`);
        await page.keyboard.press('Enter');
        check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), `the fake model answers with ${BG_RUN} put in the background`, model.seen.slice(before));
        await openNotes(t.column);
        hidden = !!await until(async () => { const x = (await claudeTabs()).find((y) => y.label === t.label); return x && !x.active; }, 5000, 200);
      } finally { model.release(); }
      /* Claude Code runs a command it takes for read-only, such as sleep, without asking. */
      const asking = await until(() => conv.evaluate((cmd) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(cmd), BG_RUN), 8000, 500);
      if (asking) {
        note('Claude Code asked before running the command, so the tab came to the front to answer it, and the envelope after a turn that ended out of sight was not checked');
        await page.locator('.tabs-container .tab').filter({ hasText: t.label.slice(0, 16) }).first().click();
        await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
        hidden = false;
      }
      const started = Date.now();
      const ended = await until(() => status() === 'idle' && Date.now() - started > 2000, 60000, 500);
      check(!!ended, 'the turn that started the command ends while the command runs', seen());
      /* The windows look for work running every ten seconds. */
      const green = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && status() === 'idle' && d; }, 25000, 500);
      check(!!green, 'with the turn over and the command still running, the tab\'s logo carries a green ring', Object.assign(seen(), { dots: await dotsOn(t.label) }));
      check(!!green && ringed(green.shape) && green.blue === 0, 'hollow in the middle, not a filled dot', green);
      const listGreen = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
      check(!!listGreen, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      const rowRing = await until(async () => { const s = [await listDotState(tab0), await listDotState(tab0, true)]; return s.every((x) => x && x.state === 'running' && x.ring) && s; }, 10000, 500);
      check(!!rowRing && rowRing.every((x) => x.border === GREEN && x.background !== GREEN), 'both its rows in the session list draw it as a ring in the tabs\' green',
        rowRing || [await listDotState(tab0), await listDotState(tab0, true)]);
      if (hidden) {
        const both = await until(async () => (await claudeTabs()).find((y) => y.label.endsWith(ENVELOPE) && titled(y.label.replace(ENVELOPE, ''), tab0.title)), 15000, 500);
        check(!!both, 'after the turn ended out of sight with work still running, the tab\'s title ends in an envelope beside the ring', await claudeTabs());
        const listBoth = await until(async () => (await list.locator(`[data-cce-open-sessions] [class*="sessionItem_"][id$="${tab0.id}"] [data-cce-envelope]`).count()) === 1, 10000, 500);
        check(!!listBoth && envelopeBetween(await rowParts(tab0)), 'and both its rows in the session list have the envelope, after the name and before the time', await rowParts(tab0));
        /* While its background work runs, the conversation has not finished, so Agent Plus shows no notice for it yet.
           */
        const working = await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'background' && a; }, 20000, 300);
        const early = working ? await noticesWithin(tab0, 'finished') : null;
        check(!!working && !early.length, 'Agent Plus sees it running background work, so it shows no notice of it yet', { agentPlus: attentionOf(tab0.id), notices: early });
        await shot('tab-dot-background-unread');
        await page.locator('.tabs-container .tab').filter({ hasText: t.label.slice(0, 16) }).first().click();
        const read = await until(async () => { const d = await dotsOn(t.label); return !(await claudeTabs()).some((y) => y.label.endsWith(ENVELOPE)) && d && ringed(d.shape) && d; }, 20000, 500);
        check(!!read, 'brought to the front, the tab loses the envelope and keeps the ring', { tabs: await claudeTabs(), dots: await dotsOn(t.label) });
      }
      const ring = await tabLogo(t.label);
      if (ring && ringed(ring.count.shape)) base.compare('tab-dot-ring', ring.png);
      /* The footer's agents button and the agent map it opens. */
      const pill = await until(async () => { const f = await footer(); return f && f.dot === 'running' && /\b1 task\b/.test(f.label) && f; }, 20000, 500);
      check(!!pill && pill.colour === GREEN, 'the agents button counts the command as 1 task, its dot the tabs\' green', await footer());
      await shot('tab-dot-background-work');
      if (pill) {
        const map = await inMap((m) => m.own && m.own.ring && m);
        check(!!map.got && map.got.own.state === 'running' && map.got.own.border === GREEN, 'and the agent map\'s own row has the green ring', map.last && map.last.own);
      }
      /* The command ends 40 s after it started, Claude Code tells the conversation, and its answer ends that turn too. */
      const cleared = await until(async () => {
        const d = await dotsOn(t.label);
        return Date.now() - started > 45000 && status() === 'idle' && d && d.running === 0 && d.waiting === 0 && d;
      }, 120000, 1000);
      check(!!cleared, 'once the command has ended and the conversation has answered its notice, the dot goes', Object.assign(seen(), { dots: await dotsOn(t.label) }));
      const greyFrom = Date.now();
      const grey = await until(async () => { const f = await footer(); return (!f || (f.dot !== 'running' && f.colour !== GREEN && !/\btasks?\b/.test(f.label))) && { f }; }, 30000, 1000);
      check(!!grey, 'and the agents button counts no task, its dot not green', { drawn: await footer(), now: await footerNow(), after: Date.now() - greyFrom });
      if (grey && grey.f) {
        const map = await inMap((m) => m.own && m);
        check(!!map.got && !map.got.own.ring && map.got.own.state !== 'running' && map.got.own.background !== GREEN, 'and the map\'s own row is grey, no ring', map.last && map.last.own);
      }
      await shot('tab-dot-background-done');
    });

    /* A helper started in the background keeps the dot green after the conversation has sent its reply. Claude Code
       2.1.326 keeps the session busy while the helper runs, and its Stop hook tells the plugin about the helper too. */
    await step('a helper left running after a turn', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const sessions = path.join(profile.home, '.claude', 'sessions');
      const status = () => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === tab0.id) return d.status || null; } catch (_) { /* being written */ }
        }
        return null;
      };
      const tasks = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', `${tab0.id}.tasks`);
      const seen = () => ({ status: status(), tasksFile: fs.existsSync(tasks) ? fs.readFileSync(tasks, 'utf8').slice(0, 400) : null });
      const turns = () => model.seen.slice(before).filter((x) => x.stream).map((x) => ({ helping: x.helping, tool: x.tool, parts: x.parts, result: x.result }));
      model.holdHelper();
      const before = model.seen.length;
      try {
        await conv.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(`Please ${ASK_FOR_HELPER}.`);
        await page.keyboard.press('Enter');
        check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), 'the fake model answers with a helper started in the background', model.seen.slice(before));
        const helping = await until(() => model.seen.slice(before).some((x) => x.helping), 30000, 300);
        check(!!helping, 'Claude Code starts the helper, whose turns the fake model holds back', turns());
        /* The conversation is told the helper was launched and answers that with text, which ends what it had to say. */
        const replied = await until(() => model.seen.slice(before).some((x) => !x.helping && !x.tool && /Async agent launched/.test(x.result || '')), 30000, 300);
        check(!!replied, 'Claude Code runs the helper in the background, and the conversation sends its reply while the helper runs', turns());
        await sleep(5000);
        const green = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && d; }, 25000, 500);
        check(!!green, 'with the reply sent and the helper still running, the tab\'s logo carries a green ring', Object.assign(seen(), { dots: await dotsOn(t.label) }));
        check(!!green && ringed(green.shape), 'hollow in the middle, not a filled dot', green);
        const listGreen = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
        check(!!listGreen, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
        const pill = await until(async () => { const f = await footer(); return f && f.dot === 'running' && /\b1 agent\b/.test(f.label) && f; }, 20000, 500);
        check(!!pill && pill.colour === GREEN, 'the agents button counts the helper as 1 agent, and its dot is the tabs\' green', await footer());
        if (pill) {
          const map = await inMap((m) => m.own && m.own.ring && m);
          check(!!map.got && map.got.own.state === 'running' && map.got.own.border === GREEN, 'and the agent map\'s own row has the green ring', map.last && map.last.own);
        }
        await shot('tab-dot-background-helper');
      } finally { model.releaseHelper(); }
      /* Released, the helper finishes, Claude Code tells the conversation, and its answer ends that turn too. */
      const cleared = await until(async () => {
        const d = await dotsOn(t.label);
        return status() === 'idle' && d && d.running === 0 && d.waiting === 0 && d;
      }, 90000, 1000);
      check(!!cleared, 'once the helper has finished and the conversation has answered its notice, the dot goes', Object.assign(seen(), { dots: await dotsOn(t.label) }));
      const greyFrom = Date.now();
      const grey = await until(async () => { const f = await footer(); return (!f || (f.dot !== 'running' && f.colour !== GREEN)) && { f }; }, 30000, 1000);
      check(!!grey, 'and the agents button\'s dot is no longer green', { drawn: await footer(), now: await footerNow(), after: Date.now() - greyFrom });
    });

    /* A program started with setsid leads a session of its own, outside Claude Code's account of its background work.
       It is found through /proc, so on Linux only: the dot stays green while it runs, the agent map lists it, and once
       it is gone the conversation is told. */
    await step('a command left running detached', async () => {
      if (process.platform !== 'linux') { note('a detached command is found through /proc, so this runs on Linux only'); return; }
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const sessions = path.join(profile.home, '.claude', 'sessions');
      const status = () => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === tab0.id) return d.status || null; } catch (_) { /* being written */ }
        }
        return null;
      };
      const before = model.seen.length;
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type(`Please ${ASK_TO_DETACH}.`);
      await page.keyboard.press('Enter');
      check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), 'the fake model answers with a command left running with setsid', model.seen.slice(before));
      const asking = await until(() => conv.evaluate(() => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes('setsid')), 8000, 500);
      if (asking) await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
      const ended = await until(() => status() === 'idle', 60000, 500);
      check(!!ended, 'the turn that started it ends while it runs', { status: status() });
      const green = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && status() === 'idle' && d; }, 25000, 500);
      check(!!green, 'with the turn over and the detached command running, the tab\'s logo carries a green ring', { status: status(), dots: await dotsOn(t.label) });
      check(!!green && ringed(green.shape), 'hollow in the middle, not a filled dot', green);
      const listGreen = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
      check(!!listGreen, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      const button = conv.locator('button, [role="button"]').filter({ hasText: /\b1 detached\b/ }).first();
      const labelled = await until(() => button.isVisible().catch(() => false), 20000, 500);
      check(!!labelled, 'the Agents button counts it as 1 detached', await conv.evaluate(() => document.body.innerText.slice(-400)));
      const pill = await until(async () => { const f = await footer(); return f && f.dot === 'running' && f; }, 10000, 500);
      check(!!pill && pill.colour === GREEN && /\b1 detached\b/.test(pill.label), 'and its dot is the tabs\' green', await footer());
      if (labelled) {
        await button.click({ timeout: 5000 });
        const listed = await until(async () => {
          const sec = mapSection(await mapLook(), 'Detached commands');
          return sec && sec.head.count === '1' && sec.cards.length === 1 && sec.cards[0].title === 'sleep 45' && /^pid \d+ · started \d\d:\d\d · /.test(sec.cards[0].meta) && sec;
        }, 10000, 500);
        check(!!listed && cardsInForm({ cards: listed.cards }) && listed.cards[0].dot === 'running' && listed.cards[0].hint === `sleep 45\n${listed.cards[0].meta}`,
          'the agent map lists the command under DETACHED COMMANDS 1, a card titled by its program with its pid, start and running time, and the whole command line on hover',
          listed || await mapLook());
        await shot('agent-map-detached');
        await page.keyboard.press('Escape');
      }
      const told = await until(() => model.seen.slice(before).some((x) => /left running detached is no longer running/.test(x.ask || '')), 150000, 1000);
      check(!!told, 'once it is gone, the conversation is told, which starts a turn', model.seen.slice(before).map((x) => (x.ask || '').slice(0, 120)));
      const cleared = await until(async () => {
        const d = await dotsOn(t.label);
        return status() === 'idle' && d && d.running === 0 && d.waiting === 0 && d;
      }, 60000, 1000);
      check(!!cleared, 'and once that turn is answered, the dot goes', { status: status(), dots: await dotsOn(t.label) });
    });

    /* A `claude -p` worker started through a shell that stays behind as its parent, as a `( setsid nohup ... claude -p
       ... & )` launch leaves one, and a command put in the background beside it. The worker is a script named claude
       that writes a session record of the CLI's shape (WORKER_SCRIPT in lib/fake-model.js), so its session id is printed
       nowhere. It is found through /proc, so on Linux only. */
    await step('a claude -p worker and a command in the background', async () => {
      if (process.platform !== 'linux') { note('a worker is found through /proc, so this runs on Linux only'); return; }
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const sessions = path.join(profile.home, '.claude', 'sessions');
      const status = () => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === tab0.id) return d.status || null; } catch (_) { /* being written */ }
        }
        return null;
      };
      const WORKER = 'c0ffee00-1111-4222-8333-444444444444', SECONDS = 100;
      const bin = path.join(profile.home, 'fake-bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'claude'), WORKER_SCRIPT(WORKER, SECONDS), { mode: 0o755 });
      const ask = async (text, shown) => {
        const before = model.seen.length;
        await conv.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(`Please ${text}.`);
        await page.keyboard.press('Enter');
        check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), `the fake model answers "${text}" with a Bash call`, model.seen.slice(before));
        const asking = await until(() => conv.evaluate((c) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(c), shown), 8000, 500);
        if (asking) await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
        await sleep(2000);
        check(!!await until(() => status() === 'idle', 60000, 500), `the turn that ran "${text}" ends while its command runs`, { status: status() });
        return before;
      };
      const started = Date.now();
      const from = await ask(ASK_FOR_WORKER, 'fake-bin');
      await ask(ASK_TO_BACKGROUND, BG_RUN);
      const backgrounded = Date.now();
      const green = await until(async () => { const f = await footer(); return f && f.dot === 'running' && /\b1 task\b/.test(f.label) && /\b1 worker\b/.test(f.label) && f; }, 40000, 500);
      check(!!green && green.colour === GREEN && !/detached/.test(green.label),
        'with the turn over, the agents button counts the command and the worker once each, not the worker\'s shell, and its dot is the tabs\' green', await footer());
      const ring = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && d; }, 25000, 500);
      check(!!ring && ringed(ring.shape), 'and the tab\'s logo carries the green ring, hollow in the middle', await dotsOn(t.label));
      await shot('agents-button-work-running');
      if (green) {
        await conv.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
        const listed = await until(async () => { const m = await mapState(), look = await mapLook(), sec = mapSection(look, 'claude -p sessions');
          return sec && sec.cards.some((c) => c.title === WORKER_NAME) && { m, look, sec }; }, 10000, 500);
        const card = listed && listed.sec.cards.find((c) => c.title === WORKER_NAME);
        check(!!card && listed.sec.head.count === '1' && card.dot === 'running' && /^pid \d+ · started /.test(card.meta) && card.hint === `claude -p session ${WORKER} · running\n${card.meta}`
          && cardsInForm({ cards: listed.sec.cards }) && !mapSection(listed.look, 'Detached commands'),
          'the agent map lists the worker by name under claude -p SESSIONS 1, with its pid and start time and its session id and state on hover, and does not list the shell it runs in',
          listed ? listed.sec : await mapLook());
        const own = listed && listed.m.own;
        check(!!own && own.state === 'running' && own.ring && own.border === GREEN, 'the map\'s own row has a green ring', own);
        await shot('agent-map-work-running');
        await page.keyboard.press('Escape');
        await sleep(500);
      }
      /* The command ends after 40 s and the worker after SECONDS; each end starts a turn that is answered at once. */
      const told = await until(() => model.seen.slice(from).some((x) => /left running detached is no longer running/.test(x.ask || '')),
        Math.max(started + SECONDS * 1000, backgrounded + 40000) - Date.now() + 90000, 1000);
      check(!!told, 'once the worker has finished, the conversation is told its shell has stopped', model.seen.slice(from).map((x) => (x.ask || '').slice(0, 120)));
      const grey = await until(async () => {
        const f = await footer(), d = await dotsOn(t.label);
        return status() === 'idle' && d && d.running === 0 && (!f || (f.dot !== 'running' && !/\b(task|worker)s?\b/.test(f.label))) && { f, d };
      }, 90000, 1000);
      check(!!grey, 'once both have ended and the conversation has answered, the button counts neither and its dot is not green, and the tab\'s dot is gone',
        { footer: await footer(), dots: await dotsOn(t.label), status: status() });
      const f = await footer();
      if (!f) { note('the agents button is gone with nothing left to count, so there is no grey dot to look at'); return; }
      check(f.colour !== GREEN, 'the button\'s dot is grey', f);
      await shot('agents-button-work-ended');
      await conv.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
      const m = await until(async () => { const x = await mapState(); return x.own && x; }, 10000, 500);
      check(!!m && m.own.state === 'idle' && !m.own.ring && !mapSection(await mapLook(), 'claude -p sessions'), 'and the map\'s own row is grey, with no worker listed', m && m.own);
      await shot('agent-map-work-ended');
      await page.keyboard.press('Escape');
    });

    /* The live session records under ~/.claude/sessions whose processes run, as `claude agents` lists them. */
    const liveRecords = () => {
      const dir = path.join(profile.home, '.claude', 'sessions');
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return []; }
      return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { return null; } })
        .filter((d) => d && Number.isInteger(d.pid) && (() => { try { process.kill(d.pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } })());
    };
    /* The status of the conversation's own Claude Code process (not a `claude -p` or `claude --bg` one), or null. */
    const sessionStatus = (id) => {
      const r = liveRecords().find((d) => d.sessionId === id && d.kind !== 'bg' && !/^sdk-/.test(d.entrypoint || ''));
      return r ? r.status || null : null;
    };
    /* Claude Code's own command line in this run's extensions, and the environment that sends its turns to the fake model. */
    const claudeCli = () => {
      const dir = fs.readdirSync(profile.exts).find((n) => n.startsWith('anthropic.claude-code-'));
      return dir ? path.join(profile.exts, dir, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude') : '';
    };
    const modelEnv = () => Object.assign({}, env, { ANTHROPIC_BASE_URL: model.url, ANTHROPIC_API_KEY: fakeHome.KEY,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' });

    /* A `claude --bg` session the conversation starts, through the stand-in of lib/fake-model.js (BG_SESSION_SCRIPT):
       a session record of kind "bg" and the job's state under ~/.claude/jobs. Nothing here reads /proc, so it runs on every
       platform. */
    await step('a claude --bg session', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const SECONDS = 60;
      const bin = path.join(profile.home, 'fake-bg');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'claude'), BG_SESSION_SCRIPT(SECONDS), { mode: 0o755 });
      const GREEN = `rgb(${DOTS.running.join(', ')})`;
      const pill = () => conv.evaluate(() => {
        const b = document.querySelector('button[data-agents-dot]');
        if (!b) return null;
        const dot = b.querySelector('[data-status-dot]');
        return { dot: b.getAttribute('data-agents-dot'), label: b.getAttribute('aria-label') || '', colour: dot ? getComputedStyle(dot).backgroundColor : '' };
      });
      const map = () => conv.evaluate(() => {
        const own = document.querySelector('[class*="rowMain_"] [data-status-dot]'), s = own && getComputedStyle(own);
        return { text: document.body.innerText.slice(-3000), own: own ? { state: own.getAttribute('data-status-dot'),
          ring: /statusDotElsewhere/.test(own.className), border: s.borderTopColor } : null };
      });
      const jobs = () => { try { return fs.readdirSync(path.join(profile.home, '.claude', 'jobs')); } catch (_) { return []; } };
      const before = model.seen.length, jobsBefore = jobs();
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type(`Please ${ASK_FOR_BG_SESSION}.`);
      await page.keyboard.press('Enter');
      check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), 'the fake model answers with a Bash call of claude --bg', model.seen.slice(before));
      const asking = await until(() => conv.evaluate(() => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes('--bg')), 8000, 500);
      if (asking) await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
      const started = Date.now();
      const job = await until(() => jobs().find((j) => !jobsBefore.includes(j)), 30000, 500);
      const ended = await until(() => sessionStatus(tab0.id) === 'idle' && model.seen.slice(before).some((x) => x.stream && !x.tool && (x.parts || []).includes('tool_result')), 60000, 500);
      check(!!job && !!ended, 'the turn that started the session ends while it runs', { job, status: sessionStatus(tab0.id), bg: liveRecords().filter((r) => r.kind === 'bg') });
      const running = await until(async () => { const f = await pill(); return f && f.dot === 'running' && /\b1 bg\b/.test(f.label) && f; }, 40000, 500);
      check(!!running && running.colour === GREEN, 'with the turn over, the agents button counts it as 1 bg, and its dot is the tabs\' green', await pill());
      const ring = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && d; }, 25000, 500);
      check(!!ring, 'and the tab\'s logo carries the green ring', await dotsOn(t.label));
      const listRing = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
      check(!!listRing, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      await shot('agents-button-bg-running');
      if (running) {
        await conv.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
        const listed = await until(async () => { const m = await map(), sec = mapSection(await mapLook(), 'claude --bg sessions');
          return sec && sec.head.count === '1' && sec.cards.some((c) => c.title === BG_SESSION_NAME) && { m, sec }; }, 10000, 500);
        const card = listed && listed.sec.cards[0];
        check(!!card && card.dot === 'running' && card.meta.startsWith('running') && card.meta.endsWith(job) && cardsInForm({ cards: listed.sec.cards })
          && !!listed.m.own && listed.m.own.state === 'running' && listed.m.own.ring && listed.m.own.border === GREEN,
          'the agent map lists the session under claude --bg SESSIONS 1, a card with a green dot saying running and its job id, and the map\'s own row has a green ring',
          listed ? { sec: listed.sec, own: listed.m.own } : await map());
        await shot('agent-map-bg-running');
        await page.keyboard.press('Escape');
        await sleep(500);
      }
      /* The session ends SECONDS after it started; the conversation is told through its inbox, which native Windows does
         not offer (src/stewards.js post()). */
      const notice = /notice, not a message from the user: news of a `claude --bg` session this conversation started/;
      if (process.platform !== 'win32') {
        const told = await until(() => model.seen.slice(before).some((x) => notice.test(x.ask || '')), started + SECONDS * 1000 - Date.now() + 90000, 1000);
        check(!!told, 'once it has finished, the conversation is told, which starts a turn', model.seen.slice(before).map((x) => (x.ask || '').slice(0, 160)));
      }
      const done = await until(async () => {
        const f = await pill(), d = await dotsOn(t.label);
        return Date.now() - started > SECONDS * 1000 && sessionStatus(tab0.id) === 'idle' && d && d.running === 0 && f && f.dot !== 'running' && /\b1 bg done\b/.test(f.label) && { f, d };
      }, started + SECONDS * 1000 - Date.now() + 120000, 1000);
      check(!!done && done.f.colour !== GREEN, 'once it has finished, the agents button says 1 bg done and its dot is grey, and the tab\'s dot is gone',
        { pill: await pill(), dots: await dotsOn(t.label), status: sessionStatus(tab0.id) });
      if (process.platform === 'win32') note(`on native Windows the conversation is not told that the session ended: ${model.seen.slice(before).some((x) => notice.test(x.ask || '')) ? 'it was told' : 'it was not told'}`);
      await shot('agents-button-bg-done');
      if (done) {
        await conv.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
        /* The result is in the session's folded row, which innerText leaves out. */
        const result = () => conv.evaluate(() => [...document.querySelectorAll('details pre')].some((p) => p.textContent.includes('The nightly report is written')));
        const over = await until(async () => { const m = await map(), sec = mapSection(await mapLook(), 'claude --bg sessions');
          return sec && sec.cards.length === 1 && sec.cards[0].dot === 'idle' && sec.cards[0].meta.startsWith('done') && await result() && { m, sec }; }, 10000, 500);
        check(!!over && !!over.m.own && over.m.own.state === 'idle' && !over.m.own.ring, 'the map keeps it as done, with a grey dot and its result, and the map\'s own row is grey',
          over ? { sec: over.sec, own: over.m.own } : await map());
        await shot('agent-map-bg-done');
        await page.keyboard.press('Escape');
        await sleep(500);
      }
      /* claudeCodePlus.show.backgroundSessions off leaves the session out of the button and the map. */
      const setShow = (v) => call(`await vscode.workspace.getConfiguration('claudeCodePlus').update('show.backgroundSessions', arg === null ? undefined : arg,
        vscode.ConfigurationTarget.Global); return true;`, v);
      await setShow(false);
      try {
        const gone = await until(async () => { const f = await pill(); return (!f || !/\bbg\b/.test(f.label)) && { f }; }, 20000, 500);
        check(!!gone, 'with claudeCodePlus.show.backgroundSessions off, the agents button no longer counts it', await pill());
      } finally { await setShow(null); }
      check(!!await until(async () => { const f = await pill(); return f && /\b1 bg done\b/.test(f.label); }, 20000, 500), 'and turned back on, it does again', await pill());
    });

    /* The same stand-in launched by a command the conversation put in the background, one that waits first, as a launch
       held back until something else has landed does. The call's result names only the file the command writes, `tail
       -3` leaves only the CLI's three hints in that file, and the session starts after that result is in the
       transcript, so no row of the transcript says which session it is. The sessions of the step before are put aside
       for this one, so that it counts its own alone, and put back after it, as that step left them; its own is put
       aside then. */
    await step('a claude --bg session launched by a background command', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const SECONDS = 90;
      const bin = path.join(profile.home, 'fake-bg');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'claude'), BG_SESSION_SCRIPT(SECONDS), { mode: 0o755 });
      const jobsDir = path.join(profile.home, '.claude', 'jobs'), aside = path.join(profile.home, 'jobs-aside');
      /* Claude Code keeps files of its own there too, such as pins.json. */
      const jobs = () => { try { return fs.readdirSync(jobsDir).filter((n) => /^[0-9a-f]{8}$/.test(n)); } catch (_) { return []; } };
      const transcript = transcriptOf(tab0);
      const read = (from = 0) => { try { return fs.readFileSync(transcript).subarray(from).toString('utf8'); } catch (_) { return ''; } };
      /* The output file a background command's result names, and when that result was written. */
      const resultIn = (text) => {
        for (const line of text.split('\n')) {
          if (!line.includes('Output is being written to')) continue;
          let row;
          try { row = JSON.parse(line); } catch (_) { continue; }
          for (const b of row && row.message && Array.isArray(row.message.content) ? row.message.content : []) {
            const body = b && b.type === 'tool_result'
              ? (typeof b.content === 'string' ? b.content : (b.content || []).map((c) => (c && c.text) || '').join('')) : '';
            const m = /Output is being written to: (\S+\.output)/.exec(body);
            if (m) return { file: m[1], at: Date.parse(row.timestamp) };
          }
        }
        return null;
      };
      const cliWords = (id) => [`backgrounded · ${id}`, `backgrounded \\u00b7 ${id}`, `claude attach ${id}`, `claude logs ${id}`, `claude stop ${id}`]
        .filter((w) => read().includes(w));
      const earlier = jobs();
      fs.mkdirSync(aside, { recursive: true });
      for (const j of earlier) fs.renameSync(path.join(jobsDir, j), path.join(aside, j));
      let job = null, created = NaN;
      try {
        const from = fs.existsSync(transcript) ? fs.statSync(transcript).size : 0, before = model.seen.length;
        await conv.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(`Please ${ASK_FOR_BG_OUTPUT}.`);
        await page.keyboard.press('Enter');
        check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), 'the fake model answers with a Bash call run in the background that launches claude --bg',
          model.seen.slice(before));
        const asking = await until(() => conv.evaluate(() => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes('tail -3')), 8000, 500);
        if (asking) await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
        const result = await until(() => resultIn(read(from)), 30000, 500);
        check(!!result && model.seen.slice(before).some((x) => /^Command running in background with ID: /.test(x.result || '')),
          'Claude Code runs it as a background command, and the call\'s result names the file the command writes', { result, results: model.seen.slice(before).map((x) => x.result) });
        job = await until(() => jobs()[0], 60000, 500) || null;
        if (job) { try { created = Date.parse(JSON.parse(fs.readFileSync(path.join(jobsDir, job, 'state.json'), 'utf8')).createdAt); } catch (_) { /* read below */ } }
        check(!!job && !!result && created - result.at > 5000,
          'the session starts more than 5 s after that result, past the leeway in which a session is tied to a call by the prompt in its command',
          { job, created: isFinite(created) ? new Date(created).toISOString() : null, result: result && isFinite(result.at) ? new Date(result.at).toISOString() : null });
        if (!job || !result) return;
        const hints = () => {
          let s;
          try { s = fs.readFileSync(result.file, 'utf8'); } catch (_) { return null; }
          return ['attach', 'logs', 'stop'].every((w) => s.includes(`claude ${w} ${job}`)) && !s.includes('backgrounded') ? s : null;
        };
        /* The command is over once tail has written the hints. Claude Code then tells the conversation, which answers. */
        const running = await until(async () => {
          const f = await footer();
          return !!hints() && sessionStatus(tab0.id) === 'idle' && f && f.dot === 'running' && /\b1 bg\b(?! done)/.test(f.label) && !/\btasks?\b/.test(f.label) && f;
        }, 90000, 500);
        check(!!running && running.colour === GREEN && !cliWords(job).length,
          'with the command over and its output file holding the CLI\'s hints alone, the agents button counts the session as 1 bg and no task, its dot the tabs\' green, while the transcript has none of the CLI\'s words for it',
          { footer: await footer(), file: result.file, output: hints(), status: sessionStatus(tab0.id), words: cliWords(job) });
        const ring = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && d; }, 25000, 500);
        check(!!ring && ringed(ring.shape), 'and the tab\'s logo carries the green ring, hollow in the middle', await dotsOn(t.label));
        const listRing = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
        check(!!listRing, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
        await shot('agents-button-bg-output-running');
        const button = conv.locator('button[data-agents-dot]').first();
        const opened = await button.isVisible().catch(() => false);
        if (opened) await button.click({ timeout: 5000 });
        const listed = opened && await until(async () => { const m = await mapState(), sec = mapSection(await mapLook(), 'claude --bg sessions');
          return sec && sec.head.count === '1' && sec.cards.length === 1 && sec.cards[0].title === BG_SESSION_NAME && { m, sec }; }, 10000, 500);
        const card = listed && listed.sec.cards[0];
        check(!!card && card.dot === 'running' && card.meta.startsWith('running') && card.meta.endsWith(job) && cardsInForm({ cards: listed.sec.cards })
          && !!listed.m.own && listed.m.own.state === 'running' && listed.m.own.ring && listed.m.own.border === GREEN,
          'the agent map lists the session under claude --bg SESSIONS 1, a card with a green dot saying running and its job id, and the map\'s own row has a green ring',
          listed ? { sec: listed.sec, own: listed.m.own } : { button: await footer(), map: opened ? await mapLook() : null });
        if (opened) {
          await shot('agent-map-bg-output-running');
          await page.keyboard.press('Escape');
          await sleep(500);
        }
        /* The conversation is told of the end through its inbox, which native Windows does not offer. */
        const notice = /notice, not a message from the user: news of a `claude --bg` session this conversation started/;
        if (process.platform !== 'win32') {
          const told = await until(() => model.seen.slice(before).some((x) => notice.test(x.ask || '')), created + SECONDS * 1000 - Date.now() + 90000, 1000);
          check(!!told, 'once it has finished, the conversation is told, which starts a turn', model.seen.slice(before).map((x) => (x.ask || '').slice(0, 160)));
        }
        const done = await until(async () => {
          const f = await footer(), d = await dotsOn(t.label);
          return Date.now() - created > SECONDS * 1000 && sessionStatus(tab0.id) === 'idle' && d && d.running === 0 && f && f.dot !== 'running' && /\b1 bg done\b/.test(f.label) && { f, d };
        }, created + SECONDS * 1000 - Date.now() + 120000, 1000);
        check(!!done && done.f.colour !== GREEN && !cliWords(job).length,
          'once it has ended, the ring goes and the agents button says 1 bg done, its dot grey, and the transcript still has none of the CLI\'s words for it',
          { footer: await footer(), dots: await dotsOn(t.label), status: sessionStatus(tab0.id), words: cliWords(job) });
        await shot('agents-button-bg-output-done');
      } finally {
        if (job) {
          await until(() => !liveRecords().some((r) => r.kind === 'bg' && r.jobId === job), Math.max(0, created + SECONDS * 1000 - Date.now()) + 30000, 1000);
          if (fs.existsSync(path.join(jobsDir, job))) fs.renameSync(path.join(jobsDir, job), path.join(aside, job));
        }
        for (const j of earlier) fs.renameSync(path.join(aside, j), path.join(jobsDir, j));
      }
      if (earlier.length) {
        const back = await until(async () => { const f = await footer(); return f && /\b1 bg done\b/.test(f.label) && f; }, 30000, 1000);
        check(!!back, 'with its own session put aside and those of the step before put back, the agents button says 1 bg done again, as that step left it', await footer());
      }
    });

    /* What makes a conversation wait for the user besides a permission prompt: a question its plan put to the user since
       the user last wrote, and a choice box. Each makes its dot red, and Agent Plus shows a notice for it and counts it
       in the status bar while the user is not looking at it, as its agentPlus.notifications settings allow. */
    await step('what needs you', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const tab = () => page.locator('.tabs-container .tab').filter({ hasText: t.label.slice(0, 16) }).first();
      const inFront = async () => !!(await claudeTabs()).find((x) => x.active && titled(x.label.replace(ENVELOPE, ''), tab0.title));
      const hide = async () => { await openNotes(t.column); return until(async () => !(await inFront()), 5000, 200); };
      const show = async () => { await tab().click(); return until(inFront, 10000, 200); };
      const plan = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', `${tab0.id}.json`);
      const had = fs.existsSync(plan) ? fs.readFileSync(plan, 'utf8') : null;
      /* Writes a plan row that waits on the user with a question asked now, or marks that row done. */
      const question = (open) => {
        const now = new Date().toISOString();
        fs.mkdirSync(path.dirname(plan), { recursive: true });
        fs.writeFileSync(plan, JSON.stringify({ nodes: [{ title: 'Pick the config to change', state: open ? 'waiting' : 'done', waitingOn: 'user',
          question: 'Staging or production?', asked: now, opened: now, since: now }] }, null, 2));
      };
      const setNotify = (k, v) => call(`await vscode.workspace.getConfiguration('agentPlus').update(arg[0], arg[1] === null ? undefined : arg[1],
        vscode.ConfigurationTarget.Global); return true;`, [`notifications.${k}`, v]);
      const red = () => until(async () => { const d = await dotsOn(t.label); return d && d.waiting >= 6 && d.running === 0 && d; }, 30000, 500);
      const clear = () => until(async () => { const d = await dotsOn(t.label); return d && d.waiting === 0 && d.running === 0 && d; }, 30000, 500);
      const uncounted = () => until(async () => (await needCount()) === null, 15000, 300);
      /* Agent Plus's Conversations entry in the status bar, which counts the plans' questions whatever the notices do. */
      const toDecide = () => page.evaluate(() => {
        const e = [...document.querySelectorAll('.statusbar-item')].find((x) => /agentPlus\.conversations$/.test(x.id));
        return e && e.offsetParent ? e.innerText.trim() : null;
      });
      try {
        check(await focusWindow(), 'the window has the focus, which Agent Plus needs before it shows a notice', { focused: await focused() });
        await exec('notifications.clearAll');

        /* A question in the plan while the tab is in the background. */
        check(await hide(), 'another editor in the same group puts the tab in the background', await tabs());
        question(true);
        const asked = await red();
        check(!!asked && asked.blue === 0,
          'a question the plan put to the user after the user\'s last message makes the tab\'s dot red', asked || await dotsOn(t.label));
        const rows = await until(async () => { const s = [await listDotState(tab0), await listDotState(tab0, true)]; return s.every((x) => x && x.state === 'waiting') && s; }, 15000, 500);
        check(!!rows, 'and both its rows in the session list', rows || [await listDotState(tab0), await listDotState(tab0, true)]);
        /* The window with the focus shows the conversation behind another editor: Agent Plus counts it and, from an Agent
           Plus with 'waitingFor', shows no notice of it there. */
        const told = apWaits ? null : await until(() => noticeOf(tab0), 30000, 250) || (await listedNotices()).find(about(tab0));
        if (!apWaits) {
          check(!!told && told.text === `"${tab0.title}" is waiting for you.` && ['Open', 'Dismiss'].every((b) => told.buttons.includes(b)),
            'Agent Plus shows a notice that the conversation is waiting for you, with Open and Dismiss', told || { toasts: await needNotices(), listed: await listedNotices() });
        }
        const counted = await until(async () => { const c = await needCount(); return c && c.n === 1 && c; }, apWaits ? 30000 : 10000, 300);
        check(!!counted, 'and counts it in the status bar as 1', counted || await needCount());
        if (apWaits) {
          const none = counted ? await noticesWithin(tab0) : null;
          check(!!counted && !none.length, 'and, since the tab is in the window with the focus, shows no notice of it', { notices: none });
        }
        await shot('needs-you-question');
        /* Open on the notice, which brings the conversation forward. */
        if (apWaits) await show();
        else if (told && await noticeOf(tab0)) {
          await pressNotice(tab0, 'Open');
          check(!!await until(inFront, 15000, 300), 'Open on the notice brings the conversation\'s tab to the front', await tabs());
        } else {
          note('the notice had left the screen for the notification list before Open could be pressed, so the tab was brought forward by a click');
          await show();
        }
        check(!!await uncounted(), 'and with the conversation in front, Agent Plus stops counting it', await needCount());
        check(!!(await dotsOn(t.label) || {}).waiting, 'while the dot stays red, the question being still open', await dotsOn(t.label));
        question(false);
        check(!!await clear(), 'once the question is answered in the plan, the dot goes', await dotsOn(t.label));
        await exec('notifications.clearAll');

        /* A question the plan asks while the turn still runs reaches the user in the reply at the end of that turn, so
           the conversation is not waiting for the user until the turn ends: no notice, no count, and the dot stays
           green. Checked once Agent Plus's Conversations entry counts the question, which shows that Agent Plus has
           read it. */
        model.hold();
        const turnsAsk = model.turns();
        const timeline = attentionTimeline(tab0.id);
        try {
          try {
            await conv.locator('[contenteditable][role="textbox"]').first().click();
            await page.keyboard.type('One more turn, please.');
            await page.keyboard.press('Enter');
            await until(() => model.turns() > turnsAsk, 30000, 300);
            const working = await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'working' && a; }, SEEN_MS, 300);
            await hide();
            await exec('notifications.clearAll');
            question(true);
            const read = await until(async () => { const s = await toDecide(); return s && /\b1 to decide\b|\b1 conversation needs you\b/.test(s) && s; }, 30000, 500);
            const quiet = read ? await noticesWithin(tab0) : null;
            const midTurn = { working: !!working, conversations: read || await toDecide(), notices: quiet, count: await needCount(),
              dot: await dotsOn(t.label), agentPlus: attentionOf(tab0.id) };
            check(!!working && !!read && !quiet.length && midTurn.count === null && !!midTurn.dot && midTurn.dot.waiting === 0 && midTurn.dot.running >= 6,
              'a question the plan puts after the user\'s last message while the turn still runs gives no notice and no count, and the tab\'s dot stays green',
              midTurn);
          } finally { model.release(); }
          const ended = await red();
          check(!!ended, 'once the turn ends, the tab\'s dot turns red', ended || await dotsOn(t.label));
          const waitingText = `"${tab0.title}" is waiting for you.`;
          if (apWaits) {
            const countedAfter = await until(async () => { const c = await needCount(); return c && c.n === 1 && c; }, 30000, 300);
            const none = countedAfter ? await noticesWithin(tab0) : null;
            check(!!countedAfter && !none.length, 'and Agent Plus then counts it as 1, with no notice in the window that shows it',
              { count: countedAfter || await needCount(), notices: none, agentPlus: timeline() });
          } else {
            const toldAfter = await until(async () => (await needNotices()).find((n) => n.text === waitingText), 30000, 250)
              || (await listedNotices()).find((n) => n.text === waitingText);
            const countedAfter = await until(async () => { const c = await needCount(); return c && c.n === 1 && c; }, 10000, 300);
            check(!!toldAfter && !!countedAfter, 'and Agent Plus then says the conversation is waiting for you and counts it as 1',
              { notice: toldAfter || { toasts: await needNotices(), listed: await listedNotices() }, count: countedAfter || await needCount(), agentPlus: timeline() });
          }
        } finally { timeline(); }
        await show();
        question(false);
        await clear();
        await uncounted();
        await exec('notifications.clearAll');

        /* With agentPlus.notifications.waiting off: counted, and no notice. */
        await setNotify('waiting', false);
        await hide();
        question(true);
        await red();
        const countedOnly = await until(async () => { const c = await needCount(); return c && c.n === 1 && c; }, 20000, 300);
        const unsaid = countedOnly ? await noticesWithin(tab0) : null;
        check(!!countedOnly && !unsaid.length, 'with agentPlus.notifications.waiting off, Agent Plus still counts it, and shows no notice',
          { count: countedOnly || await needCount(), notices: unsaid });
        question(false);
        await clear();
        await uncounted();
        await setNotify('waiting', null);

        /* With agentPlus.notifications.enabled off: neither a notice nor a count, checked once the Conversations entry
           counts the question, as above. */
        await setNotify('enabled', false);
        question(true);
        await red();
        const decide = await until(async () => { const s = await toDecide(); return s && /\b1 to decide\b|\b1 conversation needs you\b/.test(s) && s; }, 30000, 500);
        const silent = decide ? await noticesWithin(tab0) : null;
        check(!!decide && !silent.length && (await needCount()) === null, 'with agentPlus.notifications.enabled off, Agent Plus, which counts the question in its Conversations entry, shows no notice and no count',
          { conversations: decide || await toDecide(), notices: silent, count: await needCount() });
        question(false);
        await clear();
        await setNotify('enabled', null);
        await show();

        /* With agentPlus.notifications.finished off, a reply that lands unread gets no notice, and no count either. */
        await setNotify('finished', false);
        model.hold();
        const turns = model.turns();
        try {
          await conv.locator('[contenteditable][role="textbox"]').first().click();
          await page.keyboard.type('Once more, please.');
          await page.keyboard.press('Enter');
          await until(() => model.turns() > turns, 30000, 300);
          await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'working'; }, SEEN_MS, 300);
          await hide();
        } finally { model.release(); }
        const unread = await until(async () => (await claudeTabs()).find((y) => y.label.endsWith(ENVELOPE) && titled(y.label.replace(ENVELOPE, ''), tab0.title)), 30000, 500);
        const seenUnread = unread ? await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'stopped' && a.unseen && a; }, SEEN_MS, 300) : null;
        const notFinished = seenUnread ? await noticesWithin(tab0, 'finished') : null;
        check(!!seenUnread && !notFinished.length && (await needCount()) === null,
          'with agentPlus.notifications.finished off, Agent Plus shows no notice when a reply lands unread, and the status bar does not count it',
          { tab: unread, agentPlus: seenUnread || attentionOf(tab0.id), count: await needCount(), notices: notFinished });
        await show();
        check(!!await until(() => !(attentionOf(tab0.id) || {}).unseen, 20000, 300), 'and once the tab is in front, Agent Plus clears the reply\'s unread mark', attentionOf(tab0.id));
        await setNotify('finished', null);

        /* A choice box with the tab in front of the focused window: the dot turns red, and Agent Plus shows nothing. */
        const before = model.seen.length;
        await conv.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(`Please ${ASK_FOR_CHOICE}.`);
        await page.keyboard.press('Enter');
        check(!!await until(() => model.seen.slice(before).some((x) => x.choice), 30000, 300), 'a message asking to be asked gets an AskUserQuestion call from the fake model',
          model.seen.slice(before));
        /* The box Claude Code draws in place of the message box: the question, its options and a row to send the answers. */
        const box = () => conv.evaluate((c) => {
          const label = [...document.querySelectorAll('div, span, label')].find((e) => e.offsetParent && e.textContent.trim() === c.options[0]);
          let b = label;
          while (b && !(b.innerText.includes(c.question) && /\bSubmit\b/.test(b.innerText))) b = b.parentElement;
          return b ? b.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
        }, CHOICE);
        const shown = await until(box, 20000, 500);
        check(!!shown && CHOICE.options.every((o) => shown.includes(o)), 'Claude Code shows the choice box with its question and both options', shown);
        const chooses = await red();
        check(!!chooses && chooses.blue === 0, 'and while it waits for the choice the tab\'s dot is red', chooses || await dotsOn(t.label));
        const rowsChoose = await until(async () => { const s = [await listDotState(tab0), await listDotState(tab0, true)]; return s.every((x) => x && x.state === 'waiting') && s; }, 15000, 500);
        check(!!rowsChoose, 'and so are both its rows in the session list', rowsChoose || [await listDotState(tab0), await listDotState(tab0, true)]);
        const inSight = await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'waiting' && a.front && a; }, 20000, 300);
        const none = inSight ? await noticesWithin(tab0) : null;
        check(!!inSight && !none.length && (await needCount()) === null, 'Agent Plus sees it waiting in the front tab of the window with the focus, so it shows no notice and counts nothing',
          { agentPlus: attentionOf(tab0.id), notices: none, count: await needCount() });
        await shot('needs-you-choice');
        if (shown) {
          const sent = model.seen.length;
          /* A notice at the bottom right can lie over the box. */
          await exec('notifications.clearAll');
          await conv.getByText(CHOICE.options[0], { exact: true }).last().click({ timeout: 5000 });
          /* The row that sends the answers reads "1 Submit answers", its key first. */
          if (!await until(async () => !(await box()), 2000, 300)) await conv.getByText(/Submit answers\s*$/).last().click({ timeout: 5000 });
          const answered = await until(() => model.seen.slice(sent).some((x) => x.stream && (x.parts || []).includes('tool_result')), 20000, 300);
          check(!!answered && !await box(), 'picking an option closes the box and sends the choice back', { box: await box(), sent: model.seen.slice(sent).map((x) => x.result) });
          check(!!await clear(), 'and the dot goes', await dotsOn(t.label));
        }
      } finally {
        model.release();
        /* A choice box left open would hold every later step's message back. */
        const open = () => conv.evaluate((q) => document.body.innerText.includes(q) && /Esc to cancel/.test(document.body.innerText), CHOICE.question).catch(() => false);
        if (await open()) {
          await conv.locator('[contenteditable], button').first().focus().catch(() => {});
          await page.keyboard.press('Escape');
          await until(async () => !(await open()), 10000, 300);
        }
        for (const k of ['waiting', 'enabled', 'finished']) await setNotify(k, null).catch(() => {});
        if (had !== null) fs.writeFileSync(plan, had); else fs.rmSync(plan, { force: true });
        await exec('notifications.clearAll');
        await show();
      }
    });

    /* A question the plan puts to the user during a turn, after the message that started it, and how the turn ends:
       with nothing more from the user the conversation waits for them; with the answer given on a question card later
       in the turn, or typed while the turn runs and taken into it, it does not. Each turn ends with the tab behind
       another editor, where Agent Plus counts a conversation that waits. */
    await step('a question answered in its turn', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label.replace(ENVELOPE, ''), tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const tab = () => page.locator('.tabs-container .tab').filter({ hasText: t.label.slice(0, 16) }).first();
      const inFront = async () => !!(await claudeTabs()).find((x) => x.active && titled(x.label.replace(ENVELOPE, ''), tab0.title));
      const hide = async () => { await openNotes(t.column); return until(async () => !(await inFront()), 5000, 200); };
      const show = async () => { await tab().click(); return until(inFront, 10000, 200); };
      const plan = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', `${tab0.id}.json`);
      const had = fs.existsSync(plan) ? fs.readFileSync(plan, 'utf8') : null;
      const question = (open) => {
        const now = new Date().toISOString();
        fs.mkdirSync(path.dirname(plan), { recursive: true });
        fs.writeFileSync(plan, JSON.stringify({ nodes: [{ title: 'Pick the config to change', state: open ? 'waiting' : 'done', waitingOn: 'user',
          question: 'Staging or production?', asked: now, opened: now, since: now }] }, null, 2));
      };
      const sessions = path.join(profile.home, '.claude', 'sessions');
      /* The conversation's status in its session record: 'busy' while a turn runs, 'idle' once it has ended. */
      const status = () => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === tab0.id) return d.status || null; } catch (_) { /* being written */ }
        }
        return null;
      };
      const send = async (text) => {
        await conv.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
      };
      const rows = async () => [await listDotState(tab0), await listDotState(tab0, true)];
      const redDot = (d) => !!d && d.waiting >= 6 && d.running === 0;
      /* The question card on screen. A card answered earlier leaves its question and options in the transcript, so a
         match that takes in one of the user's messages is the transcript, not the card. */
      const choiceBox = () => conv.evaluate((c) => {
        for (const label of [...document.querySelectorAll('div, span, label')].filter((e) => e.offsetParent && e.textContent.trim() === c.options[0])) {
          let b = label;
          while (b && !b.querySelector('[class*="userMessage_"]') && !(b.innerText.includes(c.question) && /\bSubmit\b/.test(b.innerText))) b = b.parentElement;
          if (b && !b.querySelector('[class*="userMessage_"]')) return b.innerText.replace(/\s+/g, ' ').trim().slice(0, 300);
        }
        return null;
      }, CHOICE).catch(() => null);
      /* A turn started with `text`, its reply held back by the fake model, and the plan's question put once the model has
         the turn, so after the message that started it. Returns how many requests the model had been sent before. */
      const begin = async (text) => {
        const from = model.seen.length, turns = model.turns();
        model.hold();
        await send(text);
        if (!await until(() => model.turns() > turns, 30000, 300)) throw new Error(`the fake model was not sent "${text}"`);
        question(true);
        return from;
      };
      /* The rest of the turn let go with the tab behind another editor, until the turn ends. Should Claude Code ask before
         running `command`, the tab comes forward to allow it and goes behind again. */
      const finish = async (command) => {
        const running = await until(() => status() === 'busy', 10000, 300);
        const hidden = await hide();
        model.release();
        let asked = false;
        const over = await until(async () => {
          if (status() === 'idle') return true;
          if (command && !asked && await conv.evaluate((cmd) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(cmd), command).catch(() => false)) {
            asked = true;
            note(`Claude Code asked before running ${command}, so the tab came to the front to allow it and went behind again`);
            await show();
            await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
            await hide();
          }
          return false;
        }, 60000, 500);
        return { running: !!running, hidden: !!hidden, over: !!over, asked, status: status() };
      };
      /* After a turn that ended out of sight: the envelope, which says the window has taken the end in, then `ms` of the
         tab's dot and both rows watched for red. The host works the dots out again every 10 s (extension.js). */
      const watchRed = async (ms = 20000) => {
        const envelope = !!await until(async () => (await claudeTabs()).find((y) => y.label.endsWith(ENVELOPE) && titled(y.label.replace(ENVELOPE, ''), tab0.title)), 30000, 500);
        const reds = [], t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const d = await dotsOn(t.label), r = await rows();
          if (redDot(d) || r.some((x) => x && x.state === 'waiting')) reds.push({ after: Date.now() - t0, dot: d, rows: r });
          await sleep(500);
        }
        return { envelope, reds: reds.slice(0, 5), redCount: reds.length, last: { dot: await dotsOn(t.label), rows: await rows() } };
      };
      /* The tab in front with its reply read, the question done, and nothing counted, as the step found it. */
      const reset = async () => {
        model.release();
        await show();
        question(false);
        await until(async () => { const d = await dotsOn(t.label); return d && d.waiting === 0 && d.running === 0; }, 30000, 500);
        await until(async () => (await needCount()) === null, 15000, 300);
        await exec('notifications.clearAll');
      };
      try {
        check(await focusWindow(), 'the window has the focus, which Agent Plus needs before it counts a conversation', { focused: await focused() });
        await exec('notifications.clearAll');

        /* Not answered: the turn ends with nothing more from the user. */
        await begin('One more turn, please.');
        const plain = await finish();
        const red1 = await until(async () => { const d = await dotsOn(t.label); return redDot(d) && d; }, 30000, 500);
        check(plain.running && plain.hidden && plain.over && !!red1,
          'a question the plan put during a turn, after the message that started it, makes the tab\'s dot red once the turn ends with nothing more from the user',
          { turn: plain, dot: red1 || await dotsOn(t.label) });
        const rows1 = await until(async () => { const s = await rows(); return s.every((x) => x && x.state === 'waiting') && s; }, 15000, 500);
        check(!!rows1, 'and both its rows in the session list', rows1 || await rows());
        const counted1 = await until(async () => { const c = await needCount(), a = attentionOf(tab0.id); return c && c.n === 1 && a && a.activity === 'waiting' && { c, a }; }, SEEN_MS, 300);
        check(!!counted1, 'and Agent Plus counts it as waiting for the user', counted1 || { count: await needCount(), agentPlus: attentionFiles() });
        await shot('question-not-answered');
        await reset();

        /* Answered on a question card: the model asks it later in the same turn and the user picks an option. */
        const fromCard = await begin(`Please ${ASK_FOR_CHOICE}.`);
        model.release();
        const card = await until(choiceBox, 30000, 500);
        check(!!card && CHOICE.options.every((o) => card.includes(o)), 'later in the turn the model asks on a question card', card || model.seen.slice(fromCard));
        if (!card) throw new Error('no question card');
        model.hold();
        const sent = model.seen.length;
        await exec('notifications.clearAll');
        await conv.getByText(CHOICE.options[0], { exact: true }).last().click({ timeout: 5000 });
        /* The row that sends the answers reads "1 Submit answers", its key first. */
        if (!await until(async () => !(await choiceBox()), 2000, 300)) await conv.getByText(/Submit answers\s*$/).last().click({ timeout: 5000 });
        const back = await until(() => model.seen.slice(sent).some((x) => x.stream && (x.parts || []).includes('tool_result')), 20000, 300);
        check(!!back && !await choiceBox(), 'the user answers the card, and the answer goes back to the model in the same turn', model.seen.slice(sent).map((x) => x.parts));
        /* Once Agent Plus has the turn running again, a wait it notes is one after the answer. */
        const working = await until(() => { const a = attentionOf(tab0.id); return a && a.activity === 'working' && a; }, SEEN_MS, 300);
        const timeline = attentionTimeline(tab0.id);
        try {
          const cardTurn = await finish();
          const calm = await watchRed();
          check(cardTurn.running && cardTurn.hidden && cardTurn.over && calm.envelope && !calm.redCount,
            'a question the plan put during a turn and answered on a question card later in it leaves no red dot on the tab or its session list rows once the turn ends',
            { turn: cardTurn, ...calm });
          const end = await until(() => { const a = attentionOf(tab0.id); return a && a.activity && a.activity !== 'working' && a; }, SEEN_MS, 300);
          if (end) await sleep(noticeDelay.waiting + 3000);
          const states = timeline();
          check(!!working && !!end && !states.some(([, a]) => a && a.activity === 'waiting'),
            'and Agent Plus, once it has seen the turn end, does not count the conversation as waiting', { working: !!working, end, states, count: await needCount() });
        } finally { timeline(); }
        await shot('question-answered-on-card');
        await reset();

        /* Answered by typing: the user types the answer while the turn runs, and Claude Code takes it into the turn after
           the result of the command the model runs. */
        const fromTyped = await begin(`Please ${ASK_TO_PAUSE}.`);
        const answer = 'Staging, please.';
        await send(answer);
        const typedTurn = await finish(PAUSE_RUN);
        const asks = model.seen.slice(fromTyped).filter((x) => x.stream);
        const taken = asks.find((x) => (x.parts || []).includes('tool_result') && `${x.ask}\n${x.typed}`.includes(answer));
        check(!!taken, 'the answer typed while the turn ran goes to the model with the command\'s result, in the same turn',
          asks.map((x) => ({ parts: x.parts, ask: x.ask.slice(-160), typed: x.typed.slice(-80) })));
        const calm3 = await watchRed();
        check(typedTurn.running && typedTurn.hidden && typedTurn.over && calm3.envelope && !calm3.redCount,
          'a question the plan put during a turn and answered by a message typed while the turn ran leaves no red dot on the tab or its session list rows once the turn ends',
          { turn: typedTurn, ...calm3 });
        await shot('question-answered-by-typing');
        await reset();
      } finally {
        model.release();
        /* A choice box left open would hold every later step's message back. */
        const open = () => conv.evaluate((q) => document.body.innerText.includes(q) && /Esc to cancel/.test(document.body.innerText), CHOICE.question).catch(() => false);
        if (await open()) {
          await conv.locator('[contenteditable], button').first().focus().catch(() => {});
          await page.keyboard.press('Escape');
          await until(async () => !(await open()), 10000, 300);
        }
        if (had !== null) fs.writeFileSync(plan, had); else fs.rmSync(plan, { force: true });
        await exec('notifications.clearAll');
        await show();
      }
    });

    /* The conversation was told to save an image in its own folder and link it by its absolute path. A reply that does
       so is drawn; an image at a web address stays a link. */
    await step('images in a reply', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const folder = path.join(profile.home, '.claude', 'scratch', folderName(profile.folder), tab0.id);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'square.png'), Buffer.from(SQUARE_PNG, 'base64'));
      const slashed = folder.replace(/\\/g, '/');
      const before = model.seen.length;
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type(`Please show me the picture at ${slashed}/square.png`);
      await page.keyboard.press('Enter');
      const asked = await until(() => model.seen.slice(before).find((x) => x.picture), 30000, 300);
      const same = (a, b) => (process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);
      check(!!asked && same(asked.imagesNote, slashed), 'the conversation was told to save an image to show in its own folder',
        { told: asked && asked.imagesNote, folder: slashed });
      const drawn = await until(() => conv.evaluate((alt) => {
        const img = [...document.querySelectorAll('[data-testid="assistant-message"] img')].filter((x) => x.getAttribute('alt') === alt).pop();
        return img && img.complete && img.naturalWidth > 0 ? { src: (img.getAttribute('src') || '').slice(0, 30), width: img.naturalWidth } : null;
      }, IMAGE_ALT), 30000, 500);
      check(!!drawn && /^data:image\/png;base64,/.test(drawn.src) && drawn.width === 8, 'an image file on this machine that a reply links is drawn',
        drawn || await conv.evaluate(() => { const m = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop(); return m ? m.innerHTML.slice(-800) : null; }));
      const web = await conv.evaluate((url) => {
        const last = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop();
        if (!last) return null;
        const a = [...last.querySelectorAll('a')].find((x) => x.getAttribute('href') === url);
        return { link: !!a, img: [...last.querySelectorAll('img')].some((x) => x.getAttribute('src') === url) };
      }, IMAGE_WEB);
      check(!!web && web.link && !web.img, 'an image at a web address is shown as a link and not fetched', web);
      await shot('reply-images');
    });

    /* CronCreate keeps a durable scheduled prompt in a file in the project's own folder. The Agents button counts it
       and the agent map lists it. Once the file is removed, both disappear without any other change in the panel. */
    await step('a scheduled prompt in the agent map', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const dir = path.join(profile.folder, '.claude'), file = path.join(dir, 'scheduled_tasks.json');
      fs.mkdirSync(dir, { recursive: true });
      const prompt = 'Check the nightly build and report what failed.';
      fs.writeFileSync(file, JSON.stringify({ tasks: [{ id: 'cafe1234', cron: '*/5 * * * *', prompt, createdAt: Date.now(), recurring: true,
        createdBySessionId: tab0.id, createdInProject: profile.folder }] }, null, 2));
      const button = conv.locator('button, [role="button"]').filter({ hasText: /\b1 timer\b/ }).first();
      const counted = await until(() => button.isVisible().catch(() => false), 60000, 500);
      check(!!counted, 'the Agents button counts the scheduled prompt as 1 timer', await conv.evaluate(() => document.body.innerText.slice(-400)));
      if (counted) {
        await button.click({ timeout: 5000 });
        /* The prompt sits in a folded row, which innerText leaves out. */
        const listed = await until(async () => {
          const sec = mapSection(await mapLook(), 'Scheduled prompts');
          const folded = await conv.evaluate((text) => [...document.querySelectorAll('details pre')].some((p) => p.textContent.includes(text)), prompt);
          return sec && sec.head.count === '1' && sec.cards.length === 1 && sec.cards[0].title === prompt && sec.cards[0].meta === 'every 5 min · never fired' && folded && sec;
        }, 10000, 500);
        check(!!listed && cardsInForm({ cards: listed.cards }) && listed.cards[0].dot === 'idle',
          'the agent map lists it under SCHEDULED PROMPTS 1, a card with a grey dot, titled by its prompt and saying when it fires, with the whole prompt in the folded card', listed || await mapLook());
        await shot('agent-map-scheduled');
        await page.keyboard.press('Escape');
      }
      fs.rmSync(file, { force: true });
      const gone = await until(async () => !(await button.isVisible().catch(() => false)), 60000, 500);
      check(!!gone, 'once the file is gone the count goes too, with nothing else redrawing the panel', await conv.evaluate(() => document.body.innerText.slice(-400)));
    });

    await step('a closed tab', async () => {
      if (!list) throw new Error('the session list did not open');
      /* Earlier steps may have closed tabs of their own; the count is taken before this one closes. */
      const countOf = (x) => { const c = x.find((y) => y.closed); const m = c && /(\d+)\s*$/.exec(c.head); return m ? Number(m[1]) : 0; };
      const before = countOf(await sections());
      const closed = await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)});
        if (!t) return false; await vscode.window.tabGroups.close(t); return true;`);
      if (!closed) throw new Error('no Claude Code tab to close');
      const s = await until(async () => { const x = await sections(); const c = x.find((y) => y.closed); return c && countOf(x) === before + 1 && !x.some((y) => y.open && y.rows.length) && x; }, 20000, 500);
      const c = s && s.find((y) => y.closed);
      check(!!c && /^RECENTLY CLOSED \d+$/i.test(c.head) && countOf(s) === before + 1 && c.collapsed,
        'closing the tab puts RECENTLY CLOSED, folded, at the top of the list, with one more conversation than before, and leaves OPEN SESSIONS empty', { before, sections: s || await sections() });
      await page.mouse.move(5, 880);
      await sleep(300);
      await shot('recently-closed');
      if (!c) return;
      await compareAt('recently-closed-head', list.locator('[data-cce-recent-closed] [data-cce-section-head]').first());
      await list.locator('[data-cce-recent-closed] [data-cce-section-head] button').first().click();
      const shown = await until(async () => { const x = (await sections()).find((y) => y.closed); return x && !x.collapsed && x.rows.includes(tab0.id) && x; }, 10000, 300);
      check(!!shown, 'and opening it shows the conversation just closed', (await sections()).find((y) => y.closed));
      await page.mouse.move(5, 880);
      await shot('recently-closed-open');
    });

    await step('the sidebar and new conversations', async () => {
      if (!list) throw new Error('the session list did not open');
      const t2 = threads[2];
      const tabsBefore = (await claudeTabs()).length;
      retried(await pick(t2, ['Resume in sidebar']), 'Resume in sidebar');
      const side = await until(async () => await auxiliaryVisible() && await conversation(t2, 1000), 60000, 1000);
      check(!!side && (await claudeTabs()).length === tabsBefore, 'Resume in sidebar opens the conversation in the secondary sidebar, with no new tab',
        { sidebar: await auxiliaryVisible(), tabs: await tabs() });
      await shot('resumed-in-sidebar');
      /* The sidebar is narrower than a reply's stamp: it wraps between its parts rather than running past its column. */
      // A reply hidden as quiet keeps its stamp attribute but takes no room, so only rows on screen are measured.
      const stampsFit = () => side.evaluate(() => [...document.querySelectorAll('[data-testid="assistant-message"] [data-cce-ts]')]
        .filter((e) => e.getClientRects().length).map((e) => {
        const b = getComputedStyle(e, '::before');
        return { stamp: e.getAttribute('data-cce-ts'), width: Math.round(parseFloat(b.width)), column: e.clientWidth,
          past: e.scrollWidth - e.clientWidth, wrapped: parseFloat(b.height) > 2 * parseFloat(b.fontSize) };
      }));
      const fit = (side && await until(async () => { const f = await stampsFit(); return f.length >= t2.turns.length && f; }, 10000, 500))
        || (side ? await stampsFit() : []);
      check(fit.length >= t2.turns.length && fit.every((f) => f.width <= f.column && f.past <= 0),
        'in the sidebar every reply\'s stamp stays inside its column', fit);
      if (fit.length && !fit.some((f) => f.wrapped)) note('the sidebar was wide enough for every stamp, so none had to wrap');
      await exec('workbench.action.closeAuxiliaryBar');

      await list.locator('[data-cce-new-session="sidebar"]').first().click();
      const sideNew = await until(auxiliaryVisible, 20000, 500);
      check(!!sideNew && (await claudeTabs()).length === tabsBefore, 'New in sidebar opens Claude Code in the secondary sidebar, with no new tab', await tabs());
      await shot('new-in-sidebar');
      await exec('workbench.action.closeAuxiliaryBar');

      await list.locator('[data-cce-new-session="tab"]').first().click();
      const tabNew = await until(async () => { const x = await claudeTabs(); return x.length === tabsBefore + 1 && x.find((y) => y.active) && x; }, 30000, 500);
      check(!!tabNew, 'New in tab opens a new Claude Code tab', await tabs());
      /* Its page takes the focus as it starts; the next step's menu would close under it. */
      await frameWhere(() => !!document.querySelector('[contenteditable][role="textbox"]') && !document.querySelector('[class*="userMessage_"]'), 60000);
      await sleep(2000);
      await shot('new-in-tab');
    });

    await step('an archived conversation', async () => {
      if (!list) throw new Error('the session list did not open');
      const t1 = threads[1];
      const tabOf = async () => (await claudeTabs()).find((x) => titled(x.label, t1.title));
      const live = () => {
        const dir = path.join(profile.home, '.claude', 'sessions');
        let names = [];
        try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) { return false; }
        return names.some((n) => {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
            if (d.sessionId !== t1.id) return false;
            try { process.kill(d.pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
          } catch (_) { return false; }
        });
      };
      /* Archived while it is open in a tab, so that Delete session… meets a conversation that is open. */
      await exec('claude-vscode.editor.open', t1.id);
      const opened = !!await until(tabOf, 20000, 500);
      if (!opened) note('the conversation did not open in a tab, so deleting an open one was not tried');
      retried(await pick(t1, ['Archive session']), 'Archive session');
      check(!!await until(() => list.evaluate(() => [...document.querySelectorAll('button, [role="button"]')].some((b) => /^Archived/.test(b.innerText.trim()))), 15000, 500),
        'Archive session moves the conversation under Archived sessions');
      /* Claude Code lists archived conversations in a section of its own, folded until opened. */
      const header = list.locator('button, [role="button"]').filter({ hasText: /^Archived/ }).first();
      await header.waitFor({ state: 'visible', timeout: 15000 });
      if (!await row(t1).isVisible().catch(() => false)) await header.click();
      await row(t1).waitFor({ state: 'visible', timeout: 15000 });
      if (opened) {
        await exec('notifications.clearAll');
        retried(await pick(t1, ['Delete session…']), 'Delete session… on the open conversation');
        const refused = await until(async () => (await toasts()).find((x) => /^Not deleted:/.test(x)) || '', 15000, 300);
        const asked = await dialog();
        check(!!refused && refused.includes(t1.title) && !asked && fs.existsSync(transcriptOf(t1)),
          'Delete session… on an archived conversation open in a tab deletes nothing and says it is open', { refused, asked, toasts: await toasts(), tab: await tabOf() });
        if (asked) await answerDialog('Cancel');
        await exec('notifications.clearAll');
        await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)}
          && x.label && ${JSON.stringify(t1.title)}.startsWith(x.label.replace(/…$/, '')) && x.label.length >= 12);
          if (t) await vscode.window.tabGroups.close(t); return !!t;`);
        const gone = await until(async () => !(await tabOf()) && !live(), 30000, 500);
        check(!!gone, 'closing its tab ends its Claude Code process', { tab: await tabOf(), running: live() });
        if (!await row(t1).isVisible().catch(() => false)) await header.click();
        await row(t1).waitFor({ state: 'visible', timeout: 15000 });
      }
      const menu = await openMenu(t1);
      check(!!menu && menu[0].includes('Delete session…'), 'an archived conversation\'s menu has Delete session…', menu);
      await page.mouse.move(5, 880);
      await sleep(300);
      await shot('archived-menu');
      if (menu) await compareAt('row-menu-delete', item('Delete session…'));
      retried(await pick(t1, ['Delete session…']), 'Delete session…');
      const d = await until(dialog, 15000, 300);
      check(!!d && d.text.includes(`Delete "${t1.title}" from disk?`) && d.text.includes('This cannot be undone.') && d.buttons.includes('Delete') && d.buttons.includes('Cancel'),
        'Delete session… asks first, in a dialog naming the conversation, saying it cannot be undone, with Delete and Cancel', d);
      await shot('delete-confirmation');
      if (d) check(await answerDialog('Cancel') && fs.existsSync(transcriptOf(t1)), 'Cancel closes it and deletes nothing', transcriptOf(t1));
      /* Later steps right-click and drag this conversation's row as an ordinary one; under Archived sessions its menu
         differs and its row cannot be dragged. */
      retried(await pick(t1, ['Unarchive session']), 'Unarchive session');
      const ordinary = await until(async () => {
        const m = await openMenu(t1);
        await closeMenus();
        return m && m[0].includes('Archive session') && !m[0].includes('Unarchive session') ? m : null;
      }, 15000, 1000);
      check(!!ordinary, 'Unarchive session puts it back among the other conversations, for the steps after this one', ordinary);
    });

    await step('the steward panel', async () => { try {
      const front = threads[0];
      /* The Steward panel lists only conversations open in a window, so the others are opened in tabs first. */
      for (const t of threads.slice(1)) { await exec('claude-vscode.editor.open', t.id); await sleep(800); }
      await exec('claude-vscode.editor.open', front.id);
      await sleep(1500);
      await exec('workbench.view.extension.claudeCodePlusSteward');
      const frame = await frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
      const text = frame ? await frame.evaluate(() => document.body.innerText.slice(0, 300)) : '';
      check(!!frame, 'the Steward panel opens at the bottom of the window for the conversation in front', text);
      /* Running conversations come from `claude agents --json`, which is polled at most every 30 s. */
      const listed = () => frame.evaluate(() => [...document.querySelectorAll('input[data-id]')].map((b) => [b.dataset.id, b.checked]));
      const boxes = frame ? (await until(async () => { const b = await listed(); return b.length ? b : null; }, 40000, 1000)) || [] : [];
      const groups = frame ? await frame.evaluate(() => document.querySelectorAll('input[data-group]').length) : 0;
      const dataDir = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
      const readAll = (dir) => { try { return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))); } catch (_) { return []; } };
      check(boxes.length >= 1 && boxes.every(([id, on]) => id !== front.id && !on) && groups >= 1,
        'it lists the other conversations open in a window, in groups by window, none ticked, and not the one in front',
        { boxes, groups, windows: readAll(path.join(dataDir, 'windows')).map((w) => w.sessions),
          running: readAll(path.join(profile.home, '.claude', 'sessions')).map((r) => [r.sessionId, r.kind, r.status]) });
      await shot('steward-panel');
      /* The last title stored in a conversation's transcript, or ''. */
      const storedTitle = (id) => {
        let text = '';
        try { text = fs.readFileSync(transcriptOf({ id }), 'utf8'); } catch (_) { return ''; }
        const line = text.split('\n').filter((l) => l.includes('"type":"custom-title"')).pop();
        try { return line ? String(JSON.parse(line).customTitle || '') : ''; } catch (_) { return ''; }
      };
      if (frame && boxes.length) {
        /* The name an older build stored for a steward: the title with its bell after it, as the last custom title in the
           transcript and as the name of its process's session record. */
        const belledName = `${front.title} ${BELL}`;
        fs.appendFileSync(transcriptOf(front), JSON.stringify({ type: 'custom-title', customTitle: belledName, sessionId: front.id }) + '\n');
        for (const r of liveRecords().filter((x) => x.sessionId === front.id)) {
          const recFile = path.join(profile.home, '.claude', 'sessions', `${r.pid}.json`);
          try { fs.writeFileSync(recFile, JSON.stringify(Object.assign({}, r, { name: belledName }))); } catch (_) { /* the process rewrote it */ }
        }
        /* A test conversation that has an editor tab. An earlier step can leave one in the sidebar, and closing it and
           the tab checks below need it in a tab. */
        const tabbed = await claudeTabs();
        const inTab = (id) => { const t = threads.find((x) => x.id === id); return !!t && tabbed.some((x) => titled(x.label.replace(ENVELOPE, ''), t.title)); };
        const chosen = (boxes.find(([id]) => inTab(id)) || boxes[0])[0];
        await frame.locator(`input[data-id="${chosen}"]`).first().click();
        const file = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', 'stewards.json');
        const table = await until(() => {
          try { const t = JSON.parse(fs.readFileSync(file, 'utf8')); return t.stewards && t.stewards[front.id] ? t : null; } catch (_) { return null; }
        }, 10000, 300);
        check(!!table && table.stewards[front.id].manages.includes(chosen), 'ticking one makes the conversation in front its steward', table);
        /* A new body that reaches the panel between a box's press and its release replaces the box under the pointer;
           the panel holds it until the click is over, and the box still gets ticked. */
        const second = boxes.map(([id]) => id).find((id) => id !== chosen);
        if (second) {
          const managesIt = (on) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).stewards[front.id].manages.includes(second) === on; } catch (_) { return false; } };
          const box2 = frame.locator(`input[data-id="${second}"]`).first();
          await box2.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          const at = await until(() => box2.boundingBox().catch(() => null), 10000, 300);
          if (at) {
            await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
            await page.mouse.down();
            await frame.evaluate(() => window.postMessage({ type: 'body', html: document.getElementById('root').innerHTML }, '*'));
            await sleep(300);
            await page.mouse.up();
          }
          const kept = !!at && await until(() => managesIt(true), 10000, 300);
          check(!!kept, 'a box pressed and released while a redraw of the panel arrives ends up ticked', { box: at, table: (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } })() });
          if (kept) {
            await frame.locator(`input[data-id="${second}"]`).first().click();
            await until(() => managesIt(false), 10000, 300);
          }
        }
        const belled = (label) => typeof label === 'string' && label.endsWith(' \u{1F451}') && (label.match(/\u{1F451}/gu) || []).length === 1
          && titled(label.slice(0, -' \u{1F451}'.length), front.title);
        const marked = await until(async () => (await claudeTabs()).find((x) => belled(x.label)), 10000, 300);
        check(!!marked, 'and its tab keeps its title with one crown after it', await claudeTabs());
        /* Each of its rows in the session list, in OPEN SESSIONS and below it: one crown, drawn after the title and before
           any envelope, outside the title, and no mark in the title; the other conversations' rows have none. The crown
           comes before the title in the row's markup and the stylesheet moves it, so its place is read from where it is
           drawn. */
        const rowsOf = (id) => list.evaluate((id) => [...document.querySelectorAll(`[class*="sessionItem_"][id$="${id}"], [class*="sessionItem_"]:has([data-cce-pin="${id}"]), [data-cce-open-row="${id}"]`)]
          .map((r) => {
            const name = r.querySelector('span[class*="sessionName_"]'), crowns = [...r.querySelectorAll('[data-cce-crown]')];
            const env = r.querySelector('[data-cce-envelope]'), box = (e) => e.getBoundingClientRect();
            return { section: !!r.closest('[data-cce-section]'), crowns: crowns.length, name: name ? name.textContent : null,
              after: !!name && crowns.length === 1 && !name.contains(crowns[0]) && box(crowns[0]).left >= box(name).right - 1
                && (!env || box(env).left >= box(crowns[0]).right - 1) };
          }), id);
        const crownedRows = (rs, title) => rs.length >= 2 && rs.some((r) => r.section) && rs.some((r) => !r.section)
          && rs.every((r) => r.crowns === 1 && r.after && r.name === title && !MARK_RE.test(r.name));
        const crownRows = list ? await until(async () => { const rs = await rowsOf(front.id); return crownedRows(rs, front.title) && rs; }, 15000, 500) : null;
        const others = list ? await Promise.all(threads.filter((t) => t.id !== front.id).map((t) => rowsOf(t.id))) : [];
        check(!!crownRows && others.every((rs) => rs.every((r) => r.crowns === 0)),
          'and each of its rows in the session list, in OPEN SESSIONS and below, has one crown, after the title and not in it; no other row has one',
          { steward: crownRows || (list && await rowsOf(front.id)), others });
        /* The Steward panel's header shows the steward's name with its crown and without the bell stored in that
           name. */
        const header = () => frame.evaluate(() => { const b = document.querySelector('.head b'); return b ? b.textContent : null; });
        const headed = await until(async () => (await header()) === `${front.title} ${CROWN}`, 15000, 500);
        check(!!headed, 'the Steward panel\'s header names the steward with one crown after the name and without the bell an older build stored in it',
          { header: await header(), stored: storedTitle(front.id) });
        await shot('steward-ticked');

        /* Renamed through both of Claude Code's rename boxes, on the tab and on the session list row, with marks typed
           in every place: no mark gets into either box or into the stored title, and the tab and each row still show
           exactly one crown, after the title. */
        const crowned = (label, title) => typeof label === 'string' && label.endsWith(` ${CROWN}`) && (label.match(/\u{1F451}/gu) || []).length === 1
          && !/\u2709|\u{1F4E9}|\u{1F6CE}/u.test(label) && titled(label.slice(0, -(CROWN.length + 1)), title);
        const viaTab = async (typed) => {
          await exec('claude-vscode.editor.open', front.id);
          await sleep(500);
          const asked = exec('claude-vscode.renameSessionTab').catch((e) => String(e));
          const input = page.locator('.quick-input-widget input').first();
          if (!await until(() => input.isVisible().catch(() => false), 10000, 300)) throw new Error('Rename Session Tab did not open its box');
          const held = await input.inputValue();
          if (typed !== null) await input.fill(typed);
          await page.keyboard.press('Enter');
          await asked;
          return held;
        };
        const viaRow = async (id, typed) => {
          await openList();
          const r = row({ id });
          await page.mouse.move(5, 880);
          await r.hover();
          await r.locator('[title="Rename session"]').first().click({ timeout: 5000 });
          const box = r.locator('[contenteditable]').first();
          await box.waitFor({ state: 'visible', timeout: 5000 });
          const held = await box.textContent();
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
          await page.keyboard.insertText(typed);
          await page.keyboard.press('Enter');
          return held;
        };
        const NAME = 'Retry delay of the inventory sync';
        const renames = [
          ['Rename Session Tab', viaTab, null, 'nothing, saving what it was filled with, the stored name less its bell'],
          ['Rename Session Tab', viaTab, NAME, 'no mark'],
          ['Rename Session Tab', viaTab, `${CROWN} ${CROWN} Retry delay ${CROWN} of the inventory sync ${CROWN} ${BELL}`, 'crowns first, in the middle and last, and the old bell'],
          ['the session list row\'s Rename', (x) => viaRow(front.id, x), `Retry delay ${ENVELOPE.trim()} of the inventory sync ${ENVELOPE.trim()}${CROWN}`, 'envelopes and a crown'],
          ['the session list row\'s Rename', (x) => viaRow(front.id, x), `${BELL}${CROWN}Retry delay of the inventory sync`, 'a bell and a crown with no space before the title'],
          ['Rename Session Tab', viaTab, front.title, 'no mark, giving the conversation its own title back'],
        ];
        for (const [how, rename, typed, what] of renames) {
          const want = typed === front.title || typed === null ? front.title : NAME;
          let held = null, err = '';
          try { held = await rename(typed); } catch (e) { err = String((e && e.message) || e).split('\n')[0]; }
          const done = !err && await until(async () => {
            const tab = (await claudeTabs()).find((x) => crowned(x.label, want)), rs = await rowsOf(front.id);
            return storedTitle(front.id) === want && tab && crownedRows(rs, want) && { tab: tab.label, rows: rs };
          }, 20000, 500);
          check(!err && typeof held === 'string' && !MARK_RE.test(held) && !!done,
            `renamed through ${how} with ${what} typed: the box held no mark, the title is stored without one, and the tab and each row show a single crown after the title`,
            { err, held, typed, stored: storedTitle(front.id), tabs: (await claudeTabs()).map((x) => x.label), rows: await rowsOf(front.id) });
        }
        await page.mouse.move(5, 880);
        await shot('steward-renamed');
        /* A message the steward passes on with its script: the window types it into the managed conversation, which
           sends it as the user's message. The steward's tool call that runs the script is in its transcript first. */
        const target = threads.find((t) => t.id === chosen);
        if (target) {
          const words = 'Please run the tests once more, then stop.';
          const hooks = path.join(__dirname, '..', '..', 'claude-plugin', 'agent-work-plan', 'hooks', 'steward-relay.py');
          const answered = fakeHome.appendToolCall(transcriptOf(front), { sessionId: front.id, cwd: profile.folder, uuid: `${front.id.slice(0, 24)}000000000777`,
            toolId: 'toolu_relay_test', command: `python3 ${hooks} ${target.id} <<'EOF'\n${words}\nEOF`, description: 'Pass the message on' });
          const said = await new Promise((resolve) => {
            const kid = require('child_process').spawn(process.platform === 'win32' ? 'python' : 'python3', [hooks, target.id, dataDir],
              { env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: front.id }) });
            let out = '';
            kid.stdout.on('data', (d) => { out += d; });
            kid.stderr.on('data', (d) => { out += d; });
            kid.on('error', (e) => resolve('could not run the script: ' + e.message));
            kid.on('exit', () => resolve(out.trim()));
            kid.stdin.end(words);
          });
          answered(said);
          const arrived = /^Sent: /.test(said) ? await until(() => {
            try { return fs.readFileSync(transcriptOf(target), 'utf8').includes(JSON.stringify(words).slice(1, -1)); } catch (_) { return false; }
          }, 30000, 500) : false;
          check(/^Sent: /.test(said) && !!arrived, 'the steward passes a message on: it is typed into the managed conversation and sent as its user\'s message',
            { said, arrived: !!arrived });
          await shot('steward-relay');
          /* The steward's other requests: a rename through the panel showing the conversation, a new conversation in
             this window's folder with its first message sent, and closing that new one's tab. Each is run the way the
             steward runs it, so its tool call is in the steward's transcript first. */
          let calls = 0;
          /* `asker` runs the script: its tool call goes in its own transcript first. */
          const actAs = (asker, args, input) => {
            const line = `python3 ${hooks} ${args.join(' ')}` + (input ? ` <<'EOF'\n${input}\nEOF` : '');
            const answered = fakeHome.appendToolCall(transcriptOf({ id: asker }), { sessionId: asker, cwd: profile.folder,
              uuid: `${asker.slice(0, 24)}${String(780000 + calls++).padStart(12, '0')}`, toolId: `toolu_act_${calls}`, command: line, description: 'Act for the user' });
            return new Promise((resolve) => {
              const kid = require('child_process').spawn(process.platform === 'win32' ? 'python' : 'python3', [hooks, ...args, dataDir],
                { env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: asker }) });
              let out = '';
              kid.stdout.on('data', (d) => { out += d; });
              kid.stderr.on('data', (d) => { out += d; });
              kid.on('error', (e) => resolve('could not run the script: ' + e.message));
              kid.on('exit', () => resolve(out.trim()));
              kid.stdin.end(input || '');
            }).then((said) => { answered(said); return said; });
          };
          const act = (args, input) => actAs(front.id, args, input);
          const title = 'Renamed by its steward';
          const renamed = await act(['--rename', target.id], title);
          const titled2 = /^Renamed\./.test(renamed) ? await until(() => {
            try { return fs.readFileSync(transcriptOf(target), 'utf8').includes(`"customTitle":"${title}"`); } catch (_) { return false; }
          }, 20000, 500) : false;
          check(/^Renamed\./.test(renamed) && !!titled2, 'the steward renames a conversation it manages, and Claude Code records the title', { renamed });
          // Later steps find this conversation's tab by its own title.
          if (/^Renamed\./.test(renamed)) await act(['--rename', target.id], target.title);

          /* The managed conversation, in a tab behind the steward's, as the Steward panel's row shows it: a filled green
             dot while a turn runs, an envelope once its reply has landed unread, a red dot while it waits for permission,
             and a green ring while nothing but its background work runs. */
          const GREEN = `rgb(${DOTS.running.join(', ')})`, RED = `rgb(${DOTS.waiting.join(', ')})`;
          const panelRow = (id) => frame.evaluate((id) => {
            const a = document.querySelector(`li.row a.name[data-open="${id}"]`), li = a && a.closest('li.row');
            if (!li) return null;
            const dot = li.querySelector('.dot'), env = li.querySelector('.env'), cs = dot ? getComputedStyle(dot) : null;
            return { dot: dot ? [...dot.classList].filter((c) => c !== 'dot').join(' ') : null, env: env ? env.textContent : null,
              fill: cs && cs.backgroundColor, ring: cs && cs.borderTopWidth !== '0px' ? cs.borderTopColor : '', text: li.innerText.replace(/\s+/g, ' ').trim() };
          }, id);
          const rowIs = (want) => until(async () => { const r = await panelRow(target.id); return r && want(r) && r; }, 30000, 500);
          const sendTo = async (words) => { const said2 = await act([target.id], words); if (!/^Sent: /.test(said2)) throw new Error(`the steward could not pass "${words}" on: ${said2}`); };
          const front2 = async () => { await exec('claude-vscode.editor.open', front.id); await sleep(800); };
          model.hold();
          try {
            await sendTo('Please look at the build log, then stop.');
            const working = await rowIs((r) => r.dot === 'working' && r.fill === GREEN);
            check(!!working, 'while a turn of the managed conversation runs, its row in the Steward panel has a filled green dot', await panelRow(target.id));
            await shot('steward-row-working');
          } finally { model.release(); }
          const unread = await rowIs((r) => !r.dot && r.env === ENVELOPE.trim());
          check(!!unread, 'once its reply lands with its tab behind another, the row has no dot and ends in the envelope', await panelRow(target.id));
          await shot('steward-row-unread');
          /* While the reply is unread, the conversation is renamed through its session list row with envelopes and a
             crown typed into the name: the title is stored without them, its tab ends in one envelope, and its rows
             have one envelope after the title. */
          /* The row's marks come before its title in the page and the envelope is drawn after it, so the test reads its
             position from the screen. Rows in a folded section have no box. */
          const envRows = (id) => list.evaluate((id) => [...document.querySelectorAll(`[class*="sessionItem_"][id$="${id}"], [class*="sessionItem_"]:has([data-cce-pin="${id}"])`)]
            .filter((r) => r.getClientRects().length).map((r) => {
              const name = r.querySelector('span[class*="sessionName_"]'), envs = [...r.querySelectorAll('[data-cce-envelope]')];
              const nb = name && name.getBoundingClientRect(), eb = envs[0] && envs[0].getBoundingClientRect();
              return { envs: envs.length, crowns: r.querySelectorAll('[data-cce-crown]').length, name: name ? name.textContent : null,
                after: !!nb && envs.length === 1 && !name.contains(envs[0]) && eb.width > 0 && eb.left >= nb.right - 1 };
            }), id);
          let heldT = null, errT = '';
          try { heldT = await viaRow(target.id, `${ENVELOPE.trim()} ${target.title} ${ENVELOPE.trim()} ${CROWN}`); } catch (e) { errT = String((e && e.message) || e).split('\n')[0]; }
          const kept = !errT && await until(async () => {
            const tab = (await claudeTabs()).find((x) => titled(x.label.replace(ENVELOPE, ''), target.title)), rs = await envRows(target.id);
            return storedTitle(target.id) === target.title && tab && tab.label.endsWith(ENVELOPE) && (tab.label.match(/\u{1F4E9}|\u2709/gu) || []).length === 1
              && !tab.label.includes(CROWN) && rs.length >= 1 && rs.every((r) => r.envs === 1 && r.after && r.crowns === 0 && r.name === target.title) && { tab: tab.label, rows: rs };
          }, 20000, 500);
          check(!errT && typeof heldT === 'string' && !MARK_RE.test(heldT) && !!kept,
            'renamed through its row with envelopes and a crown typed while its reply is unread: the title is stored without them, and its tab and rows show a single envelope at the end',
            { errT, heldT, stored: storedTitle(target.id), tabs: (await claudeTabs()).map((x) => x.label), rows: await envRows(target.id) });
          await front2();

          const asked = model.seen.length;
          await sendTo(`Please ${ASK_TO_RUN}.`);
          const waitingRow = await rowIs((r) => r.dot === 'waiting' && r.fill === RED);
          check(!!waitingRow, 'while it waits for permission to run a command, the row has a filled red dot', await panelRow(target.id));
          await shot('steward-row-waiting');
          /* The steward is told, through its inbox, which native Windows does not offer (src/stewards.js post()). */
          const noticed = () => { try { const x = fs.readFileSync(transcriptOf(front), 'utf8'); return x.includes('Steward notice from Claude Code Plus') && x.includes(`(${target.id}) is waiting for the user`); } catch (_) { return false; } };
          if (process.platform === 'win32') {
            await sleep(15000);
            check(!noticed(), 'on native Windows the steward is not sent a notice, since its inbox socket takes none from other processes', model.seen.slice(asked).map((x) => (x.ask || '').slice(0, 120)));
          } else {
            check(!!await until(noticed, 45000, 1000), 'the steward is sent a notice, not as the user\'s message, that the conversation is waiting for the user',
              model.seen.slice(asked).map((x) => (x.ask || '').slice(0, 160)));
          }
          const closeBusy = await act(['--close', target.id]);
          check(/^Not done: busy: it is waiting/.test(closeBusy), 'asked to close it while it waits, without --confirmed, the steward is told to ask the user first', { closeBusy });
          await exec('claude-vscode.editor.open', target.id);
          const targetPage = await conversation(target, 30000);
          if (targetPage) await targetPage.locator('button, [role="button"]').filter({ hasText: /^\s*3\s*No\s*$/ }).first().click({ timeout: 5000 }).catch(() => {});
          await front2();
          check(!!await rowIs((r) => r.dot !== 'waiting'), 'answered, its red dot goes', await panelRow(target.id));

          await sendTo(`Please ${ASK_TO_BACKGROUND}.`);
          const ringRow = await until(async () => {
            const r = await panelRow(target.id);
            if (r && r.dot === 'waiting') {
              await exec('claude-vscode.editor.open', target.id);
              const pg = await conversation(target, 30000);
              if (pg) await pg.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 }).catch(() => {});
              await front2();
            }
            return r && r.dot === 'background' && r.ring === GREEN && r.fill !== GREEN && r;
          }, 60000, 1000);
          check(!!ringRow, 'once its turn has ended with a command still running in the background, the row has a green ring, not a filled dot', await panelRow(target.id));
          await shot('steward-row-background');

          /* A handoff run from the managed conversation reaches its steward through the steward's inbox, as a notice
             that is not the user's message. */
          const handed = model.seen.length;
          const handText = 'The user asked here for the release notes, which belong in another conversation.';
          const handoff = await actAs(target.id, ['--handoff'], handText);
          const arrivedHand = () => { try { const x = fs.readFileSync(transcriptOf(front), 'utf8'); return x.includes('Handoff from') && x.includes(`(${target.id}), passed on by Claude Code Plus`); } catch (_) { return false; } };
          if (process.platform === 'win32') {
            check(/^Not done: /.test(handoff) && /inbox/.test(handoff), 'on native Windows a handoff says the steward\'s inbox could not be reached', { handoff });
          } else {
            check(handoff.startsWith('Handed off to the steward ') && handoff.includes(`(${front.id})`) && !!await until(arrivedHand, 30000, 1000),
              'a managed conversation hands something off: the answer names the steward, which gets it as a notice from Claude Code Plus', { handoff, seen: model.seen.slice(handed).map((x) => (x.ask || '').slice(0, 160)) });
            /* Claude Code draws no row for what arrives through the inbox, so the turn that the handoff starts has no
               message on the page to begin at; its reply's duration still runs from the handoff, not from the last
               message typed. */
            const replyTo = () => {
              let recs = [];
              try { recs = fs.readFileSync(transcriptOf(front), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return {}; } }); } catch (_) { return null; }
              const at = recs.findIndex((r) => r.type === 'user' && JSON.stringify(r.message || '').includes(`(${target.id}), passed on by Claude Code Plus`));
              const reply = at < 0 ? null : recs.slice(at + 1).find((r) => r.type === 'assistant' && r.message && Array.isArray(r.message.content)
                && r.message.content.some((b) => b.type === 'text' && b.text.trim()));
              return reply && { from: Date.parse(recs[at].timestamp), at: Date.parse(reply.timestamp), uuid: reply.uuid };
            };
            const answer = await until(replyTo, 30000, 500);
            const page2 = answer ? await conversation(front, 30000) : null;
            /* The reply's first line, found by its time, and the turn duration the page writes on it (75-turn-stats.js
               dur). */
            const stampOf = () => page2 ? page2.evaluate((at) => {
              const fmt = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
              return [...document.querySelectorAll('[data-testid="assistant-message"] [data-cce-ts]')].map((e) => e.getAttribute('data-cce-ts').replace(/\u2060/g, ''))
                .find((x) => x.includes(fmt(at))) || null;
            }, answer.at) : null;
            const took = (ms) => {
              if (!(ms > 0)) return '';
              const s = Math.round(ms / 1000); if (s < 60) return `${s}s`;
              const mi = Math.floor(s / 60); return mi < 60 ? `${mi}m${s % 60 ? `${s % 60}s` : ''}` : `${Math.floor(mi / 60)}h${mi % 60}m`;
            };
            const want2 = answer ? took(answer.at - answer.from) : '';
            const timed = (x) => !!x && (want2 ? new RegExp(`\\s${want2}(\\s|$)`).test(x) : !/\s\d+(h\d+m|m(\d+s)?|s)(\s|$)/.test(x.replace(/^\S+/, '')));
            const shown2 = answer && await until(async () => { const x = await stampOf(); return timed(x) && x; }, 30000, 500);
            const listed = () => page2 && page2.evaluate(() => {
              const node = document.querySelector('[data-testid="assistant-message"]');
              const key = node && Object.keys(node).find((k) => k.startsWith('__reactFiber'));
              for (let f = key && node[key], i = 0; f && i < 80; f = f.return, i++) {
                const pr = f.memoizedProps, list = pr && pr.session && pr.session.messages && pr.session.messages.value;
                if (Array.isArray(list)) return list.filter((m) => m && m.type === 'user').slice(-4).map((m) => ({ ts: m.timestamp, origin: m.origin && m.origin.kind, folded: m.foldedIntoTurn, notAPrompt: m.notAPrompt }));
              }
              return null;
            });
            check(!!shown2, 'the steward\'s reply to the handoff, which Claude Code draws no row for, is timed from the handoff',
              { shown: await stampOf(), want: want2, answer, listed: await listed() });
          }
          const listedWindows = await act(['--windows']);
          const sameAs = (a, b) => (process.platform === 'win32' ? String(a).toLowerCase().includes(String(b).toLowerCase()) : String(a).includes(b));
          check(sameAs(listedWindows, profile.folder), '--windows lists this window with its folder', { listedWindows });
          const first = 'Start a new piece of work, please.';
          const opened = await act(['--open', profile.folder], first);
          const newId = (/Session id: ([0-9a-f-]{36})/.exec(opened) || [])[1] || '';
          const started = newId ? await until(() => {
            try { return fs.readFileSync(transcriptOf({ id: newId }), 'utf8').includes(JSON.stringify(first).slice(1, -1)); } catch (_) { return false; }
          }, 30000, 500) : false;
          check(/^Opened: /.test(opened) && !!started, 'the steward opens a new conversation in this window\'s folder, which sends the first message', { opened });
          if (newId) {
            const managed = await until(() => {
              try { return JSON.parse(fs.readFileSync(file, 'utf8')).stewards[front.id].manages.includes(newId); } catch (_) { return false; }
            }, 10000, 300);
            /* The new conversation gets a title of its own, because Claude Code counts a closed tab it remembers as
               shown while another tab has its label, and a new conversation's tab is labelled Claude Code, as is the
               empty one an earlier step leaves. */
            const ownTitle = await act(['--rename', newId], 'A new piece of work');
            check(/^Renamed\./.test(ownTitle), 'the steward gives the new conversation a title', { ownTitle });
            /* With a turn of the new conversation running, closing it needs --confirmed. */
            const idleNew = await until(() => sessionStatus(newId) === 'idle', 60000, 500);
            let refusedClose = '', closed = '';
            model.hold();
            try {
              const sent = idleNew ? await act([newId], 'Carry on with the plan, please.') : '';
              if (/^Sent: /.test(sent) && await until(() => sessionStatus(newId) === 'busy', 20000, 300)) {
                refusedClose = await act(['--close', newId]);
                closed = await act(['--close', '--confirmed', newId]);
              }
            } finally { model.release(); }
            check(!!managed && /^Not done: busy: it is working/.test(refusedClose) && /^Closed: /.test(closed),
              'the new conversation is the steward\'s; while it works, closing it is refused unless --confirmed is given, and goes ahead with it', { managed, idleNew, refusedClose, closed });
            /* With its tab closed no window shows that conversation, so the steward opens it again and passes it a
               message. Its process and this window's list of what it shows can take a moment to let it go. */
            if (/^Closed: /.test(closed)) {
              /* Two lines, to see that the line break reaches the transcript: the panel types the text, and Claude Code
                 sends what its input holds. */
              const later = 'Carry on where you left off, please.\nStart with the tests.';
              const manages = (id) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).stewards[front.id].manages.includes(id); } catch (_) { return null; } };
              /* Unticked first, with the button the panel shows when ticked conversations are open in no window, so
                 that the test sees the resume tick it again. */
              const drop = frame.locator('button[data-act="drop-hidden"]').first();
              const offered = await until(() => drop.isVisible().catch(() => false), 30000, 500);
              if (offered) await drop.click();
              const unticked = offered && await until(() => manages(newId) === false, 10000, 300);
              check(!!unticked, 'the Steward panel says a ticked conversation is open in no window, and its Untick button removes the tick', { offered, manages: manages(newId) });
              /* What this window's panels show, less what Claude Code knows runs in another process (shownList in extension.js). */
              const shownHere = () => call(`if (typeof globalThis.__cceSessionsShown !== 'function') return null;
                const away = typeof globalThis.__cceSessionsElsewhere === 'function' ? globalThis.__cceSessionsElsewhere() : [];
                return globalThis.__cceSessionsShown().filter((id) => !away.includes(id));`);
              /* Another process runs it: a `claude -p --resume`, held by the fake model. Started once no window's entry, which
                 the script reads, lists the conversation as shown. */
              const listedBy = () => readAll(path.join(dataDir, 'windows')).filter((x) => Array.isArray(x.sessions) && x.sessions.includes(newId)).map((x) => x.name);
              const unlisted = await until(() => !listedBy().length, 30000, 500);
              check(!!unlisted, 'once its tab is closed, no window\'s entry lists the conversation', { listedBy: listedBy() });
              const cli = claudeCli();
              let other = null;
              model.hold();
              try {
                other = cli ? require('child_process').spawn(cli, ['-p', '--resume', newId, 'Check the logs.'], { cwd: profile.folder, env: modelEnv(), stdio: 'ignore' }) : null;
                const running = other && await until(() => liveRecords().some((r) => r.pid === other.pid && r.sessionId === newId), 30000, 500);
                const refusedResume = running ? await act(['--resume', newId], later) : '';
                const shown = await shownHere();
                check(!!running && new RegExp(`^Not done: process ${other.pid} runs it`).test(refusedResume) && Array.isArray(shown) && !shown.includes(newId),
                  'while another process runs a conversation, the steward\'s request to open it is refused with the process named, and no tab opens', { refusedResume, shown, cli });
              } finally { model.release(); }
              if (other) await until(() => !liveRecords().some((r) => r.pid === other.pid), 30000, 500);
              let resumed = '';
              // Retried only while it was not opened at all; once opened, the answer says whether the text was sent.
              for (let i = 0; i < 15 && !/^Opened/.test(resumed); i++) {
                resumed = await act(['--resume', newId], later);
                if (!/^Opened/.test(resumed)) await new Promise((r) => setTimeout(r, 2000));
              }
              const arrived2 = /^Opened: /.test(resumed) ? await until(() => {
                try { return fs.readFileSync(transcriptOf({ id: newId }), 'utf8').includes(JSON.stringify(later).slice(1, -1)); } catch (_) { return false; }
              }, 30000, 500) : false;
              const tab = await until(async () => (await claudeTabs()).find((x) => x.active), 10000, 300);
              check(/^Opened: /.test(resumed) && /It is now ticked for you in the Steward panel\./.test(resumed) && !!arrived2,
                'the steward opens a conversation no window shows in an editor tab of this window, passes it a message of two lines, which arrives with its line break, and has it ticked',
                { resumed, arrived: !!arrived2, tab });
              /* The panel is about the conversation in front, which is the resumed one now; the steward is brought back.
                 Running conversations reach the panel from `claude agents --json`, asked at most every 30 s. */
              await exec('claude-vscode.editor.open', front.id);
              const boxOf = () => frame.evaluate((id) => { const b = document.querySelector(`input[data-id="${id}"]`); return b ? b.checked : null; }, newId);
              const tickedBox = await until(async () => (await boxOf()) === true, 45000, 500);
              check(manages(newId) === true && !!tickedBox, 'and it is ticked again: stewards.json lists it, and its box in the Steward panel is ticked', { manages: manages(newId), box: await boxOf() });
              await shot('steward-resume');
              if (/^Opened/.test(resumed)) {
                const twice = await act(['--resume', newId], later);
                check(/already open in the VS Code window|already shows it/.test(twice), 'and it does not open one that a window already shows', { twice });
                for (let i = 0; i < 15; i++) {
                  if (/^Closed: /.test(await act(['--close', newId]))) break;
                  await new Promise((r) => setTimeout(r, 2000));
                }
              }
              /* Opened only in the window whose first folder is the one Claude Code keeps the conversation under: one kept
                 under a folder no window has open is refused, and so is one kept under a folder below this window's, which
                 Claude Code's panel would show as an empty tab. */
              const [inside, outside] = [FOLDER_THREADS[0], FOLDER_THREADS[1]];
              const insideFolder = path.join(profile.folder, 'sub'), outsideFolder = path.join(path.dirname(profile.folder), 'ws-c');
              for (const d of [insideFolder, outsideFolder]) fs.mkdirSync(d, { recursive: true });
              fakeHome.writeThreads(profile.home, insideFolder, [inside]);
              fakeHome.writeThreads(profile.home, outsideFolder, [outside]);
              const away2 = await act(['--resume', outside.id]);
              check(/^Not done: no open VS Code window has its folder, .*, as its first folder/.test(away2) && !(await shownHere() || []).includes(outside.id),
                'a conversation started in a folder no window has open is opened in no window', { away2 });
              const tabsBefore = (await claudeTabs()).length;
              /* The script refuses before it writes any request, so nothing can open afterwards. */
              const below = await act(['--resume', inside.id]);
              check(/^Not done: no open VS Code window has its folder, .*, as its first folder/.test(below) && !(await shownHere() || []).includes(inside.id)
                && (await claudeTabs()).length === tabsBefore,
                'and so is one started in a folder below this window\'s folder, which Claude Code\'s panel would show as an empty tab: no tab opens', { below, tabs: await claudeTabs() });
              await exec('claude-vscode.editor.open', inside.id);
              const direct = await conversation(inside, 20000);
              note(`a conversation started in a folder below this window's, opened with claude-vscode.editor.open: ${direct ? 'it loads' : 'it does not load'}`);
              await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)}
                && (x.label === 'Claude Code' || ${JSON.stringify(inside.title)}.startsWith(x.label.replace(/…$/, ''))));
                if (t) await vscode.window.tabGroups.close(t); return !!t;`);
              await exec('claude-vscode.editor.open', front.id);
            }
          }
          await shot('steward-actions');
          /* A second steward: the managed conversation ticks another conversation in its own panel, where the first
             steward's box is greyed, since no steward can be managed. Becoming a steward takes it off the first
             steward's list, and in the first steward's panel its row then shows one crown, and the other rows none. */
          await exec('claude-vscode.editor.open', target.id);
          const box2 = frame.locator(`input[data-id="${front.id}"]`).first();
          const other2 = frame.locator(`input[data-id]:not([disabled]):not([data-id="${front.id}"])`).first();
          const ticked2 = await until(async () => { const h = await header(); return h && h.includes(target.title.slice(0, 20)) && await box2.isVisible().catch(() => false)
            && await other2.isVisible().catch(() => false); }, 45000, 500);
          const frontGreyed = !!ticked2 && await box2.isDisabled().catch(() => false);
          if (ticked2 && !await other2.isChecked()) await other2.click();
          const isSteward2 = await until(() => {
            try { const all = JSON.parse(fs.readFileSync(file, 'utf8')).stewards; return all[target.id] && all[target.id].manages.length && !(all[front.id] || { manages: [] }).manages.includes(target.id); } catch (_) { return false; }
          }, 10000, 300);
          check(frontGreyed && !!isSteward2, 'in the managed conversation\'s panel the steward\'s box is greyed; ticking another makes it a steward, which takes it off the first steward\'s list',
            { ticked2: !!ticked2, frontGreyed, table: (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).stewards; } catch (_) { return null; } })() });
          await exec('claude-vscode.editor.open', front.id);
          const names = () => frame.evaluate(() => Object.fromEntries([...document.querySelectorAll('li.row a.name[data-open]')].map((a) => [a.dataset.open, a.textContent])));
          const shown2 = await until(async () => {
            const n = await names(), others = Object.entries(n).filter(([id]) => id !== target.id);
            return n[target.id] === `${target.title} ${CROWN}` && others.length && others.every(([, t]) => !t.includes(CROWN)) && n;
          }, 30000, 500);
          check(!!isSteward2 && !!shown2, 'in the first steward\'s panel, a second steward\'s row shows one crown after its title, and the rows of conversations that are not stewards show none',
            { ticked2: !!ticked2, isSteward2: !!isSteward2, names: await names() });
          await shot('steward-two-stewards');
          await exec('claude-vscode.editor.open', target.id);
          if (await until(async () => { const h = await header(); return h && h.includes(target.title.slice(0, 20)); }, 30000, 500)) await frame.locator('button[data-act="none"]').click();
          await exec('claude-vscode.editor.open', front.id);
          await until(async () => (await header()) === `${CROWN} ${front.title}`, 15000, 500);
        } else note('the conversation ticked first is not one of the test conversations, so passing words on was not looked at');
        await frame.locator('button[data-act="none"]').click();
        const back = await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, front.title)), 10000, 300);
        check(!!back, 'and clearing gives the tab its own title back', await claudeTabs());
        await frame.locator('input[data-every]').click();
        const every = await until(() => {
          try { const t = JSON.parse(fs.readFileSync(file, 'utf8')).stewards[front.id]; return t && t.all === true && t.manages.length ? t : null; } catch (_) { return null; }
        }, 10000, 300);
        const locked = frame ? await until(() => frame.evaluate(() => {
          const rows = [...document.querySelectorAll('input[data-id]')];
          return rows.length && rows.every((b) => b.checked && b.disabled) ? rows.length : 0;
        }), 10000, 300) : 0;
        const allTab = await until(async () => (await claudeTabs()).find((x) => belled(x.label)), 10000, 300);
        check(!!every && !!locked && !!allTab, 'the All box in the panel page reaches the extension: rows locked on, the tab keeps its crown',
          { every, locked, tabs: await claudeTabs() });
        await frame.locator('input[data-every]').click();
        await until(() => frame.evaluate(() => [...document.querySelectorAll('input[data-id]')].every((b) => !b.disabled)), 10000, 300);
        await frame.locator('button[data-act="none"]').click();
        await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, front.title)), 10000, 300);
      }
      /* A steward link that Claude Code drew in a reply, clicked, should bring up the linked conversation's tab. */
      const other = threads[1], frontPanel = await conversation(front);
      if (frontPanel) {
        const href = 'vscode://xnervwang.claude-code-plus/open?session=' + other.id;
        await frontPanel.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(`Give me a link to conversation ${other.id}.`);
        await page.keyboard.press('Enter');
        const drawn = await until(() => frontPanel.evaluate((text) => {
          const a = [...document.querySelectorAll('[data-testid="assistant-message"] a')].filter((x) => x.textContent.trim() === text).pop();
          return a ? { href: a.getAttribute('href') } : null;
        }, LINK_TEXT), 30000, 500);
        check(!!drawn && drawn.href === href, 'a steward\'s link in a reply keeps its address when Claude Code draws it', drawn);
        /* With the Steward panel open, the 1024x677 macOS CI window left the conversation a few lines and clicking
           the link timed out. Close the panel first. */
        await exec('workbench.action.closePanel');
        await sleep(500);
        const link = frontPanel.locator('[data-testid="assistant-message"] a', { hasText: LINK_TEXT }).last();
        let clickError = '';
        if (drawn) {
          await link.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          await link.click({ timeout: 15000 }).catch((e) => { clickError = String((e && e.message) || e).slice(0, 1500); });
        }
        await sleep(1500);
        await shot('steward-link-click');
        /* VS Code shows this prompt before handing a vscode: URL to an extension. If it shows up, our click handler
           missed the click. */
        const allow = await until(async () => {
          const b = page.locator('.monaco-dialog-box .monaco-button', { hasText: /^(Open|Yes|Allow)$/ });
          return (await b.count()) ? b : null;
        }, 3000, 300);
        const dialogText = allow ? await page.evaluate(() => [...document.querySelectorAll('.monaco-dialog-box')].map((d) => d.innerText).join(' | ')) : '';
        if (allow) await allow.first().click();
        const jumped = drawn ? await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, other.title)), 15000, 300) : null;
        check(!!jumped && !allow, 'clicked, it brings that conversation\'s tab to the front, without going through VS Code\'s link prompt',
          { clickError, asked: !!allow, dialogText, toasts: await toasts(), tabs: await claudeTabs() });
        await shot('steward-link-jump');
      }
      await exec('workbench.action.closePanel');
    } finally {
      /* Whatever happened above, the conversation in front is no steward afterwards: later steps find its tab by its own
         title. */
      try {
        await exec('claude-vscode.editor.open', threads[0].id);
        await exec('workbench.view.extension.claudeCodePlusSteward');
        const p = await frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 15000);
        if (p && await p.locator('input[data-every]').isChecked().catch(() => false)) await p.locator('input[data-every]').click();
        if (p) await p.locator('button[data-act="none"]').click().catch(() => {});
        await until(async () => (await claudeTabs()).some((x) => titled(x.label, threads[0].title)), 10000, 300);
        await exec('workbench.action.closePanel');
      } catch (_) { /* the steps after this one say what is left */ }
    } });

    /* Two Claude Code processes under VS Code's extension host for one conversation, as after a window went away while
       its extension host stayed: the conversation's own tab, and then its CLI started from the extension host the way
       the panel starts it (stream-json, entry point claude-vscode), idle. Clicking Stop the old process then stops the
       tab's process, the older one. A process is tied to its extension host through /proc, so on Linux only. */
    await step('a conversation run by two processes', async () => {
      if (process.platform !== 'linux') { note('a conversation\'s processes are tied to their extension host through /proc, so this runs on Linux only'); return; }
      const t = threads[1], front = threads[0];
      const of = (id) => liveRecords().filter((r) => r.sessionId === id);
      await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)}
        && x.label && arg.startsWith(x.label.replace(/…$/, '')) && x.label.length >= 12); if (t) await vscode.window.tabGroups.close(t); return !!t;`, t.title);
      check(!!await until(() => !of(t.id).length, 30000, 500), 'with its tab closed, no process runs the conversation', of(t.id));
      /* Its tab first: Claude Code starts no process of its own for a conversation another process runs. */
      await exec('claude-vscode.editor.open', t.id);
      const own = await until(() => { const r = of(t.id); return r.length === 1 && r[0]; }, 60000, 500);
      let pid = 0;
      try {
        pid = await call(`const k = require('child_process').spawn(arg.bin, ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
          '--resume', arg.id], { cwd: arg.cwd, env: arg.env, stdio: ['pipe', 'ignore', 'ignore'] });
          globalThis.__cceTestSecond = k; return k.pid;`, { bin: claudeCli(), id: t.id, cwd: profile.folder,
          env: Object.assign(modelEnv(), { CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }) });
        const two = await until(() => of(t.id).some((r) => r.pid === pid) && of(t.id).length === 2 && of(t.id), 30000, 500);
        check(!!own && !!two, 'its tab runs the conversation, and so does a second CLI the test starts afterwards from the extension host, the way the panel starts one', of(t.id));
        const older = own ? own.pid : 0;
        await exec('claude-vscode.editor.open', front.id);
        await openList();
        /* The mark is the row's own ::after, after the title and never shrunk, so a title cut short does not cut it. */
        const mark = () => list.evaluate((id) => [...document.querySelectorAll(`[class*="sessionItem_"][id$="${id}"]`)].map((r) => {
          const after = getComputedStyle(r, '::after'), name = r.querySelector('span[class*="sessionName_"]');
          return { mark: after.content, shrink: after.flexShrink, inName: name ? getComputedStyle(name, '::after').content : '' };
        }), t.id);
        const marked = await until(async () => { const m = await mark(); return m.length && m.every((x) => /· 2 processes/.test(x.mark) && x.shrink === '0' && !/processes/.test(x.inName)) && m; }, 45000, 1000);
        check(!!marked, 'each of its rows in the session list says 2 processes after the title, outside it and never shrunk', await mark());
        await exec('workbench.view.extension.claudeCodePlusSteward');
        const panel = await frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
        const rowNow = () => panel.evaluate((id) => {
          const a = document.querySelector(`li.row a.name[data-open="${id}"]`), li = a && a.closest('li.row');
          const tw = li && li.querySelector('.twice'), stop = li && li.querySelector('[data-stop-old]');
          return li ? { twice: tw ? tw.textContent : null, stop: stop ? stop.textContent : null, title: stop ? stop.title : null } : null;
        }, t.id);
        const shown = panel && await until(async () => { const r = await rowNow(); return r && r.twice === '2 processes' && r && r.stop === 'Stop the old process' && r; }, 45000, 1000);
        check(!!shown && shown.title.startsWith(`Stops pid ${older}, `), 'its row in the Steward panel says 2 processes and offers Stop the old process, which names the older one, the tab\'s', shown || (panel && await rowNow()));
        await shot('steward-two-processes');
        if (shown) {
          await exec('notifications.clearAll');
          await panel.locator(`[data-stop-old="${t.id}"]`).first().click();
          const said = await until(async () => (await toasts()).find((x) => /^Stopped process \d+ of that conversation\./.test(x)) || '', 15000, 300);
          const gone = await until(() => !of(t.id).some((r) => r.pid === older) && of(t.id).length === 1, 20000, 300);
          check(said === `Stopped process ${older} of that conversation.` && !!gone, 'clicked, it stops the older process and says which, and the other runs on', { said, left: of(t.id) });
          /* The process left running is the one this test started the way the panel starts one. No window's panel shows
             it, so the conversation can leave the Steward panel altogether. */
          const cleared = await until(async () => { const r = await rowNow(), m = await mark(); return (!r || (!r.twice && !r.stop)) && m.every((x) => !/processes/.test(x.mark)); }, 45000, 1000);
          check(!!cleared, 'and the marks go from the panel and the session list', { row: await rowNow(), list: await mark() });
        }
      } finally { await call('if (globalThis.__cceTestSecond) globalThis.__cceTestSecond.kill(); return true;').catch(() => {}); }
      await exec('workbench.action.closePanel');
    });

    /* In Focus view Claude Code folds a message from another conversation into a row of its own ("1 hidden step"). */
    await step('a quiet reply to another conversation', async () => {
      const t = threads.find((x) => x.quietPeer);
      await exec('claude-vscode.editor.open', t.id);
      const conv = await conversation(t);
      if (!conv) throw new Error('the conversation did not open');
      const focus = conv.locator('[data-cce-focus-btn]').first();
      const wasOn = await focus.getAttribute('data-cce-fold') === 'folded';
      // Agent Plus's notice that the earlier turn finished sits over the panel's footer, and the pointer resting on it
      // keeps VS Code from hiding it.
      await exec('notifications.clearAll');
      if (!wasOn) await focus.click();
      const folds = () => conv.evaluate(() => [...document.querySelectorAll('[data-testid="focus-fold-row"]')]
        .map((r) => ({ label: r.textContent.trim(), shown: getComputedStyle(r).display !== 'none' })));
      /* Everything after the first fold row is the answer to the peer messages, which ends in a dash, so none of it
         may be on screen. */
      const after = () => conv.evaluate(() => {
        const fold = document.querySelector('[data-testid="focus-fold-row"]');
        if (!fold) return null;
        const out = [];
        for (let e = fold; e; e = e.nextElementSibling) {
          const box = e.getBoundingClientRect();
          out.push({ testid: e.getAttribute('data-testid') || '', cls: String(e.className || '').split(' ')[0].replace(/_[a-z0-9]+$/i, ''),
            shown: getComputedStyle(e).display !== 'none' && box.height > 0, height: Math.round(box.height),
            text: (e.innerText || '').trim().slice(0, 40) });
        }
        return out;
      });
      const seen = await until(async () => { const f = await after(); return f && f.length && f.every((x) => !x.shown) ? f : null; }, 15000, 300);
      // innerText of an element that is not drawn is all its text, so only replies on screen are read.
      const replies = await conv.evaluate(() => [...document.querySelectorAll('[data-testid="assistant-message"]')]
        .filter((m) => m.getClientRects().length).map((m) => (m.innerText || '').trim()).filter(Boolean));
      check(!!seen && replies.indexOf('-') === -1,
        'a peer message answered with a dash after thinking with no text and a tool call: nothing of it is left on screen, fold row and dots included',
        { after: seen || await after(), folds: await folds(), replies });
      await shot('quiet-peer-reply');
      if (!wasOn) await focus.click();
    });

    /* In the first conversation, where the earlier steps' turns left tool calls, which Focus view folds into rows. */
    await step('a fold opened by hand', async () => {
      await exec('claude-vscode.editor.open', tab0.id);
      const conv = await conversation(tab0);
      if (!conv) throw new Error('the conversation did not open');
      await exec('notifications.clearAll');
      const focus = conv.locator('[data-cce-focus-btn]').first();
      const button = () => focus.evaluate((e) => ({ fold: e.getAttribute('data-cce-fold'), label: e.getAttribute('aria-label') }));
      const wasOn = (await button()).fold !== 'open';
      if (!wasOn) await focus.click();
      const row = conv.locator('[data-testid="focus-fold-row"][aria-expanded="false"]').filter({ visible: true }).first();
      /* The turns before may have left no tool call in this conversation, or left it far above the screen, where Claude
         Code does not draw it; a turn that runs a command puts a folded row at the bottom. */
      const turns = model.turns();
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type(`Please ${ASK_TO_PAUSE}.`);
      await page.keyboard.press('Enter');
      // The model is asked twice in that turn: once for the command, once with its result.
      let asked = false;
      const ran = await until(async () => {
        if (model.turns() >= turns + 2) return true;
        if (!asked && await conv.evaluate((cmd) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(cmd), PAUSE_RUN).catch(() => false)) {
          asked = true;
          note(`Claude Code asked before running ${PAUSE_RUN}, so it was allowed`);
          await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 }).catch(() => {});
        }
        return false;
      }, 60000, 500);
      const found = ran && await until(async () => (await row.count()) > 0, 15000, 300);
      if (!found) throw new Error('the conversation shows no folded tool call in Focus view');
      await row.scrollIntoViewIfNeeded();
      const key = await row.evaluate((e) => { e.setAttribute('data-cce-test-fold', ''); return e.textContent.trim(); });
      const marked = conv.locator('[data-cce-test-fold]').first();
      await marked.click();
      const opened = await until(async () => await marked.getAttribute('aria-expanded') === 'true' && (await button()).fold === 'opened' && await button(), 5000, 200);
      check(!!opened && opened.label === LABELS.focusOpened, 'in Focus view, the button shows the unfolded arrows once a tool call is opened by hand',
        { row: key, expanded: await marked.getAttribute('aria-expanded'), button: await button() });
      await shot('focus-fold-opened');
      await focus.click();
      const back = await until(async () => await marked.getAttribute('aria-expanded') === 'false' && (await button()).fold === 'folded' && await button(), 5000, 200);
      check(!!back && back.label === LABELS.focusOn, 'and pressing the button folds it again, with Focus view still on',
        { row: key, expanded: await marked.getAttribute('aria-expanded'), button: await button() });
      await marked.evaluate((e) => e.removeAttribute('data-cce-test-fold')).catch(() => {});
      if (!wasOn) await focus.click();
    });

    const setLoad = (v) => call(`await vscode.workspace.getConfiguration('claudeCodePlus').update('loadRestoredTabs', arg, vscode.ConfigurationTarget.Global); return true;`, v);
    const loaded = (t) => conversation(t, 1000).then((f) => !!f, () => false);
    /*
     * Claude Code's page notes in its webview state (unfinishedOpen) that the opening of a conversation is unfinished,
     * from when it starts to load it until 3 s after it has loaded, and does not reopen a tab after a reload once two
     * opens in a row were left unfinished. The opens left unfinished in the pages of the window, read through this
     * extension's copy of acquireVsCodeApi, which hands out the page's one handle again (src/panel-load-watch.js).
     */
    const openUnfinished = () => Promise.all(page.frames().map((f) => f.evaluate(() => {
      const a = globalThis.acquireVsCodeApi;
      if (typeof a !== 'function' || !/api = orig\(\)/.test(String(a))) return null;
      const s = a().getState();
      return s && s.unfinishedOpen ? `${String(s.unfinishedOpen.sessionId).slice(-12)} x${s.unfinishedOpen.count}` : null;
    }).catch(() => null))).then((x) => x.filter(Boolean));
    /* Reloads the window once every page has finished opening its conversation, and returns once this extension is
       active again and `front`'s page has drawn its conversation. `before` runs as soon as the new extension host is
       up. Returns the helper's record of that host; its `at` is the time the host started. */
    const reloadAndWait = async (front, before) => {
      if (!await until(async () => !(await openUnfinished()).length, 30000, 300)) {
        note(`a page still had an open unfinished 30 s on, before a reload: ${(await openUnfinished()).join(', ')}`);
      }
      const host = await w.reload();
      if (before) await before();
      await until(async () => { const st = await patchState(); return st && st.active && st; }, 60000, 1000);
      await until(() => loaded(front), 60000, 1000);
      return host;
    };

    /* VS Code creates a restored tab's page only when the tab is first shown. With claudeCodePlus.loadRestoredTabs on, a
       reload loads the Claude Code tab behind the one in front without a click. */
    await step('restored tabs', async () => {
      const [front, behind] = threads;
      await exec('workbench.action.closeAllEditors');
      await exec('workbench.action.closeAuxiliaryBar');
      await exec('claude-vscode.editor.open', behind.id);
      await sleep(1500);
      await exec('claude-vscode.editor.open', front.id);
      await sleep(1500);
      await reloadAndWait(front);
      const reopened = await conversation(front, 5000).catch(() => null);
      const redrawn = reopened ? await until(() => reopened.evaluate((alt) => {
        const img = [...document.querySelectorAll('[data-testid="assistant-message"] img')].filter((x) => x.getAttribute('alt') === alt).pop();
        return img && img.complete && img.naturalWidth > 0 ? img.naturalWidth : null;
      }, IMAGE_ALT), 30000, 500) : null;
      check(redrawn === 8, 'after a reload, the image in a restored reply is drawn again',
        reopened ? await reopened.evaluate(() => { const m = [...document.querySelectorAll('[data-testid="assistant-message"]')]
          .find((x) => /red square|Here it is/.test(x.innerText)); return m ? m.innerText.slice(0, 400) : null; }) : 'the conversation did not reopen');
      await sleep(10000);
      const without = await loaded(behind);
      await setLoad(true);
      await reloadAndWait(front);
      const withIt = await until(() => loaded(behind), 60000, 1000);
      const inFront = await until(async () => { const t = (await claudeTabs()).find((x) => x.active); return t && titled(t.label, front.title) && t; }, 10000, 300)
        || (await claudeTabs()).find((t) => t.active);
      check(!without && !!withIt && !!inFront && titled(inFront.label, front.title),
        'a reload leaves a Claude Code tab behind another unloaded; with claudeCodePlus.loadRestoredTabs on it is loaded, and the tab in front stays in front',
        { without, withIt: !!withIt, tabs: await claudeTabs() });
      await shot('restored-tabs-loaded');
      await setLoad(undefined);
    });

    /*
     * A record the test keeps in the extension host from the moment watchHost() is called: each change of the window's
     * tabs (each group's labels, the tab in front starred), each change of the set of conversations Claude Code's host
     * marks unread, which it sends with the open conversations, and each change of the set whose state the host has,
     * which a page reports as it loads. watchHost() runs right after a reload, before claudeCodePlus.loadRestoredTabs
     * can run, which is 8 s after this extension starts at the earliest.
     */
    const watchHost = () => call(`
      const w = globalThis.__cceTestWatch = { t0: Date.now(), tabs: [], unread: [], states: [] };
      const snap = () => vscode.window.tabGroups.all.map((g) => g.tabs.map((t) => (t.isActive ? '*' : '') + t.label).join(' | ')).join(' || ');
      const note = (list, v) => { const k = JSON.stringify(v); if (!list.length || list[list.length - 1].k !== k) list.push({ ms: Date.now() - w.t0, v, k }); };
      note(w.tabs, snap());
      vscode.window.tabGroups.onDidChangeTabs(() => note(w.tabs, snap()));
      const wrap = () => {
        const own = globalThis.__cceStatesHook;
        if (typeof own !== 'function') return false;
        if (own.cceTest) return true;
        const hook = (...a) => {
          note(w.unread, (Array.isArray(a[3]) ? a[3] : []).slice().sort());
          note(w.states, (Array.isArray(a[0]) ? a[0] : []).map((s) => s && s.sessionId).filter(Boolean).sort());
          return own(...a);
        };
        hook.cceTest = true;
        globalThis.__cceStatesHook = hook;
        return true;
      };
      const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 20);
      return true;`);
    const watched = () => call('const w = globalThis.__cceTestWatch; return w ? { tabs: w.tabs.map((x) => [x.ms, x.v]), unread: w.unread.map((x) => [x.ms, x.v]),'
      + ' states: w.states.map((x) => [x.ms, x.v]), holds: w.holds || null, loaded: w.loaded === undefined ? null : w.loaded } : null;');
    /*
     * Whether a background tab's unread mark survives the moment claudeCodePlus.loadRestoredTabs shows it depends on
     * whether its page reports its conversation within that moment, which differs from machine to machine. Called right
     * after a reload, with watchHost(): in the new extension host Claude Code Plus's loader then keeps each tab in front
     * until Claude Code has dropped a mark, up to 15 s, so the clear always happens. Each hold, and when the loader
     * finished, go into watchHost()'s record. Nothing else in the window is changed, and the next reload undoes it.
     */
    const holdInFront = () => call(`
      const path = require('path'), fs = require('fs');
      const w = globalThis.__cceTestWatch;
      const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus');
      if (!w || !mine) throw new Error('no record kept, or Claude Code Plus is not installed');
      const file = path.join(mine.extensionPath, 'src', 'load-tabs.js');
      const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
      const marks = () => (w.unread.length ? w.unread[w.unread.length - 1].v.length : 0);
      w.holds = [];
      const wrap = () => {
        let real = file;
        try { real = fs.realpathSync(file); } catch (_) { /* not there */ }
        const key = Object.keys(require.cache).find((k) => same(k, file) || same(k, real));
        if (!key) return false;
        const mod = require.cache[key].exports, own = mod.loadAll;
        mod.loadAll = (o) => own({ ...o, sleep: async (ms) => {
          const t0 = Date.now(), had = marks();
          await o.sleep(ms);
          while (marks() >= had && Date.now() - t0 < 15000) await o.sleep(20);
          w.holds.push({ ms: t0 - w.t0, held: Date.now() - t0, cleared: marks() < had });
        } }).finally(() => { w.loaded = Date.now() - w.t0; });
        return true;
      };
      const timer = setInterval(() => { if (wrap()) clearInterval(timer); }, 20);
      return true;`);
    /* The tabs in front in each entry of the tab record, by label without the envelope. */
    const frontsIn = (rec) => rec.map(([, v]) => v.split(/ \|{1,2} /).filter((s) => s.startsWith('*')).map((s) => s.slice(1).replace(ENVELOPE, '')));
    /* Whether the tab record has each tab of `behind` come to the front at some point, and `front` back in front after
       the last of them. */
    const eachShownThenBack = (rec, behind, front) => {
      const fronts = frontsIn(rec);
      const at = (t) => fronts.map((f, i) => (f.some((l) => titled(l, t.title)) ? i : -1)).filter((i) => i >= 0);
      const last = Math.max(...behind.map((t) => { const i = at(t); return i.length ? i[i.length - 1] : Infinity; }));
      return Number.isFinite(last) && at(front).some((i) => i > last);
    };
    /* The conversations Claude Code's host marks unread now. */
    const hostUnread = () => call(`
      const own = globalThis.__cceStatesHook, send = globalThis.__cceSendSessionStates;
      if (typeof own !== 'function' || typeof send !== 'function') return null;
      let got = null;
      globalThis.__cceStatesHook = (...a) => { if (got === null) got = Array.isArray(a[3]) ? a[3].slice() : []; return own(...a); };
      try { send(); } finally { globalThis.__cceStatesHook = own; }
      return got;`);
    /* Where `t` shows its envelope: after its tab's title, on its row in OPEN SESSIONS, on its row in the list below,
       and among the host's unread marks (`unread`). */
    const envelopesOf = async (t, unread) => {
      const tab = (await claudeTabs()).find((x) => titled(x.label.replace(ENVELOPE, ''), t.title));
      const open = list ? await list.locator(`[data-cce-open-sessions] [class*="sessionItem_"][id$="${t.id}"] [data-cce-envelope]`).count().catch(() => -1) : -1;
      const p = list ? await rowParts(t) : null;
      return { title: t.title.slice(0, 24), tab: !!tab && tab.label.endsWith(ENVELOPE), open: open === 1, row: !!p && p.envelopes === 1,
        host: Array.isArray(unread) && unread.includes(t.id), label: tab ? tab.label : null };
    };
    const everywhere = (e) => e.tab && e.open && e.row && e.host;
    const envelopesNow = async (ts) => { const u = await hostUnread(); return Promise.all(ts.map((t) => envelopesOf(t, u))); };

    /*
     * Claude Code clears a conversation's unread mark when its page reports the conversation while its tab is in front,
     * and claudeCodePlus.loadRestoredTabs shows each background tab for a moment. A conversation whose reply was not
     * read when the window reloaded must still have its envelope in every place envelopesOf checks once the tabs have
     * been loaded, even when each page reported while its tab was in front (holdInFront).
     */
    await step('restored tabs keep their envelopes', async () => {
      const [front, ...behind] = threads;
      await setLoad(undefined);
      await exec('workbench.action.closeAllEditors');
      await exec('workbench.action.closeAuxiliaryBar');
      for (const t of [...behind, front]) {
        await exec('claude-vscode.editor.open', t.id);
        const open = await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label.replace(ENVELOPE, ''), t.title)), 30000, 300);
        if (!open) throw new Error(`"${t.title}" did not open in a tab`);
      }
      const groups = (await tabs()).filter((g) => g.tabs.some((x) => x.view === PANEL_VIEW));
      check(groups.length === 1, 'the three conversations share one editor group, the last opened in front', await tabs());
      /* Each conversation behind is marked unread in turn, the next only once the host holds the mark, with what each
         call returned and the host's marks right after. */
      const marks = [];
      for (const t of behind) {
        const said = await call('return globalThis.__cceSetUnread(arg, true);', t.id);
        const held = await until(async () => { const u = await hostUnread(); return Array.isArray(u) && u.includes(t.id) && u; }, 10000, 300);
        marks.push({ id: t.id.slice(-2), said, held: held || await hostUnread() });
      }
      await openList();
      const marked = await until(async () => { const e = await envelopesNow(behind); return e.every(everywhere) && e; }, 20000, 500);
      check(!!marked, 'the two conversations behind the one in front, marked unread, show the envelope on their tabs, their rows and in the host\'s marks',
        { now: marked || await envelopesNow(behind), marks });

      /* First, without the setting, what a reload alone keeps, for comparison. */
      await reloadAndWait(front);
      await openList();
      const kept = await until(async () => { const e = await envelopesNow(behind); return e.every(everywhere) && e; }, 30000, 500);
      check(!!kept, 'after a reload with claudeCodePlus.loadRestoredTabs off, each background tab, its rows and the host\'s marks still have the envelope',
        kept || await envelopesNow(behind));

      await setLoad(true);
      await reloadAndWait(front, async () => { await watchHost(); await holdInFront(); });
      const ran = await until(async () => {
        const r = await watched();
        return r && r.loaded !== null && eachShownThenBack(r.tabs, behind, front) && r;
      }, 90000, 500);
      const pages = ran ? await until(async () => (await Promise.all(behind.map(loaded))).every(Boolean), 60000, 1000) : false;
      check(!!ran && !!pages && ran.holds.length === behind.length,
        'with claudeCodePlus.loadRestoredTabs on, the reload brings each background tab to the front once and holds it there, then brings the front tab back, and both pages load',
        { pages, record: (await watched()) || 'no record' });
      if (ran && ran.holds.some((h) => !h.cleared)) note(`a tab held in front lost no mark in 15 s, so this run does not show what the loading clears: ${JSON.stringify(ran.holds)}`);
      await openList();
      /* The marks have to come back once the loader has finished, and then stay, while the pages go on reporting. */
      const back = pages ? await until(async () => { const e = await envelopesNow(behind); return e.every(everywhere) && e; }, 10000, 500) : null;
      const lost = back ? await until(async () => { const e = await envelopesNow(behind); return e.some((x) => !everywhere(x)) && e; }, 15000, 500) : null;
      const after = lost || back || await envelopesNow(behind);
      const inFront = (await claudeTabs()).find((t) => t.active);
      const rec = await watched();
      check(!!back && !lost, 'and once it has finished, each background tab, its rows and the host\'s marks have the envelope, and keep it', { after, record: rec });
      /* Kept in the output either way: when each tab was in front, the host's marks over the same time, each hold and
         when the loader finished. */
      if (rec) console.log(`        fronts: ${JSON.stringify(rec.tabs.map(([ms], i) => [ms, frontsIn(rec.tabs)[i].map((l) => l.slice(0, 12))]))}`
        + `\n        unread: ${JSON.stringify(rec.unread.map(([ms, ids]) => [ms, ids.map((id) => id.slice(-2))]))}`
        + `\n        states: ${JSON.stringify(rec.states.map(([ms, ids]) => [ms, ids.map((id) => id.slice(-2))]))}`
        + `\n        holds: ${JSON.stringify(rec.holds)}, loader finished at ${rec.loaded} ms`);
      check(!!inFront && titled(inFront.label.replace(ENVELOPE, ''), front.title), 'and the tab that was in front before the reload comes back to the front', await claudeTabs());
      await shot('restored-tabs-envelopes');
      for (const t of behind) await call('return globalThis.__cceSetUnread(arg, false);', t.id);
      await setLoad(undefined);
    });

    /*
     * A restored tab whose page VS Code builds only when it is clicked, long after the reload: its conversation loads and
     * takes a message. With claudeCodePlus.loadRestoredTabs off, so nothing shows the tab before the click.
     */
    await step('a restored tab opened late', async () => {
      const [front, late] = threads;
      const LATE_MS = 45000;
      await setLoad(undefined);
      await exec('workbench.action.closeAllEditors');
      for (const t of [late, front]) {
        await exec('claude-vscode.editor.open', t.id);
        const open = await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label.replace(ENVELOPE, ''), t.title)), 30000, 300);
        if (!open) throw new Error(`"${t.title}" did not open in a tab`);
      }
      const host = await reloadAndWait(front, watchHost);
      const notYet = !(await loaded(late));
      await sleep(Math.max(0, host.at + LATE_MS - Date.now()));
      const rec = await watched();
      const neverShown = !!rec && !frontsIn(rec.tabs).some((f) => f.some((l) => titled(l, late.title)));
      check(notYet && neverShown, `the background tab has not been shown or loaded ${LATE_MS / 1000} s after the reload`, { notYet, record: rec });
      await exec('notifications.clearAll');
      const label = ((await claudeTabs()).find((x) => titled(x.label.replace(ENVELOPE, ''), late.title)) || {}).label;
      if (!label) throw new Error(`"${late.title}" has no tab`);
      const clicked = Date.now();
      await page.locator('.tabs-container .tab').filter({ hasText: label.slice(0, 16) }).first().click();
      const frame = await conversation(late, 60000);
      const loadMs = frame ? Date.now() - clicked : null;
      const seen = frame ? null : await Promise.all(page.frames().map((f) => f.evaluate(() => (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200)).catch(() => '')))
        .then((x) => x.filter(Boolean));
      check(!!frame, `clicked ${Math.round((clicked - host.at) / 1000)} s after the reload, its conversation loads`, frame ? { loadMs } : { shown: seen });
      if (!frame) { await shot('restored-tab-late-error'); return; }
      const turns = model.turns();
      const replies = () => frame.evaluate(() => document.querySelectorAll('[data-testid="assistant-message"]').length);
      const before = await replies();
      await frame.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type('Check the export once more.');
      await page.keyboard.press('Enter');
      const reached = await until(() => model.turns() > turns, 30000, 300);
      const answered = reached ? await until(async () => (await replies()) > before && await frame.evaluate(() => {
        const m = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop();
        return !!m && /Done\. The retry delay is set in config\/sync\.yml\./.test(m.innerText);
      }), 30000, 500) : false;
      check(!!reached && !!answered, 'and it takes a message: the message reaches the fake model and its reply is drawn',
        { reached: !!reached, answered: !!answered, seen: model.seen.slice(-2) });
      await shot('restored-tab-late');
    });

    /* Each Claude Code page of the window: whether its webview state still marks the opening of its conversation
       unfinished, whether it says it did not reopen a conversation, and its text. */
    const pageStates = () => Promise.all(page.frames().map((f) => f.evaluate(() => {
      const a = globalThis.acquireVsCodeApi;
      if (typeof a !== 'function' || !/api = orig\(\)/.test(String(a))) return null;
      const s = a().getState() || {}, text = document.body ? document.body.textContent : '';
      return { open: s.unfinishedOpen || null, skipped: /was not reopened/.test(text), hidden: document.visibilityState === 'hidden', text };
    }).catch(() => null))).then((x) => x.filter(Boolean));
    const stateOf = (states, t) => states.find((s) => s.text.includes(t.turns[0][0]) || (s.skipped && s.text.includes(t.title)));
    const pageSummary = (states, ts) => ts.map((t) => {
      const s = stateOf(states, t);
      return { title: t.title.slice(0, 16), page: !!s, skipped: !!s && s.skipped, hidden: !!s && s.hidden,
        open: s && s.open ? `${s.open.sessionId.slice(-2)} x${s.open.count}` : null };
    });

    /*
     * Claude Code's page treats opening a conversation as unfinished until 3 s after it has loaded, waiting for two
     * frames first when the page is in sight, and does not reopen a tab once two opens in a row were left unfinished.
     * claudeCodePlus.loadRestoredTabs shows each background tab for a moment, so through reload after reload each tab
     * must still open its conversation.
     */
    await step('restored tabs through three reloads', async () => {
      const [front, ...behind] = threads;
      await setLoad(true);
      await exec('workbench.action.closeAllEditors');
      for (const t of [...behind, front]) {
        await exec('claude-vscode.editor.open', t.id);
        const open = await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label.replace(ENVELOPE, ''), t.title)), 30000, 300);
        if (!open) throw new Error(`"${t.title}" did not open in a tab`);
      }
      console.log(`        before the reloads: ${JSON.stringify(pageSummary(await pageStates(), behind))}`);
      let last = null;
      for (let n = 1; n <= 3; n++) {
        await reloadAndWait(front, watchHost);
        const ran = await until(async () => { const r = await watched(); return r && eachShownThenBack(r.tabs, behind, front) && r; }, 90000, 500);
        const done = ran ? await until(async () => { const s = await pageStates(); return behind.every((t) => stateOf(s, t)) && s; }, 60000, 1000) : null;
        last = pageSummary(done || await pageStates(), behind);
        console.log(`        reload ${n}: loaded ${!!ran}; ${JSON.stringify(last)}`);
      }
      check(!!last && last.every((p) => p.page && !p.skipped),
        'with claudeCodePlus.loadRestoredTabs on, after three reloads each background tab still opens its conversation, not Claude Code\'s notice that it was not reopened',
        last);
      await shot('restored-tabs-three-reloads');
      await setLoad(undefined);
    });

    await step('two windows', async () => {
      /* A second window of the same VS Code, on a folder of its own with conversations started in it: X is opened in a
         tab there, Y in no window. */
      const folderB = path.join(path.dirname(profile.folder), 'ws-b');
      fs.mkdirSync(folderB, { recursive: true });
      fs.writeFileSync(path.join(folderB, 'notes-b.txt'), 'A file for the second window.\n');
      const [X, Y] = fakeHome.writeThreads(profile.home, folderB, fakeHome.OTHER_THREADS);
      const transcriptIn = (t) => path.join(profile.home, '.claude', 'projects', folderName(folderB), `${t.id}.jsonl`);
      const dataDir = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
      const entries = () => {
        const dir = path.join(dataDir, 'windows');
        let names = [];
        try { names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return []; }
        return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { return null; } }).filter(Boolean);
      };
      /* On Windows VS Code gives a folder with its drive letter in lower case. */
      const sameFolder = (a, b) => (process.platform === 'win32' ? path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase() : a === b);
      const entryOf = (folder) => entries().find((e) => Array.isArray(e.folders) && e.folders.some((f) => sameFolder(f, folder)));
      const processesOf = (t) => {
        const dir = path.join(profile.home, '.claude', 'sessions');
        let names = [];
        try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) { return []; }
        return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { return null; } })
          .filter((d) => d && d.sessionId === t.id && (() => { try { process.kill(d.pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } })())
          .map((d) => d.pid);
      };
      const tabsIn = (folder) => call(`return vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => ({ label: t.label, column: g.viewColumn,
        active: t.isActive && g.isActive, view: (t.input && t.input.viewType) || '', input: t.input ? Object.keys(t.input) : [] })));`, undefined, 60000, folder);
      const tabOf = async (folder, t) => (await tabsIn(folder)).find((x) => x.view === PANEL_VIEW && titled(x.label, t.title));
      /* Whether VS Code counts that window as the focused one. A page's document.hasFocus() does not tell: Playwright
         makes every page it drives report focus. */
      const focused = (folder) => call('return vscode.window.state.focused;', undefined, 60000, folder).catch(() => null);
      /* The title of the window in front. Under xvfb-run there is no window manager, and VS Code then counts a window it
         has focused once as focused for good, so on Linux the X server is asked which window has the input focus
         (lib/xfocus.py); elsewhere it is the window VS Code counts as focused. */
      const frontTitle = async (pages) => {
        if (process.platform === 'linux') {
          const r = require('child_process').spawnSync('python3', [path.join(__dirname, 'lib', 'xfocus.py')], { encoding: 'utf8', env: process.env });
          return (r.stdout || '').trim();
        }
        for (const [p, folder] of pages) if ((await focused(folder)) === true) return p.title();
        return '';
      };
      const before = Date.now();
      await call('await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(arg), { forceNewWindow: true }); return true;', folderB);
      const pageB = await w.pageOf(path.basename(folderB), 90000);
      const hostB = pageB ? await w.hostUp(before, folderB).catch(() => null) : null;
      check(!!pageB && !!hostB, 'a second window of the same VS Code opens on another folder, with the test helper in it',
        { pageB: !!pageB, hosts: fs.readdirSync(profile.control).filter((n) => /^host-/.test(n)) });
      if (!pageB || !hostB) {
        /* Its helper would otherwise take the requests of the steps after this one. */
        if (pageB) await pageB.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+W' : 'Control+Shift+W').catch(() => {});
        return;
      }
      w.pin(profile.folder);
      const shotB = (name) => pageB.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-${name}.png`) }).catch(() => {});
      const inB = (body, arg) => call(body, arg, 60000, folderB);
      try {
        await until(async () => { const st = await call(`const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus'); return !!(mine && mine.isActive);`, undefined, 60000, folderB); return st; }, 60000, 1000);
        await inB('await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar"); return true;');
        await inB(`await vscode.commands.executeCommand('claude-vscode.editor.open', arg); return true;`, X.id);
        const xInB = await until(() => tabOf(folderB, X), 30000, 500);
        const listed = await until(() => { const e = entryOf(folderB); return e && e.sessions.includes(X.id) ? e : null; }, 30000, 500);
        check(!!xInB && !!listed, 'X is open in a tab of the second window, and that window\'s entry among the windows lists it',
          { tab: xInB, entry: entryOf(folderB) });
        const nameB = listed ? listed.name : '';
        /* Window A has a conversation of its own in front, as a steward would be, and the Steward panel open. */
        await exec('claude-vscode.editor.open', threads[0].id);
        const own = await conversation(threads[0], 60000).catch(() => null);
        /* notes-b.txt in front of X in X's own column, so that X's tab is behind another. */
        const coverX = async () => {
          const t = await tabOf(folderB, X);
          await inB(`await vscode.window.showTextDocument(vscode.Uri.file(arg[0]), { preview: false, viewColumn: arg[1] }); return true;`,
            [path.join(folderB, 'notes-b.txt'), t ? t.column : 1]);
        };
        /* Window A is brought to the front the way this extension brings any window there: VS Code's CLI opening the
           folder the window has open, with this VS Code's user data folder. Playwright's bringToFront does not make
           VS Code count a window as focused. */
        const [cliPath] = require('@vscode/test-electron').resolveCliArgsFromVSCodeExecutablePath(exe, { reuseMachineInstall: true });
        const frontWith = (folder) => require('child_process').spawnSync(process.platform === 'win32' ? `"${cliPath}"` : cliPath,
          ['--user-data-dir', profile.user, folder].map((a) => (process.platform === 'win32' ? `"${a}"` : a)),
          { env: process.env, encoding: 'utf8', shell: process.platform === 'win32', timeout: 30000 });
        const workbenches = () => w.browser.contexts().flatMap((c) => c.pages()).filter((x) => /workbench\.html/.test(x.url())).length;
        const both = [[page, profile.folder], [pageB, folderB]];
        /* The X window's own title can lag behind the page's, so the window is known by its folder's name in it. */
        const inFront = async (p) => {
          const [mine] = both.filter(([x]) => x === p), name = path.basename(mine[1]);
          const t = await frontTitle(p === page ? both : [both[1], both[0]]);
          return !!t && (t === await p.title() || t.includes(` - ${name} - `) || t.startsWith(`${name} - `));
        };
        const backToA = async () => {
          await coverX();
          await exec('claude-vscode.editor.open', threads[0].id);
          frontWith(profile.folder);
          return until(async () => (await inFront(page)) && !((await tabOf(folderB, X)) || {}).active, 15000, 300);
        };
        note(`window B's extension host has ${JSON.stringify(Object.keys(await inB('return process.env;')).filter((k) => /^VSCODE_/.test(k)))}`);
        /* What a jump to X looks like: window B in front with X's tab active, and A with no tab of X and no second process. */
        const jumped = async (what) => {
          const ok = await until(async () => {
            const t = await tabOf(folderB, X);
            return t && t.active && (await inFront(pageB));
          }, 20000, 300);
          const seen = { tabInB: await tabOf(folderB, X), front: await frontTitle(both), titleB: await pageB.title(),
            tabInA: await tabOf(profile.folder, X), processes: processesOf(X), windows: workbenches() };
          check(!!ok && !seen.tabInA && seen.processes.length <= 1 && seen.windows === 2,
            `${what}: window B comes to the front with X's tab active, window A opens no copy of X, and no other window opens`, seen);
          return seen;
        };
        const readyA = await backToA();
        check(!!readyA, 'window A is in front before the jump', { front: await frontTitle(both), titleA: await page.title() });
        await exec('workbench.view.extension.claudeCodePlusSteward');
        const steward = await frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
        const rowLink = steward ? await until(() => steward.evaluate((id) => !!document.querySelector(`a.name[data-open="${id}"]`), X.id), 45000, 1000) : false;
        check(!!rowLink, 'the Steward panel in window A lists X, open in window B', steward ? await steward.evaluate(() => document.body.innerText.slice(0, 400)) : 'no Steward panel');
        if (rowLink) {
          await steward.locator(`a.name[data-open="${X.id}"]`).first().click();
          await jumped('clicking X\'s row in the Steward panel');
          await shotB('two-windows-row-jump');
        }
        /* The link a steward gives, clicked in a Claude Code panel's page: the page hands it to the extension itself
           (src/page/93-steward-links.js), as Claude Code drops such links from replies. */
        const clickLink = (frame, id) => frame.evaluate((href) => {
          const a = document.createElement('a');
          a.href = href; a.textContent = 'x';
          document.body.appendChild(a);
          a.click();
          a.remove();
          return true;
        }, `vscode://xnervwang.claude-code-plus/open?session=${id}`);
        if (own) {
          check(!!await backToA(), 'window A is in front again before the link is clicked', { front: await frontTitle(both), titleA: await page.title() });
          await exec('notifications.clearAll');
          await clickLink(own, X.id);
          await jumped('a steward\'s link to X clicked in window A');
          await shotB('two-windows-link-jump');
          /* Y is open in no window. */
          frontWith(profile.folder);
          await exec('notifications.clearAll');
          await clickLink(own, Y.id);
          const said = await until(async () => (await toasts()).find((x) => /not open in any VS Code window/.test(x)) || '', 10000, 300);
          check(said === 'That conversation is not open in any VS Code window on this machine.' && !(await tabOf(profile.folder, Y)) && !(await tabOf(folderB, Y)),
            'a link to a conversation open in no window says so, and opens it nowhere', { said, toasts: await toasts() });
          await shot('two-windows-open-nowhere');
          /* A reply in window A that names X, which runs in window B: the page links its title, and the click goes the
             same way. */
          check(!!await backToA(), 'window A is in front again before a reply names X', { front: await frontTitle(both), titleA: await page.title() });
          const mention = `vscode://xnervwang.claude-code-plus/open?session=${X.id}&source=claude-code`;
          await own.locator('[contenteditable][role="textbox"]').first().click();
          await page.keyboard.type(`Name the conversation ${X.id} titled ${X.title}.`);
          await page.keyboard.press('Enter');
          const named = await until(() => own.evaluate((href) => {
            const last = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop();
            return !!last && /By its short id/.test(last.textContent) && [...last.querySelectorAll('a')].some((a) => a.getAttribute('href') === href);
          }, mention), 60000, 500);
          check(!!named, 'a reply in window A naming X by its title links it, though X is open only in window B');
          if (named) {
            check(!!await backToA(), 'window A is in front before the link is clicked', { front: await frontTitle(both), titleA: await page.title() });
            await exec('notifications.clearAll');
            await own.locator(`[data-testid="assistant-message"] a[href="${mention}"]`).last().click({ timeout: 15000 }).catch(() => {});
            await jumped('X\'s title in a reply, clicked in window A');
            await shotB('two-windows-mention-jump');
          }
          /* A second copy of X under window A's folder, like the one Claude Code leaves when a conversation is
             continued from another folder: window A's session list then shows X, and a click on that row goes to window
             B, where X is open. */
          const copyA = path.join(profile.home, '.claude', 'projects', folderName(profile.folder), `${X.id}.jsonl`);
          const relist = () => call('if (typeof globalThis.__cceSessionsChanged === "function") globalThis.__cceSessionsChanged(); return true;').catch(() => false);
          fs.writeFileSync(copyA, fs.readFileSync(transcriptIn(X), 'utf8').split('\n').map((l) => {
            try { const d = JSON.parse(l); if (d && typeof d.cwd === 'string') d.cwd = profile.folder; return JSON.stringify(d); } catch (_) { return l; }
          }).join('\n'));
          try {
            await relist();
            check(!!await backToA(), 'window A is in front before X\'s row in its session list is clicked', { front: await frontTitle(both), titleA: await page.title() });
            await openList();
            const xRow = () => list.locator(`[id="sessions-list-row-${X.id}"]:not([data-cce-section] *)`).first();
            const shown = list ? await until(async () => (await xRow().count()) > 0, 30000, 500) : false;
            check(!!shown, 'window A\'s session list shows X once a copy of X is kept under A\'s folder',
              list ? await list.evaluate(() => [...document.querySelectorAll('[class*="sessionItem_"][id]')].map((r) => r.id)) : 'no session list');
            if (shown) {
              frontWith(profile.folder);
              await exec('notifications.clearAll');
              await xRow().click({ timeout: 15000 });
              await jumped('X\'s row in window A\'s session list clicked, with a copy of X kept under A\'s folder');
              await shotB('two-windows-list-row-jump');
            }
          } finally {
            fs.rmSync(copyA, { force: true });
            await relist();
          }
        } else note('window A\'s own conversation did not load, so the link was not clicked');

        /* B reloaded with X's tab restored behind another: what each window knows, then a delete from window A. */
        const setLoad = (v) => call(`await vscode.workspace.getConfiguration('claudeCodePlus').update('loadRestoredTabs', arg, vscode.ConfigurationTarget.Global); return true;`, v);
        const reloadB = async () => {
          const at = Date.now();
          await inB('setTimeout(() => vscode.commands.executeCommand("workbench.action.reloadWindow"), 200); return true;');
          await sleep(1500);
          await w.hostUp(at, folderB);
          await until(async () => call(`const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus'); return !!(mine && mine.isActive);`, undefined, 60000, folderB), 60000, 1000);
          return at;
        };
        /* Whether a page of window B shows X's conversation, that is, whether X's tab has loaded. */
        const drawnInB = async () => {
          for (const f of pageB.frames()) {
            try { if (await f.evaluate((t) => !!document.body && document.body.innerText.includes(t), X.turns[0][1])) return true; } catch (_) { /* gone */ }
          }
          return false;
        };
        const known = async (at) => {
          await sleep(12000);
          const e = await until(() => { const x = entryOf(folderB); return x && x.at > at ? x : null; }, 30000, 500);
          return { tab: await tabOf(folderB, X), loaded: await drawnInB(), processes: processesOf(X), entryLists: !!(e && e.sessions.includes(X.id)),
            shownThere: await inB('return typeof globalThis.__cceSessionsShown === "function" ? globalThis.__cceSessionsShown() : null;') };
        };
        await coverX();
        const offAt = await reloadB();
        const off = await known(offAt);
        check(!!off.tab && !off.tab.active && !off.loaded && off.processes.length === 0 && off.entryLists,
          'after a reload of window B, X\'s restored tab behind another has not loaded and has no process, and B\'s entry still lists it', off);
        await shotB('two-windows-restored-unloaded');
        if (own) {
          frontWith(profile.folder);
          await exec('notifications.clearAll');
          await own.evaluate((s) => { acquireVsCodeApi().postMessage({ type: 'cce_delete_sessions', sessions: [s] }); return true; }, { id: X.id, title: X.title });
          const refused = await until(async () => (await toasts()).find((x) => /^Not deleted:/.test(x)) || '', 15000, 300);
          const asked = await dialog();
          check(refused === `Not deleted: "${X.title}" is open in the VS Code window "${nameB}".` && !asked && fs.existsSync(transcriptIn(X)),
            'deleting X from window A, while only window B has it as a tab that has not loaded, deletes nothing and names window B',
            { refused, asked, toasts: await toasts(), transcript: fs.existsSync(transcriptIn(X)) });
          await shot('two-windows-delete-refused');
          if (asked) await answerDialog('Cancel');
        }
        await setLoad(true);
        const onAt = await reloadB();
        const on = await known(onAt);
        check(!!on.tab && on.entryLists, 'with claudeCodePlus.loadRestoredTabs on, B\'s entry lists X after the reload as well', on);
        note(`what the windows knew of X's restored tab: loadRestoredTabs off ${JSON.stringify(off)}; on ${JSON.stringify(on)}`);
        await setLoad(undefined);
      } finally {
        await call('setTimeout(() => vscode.commands.executeCommand("workbench.action.closeWindow"), 200); return true;', undefined, 60000, folderB).catch(() => {});
        await until(async () => !(await w.pageOf(path.basename(folderB), 1000)), 20000, 500);
        w.pin(undefined);
      }
    });

    /* A steward reopens a stored conversation in the window whose first folder is the one Claude Code stores it under,
       and nowhere else. A second window opens a workspace whose folders are R, then this window's own folder A, then Q.
       Conversation Z was started in A and later resumed in R, so its transcript is kept under R's folder of projects
       while its first record still names A: it opens in the second window, and this one starts no new conversation. One
       kept under Q, which no window has first, is refused at once and opens nowhere. */
    await step('a steward reopening a conversation in the window of its folder', async () => {
      const front = threads[0];
      const base = path.dirname(profile.folder);
      for (const d of ['ws-r', 'ws-q']) fs.mkdirSync(path.join(base, d), { recursive: true });
      /* Real paths, as Claude Code names a conversation's folder after the real one: on macOS the temporary folder is
         under a symbolic link, and on Windows it can carry a short name. */
      const [folderR, folderQ] = ['ws-r', 'ws-q'].map((d) => fs.realpathSync.native(path.join(base, d)));
      const Z = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6fc', title: 'Carry the parser work over to the new folder', days: 0,
        turns: [['Carry the parser work over to the new folder.', 'Moved it; the tests pass in the new folder.'], ['Anything left?', 'Only the docs.']] };
      const W = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6fd', title: 'Notes kept in the third folder', days: 0,
        turns: [['Write down the notes for the third folder.', 'Written to notes.md.']] };
      fakeHome.writeThreads(profile.home, folderR, [Z]);
      fakeHome.writeThreads(profile.home, folderQ, [W]);
      const zFile = path.join(profile.home, '.claude', 'projects', folderName(folderR), `${Z.id}.jsonl`);
      const records = fs.readFileSync(zFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const firstAt = records.findIndex((r) => r.cwd);
      records[firstAt].cwd = profile.folder;
      fs.writeFileSync(zFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const workspace = path.join(base, 'resume-b.code-workspace');
      fs.writeFileSync(workspace, JSON.stringify({ folders: [{ path: folderR }, { path: profile.folder }, { path: folderQ }] }, null, 2));
      const dataDir = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
      const hooks = path.join(__dirname, '..', '..', 'claude-plugin', 'agent-work-plan', 'hooks', 'steward-relay.py');
      let calls = 0;
      const act = (args, input) => {
        const line = `python3 ${hooks} ${args.join(' ')}` + (input ? ` <<'EOF'\n${input}\nEOF` : '');
        const answered = fakeHome.appendToolCall(transcriptOf(front), { sessionId: front.id, cwd: profile.folder,
          uuid: `${front.id.slice(0, 24)}${String(880000 + calls++).padStart(12, '0')}`, toolId: `toolu_reopen_${calls}`, command: line, description: 'Act for the user' });
        return new Promise((resolve) => {
          const kid = require('child_process').spawn(process.platform === 'win32' ? 'python' : 'python3', [hooks, ...args, dataDir],
            { env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: front.id }) });
          let said = '';
          kid.stdout.on('data', (d) => { said += d; });
          kid.stderr.on('data', (d) => { said += d; });
          kid.on('error', (e) => resolve('could not run the script: ' + e.message));
          kid.on('exit', () => resolve(said.trim()));
          kid.stdin.end(input || '');
        }).then((said) => { answered(said); return said; });
      };
      /* What this window has before the step: its Claude Code tabs, the transcripts under its folder, and the
         conversations its processes run. */
      const sessionsNow = () => liveRecords().map((r) => r.sessionId);
      const transcriptsOf = (folder) => { try { return fs.readdirSync(path.join(profile.home, '.claude', 'projects', folderName(folder))).sort(); } catch (_) { return []; } };
      /* The steward: the conversation in front, ticking one other in the Steward panel. */
      await exec('claude-vscode.editor.open', front.id);
      await exec('workbench.view.extension.claudeCodePlusSteward');
      const panel = await frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
      const box = panel && await until(async () => { const b = panel.locator('input[data-id]').first(); return (await b.isVisible().catch(() => false)) && b; }, 40000, 1000);
      if (box && !await box.isChecked()) await box.click();
      const before = Date.now();
      await call('await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(arg), { forceNewWindow: true }); return true;', workspace);
      const pageB = await w.pageOf('resume-b', 90000);
      const hostB = pageB ? await w.hostUp(before, folderR).catch(() => null) : null;
      check(!!box && !!pageB && !!hostB, 'a steward in this window, and a second window on a workspace whose first folder is R and whose second is this window\'s folder', { box: !!box, pageB: !!pageB });
      if (!pageB || !hostB) {
        if (pageB) await pageB.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+W' : 'Control+Shift+W').catch(() => {});
        return;
      }
      w.pin(profile.folder);
      try {
        await until(() => call(`const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus'); return !!(mine && mine.isActive);`, undefined, 60000, folderR), 60000, 1000);
        const entryB = await until(() => {
          let names = [];
          try { names = fs.readdirSync(path.join(dataDir, 'windows')).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return null; }
          for (const n of names) {
            try { const e = JSON.parse(fs.readFileSync(path.join(dataDir, 'windows', n), 'utf8')); if (Array.isArray(e.folders) && e.folders.length === 3) return e; } catch (_) { /* being written */ }
          }
          return null;
        }, 60000, 500);
        const tabsA = (await claudeTabs()).length, filesA = transcriptsOf(profile.folder), runningA = sessionsNow();
        const words = 'Carry on with the docs, please.';
        const said = await act(['--resume', Z.id], words);
        const tabB = await until(async () => (await call(`return vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && t.input.viewType === ${JSON.stringify(PANEL_VIEW)})
          .map((t) => t.label);`, undefined, 60000, folderR)).find((l) => titled(l, Z.title)), 60000, 1000);
        const drawn = await until(async () => {
          for (const f of pageB.frames()) { try { if (await f.evaluate((t) => !!document.body && document.body.innerText.includes(t), Z.turns[0][1])) return true; } catch (_) { /* gone */ } }
          return false;
        }, 60000, 1000);
        const sent = await until(() => { try { return fs.readFileSync(zFile, 'utf8').includes(words); } catch (_) { return false; } }, 60000, 1000);
        check(!!entryB && said.startsWith(`Opened: the conversation was opened in an editor tab in the VS Code window "${entryB.name}"`) && !!tabB && !!drawn && !!sent,
          'a conversation started in A and resumed in R opens in the window whose first folder is R; that window shows it, the answer names the window, and the message reaches the conversation',
          { said, entryB: entryB && entryB.name, tabB, drawn: !!drawn, sent: !!sent });
        await shotB();
        const runningAfter = sessionsNow().filter((id) => !runningA.includes(id) && id !== Z.id);
        check((await claudeTabs()).length === tabsA && JSON.stringify(transcriptsOf(profile.folder)) === JSON.stringify(filesA) && !runningAfter.length,
          'and this window, whose first folder is the folder named in the conversation\'s first record, gets no tab, no new conversation and no new transcript',
          { tabs: [tabsA, (await claudeTabs()).length], newTranscripts: transcriptsOf(profile.folder).filter((n) => !filesA.includes(n)), runningAfter });
        const tabsB = (await call(`return vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;`, undefined, 60000, folderR));
        const refused = await act(['--resume', W.id], 'Pick it up again, please.');
        const tabsB2 = (await call(`return vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;`, undefined, 60000, folderR));
        check(refused.startsWith(`Not done: no open VS Code window has its folder, ${folderQ}, as its first folder`)
          && (await claudeTabs()).length === tabsA && tabsB2 === tabsB && !fs.readdirSync(path.join(dataDir, 'relay')).some((n) => /^[0-9a-f-]{36}\.json$/.test(n)),
          'one kept under a folder that a window has open but not first is refused at once, and nothing opens anywhere', { refused, tabsB: [tabsB, tabsB2] });
      } finally {
        await call('setTimeout(() => vscode.commands.executeCommand("workbench.action.closeWindow"), 200); return true;', undefined, 60000, folderR).catch(() => {});
        await until(async () => !(await w.pageOf('resume-b', 1000)), 20000, 500);
        w.pin(undefined);
        if (panel) await panel.locator('button[data-act="none"]').click().catch(() => {});
        await exec('workbench.action.closePanel');
      }
      async function shotB() { await pageB.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-steward-reopen-in-window-b.png`) }).catch(() => {}); }
    });

    /* Two stewards in two windows, one steward for each conversation at most: a steward cannot be ticked by another
       (1), a conversation that becomes a steward leaves the other steward's list (2), a conversation one steward ticked
       is greyed in the other's panel (3), and All is on for one steward only, which takes only what the other has not
       ticked (4). Each greyed control says why in a hover label. */
    await step('several stewards for one conversation', async () => {
      const SA = threads[0], X = threads[1];
      const dataDir = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
      const file = path.join(dataDir, 'stewards.json');
      const table = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).stewards || {}; } catch (_) { return {}; } };
      const has = (s, id) => !!table()[s] && table()[s].manages.includes(id);
      const stewardIn = (p) => until(async () => {
        for (const f of p.frames()) { try { if (await f.evaluate(() => /Managed by/.test(document.body ? document.body.innerText : ''))) return f; } catch (_) { /* gone */ } }
        return null;
      }, 30000, 500);
      /* A box in a panel: whether it is ticked and greyed, and the reason its wrapper gives. */
      const boxIn = (f, id) => f.evaluate((id) => {
        const b = document.querySelector(`input[data-id="${id}"]`);
        const w = b && b.closest('[data-why]');
        return b ? { checked: b.checked, disabled: b.disabled, why: w ? w.dataset.why : '' } : null;
      }, id).catch(() => null);
      const header = (f) => f.evaluate(() => { const b = document.querySelector('.head b'); return b ? b.textContent : ''; }).catch(() => '');
      const eyesIn = (f, id) => f.evaluate((id) => {
        const a = document.querySelector(`li.row a.name[data-open="${id}"]`), li = a && a.closest('li.row'), e = li && li.querySelector('.eyes');
        if (!e) return li ? { none: true, by: !!li.querySelector('.by') } : null;
        const pop = e.querySelector('.pop'), r = pop.getBoundingClientRect(), svg = e.querySelector('svg');
        return { n: e.querySelector('.n').textContent, last: li.lastElementChild === e, shown: r.width > 0 && r.height > 0,
          svg: !!svg && svg.getBoundingClientRect().width > 0, colour: getComputedStyle(e).color, text: getComputedStyle(a).color,
          names: [...pop.querySelectorAll('a[data-open]')].map((x) => ({ name: x.textContent, to: x.dataset.open })), by: !!li.querySelector('.by') };
      }, id).catch(() => null);
      const eyeOf = (id) => `li.row:has(a.name[data-open="${id}"]) .eyes`;

      /* Window B on a folder of its own: Q1 will be the second steward, Q2 a conversation of B's. */
      const folderT = fs.realpathSync.native((() => { const d = path.join(path.dirname(profile.folder), 'ws-t'); fs.mkdirSync(d, { recursive: true }); return d; })());
      const Q1 = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e700', title: 'Watch over the reports work', days: 0,
        turns: [['Watch over the reports work.', 'I will keep an eye on it.']] };
      const Q2 = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e701', title: 'Add totals to the monthly report', days: 0,
        turns: [['Add totals to the monthly report.', 'Added a totals row to report/monthly.sql.']] };
      fakeHome.writeThreads(profile.home, folderT, [Q1, Q2]);
      const before = Date.now();
      await call('await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(arg), { forceNewWindow: true }); return true;', folderT);
      const pageB = await w.pageOf(path.basename(folderT), 90000);
      const hostB = pageB ? await w.hostUp(before, folderT).catch(() => null) : null;
      check(!!pageB && !!hostB, 'a second window, B, opens on a folder of its own', { pageB: !!pageB });
      if (!pageB || !hostB) {
        if (pageB) await pageB.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+W' : 'Control+Shift+W').catch(() => {});
        return;
      }
      w.pin(profile.folder);
      const inB = (body, arg) => call(body, arg, 60000, folderT);
      const shotB = (name) => pageB.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-${name}.png`) }).catch(() => {});
      let panelA = null, panelB = null;
      try {
        await until(() => inB(`const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus'); return !!(mine && mine.isActive);`), 60000, 1000);
        await inB('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', Q2.id);
        await sleep(800);
        await inB('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); await vscode.commands.executeCommand("workbench.view.extension.claudeCodePlusSteward"); return true;', Q1.id);
        /* Window A: X loaded in a tab, SA in front with the Steward panel. */
        await exec('claude-vscode.editor.open', X.id);
        await sleep(800);
        await exec('claude-vscode.editor.open', SA.id);
        await exec('workbench.view.extension.claudeCodePlusSteward');
        panelA = await stewardIn(page);
        panelB = await stewardIn(pageB);
        const listed = panelA && panelB && await until(async () => (await boxIn(panelA, X.id)) && (await boxIn(panelA, Q1.id)) && (await boxIn(panelB, X.id))
          && (await boxIn(panelB, SA.id)) && (await header(panelB)).includes(Q1.title.slice(0, 20))
          && (await header(panelA)).includes(SA.title.slice(0, 20)), 60000, 1000);
        check(!!listed, 'each window\'s Steward panel lists the conversations of both', { a: panelA && await panelA.evaluate(() => document.body.innerText.slice(0, 400)), b: panelB && await panelB.evaluate(() => document.body.innerText.slice(0, 400)) });
        if (!listed) return;

        /* SA ticks X in A's panel; in B's panel X's box stays free, and Q1 ticks it too. */
        await panelA.locator(`input[data-id="${X.id}"]`).first().click();
        const first = await until(() => has(SA.id, X.id), 10000, 300);
        const free = first && await until(async () => { const b = await boxIn(panelB, X.id); return b && !b.disabled && !b.checked && b; }, 20000, 500);
        check(!!first && !!free, 'once one steward ticks a conversation, its box in the other window\'s panel is neither greyed nor ticked', { table: table(), box: free || await boxIn(panelB, X.id) });
        await panelB.locator(`input[data-id="${X.id}"]`).first().click();
        const both = await until(() => has(SA.id, X.id) && has(Q1.id, X.id), 10000, 300);
        /* B's panel draws SA as a steward once its next body arrives, which can come after the table is written. */
        const sa = await until(async () => { const b = await boxIn(panelB, SA.id); return b && b.disabled && b; }, 10000, 300) || await boxIn(panelB, SA.id);
        check(!!both && !!sa && sa.disabled && sa.why === 'This conversation is a steward, and a steward is not managed by another',
          'the second steward ticks it as well, so both lists have it; a steward\'s own box is still greyed in the other\'s panel', { table: table(), sa });

        /* In each panel, X's row ends with an eye and the count 1, for the other steward. */
        const eyeA = await until(async () => { const e = await eyesIn(panelA, X.id); return e && e.n === '1' && e; }, 30000, 500);
        const eyeB = await until(async () => { const e = await eyesIn(panelB, X.id); return e && e.n === '1' && e; }, 30000, 500);
        check(!!eyeA && !!eyeB && eyeA.last && eyeB.last && eyeA.svg && !eyeA.shown && !eyeA.by && !eyeB.by && eyeA.colour !== eyeA.text,
          'in each panel the managed conversation\'s row ends in a light eye with the count 1 for the other steward, and the row itself names no steward', { a: eyeA || await eyesIn(panelA, X.id), b: eyeB || await eyesIn(panelB, X.id) });
        const plain = await until(async () => { const e = await eyesIn(panelA, Q1.id); return e && e; }, 30000, 500);
        check(!!plain && plain.none === true && plain.by === true, 'a steward\'s own row says "a steward" and has no eye', plain);
        await shot('stewards-eye-in-a');

        await panelB.locator(eyeOf(X.id)).first().hover();
        const named = await until(async () => { const e = await eyesIn(panelB, X.id); return e && e.shown && e; }, 5000, 200);
        check(!!named && named.names.length === 1 && named.names[0].to === SA.id && named.names[0].name.includes(SA.title.slice(0, 20)),
          'hovered, the eye in B\'s panel lists the other steward by name', named || await eyesIn(panelB, X.id));
        await shotB('stewards-eye-hover-in-b');
        await panelA.locator(eyeOf(X.id)).first().hover();
        const namedA = await until(async () => { const e = await eyesIn(panelA, X.id); return e && e.shown && e; }, 5000, 200);
        check(!!namedA && namedA.names.length === 1 && namedA.names[0].to === Q1.id,
          'and in A\'s panel it names the steward in B', namedA || await eyesIn(panelA, X.id));

        /* Clicking a name brings that steward's conversation to the front in its window. */
        await exec('claude-vscode.editor.open', X.id);
        await until(async () => (await claudeTabs()).find((t) => t.active && titled(t.label, X.title)), 10000, 300);
        await panelB.locator(eyeOf(X.id)).first().hover();
        await until(async () => { const e = await eyesIn(panelB, X.id); return e && e.shown; }, 5000, 200);
        await panelB.locator(`${eyeOf(X.id)} .pop a[data-open="${SA.id}"]`).first().click();
        const upInA = await until(async () => (await claudeTabs()).find((t) => t.active && titled(t.label.replace(TRAILING_MARKS, ''), SA.title)), 20000, 300);
        const copyInB = (await inB(`return vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && t.input.viewType === ${JSON.stringify(PANEL_VIEW)}).map((t) => t.label);`))
          .some((l) => titled(l.replace(TRAILING_MARKS, ''), SA.title));
        check(!!upInA && !copyInB, 'clicked, the name brings that steward\'s conversation to the front in window A, and opens no copy in B',
          { tabsA: await claudeTabs(), copyInB });

        /* What each steward runs, with its tool call in its own transcript first, and a message the user typed there. */
        const hooks = path.join(__dirname, '..', '..', 'claude-plugin', 'agent-work-plan', 'hooks', 'steward-relay.py');
        const fileOf = (t) => path.join(profile.home, '.claude', 'projects', fakeHome.folderName(t === Q1 || t === Q2 ? folderT : profile.folder), `${t.id}.jsonl`);
        let calls = 0;
        const actAs = (t, args, input) => {
          const line = `python3 ${hooks} ${args.join(' ')}` + (input ? ` <<'EOF'\n${input}\nEOF` : '');
          const answered = fakeHome.appendToolCall(fileOf(t), { sessionId: t.id, cwd: t === Q1 ? folderT : profile.folder,
            uuid: `${t.id.slice(0, 24)}${String(860000 + calls++).padStart(12, '0')}`, toolId: `toolu_many_${calls}`, command: line, description: 'Act for the user' });
          return new Promise((resolve) => {
            const kid = require('child_process').spawn(process.platform === 'win32' ? 'python' : 'python3', [hooks, ...args, dataDir],
              { env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: t.id }) });
            let out = '';
            kid.stdout.on('data', (d) => { out += d; });
            kid.stderr.on('data', (d) => { out += d; });
            kid.on('error', (e) => resolve('could not run the script: ' + e.message));
            kid.on('exit', () => resolve(out.trim()));
            kid.stdin.end(input || '');
          }).then((said) => { answered(said); return said; });
        };
        /* A message in the transcript, after its last entry: Claude Code opens a conversation along that chain, so one
           with no parent would hide the turns before it the next time the conversation opens. */
        const lastUuid = (t) => {
          for (const l of fs.readFileSync(fileOf(t), 'utf8').split('\n').reverse()) {
            try { const r = JSON.parse(l); if ((r.type === 'user' || r.type === 'assistant') && r.uuid) return r.uuid; } catch (_) { /* not an entry */ }
          }
          return null;
        };
        const userSays = (t, text, from) => fs.appendFileSync(fileOf(t), JSON.stringify({ parentUuid: lastUuid(t), sessionId: t.id, cwd: profile.folder, isSidechain: false, type: 'user',
          uuid: `${t.id.slice(0, 24)}${String(870000 + calls++).padStart(12, '0')}`, timestamp: new Date().toISOString(), permissionMode: 'default',
          promptSource: from ? 'system' : 'user', origin: { kind: from || 'human' }, message: { role: 'user', content: text } }) + '\n');
        const inX = (text) => { try { return fs.readFileSync(fileOf(X), 'utf8').includes(JSON.stringify(text).slice(1, -1)); } catch (_) { return false; } };

        /* Two stewards' messages to one conversation: the second is held back while the first is recent, and sent with --anyway. */
        const first2 = 'Please keep the totals query as it is.', second2 = 'Please rewrite the totals query.';
        const sentA = await actAs(SA, [X.id], first2);
        const arrivedA = /^Sent: /.test(sentA) && await until(() => inX(first2), 30000, 500);
        const held = await actAs(Q1, [X.id], second2);
        const forced = /^Not sent: another steward sent this conversation a message in the last 30 minutes/.test(held) ? await actAs(Q1, ['--anyway', X.id], second2) : '';
        const arrivedB = /^Sent: /.test(forced) && await until(() => inX(second2), 30000, 500);
        const signed = arrivedB && fs.readFileSync(fileOf(X), 'utf8').includes(JSON.stringify(`Sent by the steward "${Q1.title}" (${Q1.id}) for the user:\n${second2}`).slice(1, -1));
        check(!!arrivedA && held.includes(`"${SA.title}" (${SA.id})`) && held.includes(first2) && /--anyway/.test(held) && !!arrivedB && !!signed,
          'a steward\'s message to a conversation that another steward messaged a moment ago is held back, showing the earlier message and who sent it; '
          + '--anyway sends it, after the line that names its sender', { sentA, held, forced });

        /* A handoff with --to goes to the steward it names, not to the one whose message started the turn. */
        const moved = 'The user asked here for the release notes, which belong in another conversation.';
        const handed = await actAs(X, ['--handoff', '--to', SA.id], moved);
        /* On native Windows no handoff reaches a steward's inbox: the answer names the steward --to gave as
           unreachable, and no other steward is tried. */
        const gotA = process.platform === 'win32'
          ? /^Not done: no steward of this conversation could be reached/.test(handed) && handed.includes(SA.id) && !handed.includes(Q1.id)
          : handed.startsWith('Handed off to the steward ') && handed.includes(`(${SA.id})`)
            && await until(() => { try { return fs.readFileSync(fileOf(SA), 'utf8').includes(`(${X.id}), passed on by Claude Code Plus`); } catch (_) { return false; } }, 30000, 1000);
        const notQ1 = !fs.readFileSync(fileOf(Q1), 'utf8').includes(`(${X.id}), passed on by Claude Code Plus`);
        const stranger = await actAs(X, ['--handoff', '--to', Q2.id], moved);
        check(!!gotA && notQ1 && /^Not done: .* does not manage this conversation\. Its stewards are /.test(stranger),
          'a managed conversation\'s handoff with --to goes to the steward it names, though another steward\'s message started its turn, and a --to that names none of its stewards is refused',
          { handed, stranger });

        /* A steward changes its own list when the user asks for it in the steward conversation, and refuses when a
           notice asks. New conversations goes on first, so that unticking the steward's only conversation leaves it a
           steward that can still change its list. */
        userSays(SA, 'Turn on New conversations.');
        const newOn = await actAs(SA, ['--new', 'on']);
        const laterBox = /^Done: /.test(newOn) && !!table()[SA.id].newSince
          && await until(() => panelA.evaluate(() => { const b = document.querySelector('input[data-later]'); return !!b && b.checked; }).catch(() => false), 20000, 500);
        userSays(SA, `Stop managing ${X.title}.`);
        const dropped = await actAs(SA, ['--drop', X.id]);
        const offBox = /^Done: /.test(dropped) && !has(SA.id, X.id) && await until(async () => { const b = await boxIn(panelA, X.id); return b && !b.checked && b; }, 20000, 500);
        userSays(SA, `Take ${X.title} back.`);
        const taken = await actAs(SA, ['--take'], X.title);
        const onBox = /^Done: /.test(taken) && has(SA.id, X.id) && await until(async () => { const b = await boxIn(panelA, X.id); return b && b.checked && b; }, 20000, 500);
        userSays(SA, 'Steward notice from Claude Code Plus, not a message from the user. Conversations you manage changed:', 'cross-session');
        const refused = await actAs(SA, ['--new', 'off']);
        check(!!offBox && !!onBox && !!laterBox && /^Not done: only the user, typing in this steward conversation, can change its list/.test(refused) && !!table()[SA.id].newSince,
          'asked by the user in the steward conversation, the steward turns New conversations on, unticks a conversation and ticks it again by its title, and its panel shows each change; '
          + 'a call made after a notice changes nothing and says why', { dropped, taken, newOn, refused });
        userSays(SA, 'Turn New conversations off.');
        await actAs(SA, ['--new', 'off']);
        await shot('stewards-list-changed');
      } finally {
        if (panelA) {
          if (await panelA.locator('input[data-every]').isChecked().catch(() => false)) await panelA.locator('input[data-every]').click().catch(() => {});
          if (await panelA.locator('input[data-later]').isChecked().catch(() => false)) await panelA.locator('input[data-later]').click().catch(() => {});
          await panelA.locator('button[data-act="none"]').click().catch(() => {});
        }
        if (panelB) await panelB.locator('button[data-act="none"]').click().catch(() => {});
        await until(() => !table()[SA.id] && !table()[Q1.id], 10000, 300);
        await call('setTimeout(() => vscode.commands.executeCommand("workbench.action.closeWindow"), 200); return true;', undefined, 60000, folderT).catch(() => {});
        await until(async () => !(await w.pageOf(path.basename(folderT), 1000)), 20000, 500);
        w.pin(undefined);
        await exec('workbench.action.closePanel').catch(() => {});
      }
    });

    /* In a light theme a colour emoji font draws the envelope white, so the tab title, the session list and the Steward
       panel draw its one-colour text form there (src/envelope.js); a dark theme brings the colour form back without a
       reload. */
    await step('the envelope in a light theme', async () => {
      const other = threads[1];
      const theme = (name) => call('await vscode.workspace.getConfiguration().update("workbench.colorTheme", arg, vscode.ConfigurationTarget.Global); return true;', name);
      const kind = () => call('return vscode.window.activeColorTheme.kind;');
      const tabEnds = (form) => until(async () => (await claudeTabs()).find((x) => x.label.endsWith(form) && titled(x.label.replace(form, ''), tab0.title)), 30000, 500);
      /* For each of the conversation's rows in the session list, the character its envelope is drawn with. */
      const listForms = () => list.evaluate((id) => [...document.querySelectorAll('[class*="sessionItem_"]')]
        .filter((r) => (r.closest('[data-cce-open-sessions]') && r.id.endsWith(id)) || (!r.closest('[data-cce-section]') && r.querySelector(`[data-cce-pin="${id}"]`)))
        .map((r) => { const e = r.querySelector('[data-cce-envelope]'); return e ? getComputedStyle(e, '::after').content : null; }), tab0.id).catch(() => []);
      const listIn = (form) => until(async () => { const f = await listForms(); return f.length === 2 && f.every((x) => x === `"${form.trim()}"`) && f; }, 15000, 500);
      let steward = null;
      /* The envelope on the conversation's row in the Steward panel, '' for a row without one. */
      const panelForm = () => steward.evaluate((id) => {
        const a = document.querySelector(`a.name[data-open="${id}"]`), row = a && a.closest('li'), e = row && row.querySelector('.env');
        return e ? e.textContent : row ? '' : null;
      }, tab0.id).catch(() => null);
      await exec('workbench.action.closeAllEditors');
      await exec('workbench.action.closeAuxiliaryBar');
      try {
        await theme('Default Light Modern');
        check(!!await until(async () => (await kind()) === 1, 15000, 300), 'VS Code takes Default Light Modern', await kind());
        await exec('claude-vscode.editor.open', tab0.id);
        const frame = await conversation(tab0, 60000);
        if (!frame) throw new Error('the conversation did not open');
        /* A reply that lands while another conversation is in front, so the Steward panel shows that other one. */
        model.hold();
        const turns = model.turns();
        try {
          await frame.locator('[contenteditable][role="textbox"]').first().click();
          await page.keyboard.type('And the light theme?');
          await page.keyboard.press('Enter');
          await until(() => model.turns() > turns, 30000, 300);
          await exec('claude-vscode.editor.open', other.id);
          await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, other.title)), 20000, 300);
        } finally { model.release(); }
        const lit = await tabEnds(ENVELOPE_TEXT);
        check(!!lit, 'a reply that lands with the tab in the background ends its title in the envelope\'s text form', await claudeTabs());
        /* A reload in an earlier step replaced the list's page, so the list is opened again. */
        check(!!await openList(), 'the session list opens', null);
        const rows = await listIn(ENVELOPE_TEXT);
        check(!!rows, 'and both its rows in the session list draw the envelope in that form', await listForms());
        await exec('workbench.view.extension.claudeCodePlusSteward');
        steward = await frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
        /* Running conversations come from `claude agents --json`, which is read at most every 30 s. */
        const panel = steward ? await until(async () => (await panelForm()) === ENVELOPE_TEXT.trim(), 45000, 1000) : false;
        check(!!panel, 'and so does its row in the Steward panel', steward ? await panelForm() : 'no Steward panel');
        await page.mouse.move(5, 880);
        await shot('light-envelope');
        await theme('Default Dark Modern');
        check(!!await until(async () => (await kind()) === 2, 15000, 300), 'back in Default Dark Modern', await kind());
        const darkTab = await tabEnds(ENVELOPE);
        const darkRows = await listIn(ENVELOPE);
        const darkPanel = steward ? await until(async () => (await panelForm()) === ENVELOPE.trim(), 20000, 500) : false;
        check(!!darkTab && !!darkRows && !!darkPanel, 'the tab, the session list and the Steward panel draw the colour form again, without a reload',
          { tabs: await claudeTabs(), list: await listForms(), panel: steward ? await panelForm() : null });
        await shot('dark-envelope-again');
      } finally {
        model.release();
        await theme('Default Dark Modern').catch(() => {});
        await exec('workbench.action.closePanel').catch(() => {});
      }
    });

    /* A steward whose stored name still ends in the bell an older build of this extension put after a title: everything
       Agent Plus draws of it - the notice, the count's hover, the list of the conversations that need you, the
       Conversations view - names it with the crown after the name and no bell (src/claude-source.js, src/title-marks.js). */
    await step('a steward named with the old bell', async () => {
      const BELL = '\u{1F6CE}', CROWN = '\u{1F451}';
      const S = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6f7', title: 'Many conversations', days: 0,
        turns: [['Look after the other conversations, please.', 'I will keep an eye on them.']] };
      const named = { title: `${S.title} ${CROWN}` };
      const stored = `${S.title} ${BELL}\uFE0F`;
      const dataDir = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
      const table = path.join(dataDir, 'stewards.json'), plan = path.join(dataDir, `${S.id}.json`);
      const had = fs.existsSync(table) ? fs.readFileSync(table, 'utf8') : null;
      const managed = threads[2];
      fakeHome.writeThreads(profile.home, profile.folder, [S]);
      fs.appendFileSync(transcriptOf(S), JSON.stringify({ type: 'custom-title', customTitle: stored, sessionId: S.id }) + '\n');
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(table, JSON.stringify({ version: 1, stewards: { [S.id]: { manages: [managed.id], names: { [managed.id]: managed.title }, at: Date.now() } } }, null, 1) + '\n');
      const sessions = path.join(profile.home, '.claude', 'sessions');
      const recordOf = (id) => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === id) return { file: path.join(sessions, n), d }; } catch (_) { /* being written */ }
        }
        return null;
      };
      const bells = (x) => JSON.stringify(x === undefined ? null : x).includes(BELL);
      try {
        await exec('workbench.action.closeAllEditors');
        await exec('workbench.action.closeAuxiliaryBar');
        await exec('claude-vscode.editor.open', S.id);
        check(!!await conversation(S, 60000), 'the steward\'s conversation opens in a tab', await tabs());
        /* Its process's record holds the stored name too. */
        const rec = await until(() => recordOf(S.id), 30000, 500);
        if (rec && !String(rec.d.name || '').includes(BELL)) fs.writeFileSync(rec.file, JSON.stringify(Object.assign({}, rec.d, { name: stored })));
        await exec('claude-vscode.editor.open', tab0.id);
        await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, tab0.title)), 20000, 300);
        check(await focusWindow(), 'the window has the focus, which Agent Plus needs before it shows a notice', { focused: await focused() });
        await exec('notifications.clearAll');
        const now = new Date().toISOString();
        fs.writeFileSync(plan, JSON.stringify({ nodes: [{ title: 'Pick which conversation goes first', state: 'waiting', waitingOn: 'user',
          question: 'Which one first?', asked: now, opened: now, since: now }] }, null, 2));
        /* Agent Plus learns of running conversations from `claude agents --json`, which is read at most every 30 s. The
           steward's tab is behind the other in the window with the focus, so an Agent Plus with 'waitingFor' shows no
           notice of it there, and its name is read from the hover of its count. */
        if (apWaits) {
          const seen = await until(async () => { const c = await needCount(); return c && c.n >= 1 && c; }, 60000, 300);
          const none = seen ? await noticesWithin(named) : null;
          check(!!seen && !none.length && !bells(await needNotices()), 'Agent Plus counts the waiting steward, and the window where its tab is open shows no notice of it',
            { count: seen || await needCount(), notices: none, record: recordOf(S.id) });
        } else {
          const told = await until(() => noticeOf(named), 60000, 250) || (await listedNotices()).find(about(named));
          const all = await needNotices();
          check(!!told && told.text === `"${named.title}" is waiting for you.` && !bells(all),
            'Agent Plus\'s notice names the steward with the crown after the name and no bell', { notice: told, toasts: all, listed: told ? undefined : await listedNotices(), record: recordOf(S.id) });
        }
        await shot('steward-old-bell-notice');
        await exec('notifications.clearAll');
        const counted = await until(async () => { const c = await needCount(); return c && c.n >= 1 && c; }, 15000, 300);
        const tip = counted ? await hoverText(await needEntry()) : '';
        const waits = tip.indexOf(WAITS_HEAD);
        check(!!counted && waits >= 0 && tip.slice(waits).includes(named.title) && !tip.includes(BELL),
          'the hover of the status bar count lists it by the same name', { count: counted, hover: tip, why: hoverWhy });
        await start('agentPlus.showAttention');
        const picks = await until(() => page.evaluate(() => {
          const q = document.querySelector('.quick-input-widget');
          if (!q || !q.offsetParent) return null;
          const rows = [...q.querySelectorAll('.monaco-list-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
          return rows.length ? rows : null;
        }), 10000, 300);
        await shot('steward-old-bell-list');
        await page.keyboard.press('Escape');
        check(!!picks && picks.some((r) => r.startsWith(named.title)) && !bells(picks), 'and so does the list of the conversations that need you', picks);
        await exec('agentPlus.showConversations');
        /* The Conversations view learns of a running conversation through `claude agents --json`, which a window reads
           at most every 30 s and may take from another window's list up to 20 s old, while the notice and the count
           above can come from the panel at once. */
        const rows = await until(() => page.evaluate((t) => {
          const panel = document.getElementById('workbench.parts.panel');
          const all = panel ? [...panel.querySelectorAll('.monaco-list-row')].map((r) => (r.innerText || r.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()) : [];
          return all.some((r) => r.includes(t)) ? all : null;
        }, S.title), SEEN_MS + 30000, 1000);
        await shot('steward-old-bell-conversations');
        check(!!rows && rows.some((r) => r.startsWith(named.title)) && !bells(rows), 'and so does Agent Plus\'s Conversations view', rows);
      } finally {
        fs.rmSync(plan, { force: true });
        if (had !== null) fs.writeFileSync(table, had); else fs.rmSync(table, { force: true });
        await exec('notifications.clearAll').catch(() => {});
        await exec('workbench.action.closePanel').catch(() => {});
        await exec('workbench.action.closeAllEditors').catch(() => {});
      }
    });

    /* A conversation of a second window starts to wait for the user while the first window has the focus: only the
       window with the focus shows Agent Plus's notice, and both count it. */
    await step('a notice in the window with the focus', async () => {
      const folderC = path.join(path.dirname(profile.folder), 'ws-c');
      fs.mkdirSync(folderC, { recursive: true });
      fs.writeFileSync(path.join(folderC, 'notes-c.txt'), 'A file for the third folder.\n');
      const Z = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6f8', title: 'Check the backup job of the reports database', days: 0,
        turns: [['Check the backup job of the reports database.', 'It ran at 02:00 and wrote 3.1 GB to the backup bucket.']] };
      fakeHome.writeThreads(profile.home, folderC, [Z]);
      const plan = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', `${Z.id}.json`);
      const before = Date.now();
      await call('await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(arg), { forceNewWindow: true }); return true;', folderC);
      const pageC = await w.pageOf(path.basename(folderC), 90000);
      const hostC = pageC ? await w.hostUp(before, folderC).catch(() => null) : null;
      check(!!pageC && !!hostC, 'a second window opens on another folder, with the test helper in it', { page: !!pageC });
      if (!pageC || !hostC) {
        if (pageC) await pageC.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+W' : 'Control+Shift+W').catch(() => {});
        return;
      }
      /* With two windows open, a request that names no folder goes to the first one. */
      w.pin(profile.folder);
      const inC = (body, arg) => call(body, arg, 60000, folderC);
      try {
        await until(() => inC('const mine = vscode.extensions.getExtension("xnervwang.claude-code-plus"); return !!(mine && mine.isActive);'), 60000, 1000);
        await inC('await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar"); return true;');
        await inC('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', Z.id);
        const zLoaded = await until(async () => {
          for (const f of pageC.frames()) { try { if (await f.evaluate((t) => !!document.body && document.body.innerText.includes(t), Z.turns[0][1])) return true; } catch (_) { /* gone */ } }
          return false;
        }, 60000, 1000);
        check(!!zLoaded, 'the second window shows a conversation of its folder in a tab', null);
        /* Behind a text file in its own column, so no window shows it in front. */
        await inC('await vscode.window.showTextDocument(vscode.Uri.file(arg), { preview: false, viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn }); return true;',
          path.join(folderC, 'notes-c.txt'));
        /* The first window's own conversation loaded first, as the two-window step has it before it brings that window
           forward; a second try if VS Code still counts the other as focused. */
        await exec('claude-vscode.editor.open', tab0.id);
        await conversation(tab0, 60000).catch(() => null);
        for (let i = 0; i < 2 && (await focused()) !== true; i++) {
          win.frontWindow(exe, profile.user, profile.folder, process.env);
          await until(async () => (await focused()) === true && (await focused(folderC)) !== true, 15000, 300);
        }
        /* Which windows VS Code counts as focused. Under xvfb-run, and on the CI's macOS and Windows runners, a window it has
           counted as focused once can stay so, and the window opened last took the focus when it opened. */
        const wins = [{ name: 'first', p: page, folder: undefined, focused: await focused() }, { name: 'second', p: pageC, folder: folderC, focused: await focused(folderC) }];
        if (!(wins[0].focused === true && wins[1].focused !== true)) {
          note(`bringing the first window forward left VS Code counting ${JSON.stringify(wins.map((x) => [x.name, x.focused]))} as focused, so each window is held to that`);
        }
        await exec('notifications.clearAll');
        await inC('await vscode.commands.executeCommand("notifications.clearAll"); return true;');
        const now = new Date().toISOString();
        fs.writeFileSync(plan, JSON.stringify({ nodes: [{ title: 'Pick the retention period', state: 'waiting', waitingOn: 'user',
          question: 'Keep 7 or 30 days?', asked: now, opened: now, since: now }] }, null, 2));
        /* `claude agents --json` is read at most every 30 s, as above; both counts showing means Agent Plus has the
           conversation waiting. */
        const counts = await until(async () => { const a = await needCount(), c = await needCount(pageC); return a && c && a.n === 1 && c.n === 1 && [a, c]; }, SEEN_MS, 300);
        check(!!counts, 'both windows count the waiting conversation in the status bar', [await needCount(), await needCount(pageC)]);
        const shows = wins.filter((x) => x.focused === true), quiet = wins.filter((x) => x.focused !== true);
        /* The second window shows the conversation, so an Agent Plus with 'waitingFor' shows no notice there whatever VS
           Code says of its focus, and names the plan's question in the first. */
        const said = apWaits ? `"${Z.title}" has a question for you in its plan.` : `"${Z.title}" is waiting for you.`;
        for (const x of shows) {
          if (apWaits && x.name === 'second') continue;
          const told = await until(() => noticeOf(Z, x.p), 20000, 250) || (await listedNotices(x.p, x.folder)).find(about(Z));
          check(!!told && told.text === said, `the ${x.name} window, which VS Code counts as focused, shows Agent Plus's notice of it`,
            told || { toasts: await needNotices(x.p), agentPlus: attentionOf(Z.id) });
        }
        if (apWaits) quiet.push(...shows.filter((x) => x.name === 'second'));
        await shot('notice-in-focused-window');
        for (const x of quiet) {
          const there = counts ? await noticesWithin(Z, 'waiting', x.p, x.folder) : null;
          check(!!counts && !there.length, `the ${x.name} window shows none, as VS Code does not count it as focused`, { there });
        }
      } finally {
        fs.rmSync(plan, { force: true });
        await exec('notifications.clearAll').catch(() => {});
        await call('setTimeout(() => vscode.commands.executeCommand("workbench.action.closeWindow"), 200); return true;', undefined, 60000, folderC).catch(() => {});
        await until(async () => !(await w.pageOf(path.basename(folderC), 1000)), 20000, 500);
        w.pin(undefined);
      }
    });

    /* What a conversation waits for, in Agent Plus's notices, which take the place of Claude Code's own
       (src/waiting-for.js and Agent Plus's src/attention.js). A permission prompt in a tab hidden behind another
       editor, in the window with the focus, gives no notice at all, only the red dot and the count; with Agent Plus's
       waiting notices off, Claude Code's own notice comes back. In a second window, a permission prompt and a question
       each give one Agent Plus notice in the window with the focus, naming the tool or saying it is a question, and
       none from Claude Code in either window; Open brings the second window forward with the prompt on screen. When
       both start to wait at once, each gets its own notice, and Open on each brings its own conversation forward. What
       starts to wait while no window has the focus is shown once, a notice for each conversation, in the first window
       to get the focus, and the other then shows nothing more. The step itself tells Agent Plus which window has the
       focus (testFocus). With an Agent Plus without 'waitingFor', only Claude Code's own notice is checked, which
       stays. */
    await step('notices of what a conversation waits for', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const setNotify = (k, v) => call(`await vscode.workspace.getConfiguration('agentPlus').update(arg[0], arg[1] === null ? undefined : arg[1],
        vscode.ConfigurationTarget.Global); return true;`, [`notifications.${k}`, v]);
      const ASK_TEXT = /Allow this bash command\?/;
      const BASH_NOTICE = 'Claude is requesting permission to use Bash';
      const say = async (frame, p, text) => {
        await frame.locator('[contenteditable][role="textbox"]').first().click();
        await p.keyboard.type(text);
        await p.keyboard.press('Enter');
      };
      /* Answers No on the permission prompt in `frame` and waits for the prompt to go. A notice at the bottom right can
         lie over the panel's buttons, so the caller clears them first. */
      const refuse = async (frame) => {
        await frame.locator('button, [role="button"]').filter({ hasText: /^\s*3\s*No\s*$/ }).first().click({ timeout: 5000 });
        return until(() => frame.evaluate((re) => !new RegExp(re).test(document.body.innerText), ASK_TEXT.source), 15000, 500);
      };
      await exec('claude-vscode.editor.open', tab0.id);
      const t = await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label.replace(ENVELOPE, ''), tab0.title)), 20000, 300);
      if (!t) throw new Error('the conversation\'s tab did not come to the front');
      /* The steps before reload the window, and the page the conversation had then is gone. */
      const cv = await conversation(tab0, 60000);
      if (!cv) throw new Error('the conversation\'s page did not load');
      const hidden = async () => { await openNotes(t.column); return until(async () => { const x = (await claudeTabs()).find((y) => titled(y.label.replace(ENVELOPE, ''), tab0.title)); return x && !x.active; }, 5000, 200); };
      const front = async () => { await page.locator('.tabs-container .tab').filter({ hasText: t.label.slice(0, 16) }).first().click(); return until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label.replace(ENVELOPE, ''), tab0.title)), 10000, 200); };
      /* A permission prompt in the conversation of the first window while its tab is behind notes.txt. */
      const askBehind = async () => {
        const before = model.seen.length;
        model.hold();
        try {
          await say(cv, page, `Please ${ASK_TO_RUN}.`);
          await until(() => model.seen.length > before, 30000, 300);
          await hidden();
        } finally { model.release(); }
        const asked = await until(() => cv.evaluate((re) => new RegExp(re).test(document.body.innerText), ASK_TEXT.source), 30000, 500);
        const red = asked && await until(async () => { const d = await dotsOn(t.label); return d && d.waiting >= 6 && d; }, 20000, 500);
        return { asked, red };
      };
      try {
        await testFocus(true);
        await exec('notifications.clearAll');
        if (apWaits) {
          const told = await until(async () => (await waitsLeft(cv)) === true, 20000, 300);
          check(told, 'the conversation\'s page knows that Agent Plus, not Claude Code, shows the notices of waits', { page: await waitsLeft(cv) });
        }
        const one = await askBehind();
        const counted = one.red && await until(async () => { const c = await needCount(); return c && c.n === 1 && c; }, SEEN_MS, 300);
        if (apWaits) {
          const none = counted ? await noticesWithin(tab0) : null;
          const cc = await ccWaitNotices();
          check(!!one.red && !!counted && !none.length && !cc.length,
            'a permission prompt in a tab hidden behind another editor, in the window with the focus, gives no notice from Agent Plus or Claude Code; its dot is red, and Agent Plus counts it',
            { asked: one.asked, red: one.red, count: counted || await needCount(), agentPlus: none, claudeCode: cc });
        } else {
          const cc = await until(async () => (await ccWaitNotices()).find((n) => ccText(n.text).startsWith(BASH_NOTICE)), 20000, 300);
          check(!!one.red && !!cc, 'with an Agent Plus that does not name what a conversation waits for, Claude Code\'s own notice of a permission prompt in a tab behind another editor stays',
            { red: one.red, claudeCode: await ccWaitNotices() });
        }
        await shot('wait-notices-same-window');
        await exec('notifications.clearAll');
        await front();
        await refuse(cv);
        await until(async () => { const d = await dotsOn(t.label); return d && d.waiting === 0 && d; }, 30000, 500);
        await exec('notifications.clearAll');
        if (!apWaits) return;

        /* Agent Plus's waiting notices off: Claude Code's own notice is back. */
        await setNotify('waiting', false);
        try {
          const back = await until(async () => (await waitsLeft(cv)) === false, 20000, 300);
          const two = await askBehind();
          const cc = two.red ? await until(async () => (await ccWaitNotices()).find((n) => ccText(n.text).startsWith(BASH_NOTICE)), 20000, 300) : null;
          const none = await needNotices();
          check(back && !!cc && !none.some(about(tab0)), 'with agentPlus.notifications.waiting off, Claude Code\'s own notice of the permission prompt comes back, and Agent Plus shows none',
            { page: await waitsLeft(cv), claudeCode: cc || await ccWaitNotices(), agentPlus: none });
          await shot('wait-notices-claude-code-back');
          await exec('notifications.clearAll');
          await front();
          await refuse(cv);
          await until(async () => { const d = await dotsOn(t.label); return d && d.waiting === 0 && d; }, 30000, 500);
        } finally {
          await setNotify('waiting', null);
          await exec('notifications.clearAll');
        }
        await until(async () => (await waitsLeft(cv)) === true, 20000, 300);

        /* A second window, with two conversations of its folder. */
        const folderD = path.join(path.dirname(profile.folder), 'ws-d');
        fs.mkdirSync(folderD, { recursive: true });
        fs.writeFileSync(path.join(folderD, 'notes-d.txt'), 'A file for the fourth folder.\n');
        const Z = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6f9', title: 'Rotate the signing keys of the release bucket', days: 0,
          turns: [['Rotate the signing keys of the release bucket.', 'The new keys are in place; the old ones expire in a week.']] };
        const Y = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6e9', title: 'Choose the config the nightly import reads', days: 0,
          turns: [['Choose the config the nightly import reads.', 'It reads config/import.yml by default.']] };
        fakeHome.writeThreads(profile.home, folderD, [Z, Y]);
        const started = Date.now();
        await call('await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(arg), { forceNewWindow: true }); return true;', folderD);
        const pageD = await w.pageOf(path.basename(folderD), 90000);
        const hostD = pageD ? await w.hostUp(started, folderD).catch(() => null) : null;
        check(!!pageD && !!hostD, 'a second window opens on another folder, with the test helper in it', { page: !!pageD });
        if (!pageD || !hostD) return;
        w.pin(profile.folder);
        const inD = (body, arg) => call(body, arg, 60000, folderD);
        const frameOf = (c) => until(async () => {
          for (const f of pageD.frames()) { try { if (await f.evaluate((x) => !!document.body && document.body.innerText.includes(x), c.turns[0][1])) return f; } catch (_) { /* gone */ } }
          return null;
        }, 60000, 1000);
        const openIn = async (c) => { await inD('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', c.id); return frameOf(c); };
        const behindD = () => inD('await vscode.window.showTextDocument(vscode.Uri.file(arg), { preview: false, viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn }); return true;',
          path.join(folderD, 'notes-d.txt'));
        /* A message to `c` in the second window, with its tab behind notes-d.txt by the time the agent answers; resolves
           once the page shows text matching `shows`. */
        const sendBehind = async (c, frame, text, shows) => {
          const before = model.seen.length;
          model.hold();
          try {
            await inD('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', c.id);
            await sleep(800);
            await say(frame, pageD, text);
            await until(() => model.seen.length > before, 30000, 300);
            await behindD();
          } finally { model.release(); }
          return until(() => frame.evaluate((re) => new RegExp(re).test(document.body.innerText), shows.source).catch(() => false), 30000, 500);
        };
        const askedBash = (frame) => until(() => frame.evaluate((re) => new RegExp(re).test(document.body.innerText), ASK_TEXT.source).catch(() => false), 30000, 500);
        const askedChoice = (frame) => until(() => frame.evaluate((q) => document.body.innerText.includes(q), CHOICE.question).catch(() => false), 30000, 500);
        const answerChoice = async (frame) => {
          await inD('await vscode.commands.executeCommand("notifications.clearAll"); return true;');
          await inD('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', Y.id);
          await sleep(800);
          await frame.getByText(CHOICE.options[0], { exact: true }).last().click({ timeout: 5000 }).catch(() => {});
          if (await askedChoice(frame).catch(() => false)) await frame.getByText(/Submit answers\s*$/).last().click({ timeout: 5000 }).catch(() => {});
          return until(() => frame.evaluate((q) => !document.body.innerText.includes(q) || !/Esc to cancel/.test(document.body.innerText), CHOICE.question).catch(() => false), 20000, 500);
        };
        const refuseIn = async (c, frame) => {
          await inD('await vscode.commands.executeCommand("notifications.clearAll"); return true;');
          await inD('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', c.id);
          await sleep(800);
          return refuse(frame);
        };
        /* After Open on a notice about `c`: once the second window's tab in front is `c`'s and `frame` shows text
           matching `shows`, the label of that tab and which window is in front. */
        const forward = async (c, frame, shows) => {
          const tab = await until(async () => {
            const label = await inD('const t = vscode.window.tabGroups.activeTabGroup.activeTab; return t ? t.label : "";');
            const onScreen = await frame.evaluate((re) => document.visibilityState === 'visible' && new RegExp(re).test(document.body.innerText), shows.source).catch(() => false);
            return titled(label, c.title) && onScreen && label;
          }, 20000, 500);
          let ahead = '';
          if (process.platform === 'linux') {
            const r = require('child_process').spawnSync('python3', [path.join(__dirname, 'lib', 'xfocus.py')], { encoding: 'utf8', env: process.env });
            ahead = (r.stdout || '').trim();
          } else ahead = (await focused(folderD)) === true ? path.basename(folderD) : '';
          return { tab, ahead };
        };
        /* Messages to each of `asks` ([conversation, frame, text]) in the second window, whose replies are held until all
           are sent, so that the conversations start to wait at once, with their tabs behind notes-d.txt by then. */
        const sendAllBehind = async (asks) => {
          model.hold();
          try {
            for (const [c, frame, text] of asks) {
              const before = model.seen.length;
              await inD('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', c.id);
              await sleep(800);
              await say(frame, pageD, text);
              await until(() => model.seen.length > before, 30000, 300);
            }
            await behindD();
          } finally { model.release(); }
        };
        /* Once Z and Y are answered: no window reports either waiting any more (a window hears of another window's
           conversations through `claude agents`, which it reads at most every 30 s), and the turns the answers started
           have ended; Agent Plus tells of a finished turn some seconds later, and the step waits for that notice and clears
           it, so that it is not taken for one of the next. */
        const quiet = async () => {
          const settled = await until(() => [Z, Y].every((c) => { const a = attentionOf(c.id); return !a || a.activity !== 'waiting'; }), SEEN_MS + 15000, 500);
          await until(() => [Z, Y].every((c) => { const a = attentionOf(c.id); return !a || a.activity !== 'working'; }), 60000, 500);
          await sleep(noticeDelay.finished + 1000);
          await exec('notifications.clearAll');
          await inD('await vscode.commands.executeCommand("notifications.clearAll"); return true;');
          return settled;
        };
        try {
          await until(() => inD('const mine = vscode.extensions.getExtension("xnervwang.claude-code-plus"); return !!(mine && mine.isActive);'), 60000, 1000);
          await inD('await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar"); return true;');
          const zf = await openIn(Z), yf = await openIn(Y);
          check(!!zf && !!yf, 'the second window shows two conversations from its folder in tabs', null);
          if (!zf || !yf) return;
          await testFocus(true);
          await testFocus(false, folderD);
          await exec('notifications.clearAll');
          await inD('await vscode.commands.executeCommand("notifications.clearAll"); return true;');

          /* A permission prompt in the second window, with the first focused. */
          const zLine = fileTimeline(Z.id);
          const zAsked = await sendBehind(Z, zf, `Please ${ASK_TO_RUN}.`, ASK_TEXT);
          const zText = `"${Z.title}" is waiting for you to approve Bash.`;
          const zTold = zAsked && (await until(async () => (await needNotices()).find((n) => n.text === zText), SEEN_MS, 300) || (await listedNotices()).find((n) => n.text === zText));
          /* Counted, and Open pressed, while the toast is on screen: reading a window's notification list puts its toasts away. */
          const zToasts = [(await needNotices()).filter(about(Z)).length, (await needNotices(pageD)).filter(about(Z)).length];
          const toastNow = !!zTold && !!await noticeOf(Z);
          let opened = null, ahead = null;
          if (toastNow) {
            await pressNotice(Z, 'Open');
            ({ tab: opened, ahead } = await forward(Z, zf, ASK_TEXT));
          }
          const ccHere = await ccWaitNotices(), ccThere = await ccWaitNotices(pageD, folderD);
          check(!!zTold && ['Open', 'Dismiss'].every((b) => zTold.buttons.includes(b)) && !ccHere.length && !ccThere.length,
            'a permission prompt in a conversation of the second window gives one notice from Agent Plus in the window with the focus, naming the tool, and Claude Code shows none in either window',
            { asked: zAsked, notice: zTold || { toasts: await needNotices(), listed: await listedNotices(), files: attentionFiles(), focus: [await focusOf(), await focusOf(folderD)] }, claudeCodeHere: ccHere, claudeCodeThere: ccThere,
              timeline: zLine() });
          check(zToasts[0] <= 1 && zToasts[1] === 0, 'one such notice, and none in the second window', { toasts: zToasts });
          await shot('wait-notices-tool');
          if (toastNow) {
            check(!!opened && (ahead || '').includes(path.basename(folderD)), 'Open on it brings the second window forward, with the conversation\'s tab in front and its prompt on screen',
              { tab: opened, front: ahead });
          } else note('the notice had left the screen for the notification list before Open could be pressed');
          await refuseIn(Z, zf);
          await behindD();
          await testFocus(true);
          await exec('notifications.clearAll');

          /* A question in the second window. */
          const yAsked = await sendBehind(Y, yf, `Please ${ASK_FOR_CHOICE}.`, /Which config should I change\?/);
          const yText = `"${Y.title}" has a question for you.`;
          const yTold = yAsked && (await until(async () => (await needNotices()).find((n) => n.text === yText), SEEN_MS, 300) || (await listedNotices()).find((n) => n.text === yText));
          const ccQ = [...await ccWaitNotices(), ...await ccWaitNotices(pageD, folderD)];
          check(!!yTold && !ccQ.length, 'AskUserQuestion in the second window gives Agent Plus\'s notice that the conversation has a question for you, and none from Claude Code',
            { asked: yAsked, notice: yTold || { toasts: await needNotices(), agentPlus: attentionOf(Y.id) }, claudeCode: ccQ });
          await shot('wait-notices-question');
          await answerChoice(yf);
          await behindD();
          await exec('notifications.clearAll');
          await inD('await vscode.commands.executeCommand("notifications.clearAll"); return true;');

          /* Both at once, while the first window has the focus. */
          const settledOne = await quiet();
          check(!!settledOne, 'the question answered, no window reports either conversation waiting', { files: attentionFiles() });
          await sendAllBehind([[Z, zf, `Please ${ASK_TO_RUN} now.`], [Y, yf, `Please ${ASK_FOR_CHOICE} now.`]]);
          const zNow = await askedBash(zf), yNow = await askedChoice(yf);
          const pair = zNow && yNow && await until(async () => {
            const n = await needNotices(), a = n.find((x) => x.text === zText), b = n.find((x) => x.text === yText);
            return a && b ? [a, b] : null;
          }, SEEN_MS, 300);
          const pairHere = (await needNotices()).filter((x) => about(Z)(x) || about(Y)(x)), pairThere = (await needNotices(pageD)).filter((x) => about(Z)(x) || about(Y)(x));
          check(!!pair && pair.every((n) => ['Open', 'Dismiss'].every((b) => n.buttons.includes(b))) && pairHere.length === 2 && !pairThere.length,
            'two conversations of the second window that start to wait at once give two notices in the focused window, one per conversation with Open and Dismiss on each, and none in the second window',
            { asked: [zNow, yNow], notices: pair, here: pairHere, there: pairThere, onScreen: pair ? undefined : await notificationItems(page, '.notifications-toasts'),
              files: pair ? undefined : attentionFiles() });
          await shot('wait-notices-two-at-once');
          if (pair) {
            await pressNotice(Z, 'Open');
            const zFwd = await forward(Z, zf, ASK_TEXT);
            check(!!zFwd.tab && (zFwd.ahead || '').includes(path.basename(folderD)),
              'Open on the notice about the permission prompt brings the second window forward, with that conversation\'s tab in front and its prompt on screen', zFwd);
            if (await noticeOf(Y)) {
              await pressNotice(Y, 'Open');
              const yFwd = await forward(Y, yf, /Which config should I change\?/);
              check(!!yFwd.tab && (yFwd.ahead || '').includes(path.basename(folderD)),
                'and Open on the notice about the question, still on screen, brings that conversation\'s tab to the front, with its question on screen', yFwd);
            } else note('the notice about the question had left the screen before its Open could be pressed');
          }
          await refuseIn(Z, zf);
          await answerChoice(yf);
          await behindD();
          await testFocus(true);
          await exec('notifications.clearAll');

          const settledBoth = await quiet();
          check(!!settledBoth, 'both answered, no window reports either waiting', { files: attentionFiles() });
          await testFocus(false);
          await testFocus(false, folderD);
          const zAgain = await sendBehind(Z, zf, `Please ${ASK_TO_RUN} once more.`, ASK_TEXT);
          const yAgain = await sendBehind(Y, yf, `Please ${ASK_FOR_CHOICE} again.`, /Which config should I change\?/);
          const bothSeen = zAgain && yAgain && await until(() => { const a = attentionOf(Z.id), b = attentionOf(Y.id); return a && b && a.activity === 'waiting' && b.activity === 'waiting'; }, SEEN_MS, 300);
          /* The notices are polled for as long as Agent Plus takes to show one after it has seen the wait, since what
             it holds back meanwhile is not drawn anywhere. */
          const awayNotices = await until(async () => { const n = [...await needNotices(), ...await needNotices(pageD)].filter((x) => about(Z)(x) || about(Y)(x)); return n.length ? n : null; },
            noticeDelay.waiting + 2500, 250) || [];
          check(!!bothSeen && !awayNotices.length, 'while no window has the focus, two conversations that start to wait give no notice', { seen: bothSeen, notices: awayNotices });
          await testFocus(true);
          const replay = await until(async () => {
            const n = await needNotices(), a = n.find((x) => x.text === zText), b = n.find((x) => x.text === yText);
            return a && b ? [a, b] : null;
          }, 15000, 300);
          const replays = (await needNotices()).filter((n) => about(Z)(n) || about(Y)(n));
          check(!!replay && replays.length === 2 && replay.every((n) => n.buttons.includes('Open')),
            'once the first window has the focus, it shows two notices, one for each conversation, each saying what it waits for, with Open',
            { notices: replay, toasts: replays, onScreen: replay ? undefined : await notificationItems(page, '.notifications-toasts'), listed: replay ? undefined : await listedNotices(),
              files: replay ? undefined : attentionFiles(), focus: [await focusOf(), await focusOf(folderD)] });
          await shot('wait-notices-replay');
          await testFocus(false);
          await testFocus(true, folderD);
          const there = await until(async () => { const n = (await needNotices(pageD)).filter((x) => about(Z)(x) || about(Y)(x)); return n.length ? n : null; },
            noticeDelay.waiting + 2500, 250) || [];
          const listedThere = there.length ? there : (await listedNotices(pageD, folderD)).filter((n) => about(Z)(n) || about(Y)(n));
          check(!listedThere.length, 'and the second window, given the focus after it, shows nothing more of them', { there: listedThere });
          await refuseIn(Z, zf);
          await answerChoice(yf);
        } finally {
          await testFocus(null, folderD).catch(() => {});
          await exec('notifications.clearAll').catch(() => {});
          await call('setTimeout(() => vscode.commands.executeCommand("workbench.action.closeWindow"), 200); return true;', undefined, 60000, folderD).catch(() => {});
          await until(async () => !(await w.pageOf(path.basename(folderD), 1000)), 20000, 500);
          w.pin(undefined);
        }
      } finally {
        model.release();
        await setNotify('waiting', null).catch(() => {});
        await testFocus(null).catch(() => {});
        await exec('notifications.clearAll').catch(() => {});
      }
    });

    /* Three of the session list's switches, each turned off and on again without a reload: the dates after a row's time,
       OPEN SESSIONS, and New in tab and New in sidebar in place of Claude Code's New session. */
    await step('the session list\'s switches without a reload', async () => {
      const setShow = (k, v) => call('await vscode.workspace.getConfiguration("claudeCodePlus").update(arg[0], arg[1] === null ? undefined : arg[1], vscode.ConfigurationTarget.Global); return true;',
        [`show.${k}`, v]);
      await exec('claude-vscode.editor.open', tab0.id);
      await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, tab0.title)), 20000, 300);
      check(!!await openList(), 'the session list opens', null);
      const seen = () => list.evaluate((id) => {
        const r = [...document.querySelectorAll('[class*="sessionItem_"]')].find((x) => !x.closest('[data-cce-section]') && x.querySelector(`[data-cce-pin="${id}"]`));
        return { dates: !!r && /\d\d\/\d\d/.test(r.innerText), open: !!document.querySelector('[data-cce-open-sessions]'),
          ours: document.querySelectorAll('[data-cce-new-session]').length,
          theirs: [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'New session').length };
      }, tab0.id).catch(() => null);
      const SWITCHES = [
        ['sessionDates', 'the dates after a row\'s time', (s) => !s.dates, (s) => s.dates],
        ['openSessions', 'OPEN SESSIONS', (s) => !s.open, (s) => s.open],
        ['openInTabOrSidebar', 'New in tab and New in sidebar', (s) => s.ours === 0 && s.theirs === 1, (s) => s.ours === 2 && s.theirs === 0],
      ];
      try {
        const at = await until(async () => { const s = await seen(); return s && SWITCHES.every(([, , , on]) => on(s)) && s; }, 15000, 500);
        check(!!at, 'the list shows all three while they are on', await seen());
        for (const [key, what, offNow, onNow] of SWITCHES) {
          await setShow(key, false);
          const gone = await until(async () => { const s = await seen(); return s && offNow(s) && s; }, 15000, 500);
          check(!!gone, `claudeCodePlus.show.${key} turned off takes ${what} out of the list without a reload`, await seen());
          await setShow(key, null);
          const back = await until(async () => { const s = await seen(); return s && onNow(s) && s; }, 15000, 500);
          check(!!back, 'and turned on again brings it back', await seen());
        }
      } finally {
        for (const [key] of SWITCHES) await setShow(key, null).catch(() => {});
      }
    });

    /* Agent Plus's agentPlus.tokenMode in each mode in turn, without a reload: All, Essential, Interface, Custom with
       two features off, and All again. Each mode is checked in Show Status, Agent Plus's status bar entry, the information
       box, the config.json the hooks read, Claude Code's own list of plugins, the notice for a change of a feature's own
       setting, what the fake model receives on a turn of a conversation already running and on the first turn of a new
       one, and, in three of the modes, whether a detached command's end is told. */
    await step('the token mode', async () => {
      const tm = require('../../src/token-mode');
      const pi = require('../../src/plugin-install');
      const dataDir = path.join(profile.home, '.claude', 'plugins', 'data', pi.DATA_DIR);
      const setMode = (m) => call(`await vscode.workspace.getConfiguration('agentPlus').update('tokenMode', arg, vscode.ConfigurationTarget.Global); return true;`, m);
      /* The request goes as JSON, where an undefined in an array arrives as null; undefined is what removes a setting. */
      const setOwn = (k, v) => call(`await vscode.workspace.getConfiguration().update(arg[0], arg[1] === null ? undefined : arg[1], vscode.ConfigurationTarget.Global); return true;`, [k, v]);
      const ownNow = (k) => call('return vscode.workspace.getConfiguration().inspect(arg).globalValue;', k);
      const hooksNow = () => { try { const c = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')); return [c.enabled, c.tellTimeZone, c.brief]; } catch (_) { return null; } };
      const marked = () => fs.existsSync(path.join(dataDir, pi.UNLOADED_MARKER));
      /* Claude Code's own answer, from its command line in this run's home, and the line in its settings.json. */
      const pluginState = () => {
        const dir = fs.readdirSync(profile.exts).find((n) => n.startsWith('anthropic.claude-code-'));
        const bin = dir ? path.join(profile.exts, dir, pi.BINARY) : '';
        const r = bin ? require('child_process').spawnSync(bin, ['plugin', 'list', '--json'], { env, encoding: 'utf8', timeout: 90000 }) : null;
        let listed = null;
        try {
          const all = JSON.parse((r && r.stdout) || 'null');
          const found = (Array.isArray(all) ? all : (all && (all.plugins || all.installed)) || []).find((p) => JSON.stringify(p).includes(pi.REF));
          listed = found ? { enabled: found.enabled, raw: JSON.stringify(found).slice(0, 300) } : { enabled: undefined, raw: String((r && r.stdout) || '').slice(0, 300) };
        } catch (e) { listed = { enabled: undefined, raw: `${String((r && r.stdout) || '').slice(0, 200)} ${String((r && r.stderr) || '').slice(0, 200)}` }; }
        return { listed, inSettings: pi.enabledIn(path.join(profile.home, '.claude')), marker: marked() };
      };
      const statusBar = () => page.evaluate(() => {
        const e = [...document.querySelectorAll('.statusbar-item')].find((x) => /agentPlus\.tokenMode$/.test(x.id));
        return e ? e.innerText.trim() : null;
      });
      const zoneFile = path.join(dataDir, 'client-time-zone.json');
      const setZone = (z) => fs.writeFileSync(zoneFile, JSON.stringify({ timeZone: z }) + '\n');
      const sessions = path.join(profile.home, '.claude', 'sessions');
      const statusOf = (id) => {
        let names = [];
        try { names = fs.readdirSync(sessions).filter((n) => n.endsWith('.json')); } catch (_) { return null; }
        for (const n of names) {
          try { const d = JSON.parse(fs.readFileSync(path.join(sessions, n), 'utf8')); if (d.sessionId === id) return d.status || null; } catch (_) { /* being written */ }
        }
        return null;
      };
      /* Types `text` into `frame`'s message box and resolves to the fake model's record of the request that carried it,
         once the turn has ended (`id`, when known). */
      const turn = async (frame, text, id) => {
        const before = model.seen.length;
        await frame.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
        /* The turn's own request, which offers tools; a side request such as the one for a title can carry the text too. */
        const got = await until(() => model.seen.slice(before).find((x) => x.stream && (x.typed || '').includes(text) && x.context && x.context.tools > 0), 60000, 300);
        if (id) await until(() => statusOf(id) === 'idle', 60000, 500);
        await sleep(1500);
        return got || null;
      };
      /* A click anywhere outside the box closes it. The box is placed above its button when it opens, and a footer that
         moves while the page is still settling can end up under it. */
      const closeBox = async (frame) => { await frame.evaluate(() => document.body.click()); await sleep(300); };
      const infoMode = async (frame, expected) => {
        await exec('notifications.hideToasts');
        await frame.locator('[data-cce-info]').first().click();
        const read = () => frame.evaluate(() => {
          const b = document.getElementById('cce-info');
          if (!b || b.style.display !== 'block') return null;
          const r = Object.fromEntries([...b.children].map((x) => [x.children[0].textContent, x.children[1].textContent]));
          return r['Token mode'] || null;
        });
        const said = await until(async () => { const v = await read(); return v === expected ? v : null; }, 8000, 200) || await read();
        await closeBox(frame);
        return said;
      };
      const notices = () => page.evaluate(() => [...document.querySelectorAll('.notification-list-item')].map((n) => ({
        text: ((n.querySelector('.notification-list-item-message') || {}).innerText || '').trim(),
        buttons: [...n.querySelectorAll('.monaco-button')].map((b) => b.innerText.trim()).filter(Boolean) }))
        .filter((n) => /has no effect until the mode is Custom/.test(n.text)));
      const statusLine = async () => {
        await exec('notifications.clearAll');
        await exec('claudeCodePlus.status');
        const s = await until(async () => (await toasts()).find((x) => x.startsWith('Claude Code Plus — ')) || '', 10000, 300);
        await exec('notifications.clearAll');
        return s.replace(/^.*\| (Token mode: )/, '$1');
      };
      /* A command left running with setsid that ends 20 s after it starts. */
      const detachShort = async (frame, id) => {
        const before = model.seen.length;
        await frame.locator('[contenteditable][role="textbox"]').first().click();
        await page.keyboard.type(`Please ${ASK_TO_DETACH_SHORT}.`);
        await page.keyboard.press('Enter');
        const asked = await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300);
        const asking = await until(() => frame.evaluate(() => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes('setsid')), 8000, 500);
        if (asking) await frame.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
        await until(() => statusOf(id) === 'idle', 60000, 500);
        return { asked: !!asked, at: Date.now(), from: model.seen.length };
      };
      const toldDetached = (job) => model.seen.slice(job.from).some((x) => x.context && x.context.detached);

      await exec('workbench.action.closeAllEditors');
      await exec('workbench.action.closeAuxiliaryBar');
      await exec('claude-vscode.editor.open', tab0.id);
      const frame = await conversation(tab0, 60000);
      if (!frame) throw new Error('the conversation did not open');
      await sleep(3000);
      fs.mkdirSync(dataDir, { recursive: true });
      const since = new Date().toISOString();
      fs.writeFileSync(path.join(dataDir, `${tab0.id}.json`), JSON.stringify({ nodes: [{ title: 'Check each token mode', state: 'todo', opened: since, since }] }, null, 2));

      const LABEL = Object.fromEntries(tm.MODES.map((m) => [m.id, m]));
      const OFF_IN_CUSTOM = { 'claudeCodePlus.tellClaudeYourTimeZone': false, 'claudeCodePlus.conversationBrief': false };
      const MODES = [
        { mode: 'all', zone: 'Asia/Tokyo', key: 'claudeCodePlus.detachedEndNotices', on: { plan: true, zone: true, brief: true } },
        { mode: 'essential', zone: 'Europe/Berlin', key: 'claudeCodePlus.workPlan', detached: false, on: { plan: true, zone: true, brief: false } },
        { mode: 'interface', zone: 'America/New_York', key: 'claudeCodePlus.tellClaudeYourTimeZone', detached: false, on: { plan: false, zone: false, brief: false } },
        { mode: 'custom', zone: 'Asia/Kolkata', own: OFF_IN_CUSTOM, key: 'claudeCodePlus.workPlan', detached: true, on: { plan: true, zone: false, brief: false } },
        { mode: 'all', zone: 'Australia/Sydney', key: 'claudeCodePlus.conversationBrief', again: true, on: { plan: true, zone: true, brief: true } },
      ];
      const results = [];
      for (const m of MODES) {
        const name = `${LABEL[m.mode].label}${m.again ? ' again' : ''}`;
        console.log(`  -- ${name}`);
        await exec('notifications.clearAll');
        /* An information box left open while the mode changes. */
        await exec('notifications.hideToasts');
        const openBox = () => frame.evaluate(() => { const b = document.getElementById('cce-info'); return !!b && b.style.display === 'block'; });
        if (!await openBox()) await frame.locator('[data-cce-info]').first().click();
        await until(() => frame.evaluate(() => /Token mode/.test((document.getElementById('cce-info') || {}).innerText || '')), 8000, 200);
        await setMode(m.mode);
        const boxSays = () => frame.evaluate(() => {
          const b = document.getElementById('cce-info');
          const row = b && [...b.children].find((x) => x.children[0] && x.children[0].textContent === 'Token mode');
          return row ? row.children[1].textContent : null;
        });
        const followed = await until(async () => (await boxSays()) === LABEL[m.mode].label, 8000, 300);
        check(!!followed, `${name}: an information box left open names the new mode without being opened again`, await boxSays());
        if (await openBox()) await closeBox(frame);
        if (m.own) for (const [k, v] of Object.entries(m.own)) await setOwn(k, v);
        const unload = m.mode === 'interface';
        const want = (s) => s && (s.inSettings === !unload) && (s.listed && s.listed.enabled === !unload) && s.marker === unload;
        const plugin = await until(async () => { const s = pluginState(); return want(s) ? s : null; }, 60000, 3000) || pluginState();
        const r = { mode: name };

        /* 1: Show Status. */
        const own = (k) => (m.own && k in m.own ? m.own[k] : true);
        const on = tm.SWITCHES.filter((s) => s.key.startsWith('claudeCodePlus.')).map((s) => {
          const by = tm.onIn(m.mode, s.feature);
          return `${tm.featureOf(s.feature).name} ${(by === null ? own(s.key) : by) ? 'on' : 'off'}`;
        });
        r.status = await statusLine();
        check(r.status === `Token mode: ${LABEL[m.mode].label} (agentPlus.tokenMode); in Claude Code: ${on.join(', ')}`,
          `${name}: Show Status names the mode and says which of the four features run`, r.status);

        /* 2: the status bar and the information box. */
        r.bar = await until(async () => { const t = await statusBar(); return t === LABEL[m.mode].short ? t : null; }, 10000, 500) || await statusBar();
        r.info = await infoMode(frame, LABEL[m.mode].label);
        check(r.bar === LABEL[m.mode].short && r.info === LABEL[m.mode].label,
          `${name}: Agent Plus's status bar entry says ${LABEL[m.mode].short} and the information box ${LABEL[m.mode].label}`, { bar: r.bar, info: r.info });
        await shot(`token-mode-${m.mode}${m.again ? '-again' : ''}-info`);

        /* 3: the hooks' settings and whether Claude Code loads the plugin. */
        r.hooks = await until(() => { const h = hooksNow(); return JSON.stringify(h) === JSON.stringify([m.on.plan, m.on.zone, m.on.brief]) ? h : null; }, 10000, 300) || hooksNow();
        check(JSON.stringify(r.hooks) === JSON.stringify([m.on.plan, m.on.zone, m.on.brief]), `${name}: config.json hands the hooks work plan ${m.on.plan}, time zone ${m.on.zone}, brief ${m.on.brief}`, r.hooks);
        r.plugin = plugin;
        check(want(plugin), `${name}: Claude Code ${unload ? 'no longer loads' : 'loads'} the work plan plugin (claude plugin list), ${unload ? 'with' : 'without'} the mark that the mode unloaded it`, plugin);

        /* 5: a turn of the conversation already running, and the first turn of a new one. On Windows the hook has no zone
           files to describe another zone with (claude-plugin/agent-work-plan/hooks/tell-time-zone.py), so it says nothing. */
        const carried = { plan: m.on.plan, zone: m.on.zone && process.platform !== 'win32', brief: m.on.brief };
        setZone(m.zone);
        const got = await turn(frame, `Token mode check: ${name}, a running conversation.`, tab0.id);
        r.running = got && got.context;
        check(!!got && ['plan', 'zone', 'brief'].every((k) => got.context[k] === carried[k]),
          `${name}: a turn of a running conversation carries what the mode runs: work plan ${carried.plan}, time-zone note ${carried.zone}, brief request ${carried.brief}`,
          got ? got.context : model.seen.slice(-3));
        let detached = null;
        if (m.detached !== undefined && process.platform === 'linux') detached = await detachShort(frame, tab0.id);

        await exec('claude-vscode.editor.open');
        const fresh = await frameWhere(() => !!document.querySelector('[contenteditable][role="textbox"]') && !document.querySelector('[class*="userMessage_"]'), 60000);
        if (fresh) {
          await sleep(2000);
          setZone(m.zone);
          const first = await turn(fresh, `Token mode check: ${name}, a new conversation.`);
          r.fresh = first && first.context;
          check(!!first && first.context.skill === !unload && first.context.zone === carried.zone,
            `${name}: the first turn of a new conversation ${unload ? 'lists no' : 'lists the'} work plan skill, ${carried.zone ? 'with' : 'without'} the time-zone note`,
            first ? first.context : model.seen.slice(-3));
          if (first && first.context.images) note(`${name}: the first turn of a new conversation carries the note on images in replies`);
          await call(`const t = vscode.window.tabGroups.activeTabGroup.activeTab; if (t && t.input && t.input.viewType === ${JSON.stringify(PANEL_VIEW)}) await vscode.window.tabGroups.close(t); return true;`);
          await sleep(1000);
        } else check(false, `${name}: a new conversation opens`, await tabs());
        await exec('claude-vscode.editor.open', tab0.id);
        await sleep(1000);

        /* 4: a change of a feature's own setting. */
        await exec('notifications.clearAll');
        const had = await ownNow(m.key);
        await setOwn(m.key, had === false);
        const said = await until(async () => { const n = await notices(); return n.length ? n : null; }, m.mode === 'custom' ? 4000 : 10000, 300) || [];
        await exec('notifications.clearAll');
        await setOwn(m.key, had);
        await sleep(2500);
        const again = await notices();
        r.notices = { first: said, second: again };
        if (m.mode === 'custom') {
          check(!said.length && !again.length, `${name}: changing ${m.key} shows no notice`, r.notices);
        } else {
          check(said.length === 1 && said[0].text === `Claude Code Plus: the token mode is ${LABEL[m.mode].label}, so ${m.key} has no effect until the mode is Custom.`
            && said[0].buttons.includes(tm.SWITCH_BUTTON) && !again.length,
          `${name}: changing ${m.key} says once that it has no effect in this mode, with ${tm.SWITCH_BUTTON}, and changing it back says nothing`, r.notices);
        }
        await exec('notifications.clearAll');

        /* The detached command's end, told only where the mode runs the notices. */
        if (detached) {
          const end = detached.at + 20000;
          const told = await until(() => toldDetached(detached), m.detached ? 180000 : Math.max(5000, end + 90000 - Date.now()), 1000);
          r.detached = { asked: detached.asked, told: !!told };
          check(detached.asked && !!told === m.detached, `${name}: a detached command's end ${m.detached ? 'is' : 'is not'} told to the conversation`, r.detached);
          await until(() => statusOf(tab0.id) === 'idle', 60000, 500);
        }
        results.push(r);
      }
      fs.writeFileSync(path.join(out, 'token-modes.json'), JSON.stringify(results, null, 2) + '\n');
      for (const k of Object.keys(OFF_IN_CUSTOM)) await setOwn(k, undefined);

      /* 3, the other half: a plugin the user stopped loading stays stopped through Interface features and back. */
      await start('claudeCodePlus.disableWorkPlanPlugin');
      if (await until(dialog, 10000, 300)) await answerDialog('Stop loading it');
      const stopped = await until(() => { const s = pluginState(); return s.inSettings === false && s.listed && s.listed.enabled === false && !s.marker ? s : null; }, 60000, 3000) || pluginState();
      check(stopped.inSettings === false && !stopped.marker, 'Stop Loading the Work Plan Plugin stops Claude Code loading it, with no token mode mark', stopped);
      await exec('notifications.clearAll');
      await setMode('interface');
      await sleep(8000);
      const inInterface = pluginState();
      await setMode('all');
      await sleep(8000);
      const back = pluginState();
      check(inInterface.inSettings === false && !inInterface.marker && back.inSettings === false && back.listed && back.listed.enabled === false && !back.marker,
        'a plugin the user stopped loading is left stopped in Interface features, and All features does not load it again', { inInterface, back });
      const bin = path.join(profile.exts, fs.readdirSync(profile.exts).find((n) => n.startsWith('anthropic.claude-code-')), pi.BINARY);
      const enable = () => require('child_process').spawnSync(bin, ['plugin', 'enable', pi.REF], { env, encoding: 'utf8', timeout: 90000 });
      /* Stopped by the user while Interface features has it unloaded: the next mode leaves it stopped too. */
      enable();
      await setMode('interface');
      const unloaded = await until(() => { const s = pluginState(); return s.inSettings === false && s.marker ? s : null; }, 60000, 3000) || pluginState();
      await start('claudeCodePlus.disableWorkPlanPlugin');
      if (await until(dialog, 10000, 300)) await answerDialog('Stop loading it');
      await sleep(8000);
      const afterStop = pluginState();
      await exec('notifications.clearAll');
      await setMode('all');
      await sleep(8000);
      const leftStopped = pluginState();
      check(unloaded.marker && !afterStop.marker && leftStopped.inSettings === false && !leftStopped.marker,
        'Stop Loading the Work Plan Plugin while Interface features has it unloaded keeps it stopped once All features is chosen', { unloaded, afterStop, leftStopped });
      enable();
      check(pluginState().inSettings === true, 'and claude plugin enable loads it again, for the steps after this one', pluginState());
      await exec('notifications.clearAll');

      /* 6: the four settings' descriptions in the Settings editor. */
      const keys = tm.SWITCHES.filter((s) => s.key.startsWith('claudeCodePlus.')).map((s) => s.key);
      /* One setting at a time: the editor draws only the rows on screen, and on a small screen four do not fit. */
      const items = [];
      for (const key of keys) {
        await exec('workbench.action.openSettings', `@id:${key}`);
        const name = key.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        const row = await until(() => page.evaluate((name) => {
          const e = [...document.querySelectorAll('.setting-item-contents')].find((x) => x.offsetParent
            && ((x.querySelector('.setting-item-title') || {}).innerText || '').replace(/\s+/g, ' ').toLowerCase().includes(name));
          return e ? { title: ((e.querySelector('.setting-item-title') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
            text: ((e.querySelector('.setting-item-description') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
            link: [...e.querySelectorAll('.setting-item-description a')].map((a) => a.innerText.trim()) } : null;
        }, name), 15000, 500);
        if (row) items.push(row);
        /* On macOS the Settings editor can open as a modal over the panel, which would take the next steps' clicks. */
        await exec('workbench.action.closeActiveEditor');
        await page.keyboard.press('Escape').catch(() => {});
      }
      check(items.length === keys.length && items.every((i) => /Used only while .+ is Custom\.$/.test(i.text) && !/#agentPlus/.test(i.text) && i.link.length >= 1),
        'the Settings editor shows the four settings, each description ending that it is used only while the token mode (a link) is Custom', items);
      await shot('token-mode-settings');
      await exec('workbench.action.closeActiveEditor');
    });

    /* A build of the same version of this extension that differs in one file is installed over the running copy, as
       installing a build locally does: every open window then runs a build that is no longer the installed one until it
       reloads. A steward of all conversations in window A still gains the conversation it opens; once A has reloaded it
       keeps the stewards table, and window B, still on the earlier build, leaves it alone and says so. */
    await step('a steward of all after its extension is installed again', async () => {
      const front = threads[0];
      const dataDir = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
      const file = path.join(dataDir, 'stewards.json');
      const table = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).stewards || {}; } catch (_) { return {}; } };
      const manages = (id) => { const t = table()[front.id]; return !!t && Array.isArray(t.manages) && t.manages.includes(id); };
      const entries = () => {
        const dir = path.join(dataDir, 'windows');
        let names = [];
        try { names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return []; }
        return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { return null; } }).filter(Boolean);
      };
      const sameFolder = (a, b) => (process.platform === 'win32' ? path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase() : a === b);
      const entryOf = (folder) => entries().find((e) => Array.isArray(e.folders) && e.folders.some((f) => sameFolder(f, folder)));
      const hooks = path.join(__dirname, '..', '..', 'claude-plugin', 'agent-work-plan', 'hooks', 'steward-relay.py');
      let calls = 0;
      const act = (args, input) => {
        const line = `python3 ${hooks} ${args.join(' ')}` + (input ? ` <<'EOF'\n${input}\nEOF` : '');
        const answered = fakeHome.appendToolCall(transcriptOf(front), { sessionId: front.id, cwd: profile.folder,
          uuid: `${front.id.slice(0, 24)}${String(990000 + calls++).padStart(12, '0')}`, toolId: `toolu_again_${calls}`, command: line, description: 'Act for the user' });
        return new Promise((resolve) => {
          const kid = require('child_process').spawn(process.platform === 'win32' ? 'python' : 'python3', [hooks, ...args, dataDir],
            { env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: front.id }) });
          let said = '';
          kid.stdout.on('data', (d) => { said += d; });
          kid.stderr.on('data', (d) => { said += d; });
          kid.on('error', (e) => resolve('could not run the script: ' + e.message));
          kid.on('exit', () => resolve(said.trim()));
          kid.stdin.end(input || '');
        }).then((said) => { answered(said); return said; });
      };
      const stewardIn = (p) => until(async () => {
        for (const f of p.frames()) { try { if (await f.evaluate(() => /Managed by/.test(document.body ? document.body.innerText : ''))) return f; } catch (_) { /* gone */ } }
        return null;
      }, 30000, 500);
      const staleLine = (f) => f.evaluate(() => { const p = document.querySelector('p.stale'); return p ? { text: p.innerText.replace(/\s+/g, ' ').trim(), button: !!p.querySelector('button[data-act="reload"]') } : null; });

      /* Window A: once the Steward panel is about the conversation in front, that conversation is set to All. The panel
         follows the tab in front at its next pass; a click before then would go to the conversation that was in front
         earlier. */
      const headed = (f, t) => until(() => f.evaluate(() => { const b = document.querySelector('.head b'); return b ? b.textContent : ''; })
        .then((h) => h.includes(t.title.slice(0, 30))).catch(() => false), 20000, 300);
      for (const t of threads.slice(1, 3)) { await exec('claude-vscode.editor.open', t.id); await sleep(800); }
      await exec('claude-vscode.editor.open', front.id);
      await exec('workbench.view.extension.claudeCodePlusSteward');
      let panel = await stewardIn(page);
      const forFront = panel && await headed(panel, front);
      if (forFront && !await panel.locator('input[data-every]').isChecked()) await panel.locator('input[data-every]').click();
      const every = await until(() => table()[front.id] && table()[front.id].all === true, 10000, 300);
      check(!!panel && !!forFront && !!every, 'window A has a steward of all conversations in front', { front: front.id, forFront: !!forFront, table: table() });
      if (!panel || !every) return;

      /* Window B on a folder of its own, opened before the install so that it runs the earlier build too. */
      const folderS = fs.realpathSync.native((() => { const d = path.join(path.dirname(profile.folder), 'ws-s'); fs.mkdirSync(d, { recursive: true }); return d; })());
      const P = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6fe', title: 'Sort out the logging levels of the importer', days: 0,
        turns: [['Sort out the logging levels of the importer.', 'Set the noisy ones to debug.']] };
      fakeHome.writeThreads(profile.home, folderS, [P]);
      const before = Date.now();
      await call('await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(arg), { forceNewWindow: true }); return true;', folderS);
      const pageB = await w.pageOf(path.basename(folderS), 90000);
      const hostB = pageB ? await w.hostUp(before, folderS).catch(() => null) : null;
      check(!!pageB && !!hostB, 'a second window, B, opens on a folder of its own', { pageB: !!pageB });
      if (!pageB || !hostB) {
        if (pageB) await pageB.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+W' : 'Control+Shift+W').catch(() => {});
        return;
      }
      w.pin(profile.folder);
      const inB = (body, arg) => call(body, arg, 60000, folderS);
      let newId = '';
      try {
        await until(() => inB(`const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus'); return !!(mine && mine.isActive);`), 60000, 1000);
        await inB('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); return true;', P.id);
        const listedB = await until(() => { const e = entryOf(folderS); return e && e.sessions.includes(P.id) && e; }, 30000, 500);
        check(!!listedB, 'B shows a conversation of its own, which its entry lists', entryOf(folderS) || null);

        /* Installs the same package with one line added to its README, the way run.js installs the extension. */
        const extDir = path.join(profile.exts, fs.readdirSync(profile.exts).find((n) => /^xnervwang\.claude-code-plus-\d/.test(n)));
        const stamp = () => { try { return JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8')).__metadata.installedTimestamp || 0; } catch (_) { return 0; } };
        const was = stamp();
        const rebuilt = path.join(out, 'rebuilt.vsix');
        const zipped = require('child_process').spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', [
          'import sys, zipfile',
          'src, dst = sys.argv[1], sys.argv[2]',
          'with zipfile.ZipFile(src) as a, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as b:',
          '    for i in a.infolist():',
          '        data = a.read(i.filename)',
          '        if i.filename == "extension/README.md": data += b"\\n"',
          '        b.writestr(i, data)',
        ].join('\n'), vsix, rebuilt], { encoding: 'utf8' });
        const [tool] = require('@vscode/test-electron').resolveCliArgsFromVSCodeExecutablePath(exe, { reuseMachineInstall: true });
        const cliEnv = Object.assign({}, env);
        delete cliEnv.VSCODE_IPC_HOOK_CLI;
        const shell = process.platform === 'win32';
        const argv = ['--install-extension', rebuilt, '--force', `--extensions-dir=${profile.exts}`, `--user-data-dir=${profile.user}`];
        const r = zipped.status === 0 ? require('child_process').spawnSync(shell ? `"${tool}"` : tool, shell ? argv.map((a) => `"${a}"`) : argv,
          { env: cliEnv, encoding: 'utf8', shell, timeout: 180000 }) : null;
        const installed = r && r.status === 0 && await until(() => stamp() && stamp() !== was, 30000, 500);
        check(!!installed, 'the same version, rebuilt with one file changed, is installed over the running copy, as a local install does',
          { zipped: zipped.status === 0 ? 'ok' : (zipped.stderr || '').slice(0, 300), install: r ? `${r.status} ${(r.stdout || '').trim()} ${(r.stderr || '').trim()}`.slice(0, 600) : null });
        if (!installed) return;
        await sleep(3000);
        await shot('steward-installed-again');

        /* A `claude --bg` session the conversation in front of A starts while no window runs the installed build: some
           window still has to note its end and tell the conversation, through its inbox, which native Windows does not
           offer (src/stewards.js post()). */
        if (process.platform === 'win32') note('on native Windows a conversation is not told that a claude --bg session ended, so that check is left out here');
        else {
          const SECONDS = 30;
          fs.mkdirSync(path.join(profile.home, 'fake-bg'), { recursive: true });
          fs.writeFileSync(path.join(profile.home, 'fake-bg', 'claude'), BG_SESSION_SCRIPT(SECONDS), { mode: 0o755 });
          const jobs = () => { try { return fs.readdirSync(path.join(profile.home, '.claude', 'jobs')); } catch (_) { return []; } };
          const from = model.seen.length, jobsBefore = jobs();
          await exec('claude-vscode.editor.open', front.id);
          const f = await conversation(front, 60000);
          if (f) {
            await f.locator('[contenteditable][role="textbox"]').first().click();
            await page.keyboard.type(`Please ${ASK_FOR_BG_SESSION}.`);
            await page.keyboard.press('Enter');
            await until(() => model.seen.slice(from).some((x) => x.tool), 30000, 300);
            const asking = await until(() => f.evaluate(() => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes('--bg')), 8000, 500);
            if (asking) await f.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
          }
          const started = Date.now();
          const job = f && await until(() => jobs().find((j) => !jobsBefore.includes(j)), 30000, 500);
          check(!!job, 'with every window still on the replaced build, the conversation in front of A starts a claude --bg session',
            { frame: !!f, asks: model.seen.slice(from).map((x) => (x.ask || '').slice(0, 120)) });
          if (job) {
            const notice = /notice, not a message from the user: news of a `claude --bg` session this conversation started/;
            const told = await until(() => model.seen.slice(from).some((x) => notice.test(x.ask || '')), started + SECONDS * 1000 - Date.now() + 90000, 1000);
            check(!!told, 'and once it has finished, the conversation is told, which starts a turn, with no window reloaded',
              { job, asks: model.seen.slice(from).map((x) => (x.ask || '').slice(0, 160)) });
            await until(() => sessionStatus(front.id) === 'idle', 60000, 500);
          }
        }

        /* The steward opens a new conversation in A's folder. Running conversations reach the panel from `claude agents
           --json`, asked at most every 30 s. */
        const opened = await act(['--open', profile.folder], 'Start on the changelog, please.');
        newId = (/Session id: ([0-9a-f-]{36})/.exec(opened) || [])[1] || '';
        const gained = newId && await until(() => manages(newId), 15000, 300);
        const boxOf = (f, id) => f.evaluate((id) => { const b = document.querySelector(`input[data-id="${id}"]`); return b ? { checked: b.checked, disabled: b.disabled } : null; }, id);
        await exec('claude-vscode.editor.open', front.id);
        const rowOn = newId && await until(async () => { const b = await boxOf(panel, newId); return b && b.checked && b; }, 60000, 1000);
        const quietA = await staleLine(panel);
        const eA = entryOf(profile.folder), eB = entryOf(folderS);
        check(/^Opened: /.test(opened) && /It is now ticked for you in the Steward panel\./.test(opened) && !!gained && !!rowOn && !quietA,
          'with every window still on the replaced build, the steward of all gains the conversation it opened at once: the script reports the tick, stewards.json lists the conversation, and the panel shows it ticked without asking for a reload',
          { opened, gained: !!gained, row: rowOn || (newId && await boxOf(panel, newId)), line: quietA, manages: (table()[front.id] || {}).manages });
        check(!!eA && eA.installed === false && !!eB && eB.installed === false && typeof eA.build === 'string' && eA.build.length > 0 && eA.build === eB.build,
          'both windows\' entries say they run the same build, and not the installed one', { a: eA && [eA.build, eA.installed], b: eB && [eB.build, eB.installed] });
        await shot('steward-replaced-gains');

        /* A reloads and runs the installed build. */
        await w.reload();
        await until(() => call(`const mine = vscode.extensions.getExtension('xnervwang.claude-code-plus'); return !!(mine && mine.isActive);`), 60000, 1000);
        const eA2 = await until(() => { const e = entryOf(profile.folder); return e && e.installed === true && e; }, 30000, 500);
        check(!!eA2 && eA2.build !== (entryOf(folderS) || {}).build, 'after its reload A\'s entry says it runs the installed build, another than B\'s', { a: entryOf(profile.folder), b: entryOf(folderS) });

        /* Window B still runs the earlier build and leaves the table to A, so a tick in B's panel is not saved, and the
           panel says so. The tick is for a conversation of A's that the steward has through All, which runs again once
           its tab is in front. */
        await exec('claude-vscode.editor.open', threads[1].id);
        await conversation(threads[1], 60000).catch(() => null);
        await exec('claude-vscode.editor.open', front.id);
        await inB('await vscode.commands.executeCommand("claude-vscode.editor.open", arg); await vscode.commands.executeCommand("workbench.view.extension.claudeCodePlusSteward"); return true;', P.id);
        const panelB = await stewardIn(pageB);
        const firstB = panelB && await until(async () => { const b = panelB.locator(`input[data-id="${threads[1].id}"]:not([disabled])`).first(); return (await b.isVisible().catch(() => false)) && b; }, 60000, 1000);
        if (firstB) await firstB.click();
        await sleep(6000);
        const lineB = panelB ? await staleLine(panelB) : null;
        const toastB = await until(() => pageB.evaluate(() => [...document.querySelectorAll('.notification-list-item-message')].map((e) => e.innerText)
          .find((t) => /^The tick is not saved: /.test(t)) || ''), 10000, 500);
        const reloadButton = toastB && await pageB.evaluate(() => [...document.querySelectorAll('.notification-list-item')].filter((n) => /The tick is not saved/.test(n.innerText))
          .some((n) => [...n.querySelectorAll('.monaco-button')].some((b) => b.innerText.trim() === 'Reload Window')));
        check(!!firstB && !table()[P.id] && !!lineB && /^This window runs an earlier build of Claude Code Plus than the one now installed, so ticks made here are not saved\./.test(lineB.text)
          && lineB.button && !!toastB && !!reloadButton,
          'window B, still on the earlier build, saves no tick once A runs the installed one, and says so in one line of its Steward panel and in a notice, each with a Reload Window button',
          { clicked: !!firstB, saved: table()[P.id] || null, line: lineB, toast: toastB, reloadButton });
        await (async () => { await pageB.screenshot({ path: path.join(shotsDir, `${String(++shotNo).padStart(2, '0')}-steward-replaced-window-b.png`) }).catch(() => {}); })();

        /* A keeps the table: turning All off there is saved. */
        await exec('claude-vscode.editor.open', front.id);
        await exec('workbench.view.extension.claudeCodePlusSteward');
        panel = await stewardIn(page);
        if (panel && await headed(panel, front)) await panel.locator('input[data-every]').click();
        const offA = panel && await until(() => table()[front.id] && table()[front.id].all !== true, 10000, 300);
        check(!!offA, 'and A, reloaded, keeps the table: turning All off there is saved', table()[front.id] || null);
      } finally {
        if (newId) await act(['--close', '--confirmed', newId]).catch(() => '');
        await call('setTimeout(() => vscode.commands.executeCommand("workbench.action.closeWindow"), 200); return true;', undefined, 60000, folderS).catch(() => {});
        await until(async () => !(await w.pageOf(path.basename(folderS), 1000)), 20000, 500);
        w.pin(undefined);
        await exec('claude-vscode.editor.open', front.id).catch(() => {});
        await exec('workbench.view.extension.claudeCodePlusSteward').catch(() => {});
        const p = await stewardIn(page);
        if (p && await p.locator('input[data-every]').isChecked().catch(() => false)) await p.locator('input[data-every]').click();
        if (p) await p.locator('button[data-act="none"]').click().catch(() => {});
        await until(async () => (await claudeTabs()).some((x) => titled(x.label, front.title)), 10000, 300);
        await exec('workbench.action.closePanel').catch(() => {});
      }
    });

    await step('commands', async () => {
      await exec('notifications.clearAll');
      await exec('claudeCodePlus.status');
      const status = await until(async () => (await toasts()).find((x) => x.startsWith('Claude Code Plus — ')) || '', 10000, 300);
      check(/^Claude Code Plus — Claude Code panel anthropic\.claude-code-\S+: patched \| Claude Code host anthropic\.claude-code-\S+: patched \| Token mode: All features \(agentPlus\.tokenMode\); in Claude Code: work plan on, time-zone note on, conversation brief on, notices when a detached command stops on$/.test(status),
        'Show Status says both of Claude Code\'s files are patched, and the token mode', status);
      await shot('command-status');
      await exec('notifications.clearAll');

      await exec('claudeCodePlus.openSettings');
      const settings = await until(() => page.evaluate(() => {
        const e = document.querySelector('.settings-editor');
        return e && e.offsetParent && /Claude Code Plus/.test(e.innerText) && e.innerText.slice(0, 400);
      }), 15000, 500);
      check(!!settings && (await tabs()).some((g) => g.tabs.some((t) => t.active && t.label === 'Settings')), 'Settings opens VS Code\'s settings at this extension\'s own', settings);
      const declared = Object.keys(require('../../package.json').contributes.configuration.properties).length;
      const found = await page.evaluate(() => ((document.querySelector('.settings-editor .settings-count-widget') || {}).innerText || '').trim());
      check(found === `${declared} Settings Found`, `and lists all ${declared} of them, and nothing else`, found);
      await shot('command-settings');
      await exec('workbench.action.closeActiveEditor');

      await start('claudeCodePlus.disableWorkPlanPlugin');
      const d = await until(dialog, 10000, 300);
      check(!!d && d.text.includes('Stop Claude Code loading the work plan plugin?') && d.buttons.includes('Stop loading it') && d.buttons.includes('Cancel'),
        'Stop Loading the Work Plan Plugin asks first, with Stop loading it and Cancel', d);
      await shot('command-stop-loading');
      if (d) check(await answerDialog('Cancel'), 'and Cancel closes the question');
    });

    /* Another conversation named in a reply, by its title, by its title in corner brackets and by the first 8 characters
       of its id: a link for each, drawn by Claude Code's own link component; hovering names the conversation and its
       agent; a click brings its tab forward; with claudeCodePlus.show.conversationLinks off, no links. The conversation
       is one of this window's, open in a tab behind, with an id no other conversation here starts with. Near the end, since
       it opens tabs the steps before arrange. */
    await step('conversation links in replies', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const L = { id: 'c0ffee12-4b5e-4f60-8a71-92b3c4d5e6a1', title: 'Map the retry settings of the export job', days: 0,
        turns: [['Map the retry settings of the export job.', 'They are in config/export.yml, under retry.']] };
      fakeHome.writeThreads(profile.home, profile.folder, [L]);
      await exec('claude-vscode.editor.open', L.id);
      const behind = await until(async () => (await claudeTabs()).find((x) => titled(x.label, L.title)), 30000, 500);
      await exec('claude-vscode.editor.open', tab0.id);
      const inFront = await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, tab0.title)), 15000, 300);
      check(!!behind && !!inFront, 'the conversation the reply will name is open in a background tab', await claudeTabs());
      const panel = await conversation(tab0).catch(() => null) || conv;
      const MENTION = `vscode://xnervwang.claude-code-plus/open?session=${L.id}&source=claude-code`;
      const linksNow = () => panel.evaluate((href) => {
        const last = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop();
        if (!last || !/By its short id/.test(last.textContent)) return null;
        return [...last.querySelectorAll('a')].filter((a) => a.getAttribute('href') === href)
          .map((a) => ({ text: a.textContent, own: a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel') || '') }));
      }, MENTION);
      await panel.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type(`Name the conversation ${L.id} titled ${L.title}.`);
      await page.keyboard.press('Enter');
      const drawn = await until(async () => { const l = await linksNow(); return l && l.length === 3 ? l : null; }, 60000, 500);
      check(!!drawn && drawn.map((x) => x.text).join('|') === `${L.title}|${L.title}|${L.id.slice(0, 8)}` && drawn.every((x) => x.own),
        'a reply naming another conversation by its title, by its title in corner brackets and by its short id has a link for each, drawn by Claude Code\'s own link component',
        drawn || await linksNow());
      const link = panel.locator(`[data-testid="assistant-message"] a[href="${MENTION}"]`).first();
      /* A pointer that arrives while the reply is still being laid out can miss the mouseover; it leaves and comes back. */
      let tip = '';
      for (let i = 0; i < 3 && !tip; i++) {
        await page.mouse.move(5, 5);
        await link.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await link.hover({ timeout: 10000 }).catch(() => {});
        tip = await until(() => panel.evaluate(() => { const b = document.querySelector('[data-cce-label]'); return b ? b.textContent : ''; }), 4000, 200) || '';
      }
      check(typeof tip === 'string' && tip.startsWith(`${L.title}\nClaude Code conversation ${L.id.slice(0, 8)}`),
        'hovering over one names the conversation and its agent', tip);
      await shot('conversation-links-hover');
      let clickError = '';
      await link.click({ timeout: 15000 }).catch((e) => { clickError = String((e && e.message) || e).slice(0, 800); });
      const jumped = await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, L.title)), 15000, 300);
      check(!!jumped, 'clicked, it brings that conversation\'s tab to the front in this window', { clickError, tabs: await claudeTabs(), toasts: await toasts() });
      await exec('claude-vscode.editor.open', tab0.id);
      await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, tab0.title)), 15000, 300);
      const setLinks = (v) => call(`await vscode.workspace.getConfiguration('claudeCodePlus').update('show.conversationLinks', arg, vscode.ConfigurationTarget.Global); return true;`, v);
      await setLinks(false);
      const gone = await until(async () => { const l = await linksNow(); return l && !l.length ? l : null; }, 20000, 500);
      check(!!gone, 'with claudeCodePlus.show.conversationLinks off the reply has no such links, without a reload', await linksNow());
      await setLinks(true);
      const back = await until(async () => { const l = await linksNow(); return l && l.length === 3 ? l : null; }, 20000, 500);
      check(!!back, 'and turned on again they are back', await linksNow());
      await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)}
        && x.label && arg.startsWith(x.label.replace(/…$/, '')) && x.label.length >= 12); if (t) await vscode.window.tabGroups.close(t); return !!t;`, L.title);
    });

    /*
     * The session list's rows as each way of opening and closing conversations leaves them, read as a person sees them.
     * A row of a conversation that is open nowhere must not be drawn as picked, as the row the arrow keys are on or as
     * the one in front, and must be drawn plain unless it holds the keyboard focus; the rows of the conversation in the
     * tab in front are drawn as the one in front. The ways: a row clicked and its tab closed in front; two opened and
     * the first closed behind the second; one brought forward from OPEN SESSIONS and closed; one opened in the sidebar
     * from its page's own list, which then starts a new conversation; one opened with the arrow keys and Enter; a row
     * picked with a modifier click before another is opened; a row's menu closed with nothing picked; one opened from
     * its menu; a row dragged and let go over no group. Tabs are closed with their close buttons, and a click there
     * leaves the keyboard focus where it was.
     */
    await step('rows of conversations no longer open', async () => {
      const [A, B, C] = threads;
      const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
      const mainRow = (t, frame = list) => frame.locator(`[id="sessions-list-row-${t.id}"]`).first();
      const tabOf = async (t) => (await claudeTabs()).find((x) => titled(x.label, t.title));
      const inFront = (t) => until(async () => { const x = await tabOf(t); return !!x && x.active; }, 30000, 300);
      const opened = async (t, how) => { if (!await inFront(t)) throw new Error(`${how} did not bring "${t.title}" to the front in a tab`); };
      const closeTab = async (t) => {
        const tab = page.locator('.tabs-container .tab').filter({ hasText: t.title.slice(0, 16) }).first();
        await tab.hover();
        await tab.locator('.tab-actions .action-label').first().click({ timeout: 5000 });
        if (!await until(async () => !(await tabOf(t)), 15000, 300)) throw new Error(`the tab of "${t.title}" did not close`);
      };
      /* Moves the pointer onto a spot of the list outside the rows, a section header found in the page: in a short
         window a full list reaches its bottom, so no fixed spot is sure to be free of rows. The pointer stays in the
         list, since a page is told the pointer left a row only when the pointer moves within the page. */
      const pointerOffRows = async () => {
        const box = await (await list.frameElement()).boundingBox();
        const at = await list.evaluate(() => {
          const free = ([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && !e.closest('[class*="sessionItem_"]'); };
          const heads = [...document.querySelectorAll('[class*="sectionHeader_"], [data-cce-section-head]')].map((h) => h.getBoundingClientRect())
            .filter((r) => r.height > 0 && r.top >= 0 && r.bottom <= innerHeight).map((r) => [r.left + Math.min(40, r.width / 2), r.top + r.height / 2]);
          return [...heads, [8, 8], [innerWidth - 8, 8]].find(free) || null;
        });
        if (!at) throw new Error('the list has no empty spot outside its rows for the pointer');
        await page.mouse.move(box.x + at[0], box.y + at[1]);
      };
      /* Puts the keyboard focus into the list with the view's own command, which no click on a row does. */
      const focusList = async () => {
        await exec('workbench.view.extension.claude-sessions-sidebar');
        const inList = () => list.evaluate(() => document.hasFocus() && !!document.activeElement && document.activeElement !== document.body);
        if (!await until(inList, 5000, 100)) await list.locator('[class*="root_"][tabindex]').first().focus();
      };
      const looked = [];
      let n = 0;
      /* `open`: the conversations open now; `front`: the one in a tab in front, or null. */
      const after = async (what, open, front) => {
        await pointerOffRows();
        const ids = open.map((t) => t.id), f = front ? front.id : null;
        let looks = [];
        /* Closing a tab adds a row to Recently closed and moves the rows below it, which can bring one under the
           resting pointer. The test then moves the pointer off again instead of counting how that row is drawn. */
        const ok = await until(async () => {
          looks = await rowLooks();
          if (looks.some((r) => r.hover)) await pointerOffRows();
          return looks.length && !misdrawn(looks, ids, f).length;
        }, 15000, 300);
        await shot(`rows-no-longer-open-${++n}`);
        looked.push({ n, what, open: ids, front: f, looks });
        check(!!ok, `${what}: no row of a conversation that is open nowhere is drawn other than plain, and only ${front ? `"${front.title}"` : 'no conversation'} is drawn as the one in front`,
          misdrawn(looks, ids, f).map((r) => ({ ...r, open: ids.includes(r.id) })));
      };
      const way = async (name, fn) => {
        try { await fn(); } catch (e) {
          check(false, `${name}: ran to its end`, failure(e));
          await shot(`rows-no-longer-open-${name.replace(/\W+/g, '-')}-error`);
        }
      };
      /* Claude Code opens a conversation clicked in its list where it last opened one, and opening it in the sidebar
         makes that the sidebar; the step puts back the setting and the sidebar it found. */
      const whereNow = () => call("return vscode.workspace.getConfiguration('claudeCode').inspect('preferredLocation').globalValue ?? null;");
      const whereTo = (v) => call("await vscode.workspace.getConfiguration('claudeCode').update('preferredLocation', arg === null ? undefined : arg, vscode.ConfigurationTarget.Global); return true;", v);
      const found = { where: await whereNow(), sidebar: await auxiliaryVisible() };

      try {
        await whereTo(null);
        await exec('workbench.action.closeAllEditors');
        await exec('workbench.action.closeAuxiliaryBar');
        await openNotes();
        if (!await openList()) throw new Error('the session list did not open');
        if (!await until(async () => (await rowLooks()).filter((r) => r.where === 'list').length >= threads.length, 30000, 500)) {
          throw new Error('the list did not draw its rows');
        }
        /* A selection an earlier step left: Escape in the list ends it. */
        await focusList();
        await page.keyboard.press('Escape');

        await way('a row clicked', async () => {
          await mainRow(A).click();
          await opened(A, 'a click on its row');
          await after('a row clicked', [A], A);
          await closeTab(A);
          await after('a row clicked and its tab closed in front', [], null);
        });
        await way('two opened', async () => {
          await mainRow(A).click();
          await opened(A, 'a click on its row');
          await mainRow(B).click();
          await opened(B, 'a click on its row');
          await closeTab(A);
          await after('two opened from the list and the first closed behind the second', [B], B);
        });
        await way('from OPEN SESSIONS', async () => {
          await mainRow(A).click();
          await opened(A, 'a click on its row');
          await list.locator(`[id="cce-open-${B.id}"]`).first().click();
          await opened(B, 'a click on its row in OPEN SESSIONS');
          await closeTab(B);
          await after('one brought forward from OPEN SESSIONS and closed in front', [A], A);
          await closeTab(A);
          await after('the last tab closed', [], null);
        });
        await way('the sidebar', async () => {
          let side = null;
          const pastOpen = () => side.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Past conversations"]'));
          /* The sidebar's page draws the conversation as its own message rows; the list it opens shows the same words as a
             title. */
          const shows = (t) => side.evaluate((ask) => [...document.querySelectorAll('[class*="userMessage_"]')].some((m) => m.innerText.includes(ask)), t.turns[0][0]);
          try {
            await exec('claude-vscode.sidebar.open');
            await whereTo(null);
            side = await frameWhere(() => !!document.querySelector('[aria-label="Session history"]') && !!document.querySelector('[contenteditable][role="textbox"]'), 60000);
            if (!side) throw new Error('Claude Code did not open in the sidebar');
            await side.locator('[aria-label="Session history"]').first().click();
            /* On the start of the row's title. A row under the pointer shows its rename and archive buttons where its time
               was, and in a box as narrow as the sidebar's they reach back over the end of the title: a click in the
               middle of the title renames the conversation instead of opening it. */
            await mainRow(C, side).locator('span[class*="sessionName_"]').first().click({ timeout: 15000, position: { x: 2, y: 6 } });
            if (!await until(async () => !(await pastOpen()) && await shows(C), 30000, 500)) throw new Error('the sidebar did not switch to the conversation');
            /* Claude Code counts only a conversation in a tab as the one in front. */
            await after('one opened in the sidebar from the list its page opens', [C], null);
            await side.locator('[aria-label="New session"]').first().click();
            if (!await until(async () => !(await shows(C)), 30000, 500)) throw new Error('the sidebar did not start a new conversation');
            /* The sidebar keeps the conversation it showed before running, so Claude Code still counts it open there. */
            await after('the sidebar then started a new conversation', [C], null);
          } finally {
            if (side && await pastOpen().catch(() => false)) await side.locator('[role="dialog"][aria-label="Past conversations"]').first().press('Escape').catch(() => {});
            await exec('workbench.action.closeAuxiliaryBar');
          }
        });
        await way('the arrow keys', async () => {
          const rowsNow = async () => (await rowLooks()).filter((r) => r.where === 'list');
          await focusList();
          await page.keyboard.press('ArrowDown');
          for (let i = 0; i < 40; i++) {
            const rows = await rowsNow(), at = rows.findIndex((r) => r.highlighted), to = rows.findIndex((r) => r.id === A.id);
            if (at === to) break;
            if (at < 0 || to < 0) throw new Error(`no row ${at < 0 ? 'is highlighted by the arrow keys' : 'shows the conversation'}`);
            await page.keyboard.press(at < to ? 'ArrowDown' : 'ArrowUp');
            await until(async () => (await rowsNow()).findIndex((r) => r.highlighted) !== at, 3000, 100);
          }
          await page.keyboard.press('Enter');
          await opened(A, 'Enter on its row');
          await after('one opened with the arrow keys and Enter', [A], A);
          await closeTab(A);
          await after('one opened with the arrow keys and Enter, its tab closed in front', [], null);
        });
        await way('a modifier click', async () => {
          await mainRow(B).click({ modifiers: [MOD] });
          if (!await until(async () => (await rowLooks()).some((r) => r.id === B.id && r.selected), 5000, 200)) note(`a ${MOD} click did not pick a row of the session list here`);
          await mainRow(A).click();
          await opened(A, 'a click on its row');
          await after('a row picked with a modifier click, then another clicked', [A], A);
          await closeTab(A);
          await after('a row picked with a modifier click, then another clicked and its tab closed', [], null);
        });
        await way('a menu closed', async () => {
          await mainRow(B).click();
          await opened(B, 'a click on its row');
          /* The list closes its menu when its page loses the focus, and the page of the conversation just opened can take
             the focus a moment after the right-click, as pick() also allows for. */
          let menuUp = false;
          for (let i = 0; i < 3 && !menuUp; i++) {
            await mainRow(B).click({ button: 'right' });
            menuUp = !!await until(async () => (await menus()).length, 3000, 100);
          }
          if (!menuUp) throw new Error('no menu opened');
          await page.keyboard.press('Escape');
          if (!await until(async () => !(await menus()).length, 5000, 100)) throw new Error('the menu did not close');
          await after('a row\'s menu closed with nothing picked', [B], B);
          await closeTab(B);
          await after('a row\'s menu closed with nothing picked, then its tab closed in front', [], null);
        });
        await way('the menu', async () => {
          retried(await pick(A, ['Resume in tab']), 'Resume in tab');
          await opened(A, 'Resume in tab');
          await after('one opened from its menu', [A], A);
          await closeTab(A);
          await after('one opened from its menu, its tab closed in front', [], null);
        });
        /*
         * The list lets a row be dragged only while it is not archived, and an earlier step can leave one archived. The
         * drag ends on another row of the list two rows away, which takes no drop; a drag let go outside the list's
         * page never tells the page that it ended.
         */
        await way('a drag', async () => {
          let dragged = null;
          const box = await (await list.frameElement()).boundingBox();
          for (const t of [B, C, A]) {
            const b = await mainRow(t).boundingBox();
            if (!b) continue;
            const x = b.x + Math.min(60, b.width / 3), y = b.y + b.height / 2;
            const to = await list.evaluate(({ x, y, h, id }) => {
              for (const d of [2 * h, -2 * h, 3 * h, -3 * h]) {
                const e = y + d > 4 && y + d < innerHeight - 4 ? document.elementFromPoint(x, y + d) : null;
                const r = e && e.closest('[class*="sessionItem_"][id]');
                if (r && !r.id.endsWith(id) && !e.closest('[class*="groupHeader_"]')) return y + d;
              }
              return null;
            }, { x: x - box.x, y: y - box.y, h: b.height, id: t.id });
            if (to === null) continue;
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x, y + Math.sign(to - (y - box.y)) * 6, { steps: 3 });
            await page.mouse.move(x, box.y + to, { steps: 6 });
            const during = await rowLooks();
            await page.mouse.up();
            if (during.some((r) => r.id === t.id && r.selected)) { dragged = t; break; }
          }
          if (!dragged) note('no drag started here: no row was picked while the drag lasted');
          await after(`a row dragged and let go over no group${dragged ? `, "${dragged.title}"` : ''}`, [], null);
        });
        fs.writeFileSync(path.join(out, 'rows-no-longer-open.json'), JSON.stringify(looked, null, 1));
      } finally {
        await whereTo(found.where);
        if (found.sidebar !== await auxiliaryVisible()) await exec(found.sidebar ? 'workbench.action.focusAuxiliaryBar' : 'workbench.action.closeAuxiliaryBar');
        await exec('workbench.action.closeAllEditors');
      }
    });

    /* More of the links to other conversations, with a conversation source registered with Agent Plus from the test
       helper and used by nothing else: it lists the conversations the step gives it, tells Agent Plus when they change,
       and records what Agent Plus asks it to open. Its conversations are kept outside the window's folders, so Agent
       Plus's views do not show them. Registered here, it stands for another agent such as Codex. */
    await step('conversation links: ids, code, own and placeholder titles, late and another agent', async () => {
      const AGENT = 'cce-test-agent', elsewhere = path.join(path.dirname(profile.folder), 'test-agent-elsewhere');
      const Z = { sessionId: 'feedf00d-1111-4222-8333-444444444444', title: 'Tune the cache of the pricing service', cwd: elsewhere,
        state: 'idle', activity: 'stopped', running: true, lastActiveAt: Date.now() };
      const Q = { sessionId: 'decafbad-1111-4222-8333-444444444444', title: '(untitled)', cwd: elsewhere, state: 'idle', activity: 'stopped',
        running: true, lastActiveAt: Date.now() };
      const listAs = (list) => call('const st = globalThis.__cceTestAgent; st.list = arg; st.changed.fire(); return st.list.length;', list);
      const reg = await call(`const ap = vscode.extensions.getExtension('xnervwang.agent-plus').exports.agentPlus;
        const changed = new vscode.EventEmitter();
        const st = globalThis.__cceTestAgent = { list: arg.list, opened: [], changed };
        const r = ap.registerSource({ protocol: 1, id: arg.id, label: 'Test agent', onDidChangeConversations: changed.event,
          listConversations: async () => st.list.map((c) => Object.assign({}, c)),
          open: async (sessionId, row) => { st.opened.push({ sessionId, title: row && row.title, cwd: row && row.cwd }); return 'here'; } });
        st.registration = r.registration;
        return { accepted: r.accepted, code: r.code, features: ap.features };`, { id: AGENT, list: [Q] });
      check(!!reg && reg.accepted && (reg.features || []).includes('allConversations'),
        'a source standing for another agent registers with an Agent Plus that offers every agent\'s conversations', reg);
      try {
        await exec('claude-vscode.editor.open', tab0.id);
        const panel = await conversation(tab0);
        if (!panel) throw new Error('the conversation did not open');
        const say = async (text, marker) => {
          await panel.locator('[contenteditable][role="textbox"]').first().click();
          await page.keyboard.type(ECHO_REQUEST(text));
          await page.keyboard.press('Enter');
          return until(() => panel.evaluate((m) => [...document.querySelectorAll('[data-testid="assistant-message"]')].some((r) => r.textContent.includes(m)), marker), 30000, 300);
        };
        const linksIn = (marker) => panel.evaluate((m) => {
          const r = [...document.querySelectorAll('[data-testid="assistant-message"]')].filter((x) => x.textContent.includes(m)).pop();
          if (!r) return null;
          return [...r.querySelectorAll('a[href^="vscode://xnervwang.claude-code-plus/open?session="]')].map((a) => {
            const q = new URLSearchParams(a.getAttribute('href').split('?')[1]);
            return { text: a.textContent, session: q.get('session'), source: q.get('source'), pre: !!a.closest('pre'), code: !!a.closest('code') };
          });
        }, marker);
        const ofZ = (l) => (l || []).filter((x) => x.session === Z.sessionId && x.source === AGENT);

        /* A reply that names a conversation no agent has listed yet. */
        const LATE = 'not in the list yet';
        check(!!await say(`${Z.title} is ${LATE}.`, LATE), 'the fake model gave the reply naming a conversation no agent lists yet');
        await sleep(4000);
        const before = await linksIn(LATE);
        await listAs([Q, Z]);
        const after = await until(async () => { const l = ofZ(await linksIn(LATE)); return l.length ? l : null; }, 45000, 500);
        check(!!before && !ofZ(before).length && !!after && after[0].text === Z.title,
          'a reply naming a conversation not listed yet has no link to it, and gets one once its agent lists it, without a reload', { before, after });

        const RULES = 'Placeholder:';
        const text = `Its full id is ${Z.sessionId} here. Own: ${tab0.title}, \u300c${tab0.title}\u300d and ${tab0.id}. `
          + `${RULES} \u300c(untitled)\u300d and (untitled), but ${Q.sessionId} by its id.\n\n\`\`\`\n${Z.title}\n${Z.sessionId}\n\`\`\`\n\n`
          + `In inline code: \`${Z.title}\` and \`${Z.sessionId}\`.`;
        check(!!await say(text, RULES), 'the fake model\'s reply holds ids, code, the conversation\'s own name and a placeholder');
        const l = await until(async () => { const x = await linksIn(RULES); return x && x.some((y) => y.session === Q.sessionId) ? x : null; }, 30000, 500) || await linksIn(RULES) || [];
        const prose = ofZ(l).filter((x) => !x.code && !x.pre && x.text === Z.sessionId);
        check(prose.length === 1, 'a full session id in the prose of a reply is a link to its conversation', l);
        check(!l.some((x) => x.pre) && !ofZ(l).some((x) => x.code && x.text === Z.title) && ofZ(l).filter((x) => x.code && !x.pre && x.text === Z.sessionId).length === 1,
          'in a code block neither the title nor the id is linked, and in inline code only the id is', l);
        check(!l.some((x) => x.session === tab0.id) && prose.length === 1, 'the conversation\'s own title and id are not linked, in the same reply where another\'s id is', l);
        check(!l.some((x) => /^\(untitled\)$/.test(x.text)) && l.filter((x) => x.session === Q.sessionId && x.text === Q.sessionId).length === 1,
          'a conversation titled (untitled) is linked by its id, not by that title', l);

        const link = panel.locator(`[data-testid="assistant-message"] a[href="vscode://xnervwang.claude-code-plus/open?session=${Z.sessionId}&source=${AGENT}"]`).first();
        let tip = '';
        for (let i = 0; i < 3 && !tip; i++) {
          await page.mouse.move(5, 5);
          await link.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
          await link.hover({ timeout: 10000 }).catch(() => {});
          tip = await until(() => panel.evaluate(() => { const b = document.querySelector('[data-cce-label]'); return b ? b.textContent : ''; }), 4000, 200) || '';
        }
        check(typeof tip === 'string' && tip.startsWith(`${Z.title}\nTest agent conversation ${Z.sessionId.slice(0, 8)}`),
          'hovering over another agent\'s conversation names that agent', tip);
        const tabsBefore = (await claudeTabs()).length;
        await link.click({ timeout: 15000 }).catch(() => {});
        const opened = await until(async () => { const o = await call('return globalThis.__cceTestAgent.opened;'); return o && o.length ? o : null; }, 15000, 300);
        check(!!opened && opened.length === 1 && opened[0].sessionId === Z.sessionId && opened[0].title === Z.title && opened[0].cwd === elsewhere
          && (await claudeTabs()).length === tabsBefore,
          'clicked, it goes through agentPlus.openConversation to that agent\'s own way of opening it, with its title and folder, and opens no Claude Code tab', { opened, tabs: await claudeTabs() });
        await shot('conversation-links-another-agent');

        /* A panel opened after the list was sent. Its conversation has an earlier reply that names Z. */
        const P = { id: 'c0ffee12-4b5e-4f60-8a71-92b3c4d5e6a2', title: 'Ask who tunes the pricing cache', days: 0,
          turns: [['Who tunes the pricing cache?', `That is ${Z.title}, the other agent's conversation.`]] };
        fakeHome.writeThreads(profile.home, profile.folder, [P]);
        await exec('claude-vscode.editor.open', P.id);
        const late = await conversation(P).catch(() => null);
        const inP = late ? await until(() => late.evaluate((h) => !!document.querySelector(`[data-testid="assistant-message"] a[href="${h}"]`),
          `vscode://xnervwang.claude-code-plus/open?session=${Z.sessionId}&source=${AGENT}`), 30000, 500) : false;
        check(!!inP, 'a panel opened after the list was sent also links the conversation named in its earlier reply');
        await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)}
          && x.label && arg.startsWith(x.label.replace(/…$/, '')) && x.label.length >= 12); if (t) await vscode.window.tabGroups.close(t); return !!t;`, P.title);
      } finally {
        await call('const st = globalThis.__cceTestAgent; if (st && st.registration) st.registration.dispose(); delete globalThis.__cceTestAgent; return true;').catch(() => {});
      }
    });

    await step('the steward panel with an OpenCode Agent Plus conversation', async () => {
      const front = threads[0], SID = 'ses_UiStep01AbCd', KEY = `opencode-plus:${SID}`;
      const plans = path.join(path.dirname(profile.folder), 'oc-plans'), planFile = path.join(plans, `${SID}.json`);
      fs.mkdirSync(plans, { recursive: true });
      fs.writeFileSync(planFile, JSON.stringify({ nodes: [{ title: 'Port the reader', state: 'doing' }] }));
      const reg = await call(`const ap = vscode.extensions.getExtension('xnervwang.agent-plus').exports.agentPlus;
        const r = ap.registerSource({ protocol: 1, id: 'opencode-plus', label: 'OpenCode Agent Plus', onDidChangeConversations: () => ({ dispose() {} }),
          listConversations: async () => [{ sessionId: arg.sid, title: 'Port the parser', cwd: arg.plans, state: 'working', activity: 'working', running: true, lastActiveAt: Date.now() }],
          planPath: (id) => arg.plans + arg.sep + id + '.json' });
        globalThis.__cceTestOpenCode = r.registration;
        return { accepted: r.accepted, code: r.code, features: ap.features };`, { sid: SID, plans, sep: path.sep });
      check(!!reg && reg.accepted && ['allConversations', 'deliver', 'planPathOf'].every((f) => (reg.features || []).includes(f)),
        'a stand-in source with OpenCode Agent Plus\'s id registers with an Agent Plus that offers allConversations, deliver and planPathOf', reg);
      try {
        await exec('claude-vscode.editor.open', front.id);
        await sleep(1500);
        await exec('workbench.view.extension.claudeCodePlusSteward');
        const look = (k) => {
          const groups = [...document.querySelectorAll('.group')].map((g) => ({ name: (g.querySelector('.gname') || {}).textContent,
            ids: [...g.querySelectorAll('input[data-id]')].map((b) => b.dataset.id) }));
          const box = document.querySelector(`input[data-id="${k}"]`), row = box && box.closest('.row');
          return { groups, dot: row ? row.querySelector('.dot').className : '', name: row ? row.querySelector('.name').textContent : '',
            every: !!(document.querySelector('input[data-every]') || {}).checked };
        };
        const frame = await frameWhere((k) => !!document.querySelector(`input[data-id="${k}"]`), 45000, KEY);
        // What the conversation is doing comes from Agent Plus's attention files, which it writes on a pass of its own.
        const seen = frame ? await until(async () => { const x = await frame.evaluate(look, KEY); return /working/.test(x.dot) ? x : null; }, 30000, 500)
          || await frame.evaluate(look, KEY) : null;
        const oc = seen ? seen.groups.findIndex((g) => g.name === 'OpenCode Agent Plus') : -1;
        check(!!seen && oc >= 0 && oc === seen.groups.length - 1 && seen.groups[oc].ids.includes(KEY) && /working/.test(seen.dot) && seen.name === 'Port the parser',
          'the Steward panel lists the OpenCode Agent Plus conversation in a group of its own after the window groups, with its title and a working dot', seen);
        await shot('steward-opencode');
        if (frame && seen && !seen.every) {
          await frame.locator(`input[data-id="${KEY}"]`).first().click();
          const file = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', 'stewards.json');
          const t = await until(() => {
            try { const x = JSON.parse(fs.readFileSync(file, 'utf8')), e = x.stewards && x.stewards[front.id]; return e && e.manages.includes(KEY) ? x : null; } catch (_) { return null; }
          }, 10000, 300);
          check(!!t && t.version === 3 && t.stewards[front.id].paths && t.stewards[front.id].paths[KEY] === planFile,
            'ticking it makes the conversation in front its steward, and the version 3 table records the plan path Agent Plus gives', t);
          await frame.locator(`input[data-id="${KEY}"]`).first().click();
        } else note('the conversation in front has All on, so the OpenCode Agent Plus conversation was not ticked by hand');
      } finally {
        await call('if (globalThis.__cceTestOpenCode) globalThis.__cceTestOpenCode.dispose(); delete globalThis.__cceTestOpenCode; return true;').catch(() => {});
      }
    });

    /*
     * The plan bar above the input box (src/page/96-plan-bar.js, src/plan-bar.js). It is drawn from the plan of the
     * conversation the panel shows, in each state a plan can be in; it is compact in a narrow panel, and gone without a
     * plan or with claudeCodePlus.show.planBar off; it is redrawn when the plan changes; and it stays as wide as the
     * input box, with the same height and the title in the same place, however many rows the plan has. A click on it
     * opens Agent Plus's Work plan view at this conversation, and a click on its questions part opens the Answer view at
     * this conversation's question.
     */
    await step('the plan bar', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const plan = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', `${tab0.id}.json`);
      const had = fs.existsSync(plan) ? fs.readFileSync(plan, 'utf8') : null;
      const row = (title, state, more) => Object.assign({ title, state }, more || {});
      const write = (nodes) => { fs.mkdirSync(path.dirname(plan), { recursive: true }); fs.writeFileSync(plan, JSON.stringify({ nodes }, null, 2)); };
      const setBar = (v) => call(`await vscode.workspace.getConfiguration('claudeCodePlus').update('show.planBar', arg, vscode.ConfigurationTarget.Global); return true;`, v);
      /* The group holding the Claude Code tab as `share` of the editor area, an empty group beside it. A layout of two groups
         keeps its sizes when it is set again, so it goes back to one group first; the tabs then all sit in the first one. */
      const layout = async (share) => {
        const at = await call(`await vscode.commands.executeCommand('workbench.action.editorLayoutSingle');
          await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: arg[0] }, { size: 1 - arg[0] }] });
          await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
          return vscode.window.tabGroups.all.findIndex((g) => g.tabs.some((t) => t.input && t.input.viewType === arg[1]));`, [share, PANEL_VIEW]);
        await exec('claude-vscode.editor.open', tab0.id);
        await sleep(1200);
        return at;
      };
      const editorWidth = () => page.evaluate(() => { const e = document.getElementById('workbench.parts.editor'); return e ? e.getBoundingClientRect().width : 0; });
      try {
        await exec('claude-vscode.editor.open', tab0.id);
        await until(async () => (await claudeTabs()).find((x) => x.active && titled(x.label, tab0.title)), 15000, 300);
        const panel = await conversation(tab0).catch(() => null) || conv;
        const bar = () => panel.evaluate(() => {
          const b = document.querySelector('[data-agent-plus-plan-bar]');
          const send = document.querySelector('button[type="submit"][data-permission-mode]'), form = send && send.closest('form');
          const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
          if (!b || b.style.display === 'none' || !b.offsetParent) return { shown: false, there: !!b };
          const text = b.querySelector('.apb-row .apb-text'), q = b.querySelector('.apb-q'), dot = q && q.querySelector('.apb-dot');
          /* The theme's colour for status bar warning entries; the questions part's dot uses it. */
          const probe = document.createElement('span');
          probe.style.color = 'var(--vscode-statusBarItem-warningBackground)';
          document.body.appendChild(probe);
          const warning = getComputedStyle(probe).color;
          probe.remove();
          return { shown: true, compact: b.getAttribute('data-compact') === '1', label: b.getAttribute('aria-label') || '',
            dot: dot ? getComputedStyle(dot).backgroundColor : '', warning,
            segments: [...b.querySelectorAll('.apb-seg')].map((s) => s.getAttribute('data-state')),
            count: ((b.querySelector('.apb-count') || {}).textContent || ''),
            current: ((b.querySelector('.apb-row') || { getAttribute: () => '' }).getAttribute('data-state') || ''),
            title: text ? text.textContent : '', dim: !!text && /apb-dim/.test(text.className), questions: q ? q.textContent : '',
            beforeForm: !!form && b.nextElementSibling === form, bar: box(b), form: box(form), text: box(text),
            oneLine: !!text && text.getBoundingClientRect().height <= b.getBoundingClientRect().height };
        });
        const barIs = (want) => until(async () => { const s = await bar(); return want(s) && s; }, 30000, 400);
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

        /* Each state of a plan. */
        write([row('Read the code', 'done'), row('Export', 'doing', { children: [row('Write the CSV exporter', 'doing')] }),
          row('Which month to default to', 'discussing', { waitingOn: 'user', question: 'This month or last month?' }), row('Document it', 'todo')]);
        const doing = await barIs((s) => s.shown && s.count === '4 open');
        check(!!doing && doing.beforeForm && same(doing.segments, ['doing', 'discussing', 'todo']) && doing.current === 'doing'
          && doing.title === '2.1 Write the CSV exporter' && doing.questions === '1 to decide' && !doing.compact && !!doing.dot && doing.dot === doing.warning,
        'with a plan, a bar sits right above the input box: the open rows by state, 4 open, the deepest row being worked on as the current row, and 1 to decide with a dot in the status bar\'s warning colour',
        doing || await bar());
        await shot('plan-bar-doing');
        /* The input area sits over the bottom of the messages, and Claude Code keeps room under them for its height; the
           bar is part of that area, so the last message scrolled to the bottom ends above the bar. */
        const clear = await until(() => panel.evaluate(() => {
          const sc = document.querySelector('[class*="messagesContainer_"]'), b = document.querySelector('[data-agent-plus-plan-bar]');
          if (!sc || !b) return null;
          sc.scrollTop = sc.scrollHeight;
          const all = [...sc.querySelectorAll('[data-testid="assistant-message"], [class*="userMessage_"]')];
          const last = all.length ? all[all.length - 1].getBoundingClientRect().bottom : 0, top = b.getBoundingClientRect().top;
          return last > 0 && last <= top + 1 ? { last, top } : null;
        }), 10000, 500);
        check(!!clear, 'scrolled to the bottom, the last message ends above the bar', clear);
        write([row('Read the code', 'done'), row('Export', 'waiting', { waitingOn: 'build' }), row('Document it', 'todo')]);
        const waiting = await barIs((s) => s.shown && s.count === '2 open');
        check(!!waiting && same(waiting.segments, ['waiting', 'todo']) && !waiting.current && !waiting.title && !waiting.questions && waiting.label === 'Work plan: 2 rows open',
          'with no row being worked on and no question, the bar shows its track and the open-row count, with no current row or questions part', waiting || await bar());
        write([row('Read the code', 'done'), row('Handle refunds later', 'parked')]);
        const parked = await barIs((s) => s.shown && s.count === '1 open');
        check(!!parked && !parked.current && !parked.title && same(parked.segments, ['parked']),
          'with only a parked row left, there is no current row either', parked || await bar());
        write([row('Read the code', 'done'), row('Export', 'done')]);
        const allDone = await barIs((s) => s.shown && s.current === 'done');
        check(!!allDone && allDone.title === 'All rows done' && allDone.count === '' && !allDone.segments.length,
          'with every row done, a check and All rows done, and an empty track', allDone || await bar());
        await shot('plan-bar-done');

        const full = await editorWidth();
        const grown = (n) => write([row('Export', 'doing', { children: [row('A current row whose title is long enough to be cut short when the panel is narrow', 'doing')] })]
          .concat(Array.from({ length: n - 2 }, (_, i) => row('Row ' + (i + 1), 'todo'))));
        const sizes = [];
        for (const width of [Math.min(1100, full - 120), 520]) {
          const at = await layout(width / full);
          if (at !== 0) throw new Error(`the Claude Code tab is in editor group ${at}, not the first`);
          grown(9);
          const nine = await barIs((s) => s.shown && s.count === '9 open' && !s.compact);
          grown(120);
          const many = await barIs((s) => s.shown && s.count === '120 open');
          sizes.push({ width, nine, many });
          check(!!nine && !!many && Math.abs(nine.bar.width - nine.form.width) <= 1 && Math.abs(many.bar.width - many.form.width) <= 1
            && nine.bar.height === many.bar.height && Math.abs(nine.text.left - many.text.left) < 0.5 && nine.oneLine && many.oneLine,
          `with the panel about ${width} px wide the bar is as wide as the input box, and as the plan grows from 9 to 120 rows its height and the title's left edge stay the same`,
          { nine: nine || null, many: many || await bar() });
        }
        const wide = sizes.map((x) => x.nine && Math.round(x.nine.bar.width));
        check(!!wide[0] && !!wide[1] && wide[0] > wide[1] + 20, 'and the two measurements come from panels of different widths', wide);
        await layout(340 / full);
        const narrow = await barIs((s) => s.shown && s.compact);
        check(!!narrow && narrow.count === '120 open' && !narrow.segments.length && Math.abs(narrow.bar.width - narrow.form.width) <= 1,
          'in a narrow panel the bar is compact: the count and no track, still as wide as the input box', narrow || await bar());
        await shot('plan-bar-compact');
        await exec('workbench.action.editorLayoutSingle');
        await exec('claude-vscode.editor.open', tab0.id);

        write([row('Export', 'doing'), row('Which month', 'waiting', { waitingOn: 'user', question: 'This month or last month?' }),
          row('Which format', 'discussing', { waitingOn: 'user', question: 'CSV or JSON?' })]);
        const two = await barIs((s) => s.shown && s.questions === '2 to decide');
        check(!!two && two.count === '3 open' && two.title === '1 Export', 'a change to the plan redraws the bar', two || await bar());
        fs.unlinkSync(plan);
        const none = await barIs((s) => !s.shown);
        check(!!none, 'a conversation with no plan has no bar', none || await bar());

        write([row('Export', 'doing'), row('Which month', 'waiting', { waitingOn: 'user', question: 'This month or last month?' })]);
        await barIs((s) => s.shown && s.questions === '1 to decide');
        await exec('workbench.action.closeSidebar');
        await exec('claude-vscode.editor.open', tab0.id);
        const planRows = () => page.evaluate(() => {
          const pane = [...document.querySelectorAll('.pane')].find((p) => { const h = p.querySelector(':scope > .pane-header'); return h && /^Work plan/.test(h.getAttribute('aria-label') || ''); });
          if (!pane || !pane.offsetParent) return null;
          return [...pane.querySelectorAll('.monaco-list-row .label-name')].map((e) => e.textContent.trim());
        });
        check(!await planRows(), 'before the click the side bar with the Work plan view is closed', await planRows());
        await panel.locator('[data-agent-plus-plan-bar] .apb-name').first().click({ timeout: 10000 });
        const rows = await until(async () => { const r = await planRows(); return r && r.includes('1. Export') && r.includes('2. Which month') && r; }, 20000, 400);
        check(!!rows, 'a click on the bar opens Agent Plus\'s Work plan view on this conversation\'s plan', rows || await planRows());
        await shot('plan-bar-work-plan');
        await panel.locator('[data-agent-plus-plan-bar] .apb-q').first().click({ timeout: 10000 });
        const asked = await frameWhere((t) => { const m = document.getElementById('main'), q = document.getElementById('question'), c = document.getElementById('conversation');
          return !!m && m.style.display === 'flex' && !!q && q.textContent === 'This month or last month?' && !!c && c.textContent === t; }, 20000, tab0.title);
        check(!!asked, 'a click on its questions part opens Agent Plus\'s Answer view at this conversation\'s question');
        await shot('plan-bar-answer');

        /* The switch, without a reload. */
        await exec('claude-vscode.editor.open', tab0.id);
        await setBar(false);
        const off = await barIs((s) => !s.there);
        check(!!off, 'with claudeCodePlus.show.planBar off the bar is gone, without a reload', off || await bar());
        await setBar(null);
        const back = await barIs((s) => s.shown && s.questions === '1 to decide');
        check(!!back, 'and turned on again it is back', back || await bar());
      } finally {
        await setBar(null).catch(() => {});
        await exec('workbench.action.editorLayoutSingle').catch(() => {});
        if (had === null) { try { fs.unlinkSync(plan); } catch (_) { /* never written */ } } else fs.writeFileSync(plan, had);
        await exec('claude-vscode.editor.open', tab0.id).catch(() => {});
      }
    });

    /* Agent Plus's pen on a Work plan row (prefill in src/claude-source.js), clicked in the Work plan view of an Agent
       Plus that has it. The row's conversation comes to the front with "About row N (title): " in its input after what
       is there. A conversation that no tab here shows is opened in a tab first; one started in a folder other than this
       window's first folder, which this window cannot open, is left alone, and Agent Plus puts the text on the
       clipboard and says why. */
    await step('writing about a work plan row', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const apDir = fs.readdirSync(profile.exts).find((n) => n.startsWith('xnervwang.agent-plus-'));
      const apCommands = (() => { try { return JSON.parse(fs.readFileSync(path.join(profile.exts, apDir, 'package.json'), 'utf8')).contributes.commands || []; } catch (_) { return []; } })();
      if (!apCommands.some((c) => c.command === 'agentPlus.writeAboutRow')) {
        note(`the Agent Plus installed (${apDir || 'none'}) has no pen on Work plan rows, so this step has nothing to click`);
        return;
      }
      const PEN = 'Agent Plus: Write About This Row in Its Conversation';
      const SEL = '[role="textbox"][aria-label="Message input"]';
      const planFile = (t) => path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', `${t.id}.json`);
      const writePlan = (t, titles) => {
        fs.mkdirSync(path.dirname(planFile(t)), { recursive: true });
        fs.writeFileSync(planFile(t), JSON.stringify({ nodes: titles.map((title, i) => ({ title, state: i ? 'todo' : 'doing' })) }, null, 2));
      };
      /* The input of the page in `f`: its text, whether it has the focus, where the caret is, and the composerDraft of
         the session the page shows, read from the send button's React props (src/page/25-session.js). */
      const input = (f) => f.evaluate((sel) => {
        const b = document.querySelector(sel);
        if (!b) return null;
        const s = getSelection();
        let caret = 'none';
        if (s.rangeCount && s.isCollapsed && b.contains(s.focusNode)) {
          const r = document.createRange();
          r.selectNodeContents(b);
          r.setStart(s.focusNode, s.focusOffset);
          caret = r.toString().replace(/\u200b/g, '') ? 'inside' : 'end';
        }
        let draft = null;
        const send = document.querySelector('button[type="submit"][data-permission-mode]');
        const k = send && Object.keys(send).find((x) => x.startsWith('__reactFiber$'));
        for (let n = k ? send[k] : null, i = 0; n && i < 60; n = n.return, i++) {
          const p = n.memoizedProps;
          if (p && p.session && p.session.agentMapAgents) { draft = typeof p.session.composerDraft === 'string' ? p.session.composerDraft : null; break; }
        }
        return { text: b.textContent.replace(/\u200b/g, ''), focus: document.hasFocus() && document.activeElement === b, caret, draft };
      }, SEL).catch(() => null);
      const workPlan = page.locator('.pane:has(> .pane-header[aria-label^="Work plan"])').first();
      const planRows = () => workPlan.locator('.monaco-list-row .label-name').allInnerTexts().catch(() => []);
      const showPlan = async (t, first) => {
        await exec('agentPlus.showWorkPlanOf', { sourceId: 'claude-code', sessionId: t.id });
        return until(async () => (await planRows()).includes(first), 20000, 300);
      };
      const pen = async (row) => {
        const r = workPlan.locator('.monaco-list-row').filter({ has: page.locator('.label-name', { hasText: row }) }).first();
        await r.hover();
        await r.locator(`.action-label[aria-label="${PEN}"]`).click({ timeout: 10000 });
      };
      const clearInput = async (f) => {
        await f.locator(SEL).first().click();
        /* On macOS Ctrl+A moves the caret to the start of the line rather than selecting all. */
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Delete');
      };
      /* Types `text` into the input of `f`, emptied first. A key typed right after selecting all and Delete can be
         lost, so the input is read back and, if it does not hold `text`, emptied and typed once more. */
      const typeInto = async (f, text) => {
        for (let i = 0; i < 2; i++) {
          await clearInput(f);
          await until(async () => { const s = await input(f); return !!s && s.text === ''; }, 3000, 100);
          await sleep(300);
          await page.keyboard.type(text);
          if (await until(async () => { const s = await input(f); return !!s && s.text === text; }, 3000, 100)) return true;
        }
        return false;
      };
      const mentions = (t, text) => { try { return fs.readFileSync(transcriptOf(t), 'utf8').split(text).length - 1; } catch (_) { return 0; } };
      const inFront = async (t) => !!(await claudeTabs()).find((x) => x.active && titled(x.label.replace(TRAILING_MARKS, ''), t.title));
      /* Agent Plus's notification that the text did not reach the message input and is on the clipboard instead. */
      const copied = async () => (await notificationItems(page, '.notifications-toasts'))
        .filter((n) => /could not put it in the conversation's message box|could not tell whether it reached the conversation's message box/.test(n.text));
      const closeTab = (t) => call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)} && x.label.startsWith(arg));
        if (t) await vscode.window.tabGroups.close(t); return true;`, t.title.slice(0, 12));
      const t1 = threads[1];
      const away = { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6fc', title: 'Profile the slow report query', days: 0,
        turns: [['Profile the slow report query.', 'The report query scans the whole orders table.']] };
      const had = fs.existsSync(planFile(tab0)) ? fs.readFileSync(planFile(tab0), 'utf8') : null;
      let side = null;
      try {
        await exec('claude-vscode.editor.open', tab0.id);
        conv = await conversation(tab0, 30000) || conv;
        await clearInput(conv);
        writePlan(tab0, ['Port the parser', 'Write the tests', 'Document the flags']);
        check(!!await showPlan(tab0, '1. Port the parser'), 'the conversation\'s plan is in the Work plan view, with a pen on its rows', await planRows());
        const sentBefore = mentions(tab0, 'About row ');

        /* An empty input, the tab behind another editor. */
        await openNotes();
        await exec('notifications.clearAll');
        await pen('1. Port the parser');
        const one = 'About row 1 (Port the parser): ';
        const got1 = await until(async () => { const s = await input(conv); return s && s.text === one && s; }, 15000, 200);
        check(!!got1 && await inFront(tab0), 'the pen on row 1 brings the conversation\'s tab to the front with exactly "About row 1 (Port the parser): " in its empty input',
          { got: got1 || await input(conv), tabs: await claudeTabs(), told: await copied() });
        check(!!got1 && got1.focus && got1.caret === 'end' && got1.draft === one, 'with the focus in the input, the caret after the text and composerDraft holding it', got1);
        await shot('prefill-empty');
        await page.keyboard.type('and the lexer');
        const typed = await until(async () => { const s = await input(conv); return s && s.text === one + 'and the lexer' && s; }, 5000, 200);
        check(!!typed, 'the user\'s next keys land after it', await input(conv));

        /* The user's own text ends in a letter. */
        await openNotes();
        await pen('2. Write the tests');
        const two = one + 'and the lexer About row 2 (Write the tests): ';
        const got2 = await until(async () => { const s = await input(conv); return s && s.text === two && s; }, 15000, 200);
        check(!!got2 && got2.focus && got2.caret === 'end' && got2.draft === two && await inFront(tab0),
          'when the user has text in the input, row 2\'s text is added after it with one space between, and the focus and the caret end up after the new text', { got: got2 || await input(conv), told: await copied() });

        /* The user's own text ends in a space. */
        check(await typeInto(conv, 'see also '), 'the user types "see also " into the emptied input', await input(conv));
        await openNotes();
        await pen('3. Document the flags');
        const three = 'see also About row 3 (Document the flags): ';
        const got3 = await until(async () => { const s = await input(conv); return s && s.text === three && s; }, 15000, 200);
        check(!!got3 && got3.focus && got3.caret === 'end' && await inFront(tab0), 'after text that ends in a space, row 3\'s text follows with no second space',
          { got: got3 || await input(conv), told: await copied() });
        check(!(await copied()).length, 'and each time Agent Plus had nothing to put on the clipboard', await copied());
        await sleep(3000);
        const still = await input(conv);
        check(!!still && still.text === three && mentions(tab0, 'About row ') === sentBefore,
          'nothing was sent: three seconds later the input still holds the text and the transcript has none of it', { still, sent: mentions(tab0, 'About row ') - sentBefore });

        await closeTab(t1);
        writePlan(t1, ['Check the export filter']);
        check(!!await showPlan(t1, '1. Check the export filter'), 'the Work plan view shows the plan of a conversation that is not open in any tab here', await planRows());
        await exec('notifications.clearAll');
        const asked = Date.now();
        await pen('1. Check the export filter');
        const four = 'About row 1 (Check the export filter): ';
        side = await conversation(t1, 30000);
        const got4 = side && await until(async () => { const s = await input(side); return s && s.text === four && s; }, 15000, 200);
        check(!!got4 && await inFront(t1), 'the pen opens it in a tab here, in front, with the text in its input',
          { got: got4 || (side && await input(side)), opened: !!side, ms: Date.now() - asked, tabs: await claudeTabs(), told: await copied() });
        check(!!got4 && got4.focus && got4.caret === 'end' && got4.draft === four, 'with its input focused and the caret at the end', got4);
        await shot('prefill-opened');
        await sleep(2000);
        check(mentions(t1, 'About row ') === 0 && !(await copied()).length, 'and sends nothing', { sent: mentions(t1, 'About row '), told: await copied() });

        /* A conversation started in a folder other than this window's first folder. */
        const elsewhere = path.join(path.dirname(profile.folder), 'elsewhere');
        fs.mkdirSync(elsewhere, { recursive: true });
        fakeHome.writeThreads(profile.home, elsewhere, [away]);
        writePlan(away, ['Add the missing index']);
        check(!!await showPlan(away, '1. Add the missing index'), 'the Work plan view shows a conversation started in another folder', await planRows());
        await exec('notifications.clearAll');
        const tabsBefore = (await claudeTabs()).length;
        await pen('1. Add the missing index');
        const told = await until(async () => (await copied())[0] || null, 15000, 300);
        const clip = await call('return vscode.env.clipboard.readText();');
        check(!!told && /it was started in a folder other than this window's first one/.test(told.text) && clip === 'About row 1 (Add the missing index): '
          && (await claudeTabs()).length === tabsBefore,
        'that one is not opened here: Agent Plus puts the text on the clipboard and its notification gives the reason', { told, clip, tabs: await claudeTabs() });
        await shot('prefill-not-received');
      } finally {
        await exec('notifications.clearAll').catch(() => {});
        if (side) await clearInput(side).catch(() => {});
        await closeTab(t1).catch(() => {});
        for (const t of [t1, away]) { try { fs.unlinkSync(planFile(t)); } catch (_) { /* never written */ } }
        if (had === null) { try { fs.unlinkSync(planFile(tab0)); } catch (_) { /* never written */ } } else fs.writeFileSync(planFile(tab0), had);
        await exec('claude-vscode.editor.open', tab0.id).catch(() => {});
        conv = await conversation(tab0, 30000) || conv;
        if (conv) await clearInput(conv).catch(() => {});
      }
    });

    /* Last, since every step before needs the patch. Remove from Claude Code restores both files, and after a reload the
       session list is Claude Code's own. Turning the extension on again puts the patch back, which the suite run after
       this stage expects. */
    await step('removing the patch', async () => {
      const allAre = (st, want) => !!st && st.targets.length === 2 && st.targets.every(([, x]) => x === want);
      const plainList = () => frameWhere(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'New session')
        && !document.querySelector('[data-cce-new-session]'), 30000);
      await exec('notifications.clearAll');
      await exec('claudeCodePlus.remove');
      const clean = await until(async () => { const st = await patchState(); return allAre(st, 'clean') && st; }, 60000, 1000);
      check(!!clean, 'Remove from Claude Code restores both of Claude Code\'s files', await patchState());
      const asked = await until(async () => (await toasts()).find((x) => /^Claude Code Plus was removed from Claude Code panel and Claude Code host\. Reload the window to finish\./.test(x)) || '', 30000, 500);
      check(!!asked, 'and asks for a reload to finish', asked || await toasts());
      await shot('removed-reload-prompt');
      await exec('notifications.clearAll');
      await w.reload();
      const after = await until(async () => { const st = await patchState(); return st && st.active && st; }, 60000, 1000);
      check(allAre(after, 'clean'), 'after the reload both files are still Claude Code\'s own: the extension does not patch them again', after);
      await exec('workbench.view.extension.claude-sessions-sidebar');
      check(!!await plainList(), 'and the session list is Claude Code\'s own again: its New session button, none of this extension\'s');
      await shot('removed');
      await exec('claudeCodePlus.enable');
      const back = await until(async () => { const st = await patchState(); return allAre(st, 'patched') && st; }, 60000, 1000);
      check(!!back, 'turning Claude Code Plus on again puts the patch back in both files', await patchState());
      await exec('notifications.clearAll');
      await w.reload();
      await until(async () => { const st = await patchState(); return st && st.active && st; }, 60000, 1000);
      await exec('workbench.view.extension.claude-sessions-sidebar');
      check(!!await frameWhere(() => !!document.querySelector('[data-cce-new-session]'), 60000), 'and after a reload the session list has this extension\'s buttons again');
    });

    await step('no self-check warning', async () => {
      check(!warned.size, 'no page of a Claude Code panel drew the warning that its messages are no longer found, at any point of the run', [...warned.values()]);
    });
  } finally {
    clearInterval(warnWatch);
    await shot('last');
    await w.close();
  }
}

module.exports = { run };
