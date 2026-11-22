// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Usage: xvfb-run -a -s "-screen 0 3200x2000x24" node test/vscode/ui-look.js --pack <dir> --vsix <file>
 *          [--agent-plus <file>] [--out <dir>] [--cache <dir>] [<step> ...]
 *        node test/vscode/ui-look.js --features
 *
 * Puts the demo window of lib/demo.js (the one readme-shots.js uses) through each state of STEPS and saves pictures of
 * it, for an agent that can read images to review afterwards by LOOK.md. It runs only where someone starts it, never in
 * CI, and calls no model itself. With step names it runs only those; --features prints which steps show each feature of
 * ui-look-features.json and opens no window.
 *
 * Each step is { name, features, expect, unchanged, act, undo }. act puts the window into a state and returns the area
 * the step is about; expect says what a person should see there and what must not be there; unchanged says what must
 * look as it did just before the step; undo, when there is one, takes back what act left open. Notifications are left
 * on screen: one that should not be there is a finding. The root folder differs from readme-shots.js's, so the two can
 * run at once with different --cache folders.
 *
 * <out>/look.json lists the steps run, each with: name, features, expect, unchanged (null when the step that ran before
 * it is not the one it was written to follow), image (<name>.jpg, the step's area), full (<name>.full.jpg, the whole
 * window), previous (the whole window just before the step: the last step's full picture, or <last>.after.jpg when that
 * step had an undo; null for the first), width and height of image, log (lines the extensions, the extension host, the
 * window and its pages logged since the step before, and notifications that appeared), and note when act failed.
 * Pictures are JPEGs at CSS pixel scale. LOOK.md is copied beside look.json.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const fakeModel = require('./lib/fake-model');

const ROOT = path.join(os.tmpdir(), 'claude-code-plus-look');
const QUALITY = 80;
const LOG_LINES = 60;
const PANEL_VIEW = 'mainThreadWebview-claudeVSCodePanel';
const CSV = 'Start with the CSV export. Write it and its tests';
const BUDGET = 'What happens if someone sets a budget for a category';
/* A name too long for any session list row. */
const LONG = 'Where the retry delay for the inventory sync is set, and why the staging config overrides it with a longer one';
/* The fake model's plain answer (lib/fake-model.js). */
const PLAIN = 'Done. The retry delay is set in config/sync.yml.';

/* The helpers the steps share. */

/* The request goes as JSON, where an undefined in an array arrives as null; undefined is what puts a setting back to its
   default. */
const setting = (d, key, value) => d.call('await vscode.workspace.getConfiguration().update(arg[0], arg[1] === null ? undefined : arg[1], vscode.ConfigurationTarget.Global); return true;', [key, value]);
const theme = (d, name) => setting(d, 'workbench.colorTheme', name);
/* Agent Plus's token mode, and a pause for the extensions to follow it. */
const modeTo = async (d, mode) => { await setting(d, 'agentPlus.tokenMode', mode); await d.sleep(3000); };

/* Turns a setting off for one step; the undo puts it back to its default. */
const off = (key) => ({
  act: async (d, area) => {
    await setting(d, key, false);
    await d.sleep(2000);
    return area(d);
  },
  undo: async (d) => { await setting(d, key, undefined); await d.sleep(1500); },
});

/* The demo conversation in front, scrolled so that your message containing `text` is at the top. */
async function demoAt(d, text, { focus = false } = {}) {
  await d.exec('claude-vscode.editor.open', d.sid);
  await d.sleep(800);
  await d.focus(focus);
  if (text && !await d.toMessage(d.conv, text)) throw new Error(`no message of yours contains "${text}"`);
  await d.sleep(800);
  await d.away();
}

/* Focus view on or off in any conversation's page, by this extension's footer button. */
async function focusIn(d, frame, on) {
  const btn = frame.locator('[data-cce-focus-btn]').first();
  const folded = async () => (await btn.getAttribute('data-cce-fold').catch(() => null)) === 'folded';
  if ((await folded()) === on) return;
  await btn.click();
  await d.until(async () => (await folded()) === on, 5000, 200);
  await d.sleep(600);
}

const IMG = 'img[src^="data:image/"]';
async function toImage(d) {
  await demoAt(d, '', { focus: true });
  const found = await d.until(() => d.conv.evaluate(() => [...document.querySelectorAll('img')].some((i) => /^data:image\//.test(i.src) && i.naturalWidth > 0)), 60000, 500);
  if (!found) {
    const shown = await d.conv.evaluate(() => [...document.querySelectorAll('[title]')].map((e) => e.innerText).filter((t) => /\.png|image/i.test(t)).slice(0, 2).join(' | '));
    throw new Error(`no image was drawn in a reply within 60 s${shown ? `; in its place: ${shown.slice(0, 200)}` : ''}`);
  }
  await d.conv.evaluate(() => [...document.querySelectorAll('img')].find((i) => /^data:image\//.test(i.src)).scrollIntoView({ block: 'center' }));
  await d.sleep(1000);
}
const viewerOpen = (d) => d.conv.evaluate(() => { const v = document.getElementById('cce-img-view'); return !!v && v.style.display !== 'none'; });
const tocOpen = (frame) => frame.evaluate(() => { const t = document.getElementById('cce-toc'); return !!t && t.style.display === 'block'; });
const infoOpen = (frame) => frame.evaluate(() => { const b = document.getElementById('cce-info'); return !!b && b.style.display === 'block'; });

async function openToc(d) {
  if (!await tocOpen(d.conv)) await d.conv.locator('#cce-toc-handle').click();
  if (!await d.until(() => tocOpen(d.conv), 5000, 200)) throw new Error('the list of your messages did not open');
}
/* Rests on the `n`th row of the open list of your messages, until the row shows that it is under the mouse. */
async function hoverRow(d, n) {
  const row = d.conv.locator('#cce-toc > div:nth-child(2) > div').nth(n);
  /* The list is drawn again when the conversation's page changes, which drops the highlight until the mouse moves. */
  for (let i = 0; i < 4; i++) {
    await d.away();
    await row.hover();
    await d.sleep(1200);
    if (await row.evaluate((e) => !!e.style.background).catch(() => false)) return;
  }
  throw new Error('the row under the mouse did not stay lit up');
}
async function closeToc(d) { if (await tocOpen(d.conv)) { await d.conv.locator('#cce-toc-handle').click(); await d.sleep(400); } }

/* Moves the mouse onto an empty spot inside `frame`'s page. A page is told the mouse left an element only when the mouse
   moves within it: jumped straight outside the page, it still counts the mouse as over the last element, and resting on
   that element again starts no hover. */
async function rest(d, frame, at = 'top') {
  const box = await (await frame.frameElement()).boundingBox();
  if (!box) return;
  await d.page.mouse.move(box.x + 30, at === 'top' ? box.y + 70 : box.y + box.height - 12);
  await d.sleep(300);
}

/* This extension's hover label in `frame` for the element `sel`. */
async function hoverLabel(d, frame, sel) {
  await rest(d, frame);
  await frame.locator(sel).first().hover();
  const shown = await d.until(() => frame.evaluate(() => { const b = document.querySelector('[data-cce-label="1"]'); return !!b && !!b.innerText.trim(); }), 3000, 100);
  if (!shown) throw new Error(`no hover label appeared for ${sel}`);
  await d.sleep(300);
}

/* Claude Code's session list in the side bar, found again each time: switching views can rebuild its page. */
async function sessionList(d) {
  await d.exec('workbench.view.extension.claude-sessions-sidebar');
  const list = await d.frameWhere(() => !!document.querySelector('[data-cce-new-session]'), 60000);
  if (!list) throw new Error('the session list did not open in 60 s');
  await d.sleep(1500);
  await d.widen();
  return list;
}
const listRow = (list, id) => list.locator(`[class*="sessionItem_"]:has([data-cce-pin="${id}"]):not([data-cce-section] *)`).first();
const menus = (list) => list.evaluate(() => [...document.querySelectorAll('[role="menu"]')].filter((m) => m.getClientRects().length).length);
const menuItem = (list, label, level = 0) => list.locator('[role="menu"]').nth(level).locator('[role="menuitem"]').filter({ hasText: label }).first();
async function closeMenus(d, list) {
  for (let i = 0; i < 3 && (await menus(list)); i++) { await d.page.keyboard.press('Escape'); await d.sleep(300); }
}

/* Right-clicks the row of conversation `id` and, given `sub`, rests on that item so its submenu opens. The list closes
   its menu whenever its page loses the focus, which another webview of the window can take at any moment, so this tries
   three times. */
async function rowMenu(d, list, id, sub) {
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await closeMenus(d, list);
      await listRow(list, id).click({ button: 'right', timeout: 5000 });
      if (!await d.until(async () => (await menus(list)) > 0, 5000, 100)) throw new Error('no menu opened');
      if (!sub) return;
      await menuItem(list, sub).hover({ timeout: 3000 });
      if (await d.until(async () => (await menus(list)) > 1, 5000, 100)) return;
      last = `the ${sub} submenu did not open`;
    } catch (e) { last = e.message.split('\n')[0]; }
    await d.sleep(1000);
  }
  throw new Error(`could not open the menu of a row: ${last}`);
}
/* Clicks `label` in the menu of the row of `id`, opening it first. */
async function rowPick(d, list, id, label) {
  await rowMenu(d, list, id);
  await menuItem(list, label).click({ timeout: 3000 });
  await d.sleep(800);
}
const archivedHeader = (list) => list.locator('button, [role="button"]').filter({ hasText: /^Archived/ }).first();
async function showArchived(d, list, id) {
  if (!await d.until(() => archivedHeader(list).isVisible().catch(() => false), 15000, 500)) throw new Error('there is no Archived sessions section');
  if (!await listRow(list, id).isVisible().catch(() => false)) await archivedHeader(list).click();
  await listRow(list, id).waitFor({ state: 'visible', timeout: 15000 });
}
/* VS Code's modal dialog, drawn in the page with window.dialogStyle "custom". */
const dialog = (d) => d.page.evaluate(() => {
  const e = [...document.querySelectorAll('.monaco-dialog-box')].find((x) => x.offsetParent);
  return e ? e.innerText : null;
});
async function answerDialog(d, label) {
  if (!await dialog(d)) return;
  await d.page.locator('.monaco-dialog-box .monaco-button').filter({ hasText: label }).first().click();
  await d.until(async () => !(await dialog(d)), 5000, 200);
}

/* A fake conversation of lib/fake-home.js in a tab of its own, and its page. */
async function thread(d, t) {
  await d.exec('claude-vscode.editor.open', t.id);
  const frame = await d.frameWhere((q) => document.querySelectorAll('[class*="userMessage_"]').length >= q.n && document.body.innerText.includes(q.ask)
    && !!document.querySelector('[data-testid="assistant-message"]'), 60000, { n: t.turns.length, ask: t.turns[0][0] });
  if (!frame) throw new Error(`the conversation "${t.title}" did not open in 60 s`);
  await d.sleep(1200);
  return frame;
}
async function closeTab(d, t) {
  await d.call(`const t = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input && x.input.viewType === ${JSON.stringify(PANEL_VIEW)}
    && x.label && arg.startsWith(x.label.replace(/\u2026$/, '')) && x.label.length >= 12);
    if (t) await vscode.window.tabGroups.close(t); return !!t;`, t.title);
  await d.sleep(800);
}
/* Sends `text` from a conversation's message box. */
async function send(d, frame, text) {
  await frame.locator('[contenteditable][role="textbox"]').first().click();
  await d.page.keyboard.type(text);
  await d.page.keyboard.press('Enter');
}
const lastReplyHas = (frame, text) => frame.evaluate((t) => {
  const r = [...document.querySelectorAll('[data-testid="assistant-message"]')].pop();
  return !!r && r.innerText.includes(t);
}, text);
async function toBottom(frame) {
  await frame.evaluate(() => {
    const last = [...document.querySelectorAll('[data-testid="assistant-message"], [class*="userMessage_"]')].pop();
    if (last) last.scrollIntoView({ block: 'end' });
  });
}
/* A text file opened in the active editor group, which puts the tab in front there into the background. */
async function notesInFront(d) {
  const file = path.join(d.profile.folder, 'notes.txt');
  if (!fs.existsSync(file)) fs.writeFileSync(file, 'Notes for the demo.\n');
  await d.call(`await vscode.window.showTextDocument(vscode.Uri.file(arg[0]), { preview: false, viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn });
    return true;`, [file]);
  await d.sleep(800);
}
/* The area around the first element of `frame` matching `sel`, kept inside the editor; the editor when there is none. */
async function around(d, frame, sel, padX = 240, padY = 40) {
  const ed = await d.editor();
  const b = await frame.locator(sel).first().boundingBox().catch(() => null);
  if (!b || !ed) return ed;
  const x = Math.max(ed.x, b.x - padX), y = Math.max(ed.y, b.y - padY);
  return { x, y, width: Math.min(ed.x + ed.width, b.x + b.width + padX) - x, height: Math.min(ed.y + ed.height, b.y + b.height + padY) - y };
}
/* The footer's agents button of `frame`: its dot's state and its label, or null. */
const agentsButton = (frame) => frame.evaluate(() => {
  const b = document.querySelector('button[data-agents-dot]');
  return b ? { dot: b.getAttribute('data-agents-dot'), label: b.getAttribute('aria-label') || '' } : null;
});
/* Sends `text` and waits for the turn to end: Claude Code asks to run the command it brings, which is allowed. */
async function runAsked(d, frame, text, shown) {
  const before = d.model.seen.length;
  await send(d, frame, text);
  if (!await d.until(() => d.model.seen.slice(before).some((x) => x.tool), 30000, 300)) throw new Error(`"${text}" got no tool call in 30 s`);
  if (await d.until(() => frame.evaluate((c) => /Allow this bash command\?/.test(document.body.innerText) && document.body.innerText.includes(c), shown), 8000, 500)) {
    await permissionButton(frame, 'Yes').click({ timeout: 5000 });
  }
  if (!await d.until(() => d.model.seen.slice(before).some((x) => x.stream && !x.tool && (x.parts || []).includes('tool_result')), 30000, 300)) {
    throw new Error(`the command "${text}" asked for did not come back to the model in 30 s`);
  }
  await d.sleep(3000);
  return before;
}
const permissionAsked = (frame) => frame.evaluate(() => /Allow this bash command\?/.test(document.body.innerText));
const permissionButton = (frame, label) => frame.locator('button, [role="button"]').filter({ hasText: new RegExp(`^\\s*\\d\\s*${label}\\s*$`) }).first();
async function askPermission(d, frame) {
  if (await permissionAsked(frame)) return;
  await send(d, frame, 'Please run the test suite.');
  if (!await d.until(() => permissionAsked(frame), 30000, 500)) throw new Error('Claude Code did not ask for permission to run the command within 30 s');
  await d.sleep(1500);
}
/* This extension's marks: the crown, the envelope in either form, the old bell (src/title-marks.js). */
const CROWN = '\u{1F451}';
const MARK_RE = /\u{1F451}|\u{1F6CE}|\u2709/u;
const tabLabels = (d) => d.call(`return vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((x) => x.input
  && String(x.input.viewType || '').endsWith('claudeVSCodePanel')).map((x) => x.label);`, []);
/* The name a conversation's transcript stores, from its last custom-title record, or ''. */
function storedTitle(d, id) {
  const projects = path.join(d.profile.home, '.claude', 'projects');
  for (const dir of fs.readdirSync(projects)) {
    const file = path.join(projects, dir, `${id}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('"type":"custom-title"')).pop();
    try { return line ? String(JSON.parse(line).customTitle || '') : ''; } catch (_) { return ''; }
  }
  return '';
}
/* Renames a conversation through its session list row's own Rename button, typing `name` over the title it holds. */
async function renameInList(d, list, id, name) {
  const row = listRow(list, id);
  await row.hover();
  await d.sleep(500);
  await row.locator('[title="Rename session"]').first().click();
  await d.sleep(600);
  const held = await row.evaluate((r) => { const e = r.querySelector('[contenteditable]'); return e ? e.textContent : null; });
  if (held === null) throw new Error('the row did not open its rename box');
  await d.page.keyboard.press('Control+A');
  await d.page.keyboard.insertText(name);
  await d.page.keyboard.press('Enter');
  await d.sleep(2000);
  return held;
}
/* The live conversation (the first fake one), with the session list in the side bar for its row under OPEN SESSIONS. */
async function live(d) {
  const t = d.threads[0];
  if (!d.liveFrame) d.liveFrame = await thread(d, t);
  else { await d.exec('claude-vscode.editor.open', t.id); await d.sleep(1000); }
  return d.liveFrame;
}
/* Before the window opens: transcripts as Claude Code's CLI writes them for `claude --bg`, for `claude -p` and for
   one of its daemon sessions. This extension leaves all three out of the session list while
   claudeCodePlus.hideBackgroundSessions is on, and with it off lists the first two. */
const BACKGROUND_TITLE = 'Nightly report run in the background';
const PRINT_TITLE = 'Weekly digest written by claude -p';
const DAEMON_TITLE = 'Daemon session never listed';
function prepare({ projects, threads }) {
  const t = threads[2];
  const src = fs.readFileSync(path.join(projects, `${t.id}.jsonl`), 'utf8');
  /* Every record id of the conversation it is copied from starts with that conversation's first 24 characters. */
  const copy = (head, entry, title) => fs.writeFileSync(path.join(projects, `${head + t.id.slice(24)}.jsonl`),
    src.split(t.id.slice(0, 24)).join(head).split('"entrypoint":"claude-vscode"').join(entry).split(t.title).join(title));
  copy('5b0d1c2e-9a8f-4c6b-8d7e-', '"entrypoint":"cli","sessionKind":"bg"', BACKGROUND_TITLE);
  copy('6c1e2d3f-0b9a-4d7c-9e8f-', '"entrypoint":"sdk-cli"', PRINT_TITLE);
  copy('7d2f3e4a-1c0b-4e8d-af90-', '"entrypoint":"cli","sessionKind":"daemon"', DAEMON_TITLE);
}

/* The steps. */

/*
 * Agent Plus's notices as cards (agentPlus.notifications.style on panel), for the notice-cards steps: four conversations
 * reported one after another through one more window file in Agent Plus's shared attention folder, as another VS Code
 * window would report them. Each works for a moment first, since Agent Plus announces a conversation that stops or waits
 * after working. Needs an Agent Plus that has the setting, which --agent-plus gives before it is published.
 */
const NOTICE_TITLES = [['Fix the flaky build on main', 'finished'], ['Write the release notes for 1.3', 'waiting'],
  ['Rename the steward commands', 'finished'], ['Review the pull request that colours the session list', 'waiting']];
let noticeOther = null;
async function noticePage(d) {
  return d.frameWhere(() => !!document.querySelector('[data-ap-stack] [data-ap-card]') && !!document.querySelector('[data-testid="assistant-message"]'), 30000);
}
async function noticeCards(d) {
  const has = await d.call(`const e = vscode.extensions.getExtension('xnervwang.agent-plus'), p = e && e.packageJSON;
    return !!(p && ((p.contributes.configuration || {}).properties || {})['agentPlus.notifications.style']);`);
  if (!has) throw new Error('the Agent Plus in this window has no agentPlus.notifications.style; give --agent-plus a build that has it');
  await setting(d, 'agentPlus.notifications.style', 'panel');
  if (!noticeOther) {
    const dir = path.join(d.profile.home, '.agent-work-plan', 'attention');
    const file = path.join(dir, 'zz0uilook-0000000c.json');
    const o = { items: [] };
    o.write = () => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify({ format: 1, at: Date.now(), items: o.items, front: [] }) + '\n');
      fs.renameSync(file + '.tmp', file);
    };
    o.report = (i, activity) => {
      const id = `c1c1c1c1-0000-4000-8000-00000000000${i + 1}`;
      o.items = o.items.filter((x) => x.sessionId !== id).concat([{ sourceId: 'claude-code', source: 'Claude Code', sessionId: id,
        title: NOTICE_TITLES[i][0], cwd: d.profile.folder, state: activity === 'waiting' ? 'prompt' : activity === 'working' ? 'working' : 'unread',
        activity, unseen: activity === 'stopped', steward: false, since: Date.now() }]);
      o.write();
    };
    o.timer = setInterval(o.write, 1000);
    noticeOther = o;
    await demoAt(d, '');
    for (let i = 0; i < NOTICE_TITLES.length; i++) {
      o.report(i, 'working');
      await d.sleep(2500);
      o.report(i, NOTICE_TITLES[i][1] === 'waiting' ? 'waiting' : 'stopped');
      const n = i + 1;
      await d.until(() => d.frameWhere((k) => document.querySelectorAll('[data-ap-stack] [data-ap-card]').length === k, 1000, n).then(Boolean, () => false), 30000, 500);
    }
  }
  return noticePage(d);
}
/* The stack and what is around it: the area of a notice-cards step. */
async function noticeArea(d, frame, above = 170) {
  const b = await frame.locator('[data-ap-stack]').boundingBox();
  const ed = await d.editor();
  const box = { x: b.x - 260, y: b.y - above, width: b.width + 280, height: b.height + above + 130 };
  if (ed) {
    const r = Math.min(box.x + box.width, ed.x + ed.width), bottom = Math.min(box.y + box.height, ed.y + ed.height);
    box.x = Math.max(box.x, ed.x); box.y = Math.max(box.y, ed.y); box.width = r - box.x; box.height = bottom - box.y;
  }
  return box;
}
/* Draws card `i` out, the pointer coming in from the left along the strip the card shows. */
async function noticePull(d, frame, i) {
  const c = await frame.locator('[data-ap-card]').nth(i).boundingBox();
  await d.page.mouse.move(c.x - 60, c.y + 4);
  await d.page.mouse.move(c.x + c.width / 2, c.y + 4, { steps: 6 });
  await d.sleep(700);
}
async function noticeCardsOff(d) {
  if (noticeOther) { clearInterval(noticeOther.timer); noticeOther = null; }
  await d.exec('agentPlus.dismissAttention').catch(() => {});
  await setting(d, 'agentPlus.notifications.style', null);
  await d.sleep(1500);
}

const STEPS = [
  /* The demo conversation, dark theme. */
  {
    name: 'conversation', features: ['timestamps', 'reply-figures', 'user-messages', 'navigation', 'self-check', 'dot-background'],
    expect: 'A conversation in an editor tab with its tool rows shown (rows headed Bash, Read, Edit, Write and the like, with IN '
      + 'and OUT boxes). Each of your own messages is a box with a colored bar down its left edge and starts with a date and '
      + 'time. Every row of a reply starts with a small grey date and time: a thinking row, a text row, and each tool row, where '
      + 'the time reads start->end (two times joined by an arrow) on a line of its own above the tool\'s name. The first row of '
      + 'each reply also shows, after its time, how long the turn had taken, the model and its effort (for example "22s . '
      + 'opus-5-5 xhigh"). A narrow column of buttons runs down the right edge and covers no letters. No warning banner from '
      + 'the page. The tab\'s logo carries a green ring at its top right, hollow in the middle rather than a filled dot: no '
      + 'turn runs, and the demo left a command running detached, which counts as background work. The tab\'s title ends '
      + 'without an envelope.',
    unchanged: null,
    act: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'token-mode-notice', features: ['token-mode'],
    expect: 'The notice that asked which token mode to use (shown at the bottom right, or by now moved into the list of '
      + 'notifications) has been answered with All features, the mode the status bar already named. The notice is gone, '
      + 'nothing covers the panel\'s footer, the list of notifications is closed, and the token mode entry in the status bar '
      + 'still says All.',
    unchanged: 'The side bar, the tab bar and the conversation look as before.',
    act: async (d) => {
      const button = (where) => d.page.locator(`${where} .monaco-button`).filter({ hasText: /^\s*All/ }).first();
      let btn = button('.notifications-toasts');
      if (!await btn.isVisible().catch(() => false)) {
        await d.exec('notifications.showList');
        await d.sleep(800);
        btn = button('.notifications-center');
      }
      if (!await btn.isVisible().catch(() => false)) {
        await d.exec('notifications.hideList').catch(() => {});
        throw new Error('no notice about token modes was on screen or in the list of notifications');
      }
      await btn.click();
      await d.sleep(1000);
      await d.exec('notifications.hideList').catch(() => {});
      await d.sleep(500);
      await d.away();
      return d.body();
    },
  },
  {
    name: 'focus-view-on', features: ['focus-view'],
    expect: 'Focus view is on: your messages and the text of the replies, with each run of thinking and tool calls folded into '
      + 'one short row (such as "Thinking" or "2 tool calls" with a small arrow) that opens on a click. No tool row itself is '
      + 'shown (no Bash or Write header, no IN or OUT box). No row holds only a dot with no text, no fold row says "0 tool '
      + 'calls", and there are no large empty gaps. Your messages and the reply text still carry their times.',
    unchanged: 'The tab bar, the side bar and the message box with its footer look as before; the same messages of yours '
      + 'appear in the same order.',
    act: async (d) => { await demoAt(d, CSV, { focus: true }); return d.editor(); },
  },
  {
    name: 'footer-focus-hover', features: ['footer-buttons', 'focus-view'],
    expect: 'The mouse rests on the Focus view button in the footer under the message box. A hover label for it says that '
      + 'Focus view is on and that a click shows the thinking and tool calls again. The label lies wholly inside the panel '
      + 'and is readable; the footer\'s buttons do not overlap one another.',
    unchanged: 'The conversation above the message box is as before: Focus view on, the same rows.',
    act: async (d) => { await demoAt(d, CSV, { focus: true }); await hoverLabel(d, d.conv, '[data-cce-focus-btn]'); return d.editor(); },
    undo: (d) => rest(d, d.conv),
  },
  {
    name: 'footer-mute-hover', features: ['chime-mute', 'footer-buttons'],
    expect: 'The mouse rests on the mute button in the footer (a music note), before any click. Its hover label says that a '
      + 'chime sounds when a turn finishes or Claude waits, and that a click mutes it. The label is wholly inside the panel.',
    unchanged: 'The conversation above the message box is as before.',
    act: async (d) => { await demoAt(d, CSV, { focus: true }); await hoverLabel(d, d.conv, '[data-cce-mute]'); return d.editor(); },
    undo: (d) => rest(d, d.conv),
  },
  {
    name: 'footer-muted', features: ['chime-mute', 'footer-buttons'],
    expect: 'The mute button has just been clicked, so the chimes are muted: the music note is drawn dimmed and struck '
      + 'through. The mouse rests on it again, and its hover label now says the chimes are muted and that a click brings '
      + 'them back.',
    unchanged: 'The conversation above the message box is as before.',
    act: async (d) => {
      await demoAt(d, CSV, { focus: true });
      await d.conv.locator('[data-cce-mute]').first().click();
      await d.sleep(500);
      await hoverLabel(d, d.conv, '[data-cce-mute]');
      return d.editor();
    },
    undo: async (d) => { await d.conv.locator('[data-cce-mute]').first().click(); await d.sleep(400); await rest(d, d.conv); },
  },
  {
    name: 'footer-info-hover', features: ['footer-buttons', 'session-info'],
    expect: 'The mouse rests on the info button (an "i") in the footer. Its hover label says what the button shows: the session '
      + 'id, process id, starting folder, transcripts and token mode. The label is wholly inside the panel and readable.',
    unchanged: 'The conversation above the message box is as before; the mute button is back in its normal (not muted) look.',
    act: async (d) => { await demoAt(d, CSV, { focus: true }); await hoverLabel(d, d.conv, '[data-cce-info]'); return d.editor(); },
    undo: (d) => rest(d, d.conv),
  },
  {
    name: 'image-in-reply', features: ['reply-images'],
    expect: 'A reply that shows a bar chart inside the conversation. The chart is drawn at a moderate size: no more than about '
      + '640 by 480 px in this picture, clearly narrower than the conversation column, and large enough to read its labels; '
      + 'not stretched, not cut off, not a thumbnail.',
    unchanged: 'The tab bar, the side bar and the footer look as before.',
    act: async (d) => { await toImage(d); await d.away(); return d.editor(); },
  },
  {
    name: 'image-opened', features: ['reply-images'],
    expect: 'The chart from the reply, after a click on it, shown large over the conversation on a dark backdrop that covers '
      + 'the whole panel. The chart fills most of the panel\'s width or height, keeps its shape, and is not cut off.',
    unchanged: 'Outside the panel (tab bar, side bar, status bar) everything looks as before.',
    act: async (d) => {
      await toImage(d);
      await d.conv.locator(IMG).first().click();
      if (!await d.until(() => viewerOpen(d), 5000, 200)) throw new Error('a click on the image did not open it large');
      await d.sleep(600);
      return d.editor();
    },
  },
  {
    name: 'image-closed', features: ['reply-images'],
    expect: 'The conversation after the large chart was closed with Escape: no dark backdrop and no large chart over the panel; '
      + 'the chart shows again at its moderate size inside the reply. No turn was stopped: no "interrupted" text.',
    unchanged: 'The conversation behind the backdrop in the previous picture is the same as here: the same reply and chart.',
    act: async (d) => {
      if (!await viewerOpen(d)) {
        await toImage(d);
        await d.conv.locator(IMG).first().click();
        if (!await d.until(() => viewerOpen(d), 5000, 200)) throw new Error('a click on the image did not open it large');
        await d.sleep(400);
      }
      await d.page.keyboard.press('Escape');
      if (!await d.until(async () => !(await viewerOpen(d)), 5000, 200)) throw new Error('Escape did not close the large image');
      await d.sleep(400);
      await d.away();
      return d.editor();
    },
  },
  {
    name: 'navigation-list', features: ['navigation'],
    expect: 'The list of your messages, opened from the narrow column of buttons on the right edge: each row a time and then the '
      + 'message\'s opening words, the times lined up in one column, a filter box at the top. A message too long for its row '
      + 'ends in an ellipsis rather than being cut in the middle of a letter. Exactly one row, the one under the mouse, is '
      + 'highlighted. The list does not cover the column of buttons.',
    unchanged: 'The conversation behind the list is as before, with its tool rows shown again.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      await openToc(d);
      await d.away();
      await hoverRow(d, 3);
      return d.editor();
    },
  },
  {
    name: 'navigation-filter', features: ['navigation'],
    expect: 'The same list with "budget" typed into its filter box: only the rows of messages that contain that word are left, '
      + 'each still with its time; no empty rows, no rows of other messages.',
    unchanged: 'The conversation behind the list and the column of buttons are as before.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      await openToc(d);
      const box = d.conv.locator('#cce-toc input').first();
      await box.click();
      await box.fill('budget');
      await d.sleep(800);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.conv.locator('#cce-toc input').first().fill('').catch(() => {}); await closeToc(d); },
  },
  {
    name: 'rail-next', features: ['navigation'],
    expect: 'The list is closed. After a click on the down arrow of the narrow column of buttons on the right edge, the '
      + 'conversation has scrolled to your next message, "Leave the README for later, I\'ll write that part myself. Commit '
      + 'what\'s done.", which now sits at or near the top of the panel.',
    unchanged: 'The tab bar, the side bar and the footer are as before; only the conversation has scrolled.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      await closeToc(d);
      const next = await d.conv.evaluate(() => {
        const rail = document.getElementById('cce-toc-rail');
        const b = rail && [...rail.querySelectorAll('[title]')].find((e) => /^Next message/.test(e.title) && e.offsetParent);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!next) throw new Error('the column of buttons on the right edge has no button for the next message');
      const frame = await (await d.conv.frameElement()).boundingBox();
      await d.page.mouse.click(frame.x + next.x, frame.y + next.y);
      await d.sleep(1500);
      await d.away();
      return d.editor();
    },
  },
  {
    name: 'context-meter', features: ['context-meter'],
    expect: 'The mouse rests on the small round usage meter in the footer under the message box; the meter is visible. A box '
      + 'above it says how much of the context window is used, with a breakdown by category and a line on what the work plan '
      + 'added. Every percentage in it is between 0 and 100; the box lies wholly inside the panel with its text wrapped, not '
      + 'cut off at an edge.',
    unchanged: 'The conversation is scrolled back to your message about a budget for a category; the tab bar and side bar are '
      + 'as before.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      const meter = d.conv.locator('button[class*="usageButtonV2"]').first();
      if (!await meter.count()) throw new Error('there is no usage meter in the footer');
      await meter.hover();
      await d.sleep(3000);
      return d.editor();
    },
    undo: (d) => d.away(),
  },
  {
    name: 'info-box', features: ['session-info', 'token-mode'],
    expect: 'The information box opened from the footer\'s info button: labelled rows for the session id, the process id, '
      + 'the starting folder, the transcript and its size, and the token mode (which matches the token mode entry in the status '
      + 'bar of the whole-window picture). The rows are aligned and readable and lie inside the panel; long paths wrap or end '
      + 'in an ellipsis rather than running off the edge.',
    unchanged: 'The conversation behind the box is as before; the meter\'s box is gone.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      if (!await infoOpen(d.conv)) await d.conv.locator('[data-cce-info]').first().click();
      if (!await d.until(() => infoOpen(d.conv), 5000, 200)) throw new Error('the information box did not open');
      await d.away();
      return d.editor();
    },
    undo: async (d) => { if (await infoOpen(d.conv)) { await d.conv.locator('[data-cce-info]').first().click(); await d.sleep(400); } },
  },
  {
    name: 'agent-map', features: ['agent-map'],
    expect: 'The agent map, opened from the footer\'s button that counts background work ("1 detached . 1 timer"). It lists one '
      + 'command left running detached (a sleep) with its command line, process id and start time, and one scheduled prompt '
      + 'with its schedule and text. The conversation\'s own row starts with a green ring, hollow in the middle, since the '
      + 'detached command runs. Rows are readable and inside the box; no empty rows; counts at the top match the rows.',
    unchanged: 'The conversation behind the map is as before; the information box is closed.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      const button = d.conv.locator('button, [role="button"]').filter({ hasText: /\bdetached\b|\btimer\b/ }).first();
      if (!await d.until(() => button.isVisible().catch(() => false), 60000, 500)) throw new Error('the footer\'s button for background work counted nothing in 60 s');
      await d.until(() => d.conv.evaluate(() => /\bdetached\b/.test(document.body.innerText)), process.platform === 'linux' ? 30000 : 1, 500);
      await button.click({ timeout: 5000 });
      await d.sleep(1500);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); },
  },
  {
    name: 'narrow', features: ['narrow-panel', 'timestamps', 'reply-figures', 'navigation'],
    expect: 'The conversation in a narrow editor, about 400 px wide, with tool rows shown. Every line of reply text wraps inside '
      + 'the panel: no word is cut off at the right edge. Each row\'s time and figures fit or wrap; they do not push past the '
      + 'edge or squeeze a tool\'s name or description. The column of buttons on the right edge covers no letters. Code blocks '
      + 'and tables may be cut at the edge only if they scroll sideways.',
    unchanged: 'The side bar shows the same view as before, only wider.',
    act: async (d) => {
      const ed = await d.editor(), sb = await d.sidebar();
      if (ed && sb && ed.width > 420) await d.sideTo(sb.width + ed.width - 400);
      await demoAt(d, BUDGET);
      return d.editor();
    },
  },
  {
    name: 'narrow-footer', features: ['narrow-panel', 'footer-buttons'],
    expect: 'The bottom of the same narrow editor: the message box and its footer. The footer\'s buttons (this extension\'s '
      + 'and Claude Code\'s own) fit in the width or wrap onto another line; none overlaps another, none is cut in half at the '
      + 'edge, and the usage meter is visible.',
    unchanged: 'The editor is as narrow as before and shows the same messages.',
    act: async (d) => {
      const ed = await d.editor(), sb = await d.sidebar();
      if (ed && sb && ed.width > 420) await d.sideTo(sb.width + ed.width - 400);
      const e = await d.editor();
      return { x: e.x, y: e.y + e.height - 260, width: e.width, height: 260 };
    },
    undo: (d) => d.sideTo(460),
  },
  {
    name: 'quiet-peer-shown', features: ['quiet-replies'],
    expect: 'A short conversation in a second tab, with Focus view off. After your message "Add a dry-run flag to the cleanup '
      + 'script." and its reply come two messages from another conversation, each shown as an italic row "Message from '
      + '@Release-notes: ..." followed by its thinking and Bash rows. The lone dash each of them got as its reply is not shown '
      + 'anywhere, and no row holds only a dot.',
    unchanged: 'The side bar is back to its earlier width; the first tab is still there.',
    act: async (d) => { const frame = await thread(d, d.threads[2]); await focusIn(d, frame, false); await d.away(); return d.editor(); },
  },
  {
    name: 'quiet-peer', features: ['quiet-replies', 'focus-view'],
    expect: 'The same short conversation with Focus view on: your message "Add a dry-run flag to the cleanup script." and its '
      + 'reply, and below that reply nothing more from the conversation: no fold row for the messages from another '
      + 'conversation, no row holding only a dot, no lone dash, no blank gap before the message box.',
    unchanged: 'The tab bar and the side bar are as before.',
    act: async (d) => { const frame = await thread(d, d.threads[2]); await focusIn(d, frame, true); await d.sleep(800); await d.away(); return d.editor(); },
    undo: async (d) => { const frame = await thread(d, d.threads[2]); await focusIn(d, frame, false); await closeTab(d, d.threads[2]); },
  },

  /* Settings turned off, one at a time, on the demo conversation. */
  {
    name: 'off-timestamps', features: ['timestamps'], ...off('claudeCodePlus.show.timestamps'),
    expect: 'The conversation with this extension\'s times switched off: your messages and the reply rows no longer start with '
      + 'its grey date and time (Claude Code may show its own, shorter times instead). The reply figures (duration, model) '
      + 'may remain. Nothing else is missing, and no gap is left where the times were.',
    unchanged: 'The same messages and rows as in the first picture of this conversation, in the same place.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-reply-duration', features: ['reply-figures'], ...off('claudeCodePlus.show.replyDuration'),
    expect: 'The times are back. The first row of each reply shows its time and the model and effort, but no longer how long the '
      + 'turn took (no "22s"-style figure); no doubled separator dot is left where it was.',
    unchanged: 'The same messages and rows in the same place.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-model-name', features: ['reply-figures'], ...off('claudeCodePlus.show.modelName'),
    expect: 'The durations are back, but the model and effort names are gone from the replies\' rows (no "opus-5-5 xhigh"); no '
      + 'dangling separator dot is left after the duration.',
    unchanged: 'The same messages and rows in the same place.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-toc', features: ['navigation'], ...off('claudeCodePlus.show.toc'),
    expect: 'The model names are back. The narrow column of buttons on the right edge is gone, and the conversation does not '
      + 'keep an empty strip where it was wider than needed; nothing else changed.',
    unchanged: 'The same messages and rows; the footer is unchanged.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-context-meter', features: ['context-meter'], ...off('claudeCodePlus.show.contextMeter'),
    expect: 'The column of buttons is back on the right edge. With this setting off, Claude Code decides alone whether the round '
      + 'usage meter shows in the footer, so it may be gone; the other footer buttons stay in place without a gap that looks '
      + 'broken.',
    unchanged: 'The conversation above the message box is as before.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-footer-info', features: ['session-info', 'footer-buttons'], ...off('claudeCodePlus.show.footerInfo'),
    expect: 'The usage meter is back. The info button (an "i") is gone from the footer; the other footer buttons stay, without '
      + 'overlapping.',
    unchanged: 'The conversation above the message box is as before.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-footer-focus', features: ['focus-view', 'footer-buttons'], ...off('claudeCodePlus.show.footerPlainView'),
    expect: 'The info button is back. The Focus view button is gone from the footer; the other footer buttons stay, without '
      + 'overlapping.',
    unchanged: 'The conversation above the message box is as before.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-footer-mute', features: ['chime-mute', 'footer-buttons'], ...off('claudeCodePlus.show.footerMute'),
    expect: 'The Focus view button is back. The mute button (a music note) is gone from the footer; the other footer buttons '
      + 'stay, without overlapping.',
    unchanged: 'The conversation above the message box is as before.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'off-reply-images', features: ['reply-images'], ...off('claudeCodePlus.show.replyImages'),
    expect: 'The mute button is back. In the reply where the chart was, there is no picture: a box shows the image\'s text and '
      + 'its file path instead (or Claude Code\'s own "[Image]" placeholder), readable and inside the column.',
    unchanged: 'The tab bar, side bar and footer are as before.',
    area: async (d) => {
      await demoAt(d, '', { focus: true });
      await d.conv.evaluate(() => { const m = [...document.querySelectorAll('[class*="userMessage_"]')].pop(); if (m) m.scrollIntoView({ block: 'start' }); });
      await d.sleep(800);
      return d.editor();
    },
  },
  {
    name: 'off-detached', features: ['agent-map'], ...off('claudeCodePlus.show.detachedCommands'),
    expect: 'The chart is drawn again in the reply. The footer\'s button for background work no longer counts the detached '
      + 'command: it says only "1 timer" (or is gone if nothing else is counted), and its dot is grey, since a scheduled prompt '
      + 'runs nothing until it is due.',
    unchanged: 'The conversation above the message box is as before.',
    area: async (d) => { await demoAt(d, '', { focus: true }); await toImage(d); return d.editor(); },
  },
  {
    name: 'off-user-edge', features: ['user-messages'], ...off('claudeCodePlus.userMessageEdge'),
    expect: 'The footer counts the detached command again. Your own messages no longer have the colored bar down their left '
      + 'edge; the boxes are otherwise unchanged and their text does not shift oddly.',
    unchanged: 'The replies and tool rows are as in the first picture of this conversation.',
    area: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'user-color', features: ['user-messages'],
    expect: 'The bar is back on your messages, and the text of your own messages is now light green; the replies keep their '
      + 'usual colors.',
    unchanged: 'The same messages and rows in the same place.',
    act: async (d) => { await setting(d, 'claudeCodePlus.userMessageColor', '#90EE90'); await d.sleep(2000); await demoAt(d, CSV); return d.editor(); },
    undo: async (d) => { await setting(d, 'claudeCodePlus.userMessageColor', undefined); await d.sleep(1500); },
  },
  {
    name: 'main-off', features: ['main-switch'],
    expect: 'After Claude Code Plus: Turn Off: your messages are in their usual color again, and the times and the reply '
      + 'figures are all gone (Claude Code may show its own times). The column of buttons on the right edge and the footer '
      + 'buttons, which have switches of their own, may stay.',
    unchanged: 'The same messages and rows in the same place.',
    act: async (d) => { await d.exec('claudeCodePlus.disable'); await d.sleep(2500); await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'main-on', features: ['main-switch'],
    expect: 'After Claude Code Plus: Toggle On/Off: the times and the reply figures are back on your messages and on every row of '
      + 'the replies, as in the first picture of this conversation.',
    unchanged: 'The same messages and rows in the same place.',
    act: async (d) => { await d.exec('claudeCodePlus.toggle'); await d.sleep(2500); await demoAt(d, CSV); return d.editor(); },
  },

  /* The session list. */
  {
    name: 'session-list', features: ['open-sessions', 'session-dates', 'session-pins', 'session-colors', 'new-in-tab-or-sidebar', 'session-selection', 'dot-background', 'dot-stopped'],
    expect: 'Claude Code\'s session list in the side bar. From the top: Claude Code\'s ACCOUNT & USAGE section, then (when a '
      + 'tab was closed earlier) RECENTLY CLOSED, then OPEN SESSIONS listing the open conversation, then SESSION MANAGER with '
      + 'New in tab and New in sidebar buttons whose icons are of normal size; each section is set apart by space and a '
      + 'divider line. Below, rows of conversations, each with a pin at its start (one pin filled and purple, the others '
      + 'hollow), a title, and the last-active time followed by dates such as "09/05->09/16"; one title is drawn in blue. '
      + 'The open conversation is listed twice, under OPEN SESSIONS and among the rows below, and both copies are highlighted; '
      + 'no other row looks selected or outlined. Titles are readable and none overlaps a pin or a date. Both rows of the '
      + 'open conversation start with a small green ring, hollow in the middle; no other row has a dot, and no row has a '
      + 'blue dot or an envelope.',
    unchanged: 'The editor shows the same conversation as before.',
    act: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'session-hover', features: ['session-hover'],
    expect: 'The mouse rests on the title of the row "Add a dry-run flag to the cleanup script". A hover label shows two lines: '
      + 'the group the row is in (Ungrouped) and its session id. The label is readable and wholly inside the side bar.',
    unchanged: 'The rows of the list are as before, in the same order.',
    act: async (d) => {
      const list = await sessionList(d);
      await d.away();
      await listRow(list, d.threads[2].id).locator('span[class*="sessionName_"]').first().hover();
      await d.until(() => list.evaluate(() => { const b = document.querySelector('[data-cce-label="1"]'); return !!b && !!b.innerText.trim(); }), 4000, 200);
      await d.sleep(400);
      return d.sidebar();
    },
    undo: async (d) => { await rest(d, await sessionList(d), 'bottom'); await d.away(); },
  },
  {
    name: 'session-pin', features: ['session-pins'],
    expect: 'The pin at the start of the row "Add a dry-run flag to the cleanup script" has just been clicked: it is now filled '
      + 'and purple like the other pinned row\'s, and the row has not moved out of place or lost its title or dates.',
    unchanged: 'The other rows are as before.',
    act: async (d) => {
      const list = await sessionList(d);
      await list.locator(`[data-cce-pin="${d.threads[2].id}"]:not([data-cce-section] *)`).first().click();
      await d.sleep(1500);
      await d.away();
      return d.sidebar();
    },
    undo: async (d) => {
      const list = await sessionList(d);
      await list.locator(`[data-cce-pin="${d.threads[2].id}"]:not([data-cce-section] *)`).first().click();
      await d.sleep(1200);
    },
  },
  {
    name: 'session-row-menu', features: ['session-colors', 'new-in-tab-or-sidebar'],
    expect: 'A right-click menu open on the row "Find where the retry delay for the inventory sync is set": items such as Resume '
      + 'in tab, Resume in sidebar and Text color (no plain "Resume session"), with Text color\'s submenu open beside it: '
      + 'Default with a check mark and eight colors. Both menus are wholly visible, not cut off by the side bar\'s edge, and no '
      + 'other menu is drawn over them.',
    unchanged: 'The pin clicked in the previous step is hollow again; the rows are otherwise as before.',
    act: async (d) => { const list = await sessionList(d); await rowMenu(d, list, d.threads[0].id, 'Text color'); await d.sleep(500); return d.sidebar(); },
  },
  {
    name: 'session-color-picked', features: ['session-colors', 'session-selection'],
    expect: 'The session list just after Green was picked from that row\'s Text color submenu. The menus are closed. That row\'s '
      + 'title is now green, and the other colored title stays blue. Only the open conversation\'s two copies (under OPEN '
      + 'SESSIONS and among the rows) are highlighted, as before the menu: the row whose color was just picked must not stay '
      + 'outlined or highlighted as well.',
    unchanged: 'Apart from the closed menus and the new color, the rows are as before.',
    act: async (d) => {
      const list = await sessionList(d);
      const id = d.threads[0].id;
      if ((await menus(list)) < 2) await rowMenu(d, list, id, 'Text color');
      const title = () => listRow(list, id).locator('span[class*="sessionName_"]').first().evaluate((e) => getComputedStyle(e).color);
      const was = await title();
      await menuItem(list, 'Green', 1).click({ timeout: 3000 });
      if (!await d.until(async () => (await title()) !== was && !(await menus(list)), 15000, 300)) throw new Error('picking Green did not recolor the row and close the menu');
      await d.away();
      await d.sleep(800);
      return d.sidebar();
    },
  },
  {
    name: 'session-search-id', features: ['session-id-search'],
    expect: 'The session list\'s search box holds "e6f2", four characters of one conversation\'s session id. The list shows that '
      + 'one conversation, "Why does the nightly export skip archived rows?", and none of the others.',
    unchanged: 'The search box is in its usual place; the side bar is as wide as before.',
    act: async (d) => {
      const list = await sessionList(d);
      let box = list.locator('input[type="text"], input:not([type]), input[type="search"]').first();
      if (!await box.isVisible().catch(() => false)) {
        const opener = list.locator('button[aria-label*="earch" i], button[title*="earch" i], [role="button"][aria-label*="earch" i]').first();
        if (await opener.count()) { await opener.click(); await d.sleep(800); }
        box = list.locator('input[type="text"], input:not([type]), input[type="search"]').first();
      }
      if (!await box.isVisible().catch(() => false)) throw new Error('the session list has no search box');
      await box.click();
      await box.fill('e6f2');
      await d.sleep(1500);
      await d.away();
      return d.sidebar();
    },
    undo: async (d) => {
      const list = await sessionList(d);
      await list.locator('input[type="text"], input:not([type]), input[type="search"]').first().fill('').catch(() => {});
      await d.sleep(800);
    },
  },
  {
    name: 'session-list-narrow', features: ['narrow-panel', 'new-in-tab-or-sidebar', 'session-dates'],
    expect: 'The search is cleared. The session list in a narrow side bar, about 260 px wide. The New buttons at the top keep '
      + 'icons of their normal size (not squeezed to slivers); a label that does not fit ends in an ellipsis. Row titles end in '
      + 'an ellipsis where they do not fit; no text overlaps a pin, a date or another row.',
    unchanged: 'The same rows in the same order as two pictures ago, only narrower.',
    act: async (d) => { await sessionList(d); await d.sideTo(260); await d.away(); await d.sleep(600); return d.sidebar(); },
    undo: (d) => d.sideTo(460),
  },
  {
    name: 'recently-closed', features: ['recently-closed'],
    expect: 'The list is wide again. A RECENTLY CLOSED section sits directly above OPEN SESSIONS, opened, listing the '
      + 'conversation "Add a dry-run flag to the cleanup script", whose tab was closed. The two sections are set apart by '
      + 'space and a divider line; their headers are readable.',
    unchanged: 'The rows below the two sections are as before.',
    act: async (d) => {
      await thread(d, d.threads[2]);
      await closeTab(d, d.threads[2]);
      const list = await sessionList(d);
      const head = list.locator('[data-cce-recent-closed] [data-cce-section-head]').first();
      if (!await d.until(() => head.isVisible().catch(() => false), 10000, 500)) throw new Error('there is no RECENTLY CLOSED section');
      if (await list.evaluate(() => { const s = document.querySelector('[data-cce-recent-closed]'); return !!s && s.getAttribute('data-cce-collapsed') === '1'; })) await head.click();
      await d.sleep(800);
      await d.away();
      return d.sidebar();
    },
  },
  {
    name: 'archived-menu', features: ['delete-archived'],
    expect: 'The conversation "Why does the nightly export skip archived rows?" has been archived and shows in an opened '
      + 'Archived sessions section. Its right-click menu is open and includes "Delete session..." (and Unarchive session). The '
      + 'menu is wholly visible.',
    unchanged: 'The other rows are as before, less the archived one.',
    act: async (d) => {
      const list = await sessionList(d);
      const id = d.threads[1].id;
      if (!await archivedHeader(list).isVisible().catch(() => false)) await rowPick(d, list, id, 'Archive session');
      await showArchived(d, list, id);
      await rowMenu(d, list, id);
      await d.sleep(500);
      return d.sidebar();
    },
  },
  {
    name: 'delete-confirm', features: ['delete-archived'],
    expect: 'After "Delete session..." was picked, VS Code asks in a dialog in the middle of the window whether to delete "Why '
      + 'does the nightly export skip archived rows?" from disk, says it cannot be undone, and offers Delete and Cancel. The '
      + 'dialog is readable and wholly inside the window.',
    unchanged: 'Behind the dialog, the side bar and editor are as before; the menu is closed.',
    act: async (d) => {
      const list = await sessionList(d);
      const id = d.threads[1].id;
      if ((await menus(list)) < 1) { await showArchived(d, list, id); await rowMenu(d, list, id); }
      await menuItem(list, 'Delete session').click({ timeout: 3000 });
      if (!await d.until(() => dialog(d), 15000, 300)) throw new Error('no confirmation appeared');
      await d.sleep(500);
      return d.body();
    },
    undo: async (d) => {
      await answerDialog(d, 'Cancel');
      const list = await sessionList(d);
      try { await showArchived(d, list, d.threads[1].id); await rowPick(d, list, d.threads[1].id, 'Unarchive session'); } catch (_) { /* left archived */ }
    },
  },
  {
    name: 'background-hidden', features: ['hide-background-sessions'],
    expect: 'The dialog is gone and "Why does the nightly export skip archived rows?" is back among the rows. The folder of '
      + 'transcripts also holds, written before the window opened, one of a session started with claude --bg, titled "'
      + BACKGROUND_TITLE + '", one started with claude -p, titled "' + PRINT_TITLE + '", and one of Claude Code\'s daemon '
      + 'sessions, titled "' + DAEMON_TITLE + '"; the list shows none of them.',
    unchanged: 'The rows are as before the archiving.',
    act: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'background-shown', features: ['hide-background-sessions'], ...off('claudeCodePlus.hideBackgroundSessions'),
    expect: 'With the setting that hides background sessions turned off, the list now also shows "' + BACKGROUND_TITLE + '" and "'
      + PRINT_TITLE + '" without a reload, and still not "' + DAEMON_TITLE + '"; the other rows are unchanged.',
    unchanged: 'Every row of the previous picture is still there.',
    area: async (d) => { await sessionList(d); await d.sleep(3000); await d.away(); return d.sidebar(); },
  },
  {
    name: 'off-session-pins', features: ['session-pins'], ...off('claudeCodePlus.sessionPins'),
    expect: 'The two background sessions are hidden again. The pins at the start of the rows are gone; the titles start where the '
      + 'pins were or a little further left, without overlapping anything.',
    unchanged: 'The same rows in the same order.',
    area: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'off-session-dates', features: ['session-dates'], ...off('claudeCodePlus.show.sessionDates'),
    expect: 'The pins are back. The dates after each row\'s last-active time are gone (no "09/05->09/16"-style dates); the '
      + 'last-active time stays.',
    unchanged: 'The same rows in the same order.',
    area: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'off-open-sessions', features: ['open-sessions'], ...off('claudeCodePlus.show.openSessions'),
    expect: 'The dates are back. The OPEN SESSIONS section at the top is gone, and no empty space or stray divider is left '
      + 'where it was.',
    unchanged: 'The rows below it are as before.',
    area: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'off-open-in-tab', features: ['new-in-tab-or-sidebar'], ...off('claudeCodePlus.show.openInTabOrSidebar'),
    expect: 'OPEN SESSIONS is back. At the top of the list, Claude Code\'s own New session button stands in place of New in tab '
      + 'and New in sidebar.',
    unchanged: 'The rows are as before.',
    area: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'off-session-colors', features: ['session-colors'], ...off('claudeCodePlus.show.sessionColors'),
    expect: 'New in tab and New in sidebar are back. A row\'s right-click menu is open and has no Text color item; the other '
      + 'items are there and the menu is wholly visible.',
    unchanged: 'The rows behind the menu are as before.',
    area: async (d) => { const list = await sessionList(d); await rowMenu(d, list, d.threads[2].id); await d.sleep(500); return d.sidebar(); },
  },
  {
    name: 'off-session-hover', features: ['session-hover'], ...off('claudeCodePlus.show.sessionHoverDetails'),
    expect: 'The menu is closed. The mouse rests on a row\'s title, and no label with its group and session id appears '
      + '(Claude Code may show its own tooltip with the title).',
    unchanged: 'The rows are as before.',
    area: async (d) => {
      const list = await sessionList(d);
      await closeMenus(d, list);
      await listRow(list, d.threads[2].id).locator('span[class*="sessionName_"]').first().hover();
      await d.sleep(2000);
      return d.sidebar();
    },
    undo: async (d) => { await setting(d, 'claudeCodePlus.show.sessionHoverDetails', undefined); await d.sleep(1500); await rest(d, await sessionList(d), 'bottom'); await d.away(); },
  },

  /* The Steward panel. */
  {
    name: 'steward-panel', features: ['steward-panel'],
    expect: 'The Steward panel at the bottom of the window, beside Problems, Output and Terminal. It lists the other '
      + 'conversations open in this window (the two short ones, in tabs of their own) under a heading for the window, each '
      + 'with an unticked box, and an "All, including new ones" choice. The conversation in front is not in the list. Text '
      + 'is readable; boxes line up with their rows.',
    unchanged: 'The side bar shows the session list as before.',
    act: async (d) => {
      for (const t of d.threads.slice(1)) { await d.exec('claude-vscode.editor.open', t.id); await d.sleep(1000); }
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(1500);
      await d.exec('workbench.view.extension.claudeCodePlusSteward');
      const frame = await d.frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
      if (!frame) throw new Error('the Steward panel did not open in 30 s');
      await d.until(() => frame.evaluate(() => document.querySelectorAll('input[data-id]').length > 0), 40000, 1000);
      d.steward = frame;
      await d.away();
      return d.part('workbench.parts.panel');
    },
  },
  {
    name: 'steward-ticked', features: ['steward-marks', 'steward-panel'],
    expect: 'One conversation has been ticked in the Steward panel, so the conversation in front is now its steward: its tab\'s '
      + 'title starts with a crown, one only, and the panel shows the tick. Nothing else in the tab bar changed. In the panel, '
      + 'the rows show no blue dot.',
    unchanged: 'The Steward panel lists the same rows as before.',
    act: async (d) => {
      if (!d.steward) throw new Error('the Steward panel is not open');
      await d.steward.locator('input[data-id]').first().click();
      await d.sleep(3000);
      await d.away();
      return d.body();
    },
  },
  {
    name: 'steward-renamed', features: ['steward-rename', 'steward-marks'],
    expect: 'The steward conversation in front was renamed through Claude Code\'s own Rename Session Tab, typing a name that '
      + 'kept a crown in front and added a second crown and the old bell at the end. Its tab now reads a crown, a space and '
      + '"CSV export and budgets": exactly one crown, first, no bell and no envelope. In the session list, both rows of that '
      + 'conversation show its pin, its dot, one crown and then "CSV export and budgets", with no crown or bell inside the '
      + 'title. No rename box is left open.',
    unchanged: 'The other tabs and the Steward panel\'s tick are as before.',
    act: async (d) => {
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(800);
      const asked = d.exec('claude-vscode.renameSessionTab').catch(() => false);
      const input = d.page.locator('.quick-input-widget input').first();
      if (!await d.until(() => input.isVisible().catch(() => false), 10000, 300)) throw new Error('Rename Session Tab did not open its box');
      const filled = await input.inputValue();
      await d.page.keyboard.press('Control+A');
      await d.page.keyboard.insertText(`${CROWN} CSV export and budgets ${CROWN} \u{1F6CE}\uFE0F`);
      await d.page.keyboard.press('Enter');
      await asked;
      await d.sleep(2500);
      const list = await sessionList(d);
      await d.sleep(1500);
      await d.away();
      const stored = storedTitle(d, d.sid), labels = await tabLabels(d);
      const tab = labels.find((l) => l.includes('CSV export and budgets')) || '';
      if (MARK_RE.test(filled)) throw new Error(`the rename box was filled with a mark: "${filled}"`);
      if (stored !== 'CSV export and budgets') throw new Error(`the transcript stored "${stored}"`);
      if (tab !== `${CROWN} CSV export and budgets`) throw new Error(`the tab reads "${tab}" (tabs: ${labels.join(' | ')})`);
      const rows = await list.evaluate(() => [...document.querySelectorAll('[class*="sessionItem_"]')].map((r) => r.innerText).filter((t) => t.includes('CSV export and budgets')));
      if (!rows.length || rows.some((t) => (t.match(/\u{1F451}/gu) || []).length !== 1)) throw new Error(`the list rows read ${JSON.stringify(rows)}`);
      return d.body();
    },
    undo: async (d) => {
      if (d.steward) await d.steward.locator('input[data-id]').first().click().catch(() => {});
      await d.sleep(1500);
      for (const t of d.threads.slice(1)) await closeTab(d, t);
      await d.exec('workbench.action.closePanel').catch(() => {});
      await d.sleep(800);
    },
  },

  /* Agent Plus. */
  {
    name: 'work-plan', features: ['work-plan-view'],
    expect: 'Agent Plus\'s work plan view in the side bar: the demo conversation\'s plan as a tree of numbered rows, each with a '
      + 'mark for its state (done, to do, waiting, parked, discussing), indented to show which rows sit under which. Titles '
      + 'are readable; rows do not overlap; there are no empty rows.',
    unchanged: 'The Steward panel is closed, the extra tabs are gone, and the first tab\'s title has no crown.',
    act: async (d) => { await d.exec('workbench.view.extension.agentPlus'); await d.sleep(1500); await d.widen(); await d.away(); return d.sidebar(); },
  },
  {
    name: 'conversations-view', features: ['conversations-view'],
    expect: 'Agent Plus\'s Conversations view at the bottom of the window. It lists the demo conversation, with its questions '
      + 'waiting for you (such as whether a category has one budget for every month) shown under it. Rows are readable, not '
      + 'cut off, and not duplicated.',
    unchanged: 'The side bar shows the work plan as before.',
    act: async (d) => {
      await d.exec('agentPlus.showConversations');
      await d.sleep(3000);
      await d.away();
      return d.part('workbench.parts.panel');
    },
  },
  {
    name: 'answer-view', features: ['conversations-view'],
    expect: 'One question of the demo conversation was clicked in the Conversations view, and the Answer view shows it: the '
      + 'question\'s full text, a box to type an answer in, and a button to send it. Nothing in it overlaps or is cut off.',
    unchanged: 'The Conversations view lists the same rows as before.',
    act: async (d) => {
      const row = d.page.locator('[id="workbench.parts.panel"] .monaco-list-row').filter({ hasText: /Should a category have one budget/ }).first();
      if (!await d.until(() => row.isVisible().catch(() => false), 15000, 500)) throw new Error('no question of the demo conversation in the Conversations view');
      await row.click();
      await d.sleep(2500);
      d.answer = await d.frameWhere(() => !!document.querySelector('textarea[placeholder^="Your answer"]') && /budget/i.test(document.body.innerText), 15000);
      if (!d.answer) throw new Error('the Answer view did not show the question');
      await d.away();
      return d.part('workbench.parts.panel');
    },
  },
  {
    name: 'answer-sent', features: ['answer-typed'],
    expect: 'An answer typed into the Answer view, "One amount for every month.", has been sent: in the demo conversation your '
      + 'newest message, with its time and the colored bar, reads My answer to row 3.1.1 ("Should a category have one budget '
      + '..."): and then, on a line of its own, One amount for every month. A reply follows it.',
    unchanged: 'The rest of the demo conversation is as before.',
    act: async (d) => {
      if (!d.answer) throw new Error('the Answer view is not open');
      await d.answer.locator('textarea[placeholder^="Your answer"]').first().fill('One amount for every month.');
      await d.answer.getByText('Send', { exact: true }).first().click({ timeout: 5000 });
      const reached = await d.until(() => d.conv.evaluate(() => document.body.innerText.includes('One amount for every month.')), 30000, 500);
      if (!reached) throw new Error('the answer did not appear in the conversation within 30 s');
      await d.until(() => lastReplyHas(d.conv, PLAIN), 30000, 500);
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(1000);
      await toBottom(d.conv);
      await d.sleep(800);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.exec('workbench.action.closePanel').catch(() => {}); await d.sleep(600); },
  },

  /* Live turns, in the first fake conversation, against the fake model. */
  {
    name: 'live-running', features: ['dot-working', 'open-sessions', 'tool-clock'],
    expect: 'A turn is running in the conversation "Find where the retry delay for the inventory sync is set", in a tab of its '
      + 'own, with Focus view on: its tab\'s logo carries a filled green dot at its top right, its row under OPEN SESSIONS in '
      + 'the side bar starts with a filled green dot too, and the working line above the message box says no tool has been '
      + 'called yet this turn and how long ago your message was sent.',
    unchanged: 'The panel at the bottom is closed; the side bar now shows the session list.',
    act: async (d) => {
      const frame = await live(d);
      await focusIn(d, frame, true);
      await sessionList(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.sleep(800);
      d.model.hold();
      const turns = d.model.turns();
      await send(d, frame, 'Run the tests again.');
      if (!await d.until(() => d.model.turns() > turns, 30000, 300)) throw new Error('the message did not reach the model in 30 s');
      await d.sleep(4000);
      await d.away();
      return d.body();
    },
  },
  {
    name: 'live-reply', features: ['reply-figures', 'context-meter', 'dot-stopped'],
    expect: 'The reply has landed: "' + PLAIN + '" is the newest reply. Its first row carries its time, how long the turn took, '
      + '"ctx" with a share between 1% and 100%, "cost $" with an amount, and the model name. The tab\'s logo has no dot at '
      + 'all and its title no envelope: the conversation stopped while its tab was in front. The usage meter shows in the footer.',
    unchanged: 'The earlier messages of this conversation are as before.',
    act: async (d) => {
      const frame = await live(d);
      d.model.release();
      if (!await d.until(() => lastReplyHas(frame, PLAIN), 30000, 500)) throw new Error('the reply did not appear within 30 s');
      await focusIn(d, frame, false);
      await toBottom(frame);
      await d.sleep(2500);
      await d.away();
      return d.editor();
    },
  },
  {
    name: 'off-context-share', features: ['reply-figures'], ...off('claudeCodePlus.show.contextShare'),
    expect: 'The newest reply\'s figures no longer include "ctx" and its share; the time, duration, cost and model remain, '
      + 'without a doubled separator dot.',
    unchanged: 'The conversation is otherwise as before.',
    area: async (d) => { const frame = await live(d); await toBottom(frame); await d.sleep(600); return d.editor(); },
  },
  {
    name: 'off-cost', features: ['reply-figures'], ...off('claudeCodePlus.show.cost'),
    expect: 'The "ctx" share is back, and the cost is gone from the newest reply\'s figures; no doubled separator dot.',
    unchanged: 'The conversation is otherwise as before.',
    area: async (d) => { const frame = await live(d); await toBottom(frame); await d.sleep(600); return d.editor(); },
  },
  {
    name: 'live-unread', features: ['unread-envelope', 'dot-stopped', 'open-sessions'],
    expect: 'A reply landed while the conversation\'s tab was in the background, behind a text file (notes.txt) opened in the '
      + 'same group: that tab\'s logo has no dot, and its title ends in a white envelope. Its row under OPEN SESSIONS in the '
      + 'side bar has no dot either and shows the envelope after the title and before the time, with the title not running '
      + 'into it, and the row\'s time lined up with the other rows\' times. No red or blue dot anywhere.',
    unchanged: 'The tab bar has the same Claude Code tabs as before, plus notes.txt.',
    act: async (d) => {
      const frame = await live(d);
      await sessionList(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.sleep(600);
      d.model.hold();
      const turns = d.model.turns();
      await send(d, frame, 'And in the staging config?');
      if (!await d.until(() => d.model.turns() > turns, 30000, 300)) throw new Error('the message did not reach the model in 30 s');
      await notesInFront(d);
      await d.sleep(800);
      d.model.release();
      await d.sleep(5000);
      await d.away();
      return d.body();
    },
  },
  {
    name: 'renamed-unread', features: ['rename-without-marks', 'long-title-envelope', 'unread-envelope'],
    expect: 'The conversation with a reply not read yet was renamed through its session list row\'s own rename box, typing a '
      + 'very long name with an envelope before it, an envelope and a crown after it. The side bar is narrow, the demo '
      + 'conversation is in front, and the Steward panel is open at the bottom. In the side bar, both rows of the renamed '
      + 'conversation show "Where the retry delay..." cut short with an ellipsis, and exactly one envelope after the title and '
      + 'before the time, not cut and not inside the title; no crown. In the Steward panel its row\'s title is cut short '
      + 'the same way and is followed by one envelope. Its tab\'s title ends in one envelope and has no crown.',
    unchanged: 'The other conversations\' rows are as before.',
    act: async (d) => {
      const list = await sessionList(d);
      const id = d.threads[0].id;
      const name = `\u2709\uFE0F ${LONG} \u2709\uFE0F ${CROWN}`;
      const held = await renameInList(d, list, id, name);
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(1200);
      await d.sideTo(300);
      await d.exec('workbench.view.extension.claudeCodePlusSteward');
      const frame = await d.frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
      if (frame) await d.until(() => frame.evaluate(() => !!document.querySelector('.env')), 20000, 1000);
      await d.away();
      const stored = storedTitle(d, id), labels = await tabLabels(d);
      if (MARK_RE.test(held)) throw new Error(`the rename box held a mark: "${held}"`);
      if (stored !== LONG) throw new Error(`the transcript stored "${stored}"`);
      const tab = labels.find((l) => l.startsWith('Where the retry')) || '';
      if (!/ \u2709[\uFE0E\uFE0F]$/u.test(tab) || /\u{1F451}/u.test(tab) || (tab.match(/\u2709/gu) || []).length !== 1) {
        throw new Error(`the tab reads "${tab}" (tabs: ${labels.join(' | ')})`);
      }
      return d.body();
    },
    undo: async (d) => {
      d.model.release();
      await d.exec('workbench.action.closePanel').catch(() => {});
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.widen();
      await d.sleep(2000);
    },
  },
  {
    name: 'live-background', features: ['dot-background', 'unread-envelope', 'open-sessions'],
    expect: 'A turn that put a command in the background ("sleep 40") ended while the conversation\'s tab was behind notes.txt: '
      + 'the tab\'s logo carries a green ring, hollow in the middle, and its title ends in a white envelope, so both show at '
      + 'once. Its row under OPEN SESSIONS starts with the same green ring and has the envelope after the title, before the time.',
    unchanged: 'The tab bar has the same tabs as before; notes.txt is in front.',
    act: async (d) => {
      const frame = await live(d);
      await sessionList(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.sleep(600);
      d.model.hold();
      const turns = d.model.turns();
      await send(d, frame, 'Please start the long job in the background.');
      if (!await d.until(() => d.model.turns() > turns, 30000, 300)) throw new Error('the message did not reach the model in 30 s');
      await notesInFront(d);
      await d.sleep(800);
      d.model.release();
      // The command runs for 40 s; the turn that started it ends a few seconds after the release.
      await d.sleep(8000);
      await d.away();
      return d.body();
    },
    undo: async (d) => {
      d.model.release();
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      // The command's end starts one more turn, which is answered at once; it is let finish before the next step.
      await d.sleep(40000);
    },
  },
  {
    name: 'live-permission', features: ['dot-waiting', 'timestamps'],
    expect: 'Claude Code asks for permission to run "npm test": the question and its Yes and No choices are in the panel. The '
      + 'tab\'s logo carries a filled red dot at its top right, its row under OPEN SESSIONS starts with a red dot, and no blue '
      + 'dot is anywhere. The tool row of that call has its time on a line of its own above "Bash" and its '
      + 'description, which stays on one line.',
    unchanged: 'The earlier messages are as before; the tab\'s title has no envelope now that the tab is in front.',
    act: async (d) => { const frame = await live(d); await askPermission(d, frame); await d.away(); return d.body(); },
  },
  {
    name: 'live-tool-clock', features: ['tool-clock', 'focus-view'],
    expect: 'Yes was picked, the command ran and failed quickly, and the turn is still running, waiting on the model. With Focus '
      + 'view on, the working line above the message box says the last tool, Bash, finished a number of seconds ago, with the '
      + 'time it finished.',
    unchanged: 'The tab bar and side bar are as before; the permission question is gone.',
    act: async (d) => {
      const frame = await live(d);
      await askPermission(d, frame);
      d.model.hold();
      await permissionButton(frame, 'Yes').click({ timeout: 5000 });
      await d.until(async () => !(await permissionAsked(frame)), 15000, 300);
      await focusIn(d, frame, true);
      await d.sleep(6000);
      await d.away();
      return d.editor();
    },
    undo: async (d) => {
      d.model.release();
      if (d.liveFrame) { await d.until(() => lastReplyHas(d.liveFrame, PLAIN), 30000, 500); await focusIn(d, d.liveFrame, false); }
      await d.sleep(1000);
    },
  },
  {
    name: 'live-helper', features: ['sub-agent-tags', 'view-filter', 'agent-map'],
    expect: 'The conversation started a helper (a sub-agent) in the background, which has answered. The helper\'s rows carry a tag '
      + 'with its task (such as "#Look through the notes"), and a filter control has appeared in the footer.',
    unchanged: 'Earlier messages are as before; Focus view is off.',
    act: async (d) => {
      const frame = await live(d);
      const before = d.model.seen.length;
      d.model.holdHelper();
      await send(d, frame, 'Please ask a helper in the background.');
      const helping = await d.until(() => d.model.seen.slice(before).some((x) => x.helping), 40000, 300);
      d.model.releaseHelper();
      if (!helping) throw new Error('the helper did not start within 40 s');
      await d.until(() => frame.evaluate(() => !!document.querySelector('[data-cce-view]')), 40000, 500);
      await d.sleep(4000);
      await toBottom(frame);
      await d.sleep(800);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { d.model.releaseHelper(); },
  },
  {
    name: 'view-filter-menu', features: ['view-filter'],
    expect: 'The footer\'s filter control has been clicked and its menu is open: All, Main thread, and one entry for the helper '
      + 'named by its task. The menu is readable and wholly inside the panel.',
    unchanged: 'The conversation is as before.',
    act: async (d) => {
      const frame = await live(d);
      const btn = frame.locator('[data-cce-view]').first();
      if (!await btn.count()) throw new Error('there is no filter control in the footer');
      await btn.click();
      await d.until(() => frame.evaluate(() => { const m = document.getElementById('cce-view-menu'); return !!m && m.style.display !== 'none' && !!m.offsetParent; }), 4000, 200);
      await d.sleep(500);
      return d.editor();
    },
  },
  {
    name: 'view-filter-helper', features: ['view-filter', 'sub-agent-tags'],
    expect: 'The helper was picked in the filter: the conversation now shows only the helper\'s rows, each tagged with its task, '
      + 'and a note or the control says that one sub-agent is shown. The main thread\'s messages are hidden.',
    unchanged: 'The tab bar, side bar and message box are as before.',
    act: async (d) => {
      const frame = await live(d);
      const menuOpen = () => frame.evaluate(() => { const m = document.getElementById('cce-view-menu'); return !!m && m.style.display !== 'none' && !!m.offsetParent; });
      const item = frame.locator('#cce-view-menu').getByText('Look through the notes', { exact: false }).last();
      let picked = false;
      for (let attempt = 0; attempt < 2 && !picked; attempt++) {
        if (!await menuOpen()) await frame.locator('[data-cce-view]').first().click();
        await d.until(menuOpen, 4000, 200);
        if (!await item.count()) throw new Error('the filter menu has no entry for the helper');
        picked = await item.click({ timeout: 5000 }).then(() => true, () => false);
      }
      if (!picked) throw new Error('the helper\'s entry in the filter menu could not be clicked');
      await d.sleep(1500);
      await d.away();
      return d.editor();
    },
    undo: async (d) => {
      const frame = await live(d);
      await frame.locator('[data-cce-view]').first().click().catch(() => {});
      await frame.locator('#cce-view-menu').getByText('All', { exact: true }).first().click({ timeout: 5000 }).catch(() => {});
      await d.sleep(800);
    },
  },
  {
    name: 'off-sub-agent-tags', features: ['sub-agent-tags'], ...off('claudeCodePlus.show.subAgentTags'),
    expect: 'All rows show again. The helper\'s rows no longer carry the tag with its task; nothing else changed.',
    unchanged: 'The same rows as before the filter, in the same place.',
    area: async (d) => { const frame = await live(d); await toBottom(frame); await d.sleep(600); return d.editor(); },
  },
  {
    name: 'off-view-filter', features: ['view-filter'], ...off('claudeCodePlus.show.footerViewFilter'),
    expect: 'The tags are back on the helper\'s rows. The filter control is gone from the footer; the other footer buttons stay, '
      + 'without overlapping.',
    unchanged: 'The conversation above the message box is as before.',
    area: async (d) => { const frame = await live(d); await toBottom(frame); await d.sleep(600); return d.editor(); },
  },
  {
    name: 'live-images', features: ['reply-images'],
    expect: 'A reply that was asked to show the picture at a local path: it draws that chart at a moderate size, and below it '
      + 'the image at a web address is not drawn but shown as a link or as text with its address.',
    unchanged: 'Earlier messages are as before; the filter control is back in the footer.',
    act: async (d) => {
      const frame = await live(d);
      const pic = path.join(d.profile.folder, 'artifacts', 'chart.png');
      fs.mkdirSync(path.dirname(pic), { recursive: true });
      const src = (() => { for (const f of walk(path.join(d.profile.home, '.claude', 'scratch'))) if (/\.png$/.test(f)) return f; return null; })();
      if (!src) throw new Error('the demo pack has no image to show');
      fs.copyFileSync(src, pic);
      await send(d, frame, `Please show me the picture at ${pic}`);
      await d.until(() => frame.evaluate(() => [...document.querySelectorAll('img')].some((i) => /^data:image\//.test(i.src) && i.naturalWidth > 0)), 40000, 500);
      await d.sleep(1500);
      await toBottom(frame);
      await d.sleep(800);
      await d.away();
      return d.editor();
    },
  },
  /* A `claude -p` worker under a detached shell, and a command in the background beside it: the agents button and the
     map it opens while both run, and once both have ended. The worker is a stand-in that writes a session record of the
     CLI's shape; it is found through /proc, so these show it on Linux only. */
  {
    name: 'live-work-running', features: ['agent-map', 'dot-background'],
    expect: 'A close-up of the footer under the message box. The conversation started a claude -p worker and then a command in '
      + 'the background ("sleep 40"); its turn has ended and both still run. The agents button reads "1 task . 1 worker" and the '
      + 'small dot at its start is a filled green dot - not grey. The button is whole and does not overlap the buttons beside it.',
    unchanged: 'The conversation is as before, with two more short exchanges at its end.',
    act: async (d) => {
      const frame = await live(d);
      const bin = path.join(d.profile.home, 'fake-bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'claude'), fakeModel.WORKER_SCRIPT('c0ffee00-1111-4222-8333-444444444444', 150), { mode: 0o755 });
      d.workStarted = Date.now();
      d.workFrom = d.model.seen.length;
      await runAsked(d, frame, `Please ${fakeModel.ASK_FOR_WORKER}.`, 'fake-bin');
      await runAsked(d, frame, `Please ${fakeModel.ASK_TO_BACKGROUND}.`, fakeModel.BG_RUN);
      const shown = await d.until(async () => { const b = await agentsButton(frame); return b && b.dot === 'running' && /\b1 worker\b/.test(b.label) && /\b1 task\b/.test(b.label) && b; }, 40000, 500);
      if (!shown) throw new Error(`the agents button did not count the worker and the command within 40 s: ${JSON.stringify(await agentsButton(frame))}`);
      await toBottom(frame);
      await d.away();
      await d.sleep(800);
      return around(d, frame, 'button[data-agents-dot]');
    },
  },
  {
    name: 'live-work-map', features: ['agent-map', 'dot-background'],
    expect: 'The agent map, opened from that button. A section at the top, "1 worker . claude -p, started from this '
      + 'conversation", lists release-notes-worker as running, for how long, and under it its session id and process id. No '
      + 'row lists a detached command or the shell that started the worker. The conversation\'s own row (its title, with the '
      + 'tokens in context) starts with a green ring, hollow in the middle, and the background task (sleep 40) with a filled '
      + 'green dot of the same green.',
    unchanged: 'The conversation behind the map is as before.',
    act: async (d) => {
      const frame = await live(d);
      await frame.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
      if (!await d.until(() => frame.evaluate(() => /\b1 worker · claude -p/.test(document.body.innerText)), 10000, 500)) throw new Error('the map lists no worker');
      await d.sleep(1200);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); },
  },
  {
    name: 'live-work-ended', features: ['agent-map'],
    expect: 'The same close-up of the footer once the worker and the command have both ended and the conversation has '
      + 'answered the notices of their ends. The agents button counts neither: it reads "0 agents" (the helper of an earlier '
      + 'step has finished), and its dot is grey, not green.',
    unchanged: 'The conversation is as before, with the answers to those notices at its end.',
    act: async (d) => {
      const frame = await live(d);
      const due = (d.workStarted || Date.now()) + 150000 - Date.now();
      const over = await d.until(async () => { const b = await agentsButton(frame); return (!b || (b.dot !== 'running' && !/\b(task|worker)s?\b/.test(b.label))) && { b }; },
        Math.max(due, 45000) + 90000, 1000);
      if (!over) throw new Error(`the agents button still counted work: ${JSON.stringify(await agentsButton(frame))}`);
      /* The worker's shell is found gone on a later scan, and the notice of that starts one more turn. */
      const from = d.workFrom || 0;
      const told = await d.until(() => { const i = d.model.seen.slice(from).findIndex((x) => /left running detached is no longer running/.test(x.ask || '')); return i < 0 ? 0 : from + i + 1; }, 60000, 1000);
      if (!told) throw new Error('the conversation was not told that the worker\'s shell has stopped within 60 s');
      // The fake model answers the notice itself with text, which ends that turn.
      await d.sleep(8000);
      if (!await agentsButton(frame)) throw new Error('the agents button is gone, so there is no grey dot to show');
      await toBottom(frame);
      await d.away();
      await d.sleep(800);
      return around(d, frame, 'button[data-agents-dot]');
    },
  },
  {
    name: 'live-work-ended-map', features: ['agent-map'],
    expect: 'The agent map once both have ended: no worker section and no background task; the conversation\'s own row starts '
      + 'with a grey dot, not a green one, and the finished helper of an earlier step is still listed with a grey dot.',
    unchanged: 'The conversation behind the map is as before.',
    act: async (d) => {
      const frame = await live(d);
      await frame.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
      await d.sleep(1500);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); },
  },

  /* This extension's commands. */
  {
    name: 'command-status', features: ['show-status'],
    expect: 'After Claude Code Plus: Show Status, a notification at the bottom right says Claude Code\'s panel and host are both '
      + 'patched and names the token mode. It is readable and not cut off.',
    unchanged: 'The editor and side bar are as before.',
    act: async (d) => { await d.exec('claudeCodePlus.status'); await d.sleep(1500); return d.body(); },
  },
  {
    name: 'command-settings', features: ['settings-command'],
    expect: 'After Claude Code Plus: Settings, VS Code\'s settings editor is open at this extension\'s settings: their names and '
      + 'descriptions are readable, and the count says how many were found.',
    unchanged: 'The side bar is as before.',
    act: async (d) => {
      await d.exec('claudeCodePlus.openSettings');
      await d.until(() => d.page.evaluate(() => { const e = document.querySelector('.settings-editor'); return !!e && !!e.offsetParent && /Claude Code Plus/.test(e.innerText); }), 15000, 500);
      await d.sleep(1500);
      return d.body();
    },
    undo: async (d) => { await d.exec('workbench.action.closeActiveEditor'); await d.sleep(600); },
  },
  {
    name: 'command-latency', features: ['open-latency'],
    expect: 'After Claude Code Plus: Show How Long Opening a Panel Took, the recorded panel-opening times are shown (in an '
      + 'editor, an output panel or a notification), readable. An empty record is fine if it says so.',
    unchanged: 'The settings editor is closed.',
    act: async (d) => { await d.exec('claudeCodePlus.showOpenLatency'); await d.sleep(2500); return d.body(); },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.exec('workbench.action.closePanel').catch(() => {}); await d.sleep(600); },
  },
  {
    name: 'command-plugin-install', features: ['work-plan-plugin'],
    expect: 'After Claude Code Plus: Install the Work Plan Plugin for Claude Code: no error notification. When the plugin is '
      + 'registered already, as here, the window may look as before, and only the log says so.',
    unchanged: 'The editor and side bar are as before.',
    act: async (d) => { await d.exec('claudeCodePlus.installWorkPlanPlugin'); await d.sleep(2500); return d.body(); },
  },
  {
    name: 'command-plugin-stop', features: ['work-plan-plugin'],
    expect: 'After Claude Code Plus: Stop Loading the Work Plan Plugin, VS Code asks first, in a dialog: whether to stop Claude '
      + 'Code loading the work plan plugin, with "Stop loading it" and Cancel. Readable and wholly inside the window.',
    unchanged: 'Behind the dialog, the window is as before.',
    act: async (d) => {
      await d.call(`vscode.commands.executeCommand('claudeCodePlus.disableWorkPlanPlugin'); return true;`);
      if (!await d.until(() => dialog(d), 10000, 300)) throw new Error('no confirmation appeared');
      await d.sleep(500);
      return d.body();
    },
    undo: (d) => answerDialog(d, 'Cancel'),
  },

  /* Agent Plus's token mode, set to each mode other than All and back, without a reload. */
  {
    name: 'token-mode-essential-status', features: ['token-mode', 'show-status'],
    expect: 'The token mode is now Essential features. A notification at the bottom right, from Claude Code Plus: Show Status, '
      + 'ends with "Token mode: Essential features (agentPlus.tokenMode); in Claude Code: work plan on, time-zone note on, '
      + 'conversation brief off, notices when a detached command stops off". It is readable and not cut off. In the whole-window '
      + 'picture, Agent Plus\'s token mode entry at the right of the status bar says Essential.',
    unchanged: 'The editor and side bar are as before.',
    act: async (d) => { await modeTo(d, 'essential'); await d.exec('claudeCodePlus.status'); await d.sleep(1500); return d.body(); },
    undo: async (d) => { await d.exec('notifications.clearAll'); await d.sleep(500); },
  },
  {
    name: 'token-mode-no-effect', features: ['token-mode'],
    expect: 'After claudeCodePlus.workPlan was changed while the token mode is Essential features, one notification at the '
      + 'bottom right says "Claude Code Plus: the token mode is Essential features, so claudeCodePlus.workPlan has no effect '
      + 'until the mode is Custom." with a Switch to Custom button. Only one such notification; it is readable and not cut off.',
    unchanged: 'The editor and side bar are as before; the Show Status notification is gone.',
    act: async (d) => { await setting(d, 'claudeCodePlus.workPlan', false); await d.sleep(2000); return d.body(); },
    undo: async (d) => { await setting(d, 'claudeCodePlus.workPlan', undefined); await d.sleep(1500); await d.exec('notifications.clearAll'); await d.sleep(500); },
  },
  {
    name: 'token-mode-interface-info', features: ['token-mode', 'session-info'],
    expect: 'The token mode is now Interface features. The information box opened from the footer\'s info button has a Token '
      + 'mode row that says Interface features, and in the whole-window picture Agent Plus\'s token mode entry at the right of '
      + 'the status bar says Interface: the two name the same mode. The rows are aligned, readable and inside the panel.',
    unchanged: 'The conversation behind the box is as before.',
    act: async (d) => {
      await modeTo(d, 'interface');
      await demoAt(d, BUDGET);
      if (!await infoOpen(d.conv)) await d.conv.locator('[data-cce-info]').first().click();
      if (!await d.until(() => d.conv.evaluate(() => /Interface features/.test((document.getElementById('cce-info') || {}).innerText || '')), 8000, 200)) {
        throw new Error('the information box did not name Interface features within 8 s');
      }
      await d.away();
      return d.editor();
    },
    undo: async (d) => { if (await infoOpen(d.conv)) { await d.conv.locator('[data-cce-info]').first().click(); await d.sleep(400); } },
  },
  {
    name: 'token-mode-interface-meter', features: ['token-mode', 'context-meter'],
    expect: 'In Interface features, the mouse rests on the usage meter in the footer, and its box shows how much of the context '
      + 'is used with a breakdown by category, but no part about the work plan, which does not run in this mode. The box lies '
      + 'wholly inside the panel, readable.',
    unchanged: 'The information box is closed; the conversation is as before.',
    act: async (d) => {
      const meter = d.conv.locator('button[class*="usageButtonV2"]').first();
      if (!await meter.count()) throw new Error('there is no usage meter in the footer');
      await d.sleep(21000);
      await meter.hover();
      await d.sleep(3000);
      return d.editor();
    },
    undo: (d) => d.away(),
  },
  {
    name: 'token-mode-interface-status', features: ['token-mode', 'show-status'],
    expect: 'A notification from Claude Code Plus: Show Status ends with "Token mode: Interface features (agentPlus.tokenMode); in '
      + 'Claude Code: work plan off, time-zone note off, conversation brief off, notices when a detached command stops off". '
      + 'Readable, not cut off. Agent Plus\'s status bar entry (whole-window picture) says Interface.',
    unchanged: 'The editor and side bar are as before.',
    act: async (d) => { await d.exec('claudeCodePlus.status'); await d.sleep(1500); return d.body(); },
    undo: async (d) => { await d.exec('notifications.clearAll'); await d.sleep(500); },
  },
  {
    name: 'token-mode-custom-status', features: ['token-mode', 'show-status'],
    expect: 'The token mode is now Custom, and claudeCodePlus.conversationBrief was then turned off. Show Status\'s notification '
      + 'ends with "Token mode: Custom (agentPlus.tokenMode); in Claude Code: work plan on, time-zone note on, conversation brief '
      + 'off, notices when a detached command stops on". No notification says a setting has no effect. Agent Plus\'s status '
      + 'bar entry (whole-window picture) says Custom.',
    unchanged: 'The editor and side bar are as before.',
    act: async (d) => {
      await modeTo(d, 'custom');
      await setting(d, 'claudeCodePlus.conversationBrief', false);
      await d.sleep(2000);
      await d.exec('claudeCodePlus.status');
      await d.sleep(1500);
      return d.body();
    },
    undo: async (d) => { await d.exec('notifications.clearAll'); await d.sleep(500); },
  },
  {
    name: 'token-mode-settings', features: ['token-mode', 'settings-command'],
    expect: 'VS Code\'s settings editor shows exactly four Claude Code Plus settings: Work Plan, Tell Claude Your Time Zone, '
      + 'Conversation Brief (its box unticked) and Detached End Notices. Each description is readable and ends saying it is used '
      + 'only while the token mode, shown as a link to Agent Plus\'s setting rather than as raw text with # signs, is Custom.',
    unchanged: 'The side bar is as before.',
    act: async (d) => {
      const keys = ['workPlan', 'tellClaudeYourTimeZone', 'conversationBrief', 'detachedEndNotices'].map((k) => `claudeCodePlus.${k}`);
      await d.exec('workbench.action.openSettings', `@id:${keys.join(',')}`);
      await d.until(() => d.page.evaluate(() => document.querySelectorAll('.settings-editor .setting-item-contents').length >= 4), 15000, 500);
      await d.sleep(1500);
      return d.body();
    },
    undo: async (d) => {
      await d.exec('workbench.action.closeActiveEditor');
      await setting(d, 'claudeCodePlus.conversationBrief', undefined);
      await modeTo(d, 'all');
    },
  },
  {
    name: 'token-mode-all-again', features: ['token-mode', 'session-info', 'show-status'],
    expect: 'Back in All features: Show Status\'s notification ends with "Token mode: All features (agentPlus.tokenMode); in Claude '
      + 'Code: work plan on, time-zone note on, conversation brief on, notices when a detached command stops on". The information '
      + 'box in the conversation has a Token mode row saying All features, and Agent Plus\'s status bar entry (whole-window '
      + 'picture) says All. No notification says a setting has no effect.',
    unchanged: 'The settings editor is closed; the side bar is as before.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      if (!await infoOpen(d.conv)) await d.conv.locator('[data-cce-info]').first().click();
      await d.until(() => d.conv.evaluate(() => /All features/.test((document.getElementById('cce-info') || {}).innerText || '')), 8000, 200);
      await d.exec('claudeCodePlus.status');
      await d.sleep(1500);
      await d.away();
      return d.body();
    },
    undo: async (d) => {
      if (await infoOpen(d.conv)) { await d.conv.locator('[data-cce-info]').first().click(); await d.sleep(400); }
      await d.exec('notifications.clearAll');
      await d.sleep(500);
    },
  },

  {
    name: 'conversation-again', features: ['timestamps', 'reply-figures', 'self-check'],
    expect: 'The demo conversation at the same place as in the first step\'s picture (conversation.jpg), minutes later, with '
      + 'tool rows shown. Everything that step\'s expect lists is there: a time on every row, start->end on each tool row on a '
      + 'line of its own above the tool\'s name, and the figures on the first row of each reply. Anything that differs from '
      + 'the first picture apart from the times on tool rows is a finding.',
    unchanged: 'The tab bar has the same tabs as before.',
    act: async (d) => { await d.exec('workbench.view.extension.agentPlus'); await d.sleep(1200); await demoAt(d, CSV); return d.editor(); },
  },

  /* A light theme. */
  {
    name: 'light-conversation', features: ['light-theme', 'timestamps', 'reply-figures', 'navigation', 'footer-buttons', 'user-messages'],
    expect: 'The whole window in a light theme, with the demo conversation and its tool rows. All text is dark on a light '
      + 'background and readable, including this extension\'s own parts: the times and figures on the rows, the bar beside '
      + 'your messages, the column of buttons on the right edge and the footer\'s buttons. Nothing is light text on a light '
      + 'background, and no dark box or strip is left over from the dark theme.',
    unchanged: 'The same conversation, scrolled to the same place as the first picture of it.',
    act: async (d) => {
      await theme(d, 'Default Light Modern');
      await d.sleep(2500);
      await d.exec('workbench.view.extension.agentPlus');
      await d.sleep(1200);
      await demoAt(d, CSV);
      return d.body();
    },
  },
  {
    name: 'light-navigation', features: ['light-theme', 'navigation'],
    expect: 'The list of your messages in the light theme, one row highlighted under the mouse: readable, with a visible border '
      + 'or shadow against the conversation behind it.',
    unchanged: 'Still the light theme; the conversation is scrolled to your message about a budget for a category.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      await openToc(d);
      await d.away();
      await hoverRow(d, 2);
      return d.editor();
    },
    undo: (d) => closeToc(d),
  },
  {
    name: 'light-info', features: ['light-theme', 'session-info'],
    expect: 'The information box in the light theme: readable labels and values, the box set apart from the conversation behind '
      + 'it.',
    unchanged: 'The conversation behind the box is as before; the list of messages is closed.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      if (!await infoOpen(d.conv)) await d.conv.locator('[data-cce-info]').first().click();
      if (!await d.until(() => infoOpen(d.conv), 5000, 200)) throw new Error('the information box did not open');
      await d.away();
      return d.editor();
    },
    undo: async (d) => { if (await infoOpen(d.conv)) { await d.conv.locator('[data-cce-info]').first().click(); await d.sleep(400); } },
  },
  {
    name: 'light-context-meter', features: ['light-theme', 'context-meter'],
    expect: 'The usage meter\'s box in the light theme: readable text, percentages between 0 and 100, the box inside the panel.',
    unchanged: 'The information box is closed; the conversation is as before.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      const meter = d.conv.locator('button[class*="usageButtonV2"]').first();
      if (!await meter.count()) throw new Error('there is no usage meter in the footer');
      await meter.hover();
      await d.sleep(3000);
      return d.editor();
    },
    undo: (d) => d.away(),
  },
  {
    name: 'light-agent-map', features: ['light-theme', 'agent-map'],
    expect: 'The agent map in the light theme: its rows (the detached command, the scheduled prompt) readable, the map set apart '
      + 'from the conversation behind it; the green ring at the start of the conversation\'s own row visible against the light '
      + 'background.',
    unchanged: 'The meter\'s box is gone; the conversation is as before.',
    act: async (d) => {
      await demoAt(d, BUDGET);
      const button = d.conv.locator('button, [role="button"]').filter({ hasText: /\bdetached\b|\btimer\b/ }).first();
      if (!await d.until(() => button.isVisible().catch(() => false), 30000, 500)) throw new Error('the footer\'s button for background work counted nothing');
      await button.click({ timeout: 5000 });
      await d.sleep(1500);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); },
  },
  {
    name: 'light-session-list', features: ['light-theme', 'session-colors', 'session-pins', 'open-sessions', 'recently-closed'],
    expect: 'The session list in the light theme: section headers, titles, times and dates readable; the purple pin and the '
      + 'blue and green titles readable against the light background; only the open conversation\'s two copies highlighted.',
    unchanged: 'The editor is as before; the map is closed.',
    act: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'light-envelope', features: ['light-envelope', 'light-theme', 'unread-envelope'],
    expect: 'In the light theme, a reply landed while the conversation "Where the retry delay..." was behind notes.txt: its tab\'s '
      + 'title ends in an envelope drawn as a dark outline on the light tab, clearly readable, not a white or faint shape; '
      + 'its rows in the session list show the same dark envelope after the title, before the time. No colour emoji envelope anywhere.',
    unchanged: 'The session list is as before, apart from the envelopes.',
    act: async (d) => {
      const frame = await live(d);
      await sessionList(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.sleep(600);
      // A permission question left open by an earlier step holds back any new message.
      if (await permissionAsked(frame)) { await permissionButton(frame, 'No').click({ timeout: 5000 }).catch(() => {}); await d.sleep(2000); }
      d.model.hold();
      const turns = d.model.turns();
      await send(d, frame, 'And in the production config?');
      if (!await d.until(() => d.model.turns() > turns, 30000, 300)) throw new Error('the message did not reach the model in 30 s');
      await notesInFront(d);
      await d.sleep(800);
      d.model.release();
      await d.sleep(5000);
      await d.away();
      const tab = (await tabLabels(d)).find((l) => l.startsWith('Where the retry')) || '';
      if (!tab.endsWith(' \u2709\uFE0E')) throw new Error(`the tab reads "${tab}", not ending in the envelope's text form`);
      return d.body();
    },
    undo: async (d) => { d.model.release(); await d.exec('claude-vscode.editor.open', d.threads[0].id); await d.sleep(2000); },
  },
  {
    name: 'light-work-plan', features: ['light-theme', 'work-plan-view'],
    expect: 'Agent Plus\'s work plan view in the light theme: the state marks and titles readable against the light background.',
    unchanged: 'The editor is as before.',
    act: async (d) => { await d.exec('workbench.view.extension.agentPlus'); await d.sleep(1500); await d.away(); return d.sidebar(); },
    undo: async (d) => { await theme(d, 'Default Dark Modern'); await d.sleep(2000); },
  },
  {
    name: 'notice-cards', features: ['notice-cards'],
    expect: 'The bottom right of the demo conversation in a wide editor tab, in the dark theme: just above the message box and level '
      + 'with its right edge, a stack of cards. The front card is whole: a red dot, "Waiting for you", the agent name "Claude Code" '
      + 'only if more than one agent is installed, how long ago, an x at its right end, and on a second line the title "Review the '
      + 'pull request that colours the session list", cut with an ellipsis if it does not fit. Above it the top edges of three more '
      + 'cards peek out, each a little narrower than the one in front, each with a red or green line along its top. No card covers '
      + 'the message box or any button of its footer, and no VS Code notification about these conversations is on screen.',
    act: async (d) => { const f = await noticeCards(d); await d.away(); await d.sleep(800); return noticeArea(d, f); },
  },
  {
    name: 'notice-cards-drawn-out', features: ['notice-cards'],
    expect: 'The same stack with the pointer on the third card from the front: that card, a red dot, "Waiting for you" and "Write '
      + 'the release notes for 1.3", is drawn out whole above the two cards in front of it, with the top edge of the second card '
      + 'showing between it and the front card, and the top edge of the fourth card above it. Over the stack, a grey pill "4 '
      + 'notices" and a "Dismiss all" button. No text of one card is drawn over another card.',
    unchanged: 'The conversation, the message box and the front card are as before.',
    act: async (d) => { const f = await noticeCards(d); await noticePull(d, f, 2); return noticeArea(d, f, 240); },
    undo: async (d) => { await rest(d, await noticePage(d)); await d.away(); await d.sleep(600); },
  },
  {
    name: 'notice-cards-light', features: ['notice-cards', 'light-theme'],
    expect: 'The same stack of four cards in the light theme: light cards with dark text, every word readable, a faint shadow under '
      + 'each, the red or green line along the top of each card, nothing cut off at the right edge, the message box below uncovered.',
    act: async (d) => { await theme(d, 'Default Light Modern'); await d.sleep(2500); const f = await noticeCards(d); await d.away(); return noticeArea(d, f); },
    undo: async (d) => { await theme(d, 'Default Dark Modern'); await d.sleep(2000); },
  },
  {
    name: 'notice-cards-sidebar', features: ['notice-cards', 'narrow-panel'],
    expect: 'Claude Code in the secondary side bar, about 300 px wide, showing another conversation, with the same stack just above '
      + 'its message box and as wide as the message box. On the front card the time is still shown, the x is inside the card, and a '
      + 'title too long for the width ends in an ellipsis. The cards cover none of the message box or its footer.',
    act: async (d) => {
      await noticeCards(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id, undefined, undefined, undefined, undefined, { programmatic: 'cce-pin-to-sidebar' });
      await d.sleep(5000);
      const aux = await d.part('workbench.parts.auxiliarybar');
      if (!aux) throw new Error('the secondary side bar did not open');
      await d.away();
      return aux;
    },
    undo: async (d) => { await d.exec('workbench.action.closeAuxiliaryBar'); await noticeCardsOff(d); },
  },
];

/* Every file under `dir`. */
function walk(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const n of names) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/* The logs the window writes, read on from where the last call stopped. Whole channels for this extension and Agent
   Plus; warnings and errors only from the rest. */
function logReader(userDir) {
  const at = new Map();
  const bad = (l) => /\[(error|warning)\]/i.test(l);
  const SOURCES = [
    { re: /[\\/]output_logging_[^\\/]+[\\/]\d+-Claude Code Plus\.log$/, label: 'Claude Code Plus', keep: () => true },
    { re: /[\\/]output_logging_[^\\/]+[\\/]\d+-Agent Plus\.log$/, label: 'Agent Plus', keep: () => true },
    { re: /[\\/]exthost[\\/]exthost\.log$/, label: 'extension host', keep: bad },
    { re: /[\\/]window\d+[\\/]renderer\.log$/, label: 'window', keep: bad },
    { re: /[\\/]exthost[\\/]Anthropic\.claude-code[\\/][^\\/]+\.log$/, label: 'Claude Code', keep: bad },
  ];
  return () => {
    const out = [];
    for (const f of walk(path.join(userDir, 'logs')).sort()) {
      const src = SOURCES.find((s) => s.re.test(f));
      if (!src) continue;
      let size = 0;
      try { size = fs.statSync(f).size; } catch (_) { continue; }
      const from = at.get(f) || 0;
      if (size <= from) continue;
      const buf = Buffer.alloc(size - from);
      const fd = fs.openSync(f, 'r');
      try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
      const end = buf.lastIndexOf(10);
      if (end < 0) continue;
      at.set(f, from + end + 1);
      for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
        if (line.trim() && src.keep(line)) out.push(`${src.label}: ${short(line.trim())}`);
      }
    }
    return out;
  };
}

/* A log line with long encoded data cut down. */
const short = (line) => line.replace(/[A-Za-z0-9+/=]{80,}/g, (m) => `${m.slice(0, 24)}...`).slice(0, 400);
/* Lines that differ only in their time stamp, once each with how often they came. */
function collapse(lines) {
  const order = [], count = new Map();
  const key = (l) => l.replace(/\b\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?Z?\s*|\b\d\d:\d\d:\d\d\.\d+\s*/g, '');
  for (const l of lines) { const k = key(l); if (!count.has(k)) { order.push([k, l]); count.set(k, 0); } count.set(k, count.get(k) + 1); }
  return order.map(([k, l]) => (count.get(k) > 1 ? `${l} (${count.get(k)} times)` : l));
}

/* The width and height in a JPEG's start-of-frame segment. */
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

/* Which steps show each feature. */
function coverage() {
  const { features } = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui-look-features.json'), 'utf8'));
  return features.map((f) => ({ id: f.id, what: f.what, notShown: f.notShown || '', steps: STEPS.filter((s) => s.features.includes(f.id)).map((s) => s.name) }));
}

async function main() {
  if (process.argv.includes('--features')) {
    for (const f of coverage()) console.log(`${f.id}: ${f.notShown ? `not shown (${f.notShown})` : f.steps.join(', ')}`);
    return;
  }
  const demo = require('./lib/demo');
  const opt = demo.options(process.argv.slice(2), { out: path.join(os.tmpdir(), 'claude-code-plus-look-pictures') });
  const names = STEPS.map((s) => s.name);
  const unknown = opt.rest.filter((a) => !names.includes(a));
  if (!fs.existsSync(path.join(opt.pack, 'pack.json')) || !fs.existsSync(opt.vsix) || unknown.length) {
    throw new Error('usage: ui-look.js --pack <dir with pack.json> --vsix <claude-code-plus .vsix> [--agent-plus <agent-plus .vsix>] [--out <dir>] [--cache <dir>] [<step> ...]'
      + `${unknown.length ? `\nunknown step: ${unknown.join(', ')}` : ''}\nsteps: ${names.join(' ')}`);
  }
  const steps = opt.rest.length ? STEPS.filter((s) => opt.rest.includes(s.name)) : STEPS;
  fs.mkdirSync(opt.out, { recursive: true });
  const started = Date.now();
  const d = await demo.open({ pack: opt.pack, vsix: opt.vsix, agentPlus: opt.agentPlus, cache: opt.cache, root: ROOT, salt: 'ui-look', prepare,
    /* Manual, as in run.js, so that a tool call stops for permission: auto mode needs a check the fake model cannot do. */
    settings: { 'claudeCode.initialPermissionMode': 'default' } });
  Object.assign(d, { sleep: demo.sleep, until: demo.until, log: demo.log });
  const logs = logReader(d.profile.user);
  const pageLines = [];
  d.page.on('console', (m) => { if (m.type() === 'error') pageLines.push(`page console error: ${short(m.text().replace(/\s+/g, ' '))}`); });
  d.page.on('pageerror', (e) => pageLines.push(`page error: ${short(String((e && e.message) || e).replace(/\s+/g, ' '))}`));
  const toastsSeen = new Set();
  const toasts = () => d.page.evaluate(() => [...document.querySelectorAll('.notifications-toasts .notification-toast-container, .notifications-center .notification-list-item')]
    .filter((e) => e.offsetParent).map((e) => {
      const sev = e.querySelector('.codicon-error') ? 'error' : e.querySelector('.codicon-warning') ? 'warning' : 'info';
      const msg = (e.querySelector('.notification-list-item-message') || e).innerText.replace(/\s+/g, ' ').trim();
      return `notification (${sev}): ${msg.slice(0, 400)}`;
    })).catch(() => []);
  /* Taken at the window's own pixel density and scaled down in the page: Playwright's CSS-scale screenshot changes the
     page's metrics while it shoots, which ends hover states such as a highlighted row. */
  const shrink = (png) => d.page.evaluate(async ({ b64, quality }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const w = Math.round(bmp.width / devicePixelRatio), h = Math.round(bmp.height / devicePixelRatio);
    const canvas = new OffscreenCanvas(w, h), g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
    let text = '';
    for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(text);
  }, { b64: png.toString('base64'), quality: QUALITY / 100 });
  const grab = (clip) => d.page.screenshot({ animations: 'disabled', ...(clip ? { clip } : {}) });
  const save = async (file, png) => {
    const jpg = Buffer.from(await shrink(png), 'base64');
    fs.writeFileSync(path.join(opt.out, file), jpg);
    return jpegSize(jpg);
  };
  const shoot = async (file, clip) => save(file, await grab(clip));
  const look = [];
  let previous = null, ranBefore = null;
  try {
    for (const step of steps) {
      let area = null, note = '';
      const left = await dialog(d);
      if (left) {
        await d.page.keyboard.press('Escape');
        await d.sleep(500);
        pageLines.push(`(the script closed a dialog the step before left open: ${left.replace(/\s+/g, ' ').slice(0, 160)})`);
      }
      try { area = await step.act(d, step.area); } catch (e) { note = e.message.split('\n')[0]; }
      if (!area) area = await d.body();
      const clip = { x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) };
      const image = `${step.name}.jpg`, full = `${step.name}.full.jpg`;
      const near = await grab(clip), whole = await grab(null);
      const size = (await save(image, near)) || { width: clip.width, height: clip.height };
      await save(full, whole);
      const lines = [];
      for (const t of await toasts()) if (!toastsSeen.has(t)) { toastsSeen.add(t); lines.push(t); }
      lines.push(...collapse([...pageLines.splice(0), ...logs()]));
      const log = lines.length > LOG_LINES ? [...lines.slice(0, LOG_LINES), `(${lines.length - LOG_LINES} more lines left out)`] : lines;
      const follows = ranBefore !== null && STEPS.indexOf(step) === STEPS.indexOf(ranBefore) + 1;
      look.push({ name: step.name, features: step.features, expect: step.expect, unchanged: follows ? step.unchanged || null : null,
        image, full, previous, width: size.width, height: size.height, log, ...(note ? { note } : {}) });
      demo.log(note ? 'step (incomplete)' : 'step', step.name, `${size.width}x${size.height}`, `${log.length} log lines`, note);
      previous = full;
      if (step.undo) {
        try { await step.undo(d); } catch (e) { demo.log('undo', step.name, e.message.split('\n')[0]); }
        previous = `${step.name}.after.jpg`;
        await shoot(previous, null);
      }
      ranBefore = step;
    }
  } finally {
    try { d.model.release(); d.model.releaseHelper(); } catch (_) { /* closed */ }
    await d.close();
    fs.writeFileSync(path.join(opt.out, 'look.json'), JSON.stringify(look, null, 2) + '\n');
    fs.copyFileSync(path.join(__dirname, 'LOOK.md'), path.join(opt.out, 'LOOK.md'));
    demo.log(`wrote ${look.length} steps, look.json and LOOK.md to ${opt.out} in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

if (require.main === module) main().catch((e) => { console.error((e && e.stack) || e); process.exitCode = 1; });

module.exports = { STEPS, coverage };
