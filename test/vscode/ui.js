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
 *   session list   Claude Code's session list as the patch changes it: New in tab and New in sidebar, a pin and the dates
 *                  on every row, the right-click menu's Resume in tab, Resume in sidebar and Text color, a pin clicked,
 *                  the hover text of a row, and claude --bg, claude -p and daemon sessions left out, and the first two
 *                  listed once claudeCodePlus.hideBackgroundSessions is off
 *   a tab          a conversation resumed in a tab: its title, the times on every message and reply, the bar on your
 *                  messages, the rail and its list, the footer's buttons, their hover text and the information box,
 *                  OPEN SESSIONS, and which times show while the extension is off and once it is on again
 *   the dots       the dot on the tab's logo while a turn sent through fake-model.js runs, the envelope after the tab's
 *                  title once its reply lands with the tab in the background, and the red dot while Claude Code waits
 *                  for permission to run a command
 *   work left running
 *                  the green ring kept after the turn ends while a command it put in the background runs, a helper
 *                  (subagent) it started in the background, or, on Linux, a program it left running with setsid, and
 *                  gone once that has ended; the detached program in the agent map, and the notice once it is gone;
 *                  on Linux, a `claude -p` worker left running under a detached shell beside a command in the
 *                  background: the agents button's dot green and its label counting both once, the map listing the
 *                  worker by name in place of its shell and its own row a green ring, all grey once both have ended;
 *                  a claude --bg session the conversation starts (a stand-in of the CLI, on every platform): the
 *                  agents button's 1 bg and its green dot, the tab's ring, the map's row, the notice of its end, 1 bg
 *                  done and grey, and the setting that leaves it out
 *   the steward    the Steward panel, a steward's crown on its tab, on every session list row and in the panel's
 *                  header, the bell an older build stored left out, renames through both of Claude Code's rename
 *                  boxes with marks typed anywhere, a managed conversation's dot and envelope in the panel while it
 *                  works, has a reply unread, waits for permission and runs work in the background, and each of the
 *                  steward's requests: a message passed on, a rename, close (refused while busy without --confirmed),
 *                  --windows, a new conversation, one reopened (refused while another process runs it or no window
 *                  has its folder, and ticked again), a handoff, a notice, a second steward's crown, and a link;
 *                  on Linux, a conversation two processes run: the marks, and Stop the old process
 *   two windows    a second window of the same VS Code on a folder of its own: a conversation open there comes to
 *                  the front, in that window, from the first window's Steward panel and from a steward's link, and no
 *                  copy of it opens; a link to one open nowhere says so; once that window has reloaded with the
 *                  conversation's tab restored behind another and not loaded, deleting it from the first window is
 *                  refused and names the second
 *   closed, sidebar, archived
 *                  RECENTLY CLOSED once the tab is closed; Resume in sidebar, New in sidebar and New in tab; Delete
 *                  session… on an archived conversation: refused while it is open in a tab, then its confirmation
 *   token mode     each of Agent Plus's token modes in turn: Show Status, the status bar, the information box, the hooks'
 *                  settings, Claude Code's list of plugins, the notice for a feature's own setting, what the fake model
 *                  receives, a detached command's end, and the four settings in the Settings editor
 *   commands       Show Status, Settings and the confirmation of Stop Loading the Work Plan Plugin
 *   removal        last: Remove from Claude Code restores both files, and turning the extension on puts the patch back
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
const { ASK_TO_RUN, RUN, ASK_TO_BACKGROUND, BG_RUN, ASK_FOR_HELPER, ASK_TO_DETACH, ASK_TO_DETACH_SHORT, LINK_TEXT, IMAGE_ALT, IMAGE_WEB,
  ASK_FOR_WORKER, WORKER_NAME, WORKER_SCRIPT } = require('./lib/fake-model');
const { ASK_FOR_BG_SESSION, BG_SESSION_NAME, BG_SESSION_SCRIPT } = require('./lib/fake-model');
/* An 8x8 red PNG. */
const SQUARE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mO4YGCAFTEMLQkA2ntMAZZ5tYQAAAAASUVORK5CYII=';
const tabdot = require('../../src/tabdot');

const { sleep, until } = win;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const DOTS = { running: rgb(tabdot.GREEN), waiting: rgb(tabdot.RED) };
const ENVELOPE = ' \u2709\uFE0F';
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
const MARK_RE = /\u{1F451}|\u{1F6CE}|\u2709/u;
/* Conversations a steward opens again: one started in a folder below the window's, one in a folder no window has open. */
const FOLDER_THREADS = [
  { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6f6', title: 'Tidy the helper scripts in the sub folder', days: 0,
    turns: [['Tidy the helper scripts in the sub folder.', 'Moved the two helpers into scripts/ and removed the unused one.']] },
  { id: '7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e6f7', title: 'Draft the migration notes for the other project', days: 0,
    turns: [['Draft the migration notes for the other project.', 'Drafted them in docs/migration.md.']] },
];

async function run({ exe, profile, env, playwright, model, threads, background = [], out, check, note }) {
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
  const step = async (name, fn) => {
    if (only.length && !only.includes(name) && name !== 'the patch' && name !== 'the reload') return;
    console.log(`\n── ${name}`);
    try { await fn(); } catch (e) { check(false, `${name}: ran to its end`, String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ')); await shot(`${name.replace(/\W+/g, '-')}-error`); }
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
  /* The text of VS Code's hover over `loc`. */
  const hoverText = async (loc) => {
    await page.mouse.move(5, 300);
    await sleep(300);
    await loc.hover();
    const text = await until(() => page.evaluate(() => {
      const h = [...document.querySelectorAll('.monaco-hover, .workbench-hover')].find((e) => e.offsetParent && e.innerText.trim());
      return h ? h.innerText.trim() : '';
    }), 5000, 200);
    await page.mouse.move(5, 300);
    await sleep(300);
    return text || '';
  };
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.notification-list-item-message')].map((e) => e.innerText));
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
  /* The crop of the logo on the tab whose label starts with `label`, and how many pixels of each dot colour it holds;
     null while that tab is not in sight on the tab bar. */
  const tabLogo = async (label) => {
    const tab = page.locator('.tabs-container .tab').filter({ hasText: label.slice(0, 16) }).first();
    const box = await tab.boundingBox().catch(() => null);
    const bar = await page.locator('.editor-group-container:has(.tabs-container .tab) .tabs-and-actions-container').filter({ has: tab }).first()
      .boundingBox().catch(() => null);
    if (!box || !bar || box.x < bar.x || box.x + 40 > bar.x + bar.width) return null;
    const area = { x: box.x + 4, y: box.y + 4, width: 24, height: box.height - 8 };
    const png = await crop(area);
    return { count: dotColours(png), png };
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
  /* A press on the empty bottom of the list, which takes the focus off its rows and does nothing else. */
  const clickEmpty = async () => {
    const box = await (await list.frameElement()).boundingBox();
    await page.mouse.click(box.x + 40, box.y + box.height - 12);
    await page.mouse.move(5, 880);
    await sleep(300);
  };

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

    await step('the dots on a tab', async () => {
      if (!conv) throw new Error('the conversation did not open');
      const t = (await claudeTabs()).find((x) => titled(x.label, tab0.title));
      if (!t) throw new Error('the conversation\'s tab is gone');
      const idle = await dotsOn(t.label);
      check(!!idle && idle.running === 0 && idle.waiting === 0 && !t.label.endsWith(ENVELOPE), 'an idle conversation\'s tab has no dot and no envelope', idle);
      model.hold();
      const turns = model.turns();
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type('Run the tests again.');
      await page.keyboard.press('Enter');
      check(!!await until(() => model.turns() > turns, 30000, 300), 'a message sent from the tab reaches the fake model', model.seen.slice(-3));
      const running = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && d.waiting === 0 && d; }, 20000, 500);
      check(!!running, 'while the turn runs the tab\'s logo carries the green dot', await dotsOn(t.label));
      const listRunning = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
      check(!!listRunning, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      await shot('tab-dot-running');
      const green = await tabLogo(t.label);
      if (running && green) base.compare('tab-dot-running', green.png);
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
      const listUnread = await until(async () => {
        const d = await listDot(tab0), env = await list.locator(`[data-cce-open-sessions] [class*="sessionItem_"][id$="${tab0.id}"] [data-cce-envelope]`).count();
        return d && d.running === 0 && env === 1 && d;
      }, 10000, 500);
      check(!!listUnread, 'and its row in OPEN SESSIONS has an envelope and no dot', await listDot(tab0));
      await shot('tab-dot-unread');
      await page.locator('.tabs-container .tab').filter({ hasText: t.label.slice(0, 16) }).first().click();
      await page.bringToFront().catch(() => {});
      const read = await until(async () => { const d = await dotsOn(t.label); return d && d.running === 0 && !(await claudeTabs()).some((y) => y.label.endsWith(ENVELOPE)) && d; }, 20000, 500);
      check(!!read, 'and bringing the tab to the front clears it', { dots: await dotsOn(t.label), windowFocused: await call('return vscode.window.state.focused;') });
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
      const listWaiting = await until(async () => { const d = await listDot(tab0); return d && d.waiting >= 4 && d; }, 10000, 500);
      check(!!listWaiting, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
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
      await conv.locator('[contenteditable][role="textbox"]').first().click();
      await page.keyboard.type(`Please ${ASK_TO_BACKGROUND}.`);
      await page.keyboard.press('Enter');
      check(!!await until(() => model.seen.slice(before).some((x) => x.tool), 30000, 300), `the fake model answers with ${BG_RUN} put in the background`, model.seen.slice(before));
      /* Claude Code runs a command it takes for read-only, such as sleep, without asking. */
      const asking = await until(() => conv.evaluate((cmd) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(cmd), BG_RUN), 8000, 500);
      if (asking) await conv.locator('button, [role="button"]').filter({ hasText: /^\s*1\s*Yes\s*$/ }).first().click({ timeout: 5000 });
      const started = Date.now();
      const ended = await until(() => status() === 'idle' && Date.now() - started > 2000, 60000, 500);
      check(!!ended, 'the turn that started the command ends while the command runs', seen());
      /* The windows look for work running every ten seconds. */
      const green = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && status() === 'idle' && d; }, 25000, 500);
      check(!!green, 'with the turn over and the command still running, the tab\'s logo carries a green ring', Object.assign(seen(), { dots: await dotsOn(t.label) }));
      const listGreen = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
      check(!!listGreen, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      await shot('tab-dot-background-work');
      /* The command ends 40 s after it started, Claude Code tells the conversation, and its answer ends that turn too. */
      const cleared = await until(async () => {
        const d = await dotsOn(t.label);
        return Date.now() - started > 45000 && status() === 'idle' && d && d.running === 0 && d.waiting === 0 && d;
      }, 120000, 1000);
      check(!!cleared, 'once the command has ended and the conversation has answered its notice, the dot goes', Object.assign(seen(), { dots: await dotsOn(t.label) }));
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
        const listGreen = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
        check(!!listGreen, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
        await shot('tab-dot-background-helper');
      } finally { model.releaseHelper(); }
      /* Released, the helper finishes, Claude Code tells the conversation, and its answer ends that turn too. */
      const cleared = await until(async () => {
        const d = await dotsOn(t.label);
        return status() === 'idle' && d && d.running === 0 && d.waiting === 0 && d;
      }, 90000, 1000);
      check(!!cleared, 'once the helper has finished and the conversation has answered its notice, the dot goes', Object.assign(seen(), { dots: await dotsOn(t.label) }));
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
      const listGreen = await until(async () => { const d = await listDot(tab0); return d && d.running >= 4 && d; }, 10000, 500);
      check(!!listGreen, 'and so does its row in OPEN SESSIONS', await listDot(tab0));
      const button = conv.locator('button, [role="button"]').filter({ hasText: /\b1 detached\b/ }).first();
      const labelled = await until(() => button.isVisible().catch(() => false), 20000, 500);
      check(!!labelled, 'the Agents button counts it as 1 detached', await conv.evaluate(() => document.body.innerText.slice(-400)));
      if (labelled) {
        await button.click({ timeout: 5000 });
        const listed = await until(() => conv.evaluate(() => {
          const text = document.body.innerText;
          return /1 detached command/.test(text) && /sleep 45/.test(text) && /pid \d+ · started \d\d:\d\d/.test(text);
        }), 10000, 500);
        check(!!listed, 'the agent map lists the command with its pid and when it started', await conv.evaluate(() => document.body.innerText.slice(-600)));
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
      const GREEN = `rgb(${DOTS.running.join(', ')})`;
      const footer = () => conv.evaluate(() => {
        const b = document.querySelector('button[data-agents-dot]');
        if (!b) return null;
        const dot = b.querySelector('[data-status-dot]');
        return { dot: b.getAttribute('data-agents-dot'), label: b.getAttribute('aria-label') || '', colour: dot ? getComputedStyle(dot).backgroundColor : '' };
      });
      const mapState = () => conv.evaluate(() => {
        const own = document.querySelector('[class*="rowMain_"] [data-status-dot]'), s = own && getComputedStyle(own);
        return { text: document.body.innerText.slice(-3000), own: own ? { state: own.getAttribute('data-status-dot'),
          ring: /statusDotElsewhere/.test(own.className), border: s.borderTopColor, background: s.backgroundColor } : null };
      });
      const green = await until(async () => { const f = await footer(); return f && f.dot === 'running' && /\b1 task\b/.test(f.label) && /\b1 worker\b/.test(f.label) && f; }, 40000, 500);
      check(!!green && green.colour === GREEN && !/detached/.test(green.label),
        'with the turn over, the agents button counts the command and the worker once each, not the worker\'s shell, and its dot is the tabs\' green', await footer());
      const ring = await until(async () => { const d = await dotsOn(t.label); return d && d.running >= 6 && d; }, 25000, 500);
      check(!!ring, 'and the tab\'s logo carries the green ring', await dotsOn(t.label));
      await shot('agents-button-work-running');
      if (green) {
        await conv.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
        const listed = await until(async () => { const m = await mapState(); return /1 worker · claude -p, started from this conversation/.test(m.text) && m.text.includes(WORKER_NAME) && m; }, 10000, 500);
        check(!!listed && new RegExp(`session ${WORKER} · pid \\d+`).test(listed.text) && /\brunning\b/.test(listed.text) && !/detached command/.test(listed.text),
          'the agent map lists the worker by name with its session id, pid and state, and not the shell that holds it', listed ? listed.text.slice(-900) : await mapState());
        const own = listed && listed.own;
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
      check(!!m && m.own.state === 'idle' && !m.own.ring && !/worker · claude -p/.test(m.text), 'and the map\'s own row is grey, with no worker listed', m && m.own);
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
        const listed = await until(async () => { const m = await map(); return /1 background session · 1 running · started from this conversation/.test(m.text) && m.text.includes(BG_SESSION_NAME) && m; }, 10000, 500);
        check(!!listed && listed.text.includes(job) && !!listed.own && listed.own.state === 'running' && listed.own.ring && listed.own.border === GREEN,
          'the agent map lists the session by name and job id as running, and the map\'s own row has a green ring', listed ? { text: listed.text.slice(-900), own: listed.own } : await map());
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
        const over = await until(async () => { const m = await map(); return /1 background session · 1 done/.test(m.text) && await result() && m; }, 10000, 500);
        check(!!over && !!over.own && over.own.state === 'idle' && !over.own.ring, 'the map keeps it, done, with its result, and the map\'s own row is grey',
          over ? { text: over.text.slice(-900), own: over.own } : await map());
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
        const listed = await until(() => conv.evaluate((text) => /1 scheduled prompt/.test(document.body.innerText)
          && [...document.querySelectorAll('details pre')].some((p) => p.textContent.includes(text)), prompt), 10000, 500);
        check(!!listed, 'the agent map lists it, its prompt in the folded row', await conv.evaluate(() => document.body.innerText.slice(-600)));
        await shot('agent-map-scheduled');
        await page.keyboard.press('Escape');
      }
      fs.rmSync(file, { force: true });
      const gone = await until(async () => !(await button.isVisible().catch(() => false)), 60000, 500);
      check(!!gone, 'once the file is gone the count goes too, with nothing else redrawing the panel', await conv.evaluate(() => document.body.innerText.slice(-400)));
    });

    await step('a closed tab', async () => {
      if (!list) throw new Error('the session list did not open');
      const closed = await call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)});
        if (!t) return false; await vscode.window.tabGroups.close(t); return true;`);
      if (!closed) throw new Error('no Claude Code tab to close');
      const s = await until(async () => { const x = await sections(); const c = x.find((y) => y.closed); return c && !x.some((y) => y.open && y.rows.length) && x; }, 20000, 500);
      const c = s && s.find((y) => y.closed);
      check(!!c && /^RECENTLY CLOSED 1$/i.test(c.head) && c.collapsed, 'closing the tab puts RECENTLY CLOSED, folded, at the top of the list, and leaves OPEN SESSIONS empty', s || await sections());
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
    });

    await step('the steward panel', async () => {
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
      /* The title a conversation's transcript stores last, or ''. */
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
        await frame.locator('input[data-id]').first().click();
        const file = path.join(profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', 'stewards.json');
        const table = await until(() => {
          try { const t = JSON.parse(fs.readFileSync(file, 'utf8')); return t.stewards && t.stewards[front.id] ? t : null; } catch (_) { return null; }
        }, 10000, 300);
        check(!!table && table.stewards[front.id].manages.includes(boxes[0][0]), 'ticking one makes the conversation in front its steward', table);
        const belled = (label) => typeof label === 'string' && label.startsWith('\u{1F451} ') && (label.match(/\u{1F451}/gu) || []).length === 1
          && titled(label.slice('\u{1F451} '.length), front.title);
        const marked = await until(async () => (await claudeTabs()).find((x) => belled(x.label)), 10000, 300);
        check(!!marked, 'and its tab keeps its title with one crown before it', await claudeTabs());
        /* Each of its rows in the session list, in OPEN SESSIONS and below it: one crown, before the title and outside
           it, and no mark in the title; the other conversations' rows have none. */
        const rowsOf = (id) => list.evaluate((id) => [...document.querySelectorAll(`[class*="sessionItem_"][id$="${id}"], [class*="sessionItem_"]:has([data-cce-pin="${id}"]), [data-cce-open-row="${id}"]`)]
          .map((r) => {
            const name = r.querySelector('span[class*="sessionName_"]'), crowns = [...r.querySelectorAll('[data-cce-crown]')];
            return { section: !!r.closest('[data-cce-section]'), crowns: crowns.length, name: name ? name.textContent : null,
              before: !!name && crowns.length === 1 && !name.contains(crowns[0]) && !!(crowns[0].compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING) };
          }), id);
        const crownedRows = (rs, title) => rs.length >= 2 && rs.some((r) => r.section) && rs.some((r) => !r.section)
          && rs.every((r) => r.crowns === 1 && r.before && r.name === title && !MARK_RE.test(r.name));
        const crownRows = list ? await until(async () => { const rs = await rowsOf(front.id); return crownedRows(rs, front.title) && rs; }, 15000, 500) : null;
        const others = list ? await Promise.all(threads.filter((t) => t.id !== front.id).map((t) => rowsOf(t.id))) : [];
        check(!!crownRows && others.every((rs) => rs.every((r) => r.crowns === 0)),
          'and each of its rows in the session list, in OPEN SESSIONS and below, has one crown, before the title and not in it; no other row has one',
          { steward: crownRows || (list && await rowsOf(front.id)), others });
        /* The Steward panel's header names the steward with its crown, and without the bell its stored name carries. */
        const header = () => frame.evaluate(() => { const b = document.querySelector('.head b'); return b ? b.textContent : null; });
        const headed = await until(async () => (await header()) === `${CROWN} ${front.title}`, 15000, 500);
        check(!!headed, 'the Steward panel\'s header names the steward with one crown first and without the bell an older build stored in its name',
          { header: await header(), stored: storedTitle(front.id) });
        await shot('steward-ticked');

        /* Renamed through Claude Code's own two rename boxes, the tab's and the session list row's, with marks typed in
           every place: neither box is filled with a mark, the title is stored without any, and the tab and each row still
           show exactly one crown, first. */
        const crowned = (label, title) => typeof label === 'string' && label.startsWith(`${CROWN} `) && (label.match(/\u{1F451}/gu) || []).length === 1
          && !/\u2709|\u{1F6CE}/u.test(label) && titled(label.slice(CROWN.length + 1), title);
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
            `renamed through ${how} with ${what} typed: the box held no mark, the title is stored without one, and the tab and each row show one crown, first`,
            { err, held, typed, stored: storedTitle(front.id), tabs: (await claudeTabs()).map((x) => x.label), rows: await rowsOf(front.id) });
        }
        await page.mouse.move(5, 880);
        await shot('steward-renamed');
        /* A message the steward passes on with its script: the window types it into the managed conversation, which
           sends it as the user's message. The steward's tool call that runs the script is in its transcript first. */
        const target = threads.find((t) => t.id === boxes[0][0]);
        if (target) {
          const words = 'Please run the tests once more, then stop.';
          const hooks = path.join(__dirname, '..', '..', 'claude-plugin', 'agent-work-plan', 'hooks', 'steward-relay.py');
          fs.appendFileSync(transcriptOf(front), JSON.stringify({ type: 'assistant', uuid: `${front.id.slice(0, 24)}000000000777`,
            timestamp: new Date().toISOString(), sessionId: front.id, cwd: profile.folder, isSidechain: false,
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_relay_test', name: 'Bash',
              input: { command: `python3 ${hooks} ${target.id} <<'EOF'\n${words}\nEOF`, description: 'Pass the message on' } }] } }) + '\n');
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
            fs.appendFileSync(transcriptOf({ id: asker }), JSON.stringify({ type: 'assistant', uuid: `${asker.slice(0, 24)}${String(780000 + calls++).padStart(12, '0')}`,
              timestamp: new Date().toISOString(), sessionId: asker, cwd: profile.folder, isSidechain: false,
              message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_act_${calls}`, name: 'Bash',
                input: { command: line, description: 'Act for the user' } }] } }) + '\n');
            return new Promise((resolve) => {
              const kid = require('child_process').spawn(process.platform === 'win32' ? 'python' : 'python3', [hooks, ...args, dataDir],
                { env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: asker }) });
              let out = '';
              kid.stdout.on('data', (d) => { out += d; });
              kid.stderr.on('data', (d) => { out += d; });
              kid.on('error', (e) => resolve('could not run the script: ' + e.message));
              kid.on('exit', () => resolve(out.trim()));
              kid.stdin.end(input || '');
            });
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
             and a green ring while only work it put in the background runs. */
          const GREEN = `rgb(${DOTS.running.join(', ')})`, RED = `rgb(${DOTS.waiting.join(', ')})`;
          const panelRow = (id) => frame.evaluate((id) => {
            const a = document.querySelector(`li.row [data-open="${id}"]`), li = a && a.closest('li.row');
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
          /* Renamed through its session list row while the reply is unread, with envelopes and a crown typed: the title is
             stored without them, its tab ends in one envelope, and its rows have one envelope after the title. */
          /* The row's marks come before its title in the page and the envelope is drawn after it, so where it stands is read
             from the screen. Rows in a folded section have no box. */
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
            return storedTitle(target.id) === target.title && tab && tab.label.endsWith(ENVELOPE) && (tab.label.match(/\u2709/gu) || []).length === 1
              && !tab.label.includes(CROWN) && rs.length >= 1 && rs.every((r) => r.envs === 1 && r.after && r.crowns === 0 && r.name === target.title) && { tab: tab.label, rows: rs };
          }, 20000, 500);
          check(!errT && typeof heldT === 'string' && !MARK_RE.test(heldT) && !!kept,
            'renamed through its row with envelopes and a crown typed while its reply is unread: the title is stored without them, and its tab and rows show one envelope, last',
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
          check(!!ringRow, 'once its turn has ended with a command still running in the background, the row has a green ring, hollow in the middle', await panelRow(target.id));
          await shot('steward-row-background');

          /* A handoff, run from the managed conversation: it reaches the steward that manages it, as a notice that is not
             the user's message, through the steward's inbox. */
          const handed = model.seen.length;
          const handText = 'The user asked here for the release notes, which belong in another conversation.';
          const handoff = await actAs(target.id, ['--handoff'], handText);
          const arrivedHand = () => { try { const x = fs.readFileSync(transcriptOf(front), 'utf8'); return x.includes('Handoff from') && x.includes(`(${target.id}), passed on by Claude Code Plus`); } catch (_) { return false; } };
          if (process.platform === 'win32') {
            check(/^Not done: /.test(handoff) && /inbox/.test(handoff), 'on native Windows a handoff says the steward\'s inbox could not be reached', { handoff });
          } else {
            check(handoff.startsWith('Handed off to the steward ') && handoff.includes(`(${front.id})`) && !!await until(arrivedHand, 30000, 1000),
              'a managed conversation hands something off: the answer names the steward, which gets it as a notice from Claude Code Plus', { handoff, seen: model.seen.slice(handed).map((x) => (x.ask || '').slice(0, 160)) });
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
            /* A title of its own: Claude Code counts a closed tab it remembers as shown while another tab has its label, and a
               new conversation's tab is labelled Claude Code, as is the empty one a step before leaves. */
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
              'the new conversation is the steward\'s; while it works, closing it is refused without --confirmed, and done with it', { managed, idleNew, refusedClose, closed });
            /* With its tab closed no window shows that conversation, so the steward opens it again and passes it a
               message. Its process and this window's list of what it shows can take a moment to let it go. */
            if (/^Closed: /.test(closed)) {
              /* Two lines, to see that the line break reaches the transcript: the panel types the text, and Claude Code
                 sends what its input holds. */
              const later = 'Carry on where you left off, please.\nStart with the tests.';
              const manages = (id) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).stewards[front.id].manages.includes(id); } catch (_) { return null; } };
              /* Unticked first, from the line the panel shows for ticked conversations no window has open, so that the tick
                 the resume gives is seen to be given. */
              const drop = frame.locator('button[data-act="drop-hidden"]').first();
              const offered = await until(() => drop.isVisible().catch(() => false), 30000, 500);
              if (offered) await drop.click();
              const unticked = offered && await until(() => manages(newId) === false, 10000, 300);
              check(!!unticked, 'the Steward panel says a ticked conversation is open in no window, and its Untick button unticks it', { offered, manages: manages(newId) });
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
                  'while another process runs a conversation, the steward is refused opening it, told which process, and no tab opens', { refusedResume, shown, cli });
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
              check(manages(newId) === true && !!tickedBox, 'and it is ticked: stewards.json has it again, and so does its box in the Steward panel', { manages: manages(newId), box: await boxOf() });
              await shot('steward-resume');
              if (/^Opened/.test(resumed)) {
                const twice = await act(['--resume', newId], later);
                check(/already open in the VS Code window|already shows it/.test(twice), 'and it does not open one that a window already shows', { twice });
                for (let i = 0; i < 15; i++) {
                  if (/^Closed: /.test(await act(['--close', newId]))) break;
                  await new Promise((r) => setTimeout(r, 2000));
                }
              }
              /* Opened only in a window that has the folder the conversation started in open. Claude Code's panel shows
                 nothing for one started in a folder below the window's (it opens an empty tab), so that one is refused
                 too, as is one started in a folder no window has open. */
              const [inside, outside] = [FOLDER_THREADS[0], FOLDER_THREADS[1]];
              const insideFolder = path.join(profile.folder, 'sub'), outsideFolder = path.join(path.dirname(profile.folder), 'ws-c');
              for (const d of [insideFolder, outsideFolder]) fs.mkdirSync(d, { recursive: true });
              fakeHome.writeThreads(profile.home, insideFolder, [inside]);
              fakeHome.writeThreads(profile.home, outsideFolder, [outside]);
              const away2 = await act(['--resume', outside.id]);
              check(/^Not done: no open VS Code window has its folder, .*, open; Claude Code opens a conversation only in a window with the folder it was started in/.test(away2) && !(await shownHere() || []).includes(outside.id),
                'a conversation started in a folder no window has open is not opened, in this window or any other', { away2 });
              const tabsBefore = (await claudeTabs()).length;
              /* The script refuses before it writes any request, so nothing can open afterwards. */
              const below = await act(['--resume', inside.id]);
              check(/^Not done: no open VS Code window has its folder, .*, open;/.test(below) && !(await shownHere() || []).includes(inside.id)
                && (await claudeTabs()).length === tabsBefore,
                'and so is one started in a folder below this window\'s folder, which Claude Code\'s panel would show as an empty tab: no tab opens', { below, tabs: await claudeTabs() });
              /* Claude Code itself, asked to open it here, shows an empty tab: the reason for the refusal. */
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
          /* A second steward: the third conversation, ticking the managed one in its own panel. In the first steward's
             panel its row shows one crown, and the managed conversation's row none. */
          const second = threads.find((t) => t.id !== front.id && t.id !== target.id);
          if (second) {
            /* In an editor tab, so that it is the conversation the panel is about: an earlier step can have left it in the
               sidebar, which opening it by id only brings into view. */
            await openList();
            retried(await pick(second, ['Resume in tab']), 'Resume in tab');
            const box2 = frame.locator(`input[data-id="${target.id}"]`).first();
            const ticked2 = await until(async () => (await header()) && (await header()).includes(second.title.slice(0, 20)) && await box2.isVisible().catch(() => false), 30000, 500);
            if (ticked2 && !await box2.isChecked()) await box2.click();
            const isSteward2 = await until(() => { try { const t2 = JSON.parse(fs.readFileSync(file, 'utf8')).stewards[second.id]; return t2 && t2.manages.includes(target.id); } catch (_) { return false; } }, 10000, 300);
            await exec('claude-vscode.editor.open', front.id);
            const names = () => frame.evaluate(() => Object.fromEntries([...document.querySelectorAll('li.row [data-open]')].map((a) => [a.dataset.open, a.textContent])));
            const shown2 = await until(async () => { const n = await names(); return n[second.id] === `${CROWN} ${second.title}` && n[target.id] === target.title && n; }, 30000, 500);
            check(!!isSteward2 && !!shown2, 'in the first steward\'s panel, a second steward\'s row shows one crown before its title, and the row of a conversation that is no steward shows none',
              { ticked2: !!ticked2, isSteward2: !!isSteward2, names: await names() });
            await shot('steward-two-stewards');
            await exec('claude-vscode.editor.open', second.id);
            if (await until(async () => (await header()) && (await header()).includes(second.title.slice(0, 20)), 30000, 500)) await frame.locator('button[data-act="none"]').click();
            await exec('claude-vscode.editor.open', front.id);
            await until(async () => (await header()) === `${CROWN} ${front.title}`, 15000, 500);
          }
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
    });

    /* Two Claude Code processes under VS Code's extension host for one conversation, as after a window went away while
       its extension host stayed: the conversation's own tab, and then its CLI started from the extension host the way the
       panel starts it (stream-json, entry point claude-vscode), idle. Stop the old process then stops the tab's, the older.
       A process is tied to its extension host through /proc, so on Linux only. */
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
        check(!!own && !!two, 'its tab runs the conversation, and so does its CLI started after it from the extension host as the panel starts it', of(t.id));
        const older = own ? own.pid : 0;
        await exec('claude-vscode.editor.open', front.id);
        await openList();
        const mark = () => list.evaluate((id) => [...document.querySelectorAll(`[class*="sessionItem_"][id$="${id}"] span[class*="sessionName_"]`)]
          .map((n) => getComputedStyle(n, '::after').content), t.id);
        const marked = await until(async () => { const m = await mark(); return m.length && m.every((c) => /· 2 processes/.test(c)) && m; }, 45000, 1000);
        check(!!marked, 'each of its rows in the session list says 2 processes after the title', await mark());
        await exec('workbench.view.extension.claudeCodePlusSteward');
        const panel = await frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
        const rowNow = () => panel.evaluate((id) => {
          const a = document.querySelector(`li.row [data-open="${id}"]`), li = a && a.closest('li.row');
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
          const cleared = await until(async () => { const r = await rowNow(), m = await mark(); return r && !r.twice && !r.stop && m.every((c) => !/processes/.test(c)); }, 45000, 1000);
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

    /* VS Code creates a restored tab's page only when the tab is first shown. With claudeCodePlus.loadRestoredTabs on, a
       reload loads the Claude Code tab behind the one in front without a click. */
    await step('restored tabs', async () => {
      const [front, behind] = threads;
      const setLoad = (v) => call(`await vscode.workspace.getConfiguration('claudeCodePlus').update('loadRestoredTabs', arg, vscode.ConfigurationTarget.Global); return true;`, v);
      const loaded = (t) => conversation(t, 1000).then((f) => !!f, () => false);
      const reloadAndWait = async () => {
        await w.reload();
        await until(async () => { const st = await patchState(); return st && st.active && st; }, 60000, 1000);
        await until(() => loaded(front), 60000, 1000);
      };
      await exec('workbench.action.closeAllEditors');
      await exec('workbench.action.closeAuxiliaryBar');
      await exec('claude-vscode.editor.open', behind.id);
      await sleep(1500);
      await exec('claude-vscode.editor.open', front.id);
      await sleep(1500);
      await reloadAndWait();
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
      await reloadAndWait();
      const withIt = await until(() => loaded(behind), 60000, 1000);
      const inFront = (await claudeTabs()).find((t) => t.active);
      check(!without && !!withIt && !!inFront && titled(inFront.label, front.title),
        'a reload leaves a Claude Code tab behind another unloaded; with claudeCodePlus.loadRestoredTabs on it is loaded, and the tab in front stays in front',
        { without, withIt: !!withIt, tabs: await claudeTabs() });
      await shot('restored-tabs-loaded');
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
        const rowLink = steward ? await until(() => steward.evaluate((id) => !!document.querySelector(`[data-open="${id}"]`), X.id), 45000, 1000) : false;
        check(!!rowLink, 'the Steward panel in window A lists X, open in window B', steward ? await steward.evaluate(() => document.body.innerText.slice(0, 400)) : 'no Steward panel');
        if (rowLink) {
          await steward.locator(`[data-open="${X.id}"]`).first().click();
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

    /* Last, since every step before needs the patch. Remove from Claude Code restores both files, and after a reload the
       session list is Claude Code's own; turning the extension on again puts the patch back, as the suite run after this
       stage expects. */
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
  } finally {
    await shot('last');
    await w.close();
  }
}

module.exports = { run };
