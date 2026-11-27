// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Usage: xvfb-run -a -s "-screen 0 3200x2000x24" node test/vscode/ui-look.js --pack <dir> --vsix <file>
 *          [--core <Agent Plus .vsix>] [--out <dir>] [--cache <dir>] [<step> ...]
 *        node test/vscode/ui-look.js --features
 *
 * Puts the demo window of lib/demo.js (the one readme-shots.js uses) through each state of STEPS and saves pictures of
 * it, for an agent that can read images to review afterwards by LOOK.md. It runs only where someone starts it, never in
 * CI, and calls no model itself. With step names it runs only those; --features prints which steps show each feature of
 * ui-look-features.json and opens no window.
 *
 * Each step is { name, features, expect, unchanged, act, undo, only }. act puts the window into a state and returns the
 * area the step is about. expect is what a person should see there, and what must not be there; unchanged is what
 * must look as it did just before the step; undo takes back what act left open; only names the platforms the step runs
 * on. A step may leave out undo and only. An error act throws may carry the area as its `area`, for the pictures of the
 * state the step stopped in. Notifications are left on screen: one that should not be there is a finding.
 * The root folder differs from readme-shots.js's, so the two can run at once with different --cache folders.
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
/* The demo leaves a command running detached on Linux only (lib/demo.js), and detached commands and workers are found
   through /proc, so what the agent map and the dots show of them differs by platform. */
const LINUX = process.platform === 'linux';
/* Where a terminal process cannot be told apart by its screen session (src/claude-elsewhere.js). */
const WINDOWS = process.platform === 'win32';

/* The helpers the steps share. */

/* The request goes as JSON, where an undefined in an array arrives as null; undefined is what puts a setting back to its
   default. */
const setting = (d, key, value) => d.call('await vscode.workspace.getConfiguration().update(arg[0], arg[1] === null ? undefined : arg[1], vscode.ConfigurationTarget.Global); return true;', [key, value]);
const theme = (d, name) => setting(d, 'workbench.colorTheme', name);
/* Runs Claude Code Plus: Show Status and expands its notification: VS Code shows a long one on a single line until it
   is expanded, and the token mode is at its end. */
const showStatus = async (d) => {
  await d.exec('claudeCodePlus.status');
  await d.sleep(1500);
  await d.exec('notifications.focusFirstToast').catch(() => {});
  await d.exec('notification.expand').catch(() => {});
  await d.sleep(500);
};
/* Drags the top edge of the panel at the bottom until the panel is `to` px tall. */
async function panelTo(d, to) {
  const p = await d.part('workbench.parts.panel');
  if (!p || Math.abs(p.height - to) < 4) return;
  const sash = await d.page.evaluate((edge) => {
    const b = [...document.querySelectorAll('.monaco-sash.horizontal')].map((e) => e.getBoundingClientRect())
      .find((r) => r.width > 200 && Math.abs(r.top + r.height / 2 - edge) < 6);
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  }, p.y);
  if (!sash) return;
  await d.page.mouse.move(sash.x, sash.y);
  await d.sleep(200);
  await d.page.mouse.down();
  await d.page.mouse.move(sash.x, sash.y - (to - p.height), { steps: 10 });
  await d.page.mouse.up();
  await d.sleep(500);
}
/* Whether the panel's Output view shows lines starting with each of `starts`: the view draws only the lines in view. */
const outputShows = (d, starts) => d.page.evaluate((want) => {
  const panel = document.getElementById('workbench.parts.panel');
  const shown = panel ? [...panel.querySelectorAll('.view-lines .view-line')].map((e) => e.textContent.replace(/\u00a0/g, ' ')) : [];
  return want.every((w) => shown.some((l) => l.startsWith(w)));
}, starts);
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

/* The demo conversation in front, its last reply naming the conversation `t` twice, by its title alone and in corner
   brackets (lib/fake-model.js), and the links the page made of them on screen. A conversation is linked only while it runs,
   so a stopped one is first opened in its tab. */
const mentionLinks = (d, t) => d.conv.locator(`[data-testid="assistant-message"] a[href^="vscode://xnervwang.claude-code-plus/open?session=${t.id}&source="]`);
async function toMentions(d, t, ask) {
  await d.exec('claude-vscode.editor.open', d.sid);
  await d.sleep(800);
  if (ask) await send(d, d.conv, `Name the conversation ${t.id} titled ${t.title}.`);
  if (!await d.until(async () => (await mentionLinks(d, t).count()) >= 2, 20000, 500)) {
    await thread(d, t);
    await d.exec('claude-vscode.editor.open', d.sid);
    await d.sleep(800);
  }
  if (!await d.until(async () => (await mentionLinks(d, t).count()) >= 2, 60000, 500)) {
    throw new Error(`the reply naming "${t.title}" has ${await mentionLinks(d, t).count()} links to it after 60 s`);
  }
  await toBottom(d.conv);
  await d.sleep(800);
}

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

/* Claude Code's own session list in the side bar, found again each time: switching views can rebuild its page. Known
   by its rows, in a page without the message box a conversation's page has. */
async function sessionList(d) {
  await d.exec('workbench.view.extension.claude-sessions-sidebar');
  const list = await d.frameWhere(() => !!document.querySelector('[class*="sessionItem_"]') && !document.querySelector('[contenteditable][role="textbox"]'), 60000);
  if (!list) throw new Error('Claude Code\'s session list did not open in 60 s');
  await d.sleep(1500);
  await d.widen();
  return list;
}
/* Conversation `id`'s row in Claude Code's own list: the row's element id ends in the session id. */
const listRow = (list, id) => list.locator(`[class*="sessionItem_"][id$="${id}"]`).first();

/* Opens Agent Plus's session list in the side bar, where this extension lists Claude Code's conversations
   (src/claude-session-list.js), and finds its page again each time, as for Claude Code's own list. */
async function agentList(d) {
  await d.exec('workbench.view.extension.agentPlusSessions');
  const list = await d.frameWhere(() => !!document.querySelector('.sl-root .sl-new'), 30000);
  if (!list) throw new Error('Agent Plus\'s session list did not open in 30 s');
  await d.sleep(1000);
  await d.widen();
  return list;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* The row titled exactly `title` in Agent Plus's list, outside its Recently closed section. */
const agentRow = (list, title) => list.locator('.sl-section:not([data-key="closed"]) .sl-row')
  .filter({ has: list.locator('.sl-title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) }).first();
/* What that row shows: the dot on its logo, its stripe, whether it is dimmed as open somewhere else, how many envelopes
   and crowns follow its title, and the text of its marks; null while no such row is listed. */
const agentRowState = (list, title) => list.evaluate((t) => {
  const r = [...document.querySelectorAll('.sl-section:not([data-key="closed"]) .sl-row')].find((x) => (x.querySelector('.sl-title') || {}).textContent === t);
  return r ? { dot: r.dataset.dot, stripe: r.dataset.stripe, dim: r.classList.contains('sl-elsewhere'), unread: r.querySelectorAll('.sl-unread svg').length,
    crowns: r.querySelectorAll('.sl-crown').length, marks: ((r.querySelector('.sl-marks') || {}).textContent || '').trim() } : null;
}, title).catch(() => null);
/* Waits up to `ms` for that row to pass `test` and returns its state, or throws with `fails`, the failure in words
   ("is not listed"). Agent Plus draws a change some time after this extension reports it. */
async function agentRowWhere(d, list, title, test, ms, fails) {
  const hit = await d.until(async () => { const s = await agentRowState(list, title); return s && test(s) && s; }, ms, 500);
  if (!hit) throw new Error(`in Agent Plus's session list the row "${title}" ${fails} after ${ms / 1000} s: ${JSON.stringify(await agentRowState(list, title))}`);
  return hit;
}
/* The text of Agent Plus's hover box, or '' while none shows. */
const agentHoverText = (list) => list.evaluate(() => { const h = document.querySelector('.sl-hover'); return h && !h.classList.contains('sl-hidden') ? h.textContent : ''; }).catch(() => '');
/* Hovers over the row titled `title` until the hover box matches `re`, and returns the box's text. The list keeps a
   hover box as it was while the pointer stays on its row, so the pointer leaves the rows first. */
async function agentHover(d, list, title, re) {
  for (let i = 0; i < 3; i++) {
    await rest(d, list, 'bottom');
    await agentRow(list, title).hover({ timeout: 5000 });
    const said = await d.until(async () => { const t = await agentHoverText(list); return re.test(t) && t; }, 5000, 200);
    if (said) return said;
  }
  throw new Error(`the hover box of the row "${title}" in Agent Plus's session list did not say ${re}: ${JSON.stringify(await agentHoverText(list))}`);
}
/* Clicks `label` in the right-click menu of the row titled `title` in Agent Plus's list. */
async function agentMenuPick(d, list, title, label) {
  const item = list.locator('.sl-ctx:not(.sl-ctx-sub) .sl-ctx-item').filter({ hasText: label }).first();
  let offered = null;
  for (let i = 0; i < 3; i++) {
    await agentRow(list, title).click({ button: 'right', timeout: 5000 });
    if (await d.until(() => item.isVisible().catch(() => false), 5000, 200)) { await item.click({ timeout: 3000 }); return; }
    offered = await list.evaluate(() => [...document.querySelectorAll('.sl-ctx:not(.sl-ctx-sub) .sl-ctx-item')].map((x) => x.textContent.trim())).catch(() => null);
    await d.page.keyboard.press('Escape');
    await d.sleep(1000);
  }
  throw new Error(`the menu of the row "${title}" in Agent Plus's session list has no ${label}: ${JSON.stringify(offered)}`);
}
/* The note above Agent Plus's list that asks whether to hide Claude Code's own list, or ''. */
const listQuestion = (list) => list.evaluate(() => {
  const n = [...document.querySelectorAll('.sl-notice')].find((x) => /Hide Claude Code's own session list\?/.test(x.textContent));
  return n ? n.innerText : '';
}).catch(() => '');
/* A conversation's title as the list shows it now: the name it was last given, or the one it started with. */
const titleNow = (d, t) => storedTitle(d, t.id) || t.title;

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

/* In a page, whether it is the page of the fake conversation `q` (ownPageOf): its first message of yours is that
   conversation's first, it has its messages and a reply, and with `box` a message box. Text alone does not tell: another
   conversation's page can hold the same words, as a steward's message names the conversation by its title. Run in the
   page, so it uses nothing outside itself. */
function ownPage(q) {
  const mine = document.querySelectorAll('[class*="userMessage_"]');
  return mine.length >= q.n && mine[0].innerText.includes(q.ask) && !!document.querySelector('[data-testid="assistant-message"]')
    && (!q.box || !!document.querySelector('[contenteditable][role="textbox"]'));
}
const ownPageOf = (t, box = false) => ({ n: t.turns.length, ask: t.turns[0][0], box });
/* A fake conversation of lib/fake-home.js in a tab of its own, and its page. */
async function thread(d, t) {
  await d.exec('claude-vscode.editor.open', t.id);
  const frame = await d.frameWhere(ownPage, 60000, ownPageOf(t));
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
/* The conversation scrolled to its end. The message box floats over the bottom of the list, which keeps room under its
   last message for it, so the list is scrolled to its own bottom rather than to the last message's. */
async function toBottom(frame) {
  await frame.evaluate(() => {
    const last = [...document.querySelectorAll('[data-testid="assistant-message"], [class*="userMessage_"]')].pop();
    if (!last) return;
    last.scrollIntoView({ block: 'end' });
    for (let s = last.parentElement; s; s = s.parentElement) {
      if (s.scrollHeight > s.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(s).overflowY)) { s.scrollTop = s.scrollHeight; break; }
    }
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
const MARK_RE = /\u{1F451}|\u{1F6CE}|\u{1F4E9}|\u2709/u;
const tabLabels = (d) => d.call(`return vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((x) => x.input
  && String(x.input.viewType || '').endsWith('claudeVSCodePanel')).map((x) => x.label);`, []);
/* The texts of the Agent Plus notices on screen as toasts (its src/attention.js), or null while one is still sliding
   in. */
const needToasts = (d) => d.page.evaluate(() => {
  const items = [...document.querySelectorAll('.notifications-toasts .notification-list-item')].filter((n) => n.offsetParent);
  if (items.some((n) => n.closest('.notification-toast-container').getAnimations({ subtree: true }).some((a) => a.playState === 'running'))) return null;
  return items.map((n) => ((n.querySelector('.notification-list-item-message') || {}).innerText || '').replace(/\s+/g, ' ').trim());
}).catch(() => null);
/* Whether the text of a notice says `want`. With conversations of more than one program listed (Codex Plus adds its
   own), Agent Plus starts each notice with the program's name and a colon (its src/attention.js). */
const noticeSays = (text, want) => text === want || (text.endsWith(want) && /^[^"]+: $/.test(text.slice(0, -want.length)));
/* For an expect: what that start looks like here. */
const NOTICE_SOURCE = 'When Agent Plus lists conversations of more than one program, a notification starts with the name of the '
  + 'conversation\'s program and a colon, "Claude Code: ", and then reads as given.';
/* Whether an Agent Plus window's attention file (its src/attention.js) has an item for conversation `id` that passes `test`. */
function attentionHas(d, id, test) {
  const dir = path.join(d.profile.home, '.agent-work-plan', 'attention');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) { return false; }
  return names.some((n) => {
    try { return (JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')).items || []).some((x) => x.sessionId === id && test(x)); } catch (_) { return false; }
  });
}
/* As working: Agent Plus tells of a reply left unread only in a conversation it has seen working. */
const seenWorking = (d, id) => attentionHas(d, id, (x) => x.activity === 'working');
/* As stopped with a reply not read. */
const seenUnread = (d, id) => attentionHas(d, id, (x) => x.activity === 'stopped' && !!x.unseen);
/* How long Agent Plus can take to see a conversation's new activity: two of its 30 s refreshes (ui.js says why). */
const SEEN_MS = 60000;
/* The status bar box of Agent Plus's Conversations entry. VS Code puts the entry's hover after its text in its
   aria-label; the conversations waiting for you are its last group, under the line below, with "and N more" after the
   tenth. */
const needCountBox = (d) => d.page.evaluate((head) => {
  const e = [...document.querySelectorAll('.statusbar-item')].find((x) => /agentPlus\.conversations$/.test(x.id) && x.offsetParent);
  const label = (e && e.getAttribute('aria-label')) || '', at = label.indexOf(head);
  if (at < 0) return null;
  const lines = label.slice(at + head.length).split('\n').map((l) => l.trim()).filter(Boolean);
  const more = /^and (\d+) more$/.exec(lines[lines.length - 1] || '');
  const n = more ? lines.length - 1 + Number(more[1]) : lines.length;
  const r = e.getBoundingClientRect();
  return n ? { x: r.left, y: r.top, width: r.width, height: r.height, text: String(n), says: e.innerText.trim() } : null;
}, 'Waiting for you to approve something or answer:');
/* The box and text of Agent Plus's Conversations entry in the status bar, whatever it counts; null while it is not shown. */
const needEntry = (d) => d.page.evaluate(() => {
  const e = [...document.querySelectorAll('.statusbar-item')].find((x) => /agentPlus\.conversations$/.test(x.id) && x.offsetParent);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height, says: e.innerText.trim() };
});
/* How many conversations that text says need you: 0 when it says none do. */
const needTotal = (says) => { const m = /^(\d+) conversations? needs? you$/.exec(says || ''); return m ? Number(m[1]) : 0; };
/*
 * Another window of this machine reporting `items` to Agent Plus, which reads every window's file in the folder they
 * share (its src/attention.js), so this window treats them as conversations of that other window. A file not rewritten
 * for a minute is a window that has gone, and for two minutes Agent Plus gives no second notice for a conversation it
 * saw waiting there, so each step gives its own session ids.
 */
const OTHER_WINDOW = 'look-0000000a.json';
const attentionDir = (d) => path.join(d.profile.home, '.agent-work-plan', 'attention');
function otherWindow(d, items) {
  fs.mkdirSync(attentionDir(d), { recursive: true });
  const file = path.join(attentionDir(d), OTHER_WINDOW);
  const now = Date.now();
  fs.writeFileSync(file + '.tmp', JSON.stringify({ format: 1, at: now, front: [], settled: [], items: items.map((it) => Object.assign({
    sourceId: 'claude-code', source: 'Claude Code', state: 'prompt', activity: 'waiting', unseen: false, steward: false, lastActiveAt: now,
    cwd: path.join(path.dirname(d.profile.folder), 'another-project') }, it)) }) + '\n');
  fs.renameSync(file + '.tmp', file);
}
const noOtherWindow = (d) => { try { fs.unlinkSync(path.join(attentionDir(d), OTHER_WINDOW)); } catch (_) { /* gone */ } };
/* Says to Agent Plus whether this window has the focus: lib/window.js starts it with AGENT_PLUS_TEST_FOCUS=1. null gives
   the word back to VS Code. */
const testFocus = (d, on) => d.call('if (arg === null) delete globalThis.__agentPlusTestFocused; else globalThis.__agentPlusTestFocused = arg; return true;', on);
/* The area of the notice toasts, with padding, once every text in `want` (one text or a list) is among the toasts. */
async function noticeArea(d, want) {
  const wanted = [].concat(want);
  if (!await d.until(async () => { const t = (await needToasts(d)) || []; return wanted.every((w) => t.some((x) => noticeSays(x, w))); }, 20000, 300)) {
    throw new Error(`Agent Plus showed no notices ${JSON.stringify(wanted)} in 20 s: ${JSON.stringify(await needToasts(d))}`);
  }
  await d.sleep(600);
  await d.away();
  const b = await d.page.evaluate(() => {
    const rs = [...document.querySelectorAll('.notifications-toasts .notification-toast-container')].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
    return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y, w: innerWidth, h: innerHeight };
  });
  if (!b) throw new Error('the notice is not on screen');
  const pad = 24, x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return { x, y, width: Math.min(b.w, b.x + b.width + pad) - x, height: Math.min(b.h, b.y + b.height + pad) - y };
}
/* A step for the notice that a conversation in another window is waiting, for the reason `waitingFor`. */
const waitNotice = (sessionId, title, waitingFor, said) => ({
  act: async (d) => {
    await d.exec('notifications.clearAll');
    await testFocus(d, true);
    otherWindow(d, [{ sessionId, title, waitingFor }]);
    return noticeArea(d, said);
  },
  undo: async (d) => { noOtherWindow(d); await d.exec('notifications.clearAll'); await testFocus(d, null); await d.sleep(1500); },
});
/* Two conversations of another window that start to wait while no window has the focus, and the notices (listed in
   `said`) that appear once this window has it again. */
const replayNotice = (a, b, said) => ({
  act: async (d) => {
    await d.exec('notifications.clearAll');
    await testFocus(d, false);
    const before = Number(((await needCountBox(d)) || {}).text) || 0;
    otherWindow(d, [a, b]);
    if (!await d.until(async () => Number(((await needCountBox(d)) || {}).text) === before + 2, 20000, 300)) {
      throw new Error(`Agent Plus did not count the two conversations in 20 s: ${JSON.stringify(await needCountBox(d))}`);
    }
    /* Longer than Agent Plus gathers changes before it shows them or, without the focus, keeps them. */
    if (await d.until(async () => ((await needToasts(d)) || []).length > 0, 4500, 300)) throw new Error('a notice came while the window had no focus');
    await testFocus(d, true);
    return noticeArea(d, said);
  },
  undo: async (d) => { noOtherWindow(d); await d.exec('notifications.clearAll'); await testFocus(d, null); await d.sleep(1500); },
});
const LOOK_ID = (n) => `7d1f3c2a-4b5e-4f60-8a71-92b3c4d5e7${String(n).padStart(2, '0')}`;

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
/* The live conversation (the first fake one), opened in a tab of its own the first time and brought to the front after. */
async function live(d) {
  const t = d.threads[0];
  if (!d.liveFrame) d.liveFrame = await thread(d, t);
  else { await d.exec('claude-vscode.editor.open', t.id); await d.sleep(1000); }
  return d.liveFrame;
}
/* The transcript file of conversation `id`. */
function transcriptFile(d, id) {
  const projects = path.join(d.profile.home, '.claude', 'projects');
  for (const dir of fs.readdirSync(projects)) {
    const file = path.join(projects, dir, `${id}.jsonl`);
    if (fs.existsSync(file)) return file;
  }
  return '';
}
/* Runs the steward's script as conversation `asker` would: the tool call that runs it goes in that conversation's
   transcript first, since a window carries out only what the asker's own transcript shows it asked for. */
const RELAY = path.join(__dirname, '..', '..', 'claude-plugin', 'agent-work-plan', 'hooks', 'steward-relay.py');
let relayCalls = 0;
function relay(d, asker, args, input) {
  const line = `python3 ${RELAY} ${args.join(' ')}` + (input ? ` <<'EOF'\n${input}\nEOF` : '');
  const answered = require('./lib/fake-home').appendToolCall(transcriptFile(d, asker), { sessionId: asker, cwd: d.profile.folder,
    uuid: `${asker.slice(0, 24)}${String(790000 + relayCalls++).padStart(12, '0')}`, toolId: `toolu_look_${relayCalls}`, command: line, description: 'Act for the user' });
  const data = path.join(d.profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
  return new Promise((resolve) => {
    /* The demo's home, and none of the variables that would point the script at another ~/.claude. */
    const env = Object.assign(require('./lib/env').cleanEnv(path.dirname(d.profile.home)), { CLAUDE_CODE_SESSION_ID: asker });
    const kid = require('child_process').spawn('python3', [RELAY, ...args, data], { env });
    let out = '';
    kid.stdout.on('data', (x) => { out += x; });
    kid.stderr.on('data', (x) => { out += x; });
    kid.on('error', (e) => resolve('could not run the script: ' + e.message));
    kid.on('exit', () => resolve(out.trim()));
    kid.stdin.end(input || '');
  }).then((said) => { answered(said); return said; });
}
/* The Steward panel at the bottom, for the conversation in front. */
async function stewardPanel(d) {
  await d.exec('workbench.view.extension.claudeCodePlusSteward');
  const frame = await d.frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
  if (!frame) throw new Error('the Steward panel did not open in 30 s');
  return frame;
}
const stewardsFile = (d) => path.join(d.profile.home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras', 'stewards.json');
async function severalPanel(d) {
  const [t1, t2] = d.threads.slice(1);
  for (const t of [t1, t2]) { await d.exec('claude-vscode.editor.open', t.id); await d.sleep(1000); }
  fs.mkdirSync(path.dirname(stewardsFile(d)), { recursive: true });
  fs.writeFileSync(stewardsFile(d), JSON.stringify({ version: 3, stewards: {
    [t1.id]: { manages: [t2.id], names: { [t2.id]: t2.title }, at: Date.now() - 1000, title: t1.title },
    [d.sid]: { manages: [t2.id], names: { [t2.id]: t2.title }, at: Date.now() } } }, null, 1) + '\n');
  await d.exec('claude-vscode.editor.open', d.sid);
  await d.sleep(1000);
  const frame = await stewardPanel(d);
  if (!await d.until(() => frame.evaluate(([a, b]) => { const x = document.querySelector(`input[data-id="${a}"]`); const e = document.querySelector(`.eyes[data-eyes="${b}"]`);
    return !!x && x.disabled && !!e; }, [t1.id, t2.id]).catch(() => false), 40000, 1000)) {
    throw new Error(`the box of the steward "${t1.title}" is not greyed, or the row of "${t2.title}" has no eye`);
  }
  d.several = frame;
  return frame;
}
function typed(d, id, text) {
  fs.appendFileSync(transcriptFile(d, id), JSON.stringify({ sessionId: id, cwd: d.profile.folder, isSidechain: false, type: 'user',
    uuid: `${id.slice(0, 24)}${String(795000 + relayCalls++).padStart(12, '0')}`, timestamp: new Date().toISOString(), permissionMode: 'default',
    promptSource: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } }) + '\n');
}
/* Brings the demo conversation to the front and ticks `ids` in its Steward panel. */
async function stewardOf(d, ids) {
  await d.exec('claude-vscode.editor.open', d.sid);
  await d.sleep(1000);
  const frame = await stewardPanel(d);
  for (const id of ids) {
    const box = frame.locator(`input[data-id="${id}"]`).first();
    if (!await d.until(() => box.isVisible().catch(() => false), 40000, 1000)) throw new Error(`the Steward panel does not list ${id}`);
    if (!await box.isChecked()) await box.click();
  }
  await d.sleep(1500);
  return frame;
}
const transcriptHas = (d, id, text) => { try { return fs.readFileSync(transcriptFile(d, id), 'utf8').includes(text); } catch (_) { return false; } };
/* Claude Code's own command line, of the newest build installed in the cache. */
const claudeCli = (d) => {
  const dir = fs.readdirSync(d.profile.exts).filter((n) => n.startsWith('anthropic.claude-code-')).sort().pop();
  return dir ? path.join(d.profile.exts, dir, 'resources', 'native-binary', 'claude') : '';
};
const liveOf = (d, id) => {
  const dir = path.join(d.profile.home, '.claude', 'sessions');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return []; }
  return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (_) { return null; } })
    .filter((r) => r && r.sessionId === id && (() => { try { process.kill(r.pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } })());
};

/* The agent map steps: the conversation they use, the worker's session id, and the two scheduled prompts. */
const mapThread = (d) => d.threads[1];
const MAP_WORKER = 'c0ffee00-2222-4222-8333-555555555555';
const MAP_SCHEDULES = [
  { id: 'c4d5e6f7', cron: '7,27,47 * * * *', prompt: 'Check whether the nightly build has finished, and report the tests that failed.', firedAgo: 7 * 60000 },
  { id: 'd5e6f7a8', cron: '30 9 * * *', prompt: 'Summarise yesterday\'s merged pull requests for the stand-up.' },
];
/* Whether `frame` shows the agent map. */
const mapShown = (frame) => frame.evaluate(() => [...document.querySelectorAll('[role="dialog"] h3')].some((h) => h.textContent.trim() === 'Agent map' && !!h.offsetParent));
/* Opens the agent map of `frame`'s conversation: with the footer's agents button where there is one, and otherwise with
   /tasks, which also opens it. `ready`, a regular expression, is what the map's text must match first. */
async function openMap(d, frame, ready) {
  if (!await mapShown(frame)) {
    const button = frame.locator('button[data-agents-dot]').first();
    if (await button.isVisible().catch(() => false)) await button.click({ timeout: 5000 });
    else await send(d, frame, '/tasks');
  }
  if (!await d.until(() => mapShown(frame), 10000, 300)) throw new Error('the agent map did not open');
  if (ready) {
    const has = () => frame.evaluate((re) => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Agent map/.test(x.textContent));
      return !!dialog && new RegExp(re).test(dialog.textContent);
    }, ready);
    /* The host reads a conversation's claude --bg sessions from its transcript on a timer of its own. */
    if (!await d.until(has, 60000, 500)) throw new Error(`the agent map did not show ${ready} within 60 s`);
  }
  await d.sleep(1200);
  /* Moves the pointer off inside the page first, so that a card the dialog opened under it gets its mouse-leave event.
     */
  await rest(d, frame);
  await d.away();
}
const closeMap = async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(500); };
/* Clicks open the first of the map's folded cards whose text matches `re`, and scrolls it into the middle of the map. */
async function openCard(d, frame, re) {
  const done = await frame.evaluate((src) => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Agent map/.test(x.textContent));
    const row = dialog && [...dialog.querySelectorAll('details > summary')].find((x) => new RegExp(src).test(x.textContent));
    if (!row) return false;
    row.click();
    row.parentElement.scrollIntoView({ block: 'center' });
    return true;
  }, re.source);
  if (!done) throw new Error(`the map has no folded card matching ${re}`);
  await d.sleep(1000);
  await rest(d, frame);
  await d.away();
}
/* Starts `argv` with setsid in conversation `sid`'s name, as a command it left running detached (Linux only). */
function detachFor(d, sid, argv) {
  const env = Object.assign(require('./lib/env').cleanEnv(path.dirname(d.profile.home)), { CLAUDE_CODE_SESSION_ID: sid });
  require('child_process').spawnSync('sh', ['-c', 'setsid "$@" < /dev/null > /dev/null 2>&1 &', 'sh', ...argv], { env, cwd: d.profile.folder, stdio: 'ignore' });
}
const scheduleFile = (d) => path.join(d.profile.folder, '.claude', 'scheduled_tasks.json');
function addSchedules(d, sid) {
  const file = scheduleFile(d);
  const held = JSON.parse(fs.readFileSync(file, 'utf8'));
  held.tasks = (held.tasks || []).filter((t) => !MAP_SCHEDULES.some((m) => m.id === t.id)).concat(MAP_SCHEDULES.map((m) => ({ id: m.id, cron: m.cron,
    prompt: m.prompt, createdAt: Date.now() - 3600000, ...(m.firedAgo ? { lastFiredAt: Date.now() - m.firedAgo } : {}), recurring: true,
    createdBySessionId: sid, createdInProject: d.profile.folder })));
  fs.writeFileSync(file, JSON.stringify(held, null, 2));
}
function removeSchedules(d) {
  try {
    const held = JSON.parse(fs.readFileSync(scheduleFile(d), 'utf8'));
    held.tasks = (held.tasks || []).filter((t) => !MAP_SCHEDULES.some((m) => m.id === t.id));
    fs.writeFileSync(scheduleFile(d), JSON.stringify(held, null, 2));
  } catch (_) { /* no file */ }
}
/* Stops what the agent map steps started: on Linux every process started in those conversations' names in the demo's
   folder, and on every platform the claude --bg sessions and the worker, by their session records. The fake conversations
   have the same session ids in every run, so a process of another run at the same time is told apart by its folder. */
function stopMapWork(d, ids) {
  const marks = ids.map((id) => `CLAUDE_CODE_SESSION_ID=${id}`);
  const ours = (p) => { try { const at = fs.readlinkSync(`/proc/${p}/cwd`); return at === d.profile.folder || at.startsWith(d.profile.folder + path.sep); } catch (_) { return false; } };
  if (process.platform === 'linux') {
    for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try { if (fs.readFileSync(`/proc/${p}/environ`, 'utf8').split('\0').some((v) => marks.includes(v)) && ours(p)) process.kill(Number(p), 'SIGTERM'); } catch (_) { /* gone */ }
    }
  }
  const dir = path.join(d.profile.home, '.claude', 'sessions');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const n of names) {
    try { const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); if (r.kind === 'bg' || r.sessionId === MAP_WORKER) process.kill(r.pid, 'SIGTERM'); } catch (_) { /* gone */ }
  }
}

/* Transcripts of a `claude --bg`, a `claude -p` and a daemon session, written with the demo's home (lib/fake-home.js). */
const [BACKGROUND_TITLE, PRINT_TITLE, DAEMON_TITLE] = require('./lib/fake-home').BACKGROUND.map((b) => b.title);

/* The steps. */

const STEPS = [
  /* The demo conversation, dark theme. */
  {
    name: 'conversation', features: ['timestamps', 'reply-figures', 'user-messages', 'navigation', 'self-check', 'dot-background'],
    expect: 'A conversation in an editor tab with its tool rows shown (rows headed Bash, Read, Edit, Write and the like, with IN '
      + 'and OUT boxes). Each of your own messages is a box with a colored bar down its left edge and starts with a date and '
      + 'time. Every row of a reply starts with a small grey date and time: a thinking row, a text row, and each tool row, where '
      + 'the time is the tool\'s start and end joined by an arrow, on a line of its own above the tool\'s name. The first row of '
      + 'each reply also shows, after its time, how long the turn had taken, the model and its effort (for example "22s . '
      + 'opus-5-5 xhigh"). A narrow column of buttons runs down the right edge and covers no letters. No warning banner from '
      + 'the page. ' + (LINUX ? 'The tab\'s logo carries a green ring at its top right, hollow in the middle rather than a filled '
        + 'dot: no turn runs, and the demo left a command running detached, which counts as background work. '
        : 'The tab\'s logo has no dot: no turn runs, and nothing this conversation started runs in the background here. ')
      + 'The tab\'s title ends without an envelope.',
    unchanged: null,
    act: async (d) => { await demoAt(d, CSV); return d.editor(); },
  },
  {
    name: 'token-mode-notice', features: ['token-mode'],
    expect: 'The notice that asked which token mode to use (shown at the bottom right, or by now moved into the list of '
      + 'notifications) has been answered: its Choose a Mode... button opened the list of modes. '
      + 'The notice and the list are gone, nothing covers the panel\'s footer, the list of '
      + 'notifications is closed, and the token mode entry in the status bar still says All.',
    unchanged: 'The side bar, the tab bar and the conversation look as before.',
    act: async (d) => {
      const button = (where) => d.page.locator(`${where} .monaco-button`).filter({ hasText: /^\s*Choose a Mode/ }).first();
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
      const list = () => d.page.evaluate(() => { const q = document.querySelector('.quick-input-widget'); return !!q && !!q.offsetParent && /All features/.test(q.innerText); });
      if (!await d.until(list, 10000, 300)) throw new Error('Choose a Mode... opened no list of the modes');
      /* The list opens with the mode in use selected: All features. */
      await d.page.keyboard.press('Enter');
      await d.until(async () => !(await list()), 5000, 300);
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
  /* The bar above the message box, drawn from the demo conversation's plan. */
  {
    name: 'plan-bar', features: ['plan-bar'],
    expect: 'Right above the message box, a bar exactly as wide as the box: a list mark and "Plan" in bold; a rounded bubble '
      + 'with a yellow speech-bubble mark and "11" on a yellow tint, and one with a purple circle and "4" on a purple tint; '
      + 'no other bubble, none green or grey; then empty space; at the right a part filled solid orange with a question '
      + 'mark and "3 to decide" in dark letters, not red; and an arrow. The bar is one line, nothing in it is cut at the '
      + 'top or bottom, and it covers neither the conversation nor the message box.',
    unchanged: 'The conversation above the bar and the message box below it are as before.',
    act: async (d) => {
      await demoAt(d, CSV, { focus: true });
      const shown = () => d.conv.evaluate(() => { const b = document.querySelector('[data-agent-plus-plan-bar]'); return !!b && !!b.offsetParent; });
      if (!await d.until(shown, 30000, 500)) {
        const there = await d.conv.evaluate(() => { const b = document.querySelector('[data-agent-plus-plan-bar]'); return b ? `hidden (${b.style.display || 'shown'})` : 'not in the page'; });
        throw new Error(`no plan bar above the message box: the bar is ${there}`);
      }
      await d.away();
      return around(d, d.conv, '[data-agent-plus-plan-bar]', 40, 140);
    },
  },
  {
    name: 'plan-bar-hover', features: ['plan-bar'],
    expect: 'The mouse rests on the word "Plan" in the plan bar, whose border is drawn in the focus colour. A box next to it '
      + 'shows first "19 rows not done", with no row title above it, then the open rows, each with its number and a mark '
      + 'for its state in its state\'s colour, each nested row indented below its parent. Nothing in the box is cut off or '
      + 'outside the window.',
    unchanged: 'The bar reads as before.',
    act: async (d) => {
      await demoAt(d, CSV, { focus: true });
      await d.conv.locator('[data-agent-plus-plan-bar] .apb-name').first().hover({ timeout: 10000 });
      if (!await d.until(() => d.conv.evaluate(() => !!document.querySelector('[data-agent-plus-plan-bar-list]')), 5000, 200)) {
        throw new Error('no list of open rows appeared over the plan bar');
      }
      return d.editor();
    },
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
    expect: 'The agent map, opened from the footer\'s button that counts background work ('
      + (LINUX ? '"1 detached . 1 timer"' : '"1 timer"') + '). At the top a small bold heading THIS CONVERSATION and the '
      + 'conversation\'s own card, which starts with ' + (LINUX ? 'a green ring rather than a filled dot: the detached command is running.'
        : 'a grey dot, since nothing runs yet and the scheduled prompt is not due.')
      + ' Then, each after a thin line and each headed in capitals with a count badge: '
      + (LINUX ? 'DETACHED COMMANDS 1, a card with a green dot titled "sleep 1800" and its process id, start time and running time under it; ' : '')
      + 'SCHEDULED PROMPTS 1, a card with a grey dot, the start of its prompt ("Every Monday morning, ...") and "0 9 * * 1 . never fired" '
      + 'under it. No "0 agents" line anywhere. Cards are readable and inside the box.',
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
    expect: 'The chart is drawn again in the reply. The footer\'s button for background work '
      + (LINUX ? 'no longer counts the detached command: it says only "1 timer"' : 'says "1 timer", as before')
      + ' (or is gone if nothing else is counted), and its dot is grey, since a scheduled prompt alone does not turn it green.',
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

  /* The steps on Agent Plus's session list, then those on Claude Code's own list, whose view this extension hides when
     asked and from which it leaves out background sessions. */
  {
    name: 'official-list-question', features: ['official-list-question'],
    expect: 'Agent Plus\'s session list in the side bar. Above its rows, a note that starts with the Claude Code logo says that Agent '
      + 'Plus now lists your Claude Code conversations and asks whether to hide Claude Code\'s own session list, naming the setting '
      + 'that changes it later; two buttons follow, Hide It and Keep It. The note\'s text wraps inside the side bar, and neither '
      + 'button is cut off or drawn over the text.',
    unchanged: 'The editor shows the same conversation as before.',
    act: async (d) => {
      const list = await agentList(d);
      if (!await d.until(() => listQuestion(list), 15000, 300)) throw new Error('no note above Agent Plus\'s list asks whether to hide Claude Code\'s own list');
      await d.away();
      return d.sidebar();
    },
    /* Answered with Keep It, which leaves Claude Code's own list shown and takes the note away. */
    undo: async (d) => {
      const list = await agentList(d);
      const keep = list.locator('.sl-notice .sl-note-btn').filter({ hasText: 'Keep It' }).first();
      if (await keep.isVisible().catch(() => false)) {
        await keep.click();
        await d.until(async () => !(await listQuestion(list)), 10000, 300);
      }
      await d.away();
    },
  },
  {
    name: 'agent-plus-session-list', features: ['agent-plus-session-list', 'official-list-question', 'dot-stopped', ...(LINUX ? ['dot-background'] : [])],
    expect: 'After the click on "Keep It", the note above Agent Plus\'s session list is gone. The rows now occupy '
      + 'its space. The list shows Claude Code\'s conversations of this folder, each row starting with the Claude '
      + 'Code logo and ending with how long ago it was last active: the demo conversation that is in the editor, '
      + '"Find where the retry delay for the inventory sync is set", "Why does the nightly export skip archived '
      + 'rows?" and "Add a dry-run flag to the cleanup script". The demo conversation comes first and has a pin. '
      + 'A solid light stripe at the start of its row marks it as open in this window. "Why does the nightly '
      + 'export skip archived rows?" is written in blue: the pins and title colours Claude Code Plus kept, which '
      + 'the list took over. '
      + (LINUX ? 'A small, hollow green ring appears at the top right of the demo conversation\'s logo. No turn '
        + 'is running, but the command the conversation left detached is still running. '
        : 'The demo conversation\'s logo has no dot: nothing runs. ')
      + 'No other logo has a dot, and no row has an envelope or a crown: Agent Plus counts a reply from before it began its record '
      + 'of this folder as read, and none has come since. None of "' + BACKGROUND_TITLE + '", "' + PRINT_TITLE
      + '" or "' + DAEMON_TITLE + '", sessions run in the background, is listed. A RECENTLY CLOSED band, folded or open, holds "Add '
      + 'a dry-run flag to the cleanup script", whose tab an earlier step closed, and that conversation\'s own row has a light blue '
      + 'stripe at its start. An ACCOUNT & USAGE band may sit at the top; a later step looks at it.',
    unchanged: 'The rows are those of the picture before, moved up where the note was.',
    act: async (d) => {
      const list = await agentList(d);
      /* The step before answers the question; when this step runs without it, it answers the question itself. */
      if (await listQuestion(list)) {
        await list.locator('.sl-notice .sl-note-btn').filter({ hasText: 'Keep It' }).first().click();
        await d.until(async () => !(await listQuestion(list)), 10000, 300);
      }
      for (const t of d.threads) await agentRowWhere(d, list, titleNow(d, t), () => true, 30000, 'is not listed');
      await d.away();
      return d.sidebar();
    },
  },
  {
    name: 'agent-plus-row-click', features: ['agent-plus-session-list'],
    expect: 'After a click on the "Why does the nightly export skip archived rows?" row in Agent Plus\'s session '
      + 'list, the conversation has its own active editor tab. Its row now starts with the same solid light '
      + 'stripe as the demo conversation\'s row.',
    unchanged: 'The other rows of the list are as before.',
    act: async (d) => {
      const t = d.threads[1], title = titleNow(d, t);
      const list = await agentList(d);
      await agentRow(list, title).click({ timeout: 5000 });
      const front = () => d.call(`const t = vscode.window.tabGroups.activeTabGroup.activeTab;
        return !!t && !!t.input && t.input.viewType === ${JSON.stringify(PANEL_VIEW)} && !!t.label && arg.startsWith(t.label.replace(/\u2026$/, ''));`, t.title);
      if (!await d.until(front, 30000, 500)) throw new Error(`a click on the row "${title}" did not bring its conversation to the front in a tab`);
      await agentRowWhere(d, list, title, (s) => s.stripe === 'here', 15000, 'has no stripe of a conversation open here');
      await d.sleep(1500);
      await d.away();
      return d.body();
    },
    undo: async (d) => { await closeTab(d, d.threads[1]); await d.exec('claude-vscode.editor.open', d.sid); await d.sleep(800); },
  },
  /* A terminal that has a conversation open, as Claude Code's record of the process says: a child of this script stands
     in for that process, with the environment a screen session gives it. */
  {
    name: 'agent-plus-elsewhere', features: ['agent-plus-elsewhere'],
    expect: 'A terminal now has "Add a dry-run flag to the cleanup script" open. In Agent Plus\'s session list, '
      + 'its row has a greyed logo, title and time. Only the outline of the stripe shows at the start of the row. '
      + 'The other rows are not greyed. The mouse rests on that row, and a hover box under it names Claude Code '
      + 'and the row\'s section, gives the session id and when it started and was last active, then '
      + (WINDOWS ? '"Open in a terminal"' : '"Open in screen session "mywork" in" and a folder')
      + ', and under that "Process" with a number and "running for 2m". The box is readable and wholly inside the '
      + 'side bar.',
    unchanged: 'The tab of "Why does the nightly export skip archived rows?" is closed again, and the demo conversation is in front.',
    act: async (d) => {
      const t = d.threads[2];
      const sessions = path.join(d.profile.home, '.claude', 'sessions');
      const child = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'],
        { stdio: 'ignore', env: Object.assign({}, process.env, { STY: '4242.mywork' }) });
      d.elsewhere = { child, record: path.join(sessions, `${child.pid}.json`) };
      /* Field 22 of /proc/<pid>/stat, the process's start time, which Claude Code writes as procStart: the 20th after the
         name in parentheses. */
      let procStart;
      if (LINUX) {
        for (let i = 0; i < 40 && procStart === undefined; i++) {
          try { procStart = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[19]; } catch (_) { await d.sleep(50); }
        }
      }
      fs.mkdirSync(sessions, { recursive: true });
      fs.writeFileSync(d.elsewhere.record, JSON.stringify({ pid: child.pid, sessionId: t.id, cwd: d.profile.folder, startedAt: Date.now() - 125000,
        procStart, entrypoint: 'cli', kind: 'interactive', status: 'idle' }));
      const list = await agentList(d);
      await agentRowWhere(d, list, titleNow(d, t), (s) => s.stripe === 'elsewhere' && s.dim, 20000, 'is not marked open somewhere else');
      await agentHover(d, list, titleNow(d, t), /Open in /);
      return d.sidebar();
    },
    undo: async (d) => {
      if (d.elsewhere) {
        d.elsewhere.child.kill();
        try { fs.rmSync(d.elsewhere.record, { force: true }); } catch (_) { /* gone */ }
        d.elsewhere = null;
      }
      await d.away();
    },
  },
  {
    name: 'official-session-list-hidden', features: ['hide-official-session-list'],
    expect: 'The Activity Bar at the left edge of the window with Claude Code Plus set to hide Claude Code\'s own session list: '
      + 'there is no Claude Code icon in it, while the Explorer, Search and the other icons are still there and evenly spaced.',
    unchanged: 'The editor and the side bar show what they showed before.',
    act: async (d) => { await setting(d, 'claudeCodePlus.hideOfficialSessionList', true); await d.sleep(2500); return d.part('workbench.parts.activitybar'); },
    undo: async (d) => { await setting(d, 'claudeCodePlus.hideOfficialSessionList', undefined); await d.sleep(1500); },
  },
  {
    name: 'background-hidden', features: ['hide-background-sessions'],
    expect: 'Claude Code\'s own session list in the side bar, its icon back in the Activity Bar. The list omits the '
      + 'session titled "' + BACKGROUND_TITLE + '" started with claude --bg, the session titled "' + PRINT_TITLE
      + '" started with claude -p, and the Claude Code daemon session titled "' + DAEMON_TITLE + '". Their '
      + 'transcripts are in the same folder as the transcripts of the conversations the list shows.',
    unchanged: 'The editor shows the same conversation as before.',
    act: async (d) => { await sessionList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'background-shown', features: ['hide-background-sessions'], ...off('claudeCodePlus.hideBackgroundSessions'),
    expect: 'With the setting that hides background sessions turned off, Claude Code\'s own list now also shows "' + BACKGROUND_TITLE
      + '" and "' + PRINT_TITLE + '" without a reload, and still not "' + DAEMON_TITLE + '"; the other rows are unchanged.',
    unchanged: 'Every row of the previous picture is still there.',
    area: async (d) => { await sessionList(d); await d.sleep(3000); await d.away(); return d.sidebar(); },
  },

  /* The Steward panel. */
  {
    name: 'steward-panel', features: ['steward-panel'],
    expect: 'The Steward panel at the bottom of the window, beside Problems, Output and Terminal. It lists the other '
      + 'conversations open in this window (the two short ones, in tabs of their own) under a heading for the window, each '
      + 'with an unticked box, and an "All, including new ones" choice. The conversation in front is not in the list. Text '
      + 'is readable; boxes line up with their rows.',
    unchanged: 'The side bar shows Claude Code\'s own session list as before, but for the two conversations whose tabs this step '
      + 'opened: their rows now carry the dot of an open conversation and may have moved up.',
    act: async (d) => {
      /* The panel lists the conversations that have a process, and a tab starts one only once its page has loaded: a tab
         opened and at once put behind another may never load. */
      const others = d.threads.slice(1);
      for (const t of others) await thread(d, t);
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(1500);
      await d.exec('workbench.view.extension.claudeCodePlusSteward');
      const frame = await d.frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
      if (!frame) throw new Error('the Steward panel did not open in 30 s');
      const listed = () => frame.evaluate((ids) => ids.filter((id) => !!document.querySelector(`input[data-id="${id}"]`)), others.map((t) => t.id)).catch(() => []);
      if (!await d.until(async () => (await listed()).length === others.length, 60000, 1000)) {
        throw new Error(`the Steward panel lists ${JSON.stringify(await listed())} of ${JSON.stringify(others.map((t) => t.id))} in 60 s`);
      }
      d.steward = frame;
      await d.away();
      return d.part('workbench.parts.panel');
    },
  },
  {
    name: 'steward-ticked', features: ['steward-marks', 'steward-panel'],
    expect: 'One conversation has been ticked in the Steward panel, so the conversation in front is now its steward: its tab\'s '
      + 'title ends with a crown, one only, and the panel shows the tick. Nothing else in the tab bar changed. In the panel, '
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
      + 'kept a crown in front and added a second crown and the old bell at the end. Its tab now reads "CSV export and '
      + 'budgets", a space and a crown: exactly one crown, after the title, no bell and no envelope. In Agent Plus\'s session '
      + 'list in the side bar, that conversation\'s row reads "CSV export and budgets", with no crown or bell inside the title, '
      + 'and then one small yellow crown icon; nothing overlaps the title. No rename box is left open.',
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
      const list = await agentList(d);
      await d.away();
      const stored = storedTitle(d, d.sid), labels = await tabLabels(d);
      const tab = labels.find((l) => l.includes('CSV export and budgets')) || '';
      if (MARK_RE.test(filled)) throw new Error(`the rename box was filled with a mark: "${filled}"`);
      if (stored !== 'CSV export and budgets') throw new Error(`the transcript stored "${stored}"`);
      if (tab !== `CSV export and budgets ${CROWN}`) throw new Error(`the tab reads "${tab}" (tabs: ${labels.join(' | ')})`);
      await agentRowWhere(d, list, 'CSV export and budgets', (s) => s.crowns === 1, 20000, 'does not have exactly one crown after its title');
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
  /* What a steward does for the conversations it manages, each request made through steward-relay.py as a steward would
     make it, and the mark on a conversation that two processes run. The last undo closes the Steward panel and the
     extra tabs and takes the crown off the first tab, which is the state the work-plan step starts from. */
  {
    name: 'steward-relayed', features: ['steward-send'],
    expect: 'The conversation "Why does the nightly export skip archived rows?" is in front. The last message in it from you '
      + 'reads "Please check the export query once more, then stop.", after a first line that Claude Code Plus puts before '
      + 'whatever a steward passes on: Sent by the steward "CSV export and budgets" (and the steward\'s session id) for the user:. '
      + 'The demo conversation, which is its steward, passed it on and Claude Code Plus typed it in, so it is drawn like any '
      + 'message you typed; the fake model\'s reply follows it.',
    unchanged: null,
    act: async (d) => {
      for (const t of d.threads.slice(1)) { await d.exec('claude-vscode.editor.open', t.id); await d.sleep(1000); }
      const t = d.threads[1];
      await stewardOf(d, [t.id]);
      const words = 'Please check the export query once more, then stop.';
      const said = await relay(d, d.sid, [t.id], words);
      if (!/^Sent: /.test(said)) throw new Error(`the steward could not pass the message on: ${said}`);
      if (!await d.until(() => d.model.seen.some((x) => (x.typed || '').includes(words)), 30000, 500)) throw new Error('the message did not reach the model');
      const frame = await thread(d, t);
      await d.until(() => lastReplyHas(frame, PLAIN), 20000, 500);
      await toBottom(frame);
      await d.away();
      return d.editor();
    },
  },
  {
    name: 'steward-renamed-managed', features: ['steward-renames-managed'],
    expect: 'The demo conversation is in front again, with the Steward panel open at the bottom. Its steward renamed the '
      + 'conversation it manages: that conversation\'s tab in the tab bar and its row in the Steward panel now read "Export '
      + 'query and archived rows".',
    unchanged: null,
    act: async (d) => {
      const t = d.threads[1];
      await stewardOf(d, [t.id]);
      const said = await relay(d, d.sid, ['--rename', t.id], 'Export query and archived rows');
      if (!/^Renamed\./.test(said)) throw new Error(`the steward could not rename it: ${said}`);
      await d.sleep(4000);
      await d.away();
      return d.body();
    },
    undo: async (d) => { await relay(d, d.sid, ['--rename', d.threads[1].id], d.threads[1].title); await d.sleep(2000); },
  },
  {
    name: 'steward-notice', features: ['steward-notices'],
    expect: 'The demo conversation, the steward, is in front. The conversation it manages was asked to run the test suite and '
      + 'waits for permission, so Claude Code Plus has sent the steward a notice through its inbox. Claude Code draws no row '
      + 'for what a script sends there, so the notice itself is not on screen: at the end of the steward conversation comes '
      + 'the fake model\'s reply to it with no message of yours before it, and that reply\'s first line gives a duration of '
      + 'a few seconds, not the hours since the last message you typed. In the Steward panel, that conversation\'s row starts '
      + 'with a filled red dot.',
    unchanged: 'The other conversation\'s title is its own again.',
    act: async (d) => {
      const t = d.threads[1];
      await stewardOf(d, [t.id]);
      const said = await relay(d, d.sid, [t.id], 'Please run the test suite.');
      if (!/^Sent: /.test(said)) throw new Error(`the steward could not pass the message on: ${said}`);
      if (!await d.until(() => transcriptHas(d, d.sid, `(${t.id}) is waiting for the user`), 60000, 1000)) throw new Error('the steward was not sent a notice within 60 s');
      await d.sleep(6000);
      await toBottom(d.conv);
      await d.away();
      return d.body();
    },
  },
  {
    name: 'steward-closed', features: ['steward-close'],
    expect: 'The steward asked to close the conversation that waits for permission. The first request, without the user\'s '
      + 'confirmation, was refused; the second, with it, closed the tab. "Why does the nightly export skip archived rows?" has no tab any more. The '
      + 'Steward panel says one ticked conversation is not open in any VS Code window, with a button to untick it.',
    unchanged: 'The steward conversation is as before.',
    act: async (d) => {
      const t = d.threads[1];
      await stewardOf(d, []);
      const refused = await relay(d, d.sid, ['--close', t.id]);
      if (!/^Not done: busy:/.test(refused)) throw new Error(`closing it without --confirmed was not refused: ${refused}`);
      const closed = await relay(d, d.sid, ['--close', '--confirmed', t.id]);
      if (!/^Closed: /.test(closed)) throw new Error(`closing it with --confirmed failed: ${closed}`);
      await d.sleep(6000);
      await d.away();
      return d.body();
    },
  },
  {
    name: 'steward-resumed', features: ['steward-resume'],
    expect: 'The steward opened that conversation again, in a tab of this window: "Why does the nightly export skip archived '
      + 'rows?" is in front and ends with your message "Carry on where you left off, please." and the fake model\'s reply. The '
      + 'message starts with the line Claude Code Plus puts before whatever a steward passes on: Sent by the steward "CSV export '
      + 'and budgets" (and the steward\'s session id) for the user:.',
    unchanged: null,
    act: async (d) => {
      const t = d.threads[1];
      await d.until(() => !liveOf(d, t.id).length, 30000, 500);
      let said = '';
      for (let i = 0; i < 10 && !/^Opened/.test(said); i++) {
        said = await relay(d, d.sid, ['--resume', t.id], 'Carry on where you left off, please.');
        if (!/^Opened/.test(said)) await d.sleep(2000);
      }
      if (!/^Opened: /.test(said)) throw new Error(`the steward could not open it: ${said}`);
      const frame = await thread(d, t);
      await d.until(() => lastReplyHas(frame, PLAIN), 20000, 500);
      await toBottom(frame);
      await d.away();
      return d.editor();
    },
  },
  {
    name: 'steward-opened', features: ['steward-open'],
    expect: 'A new conversation, which the steward started in this window\'s folder, is in a new tab in front: its first '
      + 'message, "Start a new piece of work: list the scripts in the repository.", is drawn as your own, followed by the '
      + 'fake model\'s reply.',
    unchanged: null,
    act: async (d) => {
      await stewardOf(d, []);
      const first = 'Start a new piece of work: list the scripts in the repository.';
      const said = await relay(d, d.sid, ['--open', d.profile.folder], first);
      d.openedId = (/Session id: ([0-9a-f-]{36})/.exec(said) || [])[1] || '';
      if (!/^Opened: /.test(said) || !d.openedId) throw new Error(`the steward could not open a new conversation: ${said}`);
      await d.until(() => transcriptHas(d, d.openedId, PLAIN), 30000, 500);
      await d.sleep(2000);
      await d.away();
      return d.editor();
    },
    undo: async (d) => {
      for (let i = 0; i < 10 && d.openedId; i++) {
        if (/^Closed: /.test(await relay(d, d.sid, ['--close', '--confirmed', d.openedId]))) break;
        await d.sleep(2000);
      }
    },
  },
  {
    name: 'steward-handoff', features: ['steward-handoff'],
    expect: 'The demo conversation, the steward, is in front, after "Why does the nightly export skip archived rows?" handed '
      + 'something off to it through Claude Code Plus. Claude Code draws no row for what arrives through its inbox, so the '
      + 'handoff itself is not on screen: the conversation ends with the fake model\'s reply to it. No message of yours comes '
      + 'before that reply, and its first line says the turn took a few seconds, not the time since you last typed.',
    unchanged: null,
    act: async (d) => {
      const t = d.threads[1];
      await stewardOf(d, [t.id]);
      const said = await relay(d, t.id, ['--handoff'], 'The user asked here for the release notes, which belong in another conversation.');
      if (!/^Handed off to the steward /.test(said)) throw new Error(`the handoff did not reach the steward: ${said}`);
      if (!await d.until(() => transcriptHas(d, d.sid, `(${t.id}), passed on by Claude Code Plus`), 30000, 1000)) throw new Error('the steward did not get the handoff within 30 s');
      await d.sleep(6000);
      await toBottom(d.conv);
      await d.away();
      return d.editor();
    },
  },
  {
    name: 'steward-link', features: ['steward-links'],
    expect: 'The steward was asked for a link to another conversation and its reply held one ("that conversation"); clicked, '
      + 'it brought that conversation\'s tab, "Add a dry-run flag to the cleanup script", to the front, with no prompt from '
      + 'VS Code about opening a link.',
    unchanged: null,
    act: async (d) => {
      const t = d.threads[2];
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(800);
      await send(d, d.conv, `Give me a link to conversation ${t.id}.`);
      const link = d.conv.locator('[data-testid="assistant-message"] a', { hasText: fakeModel.LINK_TEXT }).last();
      if (!await d.until(() => link.isVisible().catch(() => false), 30000, 500)) throw new Error('no link was drawn in the reply');
      await d.exec('workbench.action.closePanel');
      await link.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await link.click({ timeout: 15000 });
      await thread(d, t);
      await d.away();
      return d.body();
    },
  },
  /* Several stewards, with the demo conversation in front: its Steward panel greys another steward's box, which says
     why on hover, and the row of a conversation another steward also ticked ends in an eye with their number; hovering
     over the eye lists them. The other steward is set by writing the table, as its own panel would. In both themes. */
  ...['dark', 'light'].flatMap((tone) => [
    {
      name: `steward-eye${tone === 'light' ? '-light' : ''}`, features: ['steward-several', 'steward-panel', ...(tone === 'light' ? ['light-theme'] : [])],
      expect: `The Steward panel at the bottom, in a ${tone} theme, for the demo conversation in front. The row of "Why does the nightly export skip `
        + 'archived rows?" has a greyed box and says "a steward" after its title. The row of "Add a dry-run flag to the cleanup script" is ticked, '
        + 'and at its far right end, after the time, stands a small eye with the number 1 beside it, drawn in a lighter grey than the row\'s text and about '
        + 'as tall as the text. No row names a steward after its title. The "All, including new ones" and "New conversations" switches at the top '
        + 'right are both unticked and not greyed. The mouse is away; nothing overlaps.',
      unchanged: tone === 'light' ? null : 'The side bar is as before, and the tab bar has the same tabs; the demo conversation is '
        + 'in front now, and "Why does the nightly export skip archived rows?", made a steward by this step, has a crown after its '
        + 'title.',
      act: async (d) => {
        if (tone === 'light') { await theme(d, 'Default Light Modern'); await d.sleep(2500); }
        const frame = await severalPanel(d);
        await rest(d, frame, 'bottom');
        await d.away();
        await d.sleep(500);
        return d.part('workbench.parts.panel');
      },
    },
    {
      name: `steward-eye-hover${tone === 'light' ? '-light' : ''}`, features: ['steward-several', 'steward-panel', ...(tone === 'light' ? ['light-theme'] : [])],
      expect: `The mouse rests on the eye at the end of the row of "Add a dry-run flag to the cleanup script", still in the ${tone} theme, and a small `
        + 'box opens just below it, its right edge under the eye: its first line reads "Also managed by 1 other steward", and below it "Why does the '
        + 'nightly export skip archived rows?" in link colour. The box is readable against its background, wholly inside the panel, and has a thin border.',
      unchanged: 'The rows of the Steward panel are as in the step before.',
      act: async (d) => {
        const frame = d.several || await severalPanel(d);
        const t2 = d.threads[2];
        await rest(d, frame);
        await frame.locator(`.eyes[data-eyes="${t2.id}"]`).first().hover();
        if (!await d.until(() => frame.evaluate((id) => { const p = document.querySelector(`.eyes[data-eyes="${id}"] .pop`); return !!p && p.getBoundingClientRect().width > 0; }, t2.id), 3000, 100)) {
          throw new Error('the eye\'s list did not open');
        }
        await d.sleep(300);
        return d.part('workbench.parts.panel');
      },
    },
    {
      name: `steward-greyed-box${tone === 'light' ? '-light' : ''}`, features: ['steward-several', 'steward-panel', ...(tone === 'light' ? ['light-theme'] : [])],
      expect: `The mouse rests on the greyed box of "Why does the nightly export skip archived rows?", still in the ${tone} theme: a small hover label `
        + 'beside it reads "This conversation is a steward, and a steward is not managed by another". The label is readable against its background '
        + 'and does not hide the row\'s title; the eye\'s list from the step before is closed.',
      unchanged: 'The rows of the Steward panel are as in the step before.',
      act: async (d) => {
        const frame = d.several || await severalPanel(d);
        const t1 = d.threads[1];
        await rest(d, frame);
        await frame.locator(`.box:has(input[data-id="${t1.id}"])`).first().hover();
        if (!await d.until(() => frame.evaluate(() => { const l = document.querySelector('[data-steward-why]'); return !!l && l.getBoundingClientRect().width > 0; }), 3000, 100)) {
          throw new Error('no hover label appeared for the greyed box');
        }
        await d.sleep(300);
        return d.part('workbench.parts.panel');
      },
    },
    {
      name: `steward-eye-narrow${tone === 'light' ? '-light' : ''}`, features: ['steward-several', 'steward-panel', ...(tone === 'light' ? ['light-theme'] : [])],
      expect: `The panel area moved to the right side of the window, in the ${tone} theme, so the Steward panel is narrow. The rows' titles are cut `
        + 'short with an ellipsis where they do not fit, and the eye with its 1 still stands whole at the right end of the row of "Add a dry-run flag '
        + 'to the cleanup script". Nothing wraps onto a second line or overlaps.',
      unchanged: null,
      act: async (d) => {
        const frame = d.several || await severalPanel(d);
        await d.exec('workbench.action.positionPanelRight');
        await d.sleep(2000);
        await rest(d, frame);
        await d.away();
        await d.sleep(500);
        return d.part('workbench.parts.panel');
      },
      undo: async (d) => {
        await d.away();
        await d.exec('workbench.action.positionPanelBottom').catch(() => {});
        if (tone === 'light') { await theme(d, 'Default Dark Modern'); await d.sleep(2000); }
        try { fs.unlinkSync(stewardsFile(d)); } catch (_) { /* gone */ }
        for (const t of d.threads.slice(1)) await closeTab(d, t);
        await d.exec('workbench.action.closePanel').catch(() => {});
        d.several = null;
        await d.sleep(800);
      },
    },
  ]),
  {
    name: 'steward-new-switch', features: ['steward-new-switch', 'steward-panel'],
    expect: 'The Steward panel for the demo conversation. "New conversations" at the top right, beside "All, including new ones", is ticked; '
      + '"All, including new ones" is not. The boxes of the rows below are not greyed, and the header line reads "Managed by" and the demo '
      + 'conversation\'s title with one crown after it.',
    unchanged: null,
    act: async (d) => {
      for (const t of d.threads.slice(1)) { await d.exec('claude-vscode.editor.open', t.id); await d.sleep(1000); }
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(1000);
      const frame = await stewardPanel(d);
      await frame.locator('input[data-later]').first().click();
      if (!await d.until(() => frame.evaluate(() => { const b = document.querySelector('input[data-later]'); return !!b && b.checked; }), 10000, 300)) {
        throw new Error('New conversations did not turn on');
      }
      await d.away();
      await d.sleep(500);
      return d.part('workbench.parts.panel');
    },
    undo: async (d) => { try { fs.unlinkSync(stewardsFile(d)); } catch (_) { /* gone */ } await d.sleep(1500); },
  },
  {
    name: 'steward-list-changed', features: ['steward-list-change'],
    expect: 'The Steward panel for the demo conversation, after you asked it in its own conversation to take "Add a dry-run flag to the cleanup '
      + 'script" and to stop managing "Why does the nightly export skip archived rows?". The row of "Add a dry-run flag to the cleanup script" '
      + 'is ticked, the row of "Why does the nightly export skip archived rows?" is not, and the header counts 1.',
    unchanged: null,
    act: async (d) => {
      const [t1, t2] = d.threads.slice(1);
      await stewardOf(d, [t1.id]);
      typed(d, d.sid, `Take "${t2.title}" too.`);
      const said = await relay(d, d.sid, ['--take'], t2.title);
      if (!/^Done: /.test(said)) throw new Error(`the steward did not take it: ${said}`);
      typed(d, d.sid, `Stop managing "${t1.title}".`);
      const dropped = await relay(d, d.sid, ['--drop', t1.id]);
      if (!/^Done: /.test(dropped)) throw new Error(`the steward did not drop it: ${dropped}`);
      const frame = await stewardPanel(d);
      if (!await d.until(() => frame.evaluate(([a, b]) => { const x = document.querySelector(`input[data-id="${a}"]`), y = document.querySelector(`input[data-id="${b}"]`);
        return !!x && x.checked && !!y && !y.checked; }, [t2.id, t1.id]), 20000, 500)) {
        throw new Error('the boxes did not show the change');
      }
      await d.away();
      await d.sleep(500);
      return d.part('workbench.parts.panel');
    },
    undo: async (d) => { try { fs.unlinkSync(stewardsFile(d)); } catch (_) { /* gone */ } await d.sleep(1500); },
  },
  {
    name: 'steward-recent-held', features: ['steward-recent-send'],
    expect: 'The conversation "Add a dry-run flag to the cleanup script" is in front. Two stewards manage it, and the second one\'s message was held '
      + 'back once, as the first had just sent one, then sent with --anyway. The last message from you in it starts with the line "Sent by the '
      + 'steward" followed by the demo conversation\'s title in quotes and its session id in parentheses, then "for the user:", and on the next line '
      + 'reads "Turn the dry-run flag on by default.". The message before it, from the other steward, starts with that steward\'s line the same way.',
    unchanged: null,
    act: async (d) => {
      const [t1, t2] = d.threads.slice(1);
      for (const t of [t1, t2]) { await d.exec('claude-vscode.editor.open', t.id); await d.sleep(1000); }
      fs.mkdirSync(path.dirname(stewardsFile(d)), { recursive: true });
      fs.writeFileSync(stewardsFile(d), JSON.stringify({ version: 3, stewards: {
        [t1.id]: { manages: [t2.id], names: {}, at: Date.now() - 1000, title: t1.title }, [d.sid]: { manages: [t2.id], names: {}, at: Date.now() } } }, null, 1) + '\n');
      await d.sleep(6000);
      const one = await relay(d, t1.id, [t2.id], 'Keep the dry-run flag off by default.');
      if (!/^Sent: /.test(one)) throw new Error(`the first steward could not send: ${one}`);
      const words = 'Turn the dry-run flag on by default.';
      const held = await relay(d, d.sid, [t2.id], words);
      if (!/^Not sent: another steward/.test(held)) throw new Error(`the second message was not held back: ${held}`);
      const sent = await relay(d, d.sid, ['--anyway', t2.id], words);
      if (!/^Sent: /.test(sent)) throw new Error(`--anyway did not send it: ${sent}`);
      const frame = await thread(d, t2);
      await d.until(() => lastReplyHas(frame, PLAIN), 20000, 500);
      await toBottom(frame);
      await d.away();
      return d.editor();
    },
    undo: async (d) => {
      try { fs.unlinkSync(stewardsFile(d)); } catch (_) { /* gone */ }
      for (const t of d.threads.slice(1)) await closeTab(d, t);
      await d.exec('workbench.action.closePanel').catch(() => {});
      await d.sleep(800);
    },
  },
  {
    name: 'conversation-links', features: ['conversation-links'],
    expect: 'The last reply in the demo conversation names the conversation "Add a dry-run flag to the cleanup script" twice: once '
      + 'on its own at the start of the reply, and once inside corner brackets. Both are drawn as links, in the same colour and '
      + 'style as the other links Claude Code draws in replies, and the brackets themselves are not part of the link. The 8 '
      + 'characters after "By its short id:" are a link to it too while no other running conversation\'s id starts with them, and '
      + 'plain text otherwise; the demo\'s conversations share their first 8 characters, so either is right. The rest of the reply '
      + 'is plain text. Where the machine has no CJK font the corner brackets show as empty boxes; that is the font, not the links.',
    unchanged: null,
    act: async (d) => { await toMentions(d, d.threads[2], true); await d.away(); return d.editor(); },
  },
  {
    name: 'conversation-links-hover', features: ['conversation-links'],
    expect: 'The mouse rests on the first link in the last reply, and a label floats next to it: the first line is the title "Add a '
      + 'dry-run flag to the cleanup script", the second says "Claude Code conversation 7d1f3c2a, active" and how long ago. The '
      + 'label is wholly inside the panel, readable, and does not hide the link itself.',
    unchanged: 'The conversation is as in the picture before, scrolled to the same place.',
    act: async (d) => {
      await toMentions(d, d.threads[2], false);
      await rest(d, d.conv);
      await mentionLinks(d, d.threads[2]).first().hover();
      if (!await d.until(() => d.conv.evaluate(() => { const b = document.querySelector('[data-cce-label="1"]'); return !!b && !!b.innerText.trim(); }), 3000, 100)) {
        throw new Error('no hover label appeared over the link');
      }
      await d.sleep(300);
      return d.editor();
    },
    undo: (d) => rest(d, d.conv),
  },
  {
    name: 'session-twice', features: ['session-twice'],
    expect: 'The conversation "Add a dry-run flag to the cleanup script" runs in two Claude Code processes at once. In the Steward '
      + 'panel at the bottom, its row says "2 processes" and has a "Stop the old process" button. In Agent Plus\'s session list in '
      + 'the side bar, its row says "2 processes" after the title, and the mouse rests on that row: the hover box under it has a '
      + 'line "Open in 2 processes at once". The box is wholly inside the side bar; nothing overlaps.',
    unchanged: null,
    act: async (d) => {
      const t = d.threads[2];
      /* Its tab first: Claude Code starts no process of its own for a conversation another process runs. */
      await d.exec('claude-vscode.editor.open', t.id);
      if (!await d.until(() => liveOf(d, t.id).length === 1, 60000, 500)) throw new Error('its tab runs no process of its own');
      d.twicePid = await d.call(`const k = require('child_process').spawn(arg.bin, ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
        '--resume', arg.id], { cwd: arg.cwd, env: Object.assign({}, process.env, arg.env), stdio: ['pipe', 'ignore', 'ignore'] });
        globalThis.__cceLookSecond = k; return k.pid;`,
      { bin: claudeCli(d), id: t.id, cwd: d.profile.folder,
        env: { ANTHROPIC_BASE_URL: d.model.url, ANTHROPIC_API_KEY: require('./lib/fake-home').KEY, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' } });
      if (!await d.until(() => liveOf(d, t.id).some((r) => r.pid === d.twicePid) && liveOf(d, t.id).length === 2, 30000, 500)) throw new Error('the second process did not start');
      const frame = await stewardOf(d, []);
      if (!await d.until(() => frame.evaluate((id) => { const a = document.querySelector(`li.row a.name[data-open="${id}"]`), li = a && a.closest('li.row'); return !!li && !!li.querySelector('[data-stop-old]'); }, t.id), 45000, 1000)) {
        throw new Error('the Steward panel does not mark it as run twice');
      }
      d.twiceFrame = frame;
      const list = await agentList(d);
      await agentRowWhere(d, list, titleNow(d, t), (s) => /\b2 processes\b/.test(s.marks), 30000, 'does not say 2 processes');
      await agentHover(d, list, titleNow(d, t), /Open in 2 processes at once/);
      return d.body();
    },
  },
  {
    name: 'session-twice-stopped', features: ['session-twice'],
    expect: 'Stop the old process was clicked: a notification at the bottom right says "Stopped process <a number> of that '
      + 'conversation."',
    unchanged: 'The tab bar is as before.',
    act: async (d) => {
      const t = d.threads[2];
      if (!d.twiceFrame) throw new Error('the conversation was not run twice');
      await d.twiceFrame.locator(`[data-stop-old="${t.id}"]`).first().click({ timeout: 5000 });
      const said = () => d.page.evaluate(() => [...document.querySelectorAll('.notification-list-item-message')].some((e) => /^Stopped process \d+/.test(e.innerText)));
      if (!await d.until(said, 15000, 300)) throw new Error('no notice that the old process was stopped appeared within 15 s');
      await d.sleep(500);
      await d.away();
      return d.body();
    },
    undo: async (d) => {
      await d.call('if (globalThis.__cceLookSecond) globalThis.__cceLookSecond.kill(); return true;').catch(() => {});
      await d.exec('notifications.clearAll').catch(() => {});
      const frame = await stewardOf(d, []).catch(() => null);
      if (frame) await frame.locator('button[data-act="none"]').click().catch(() => {});
      await d.sleep(1500);
      for (const t of d.threads.slice(1)) await closeTab(d, t);
      await d.exec('workbench.action.closePanel').catch(() => {});
      await d.exec('claude-vscode.editor.open', d.sid);
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
  /* The pen on a work plan row, which puts "About row N (title): " into the conversation's message box (prefill in
     src/claude-source.js). Undo empties the box again, because an answer sent later is refused while the box holds
     text. */
  {
    name: 'work-plan-pen', features: ['write-about-row'],
    expect: 'In the side bar, Agent Plus\'s work plan view with the mouse on the row "3. Monthly budgets per category, with an '
      + 'over-budget warning in report", which shows a pen button at its right end; VS Code\'s hover box for that '
      + 'row may cover part of the view. In the demo conversation on the right, the '
      + 'message box holds "About row 3 (Monthly budgets per category, with an over-budget warning in report): " and nothing '
      + 'else, fully readable, with its focus border drawn. The conversation above it has no new message from you.',
    unchanged: 'The work plan view lists the same rows as before.',
    act: async (d) => {
      const text = 'About row 3 (Monthly budgets per category, with an over-budget warning in report): ';
      await demoAt(d, '', { focus: true });
      /* Point the work plan view at this conversation the way a click on the plan bar does; otherwise it follows the
         conversation in front only after that tab has reported its session to Agent Plus. */
      await d.exec('agentPlus.showWorkPlanOf', { sourceId: 'claude-code', sessionId: d.sid });
      await d.sleep(1500);
      const row = d.page.locator('[id="workbench.parts.sidebar"] .monaco-list-row')
        .filter({ has: d.page.locator('.label-name', { hasText: /^3\. Monthly budgets per category/ }) }).first();
      if (!await d.until(() => row.isVisible().catch(() => false), 15000, 500)) throw new Error('no row 3 in the work plan view');
      await row.hover();
      const pen = row.locator('.action-label[aria-label="Agent Plus: Write About This Row in Its Conversation"]');
      if (!await d.until(() => pen.isVisible().catch(() => false), 5000, 200)) throw new Error('no pen on the row: the Agent Plus installed may not have one');
      await pen.click();
      const box = () => d.conv.evaluate(() => { const b = document.querySelector('[role="textbox"][aria-label="Message input"]'); return b ? b.textContent : null; });
      if (!await d.until(async () => (await box()) === text, 10000, 200)) throw new Error(`the message box holds ${JSON.stringify(await box())}`);
      await row.hover();
      await d.sleep(500);
      const sb = await d.sidebar(), ed = await d.editor();
      if (!sb || !ed) return ed || sb;
      const x = Math.min(sb.x, ed.x), y = Math.min(sb.y, ed.y);
      return { x, y, width: Math.max(sb.x + sb.width, ed.x + ed.width) - x, height: Math.max(sb.y + sb.height, ed.y + ed.height) - y };
    },
    undo: async (d) => {
      await d.conv.locator('[role="textbox"][aria-label="Message input"]').first().click();
      await d.page.keyboard.press('Control+a');
      await d.page.keyboard.press('Delete');
      await d.sleep(400);
      await rest(d, d.conv);
    },
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
    name: 'live-running', features: ['dot-working', 'tool-clock'],
    expect: 'A turn is running in the conversation "Find where the retry delay for the inventory sync is set", in '
      + 'a tab of its own, with Focus view on: a filled green dot appears at the top right of the tab\'s logo, '
      + 'and another filled green dot appears on its row\'s Claude Code logo in Agent Plus\'s session list in the '
      + 'side bar; and the working line above the message box says no tool has been called yet this turn and how '
      + 'long ago your message was sent.',
    unchanged: 'The panel at the bottom is closed; the side bar now shows Agent Plus\'s session list.',
    act: async (d) => {
      const frame = await live(d);
      await focusIn(d, frame, true);
      const list = await agentList(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.sleep(800);
      d.model.hold();
      const turns = d.model.turns();
      await send(d, frame, 'Run the tests again.');
      if (!await d.until(() => d.model.turns() > turns, 30000, 300)) throw new Error('the message did not reach the model in 30 s');
      await d.sleep(4000);
      await agentRowWhere(d, list, titleNow(d, d.threads[0]), (s) => s.dot === 'green', 20000, 'has no green dot');
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
  /* Claude Code's host asks a conversation's CLI for its figures when it starts and after each turn, which the step
     before ran. */
  {
    name: 'agent-plus-account', features: ['agent-plus-account'],
    expect: 'Agent Plus\'s session list in the side bar, its ACCOUNT & USAGE section at the top opened. In it a Claude Code part, '
      + 'headed by the Claude Code logo and its name, has a row Sign-in with "API key" and ends with the figures of the conversation in front: a small heading in '
      + 'capitals, THIS CONVERSATION, and under it the conversation\'s title, "Find where the retry delay for the inventory sync '
      + 'is set". Under that four rows, each a label and a value: Estimated cost with '
      + 'a dollar amount, Total duration (API) and Total duration (wall) each with a time such as "2.3s" or "1m 5s", and Total '
      + 'code changes such as "0 lines added, 0 lines removed". The labels and values line up and are readable, and nothing is '
      + 'cut off at the side bar\'s edge.',
    unchanged: 'The conversation in the editor is as before.',
    act: async (d) => {
      await live(d);
      const list = await agentList(d);
      const section = () => list.evaluate(() => {
        const a = document.querySelector('.sl-section[data-key="account"]');
        return a && !a.classList.contains('sl-hidden') ? { open: a.classList.contains('sl-open'), text: a.textContent } : null;
      }).catch(() => null);
      if (!await d.until(async () => { const s = await section(); return s && /Claude Code/.test(s.text); }, 30000, 500)) {
        throw new Error(`Account & usage in Agent Plus's list has no Claude Code part within 30 s: ${JSON.stringify(await section())}`);
      }
      if (!(await section()).open) await list.locator('.sl-section[data-key="account"] .sl-head').first().click();
      const full = await d.until(async () => { const s = await section(); return s && s.open && /Estimated cost/.test(s.text) && /Total duration \(wall\)/.test(s.text)
        && /Total code changes/.test(s.text) && s; }, 30000, 500);
      if (!full) throw new Error(`Account & usage does not show the figures of the conversation in front: ${JSON.stringify(await section())}`);
      await d.away();
      return d.sidebar();
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
    name: 'live-unread', features: ['unread-envelope', 'dot-stopped', 'need-you-notices'],
    expect: 'A reply landed while the conversation\'s tab was in the background, behind a text file (notes.txt) opened in the '
      + 'same group: that tab\'s logo has no dot, and its title ends in a white envelope. In Agent Plus\'s session list in the '
      + 'side bar, the logo on its row has no dot either, and an envelope icon follows its title, before the time; the title '
      + 'does not run into it, and the row\'s time lines up with the other rows\'. No red or blue dot anywhere. No notification '
      + 'at the bottom right: Agent Plus shows none for a conversation this window shows.',
    unchanged: 'The tab bar has the same Claude Code tabs as before, plus notes.txt.',
    act: async (d) => {
      const frame = await live(d);
      const list = await agentList(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.sleep(600);
      if (!await d.front()) throw new Error('the window did not get the focus, which Agent Plus needs before it shows a notice');
      await d.exec('notifications.clearAll');
      d.model.hold();
      const turns = d.model.turns();
      await send(d, frame, 'And in the staging config?');
      if (!await d.until(() => d.model.turns() > turns, 30000, 300)) throw new Error('the message did not reach the model in 30 s');
      if (!await d.until(() => seenWorking(d, d.threads[0].id), SEEN_MS, 300)) throw new Error('Agent Plus did not see the turn running in 60 s');
      await notesInFront(d);
      await d.sleep(800);
      d.model.release();
      await d.away();
      if (!await d.until(() => seenUnread(d, d.threads[0].id), SEEN_MS, 300)) throw new Error('Agent Plus did not see the reply unread in 60 s');
      const said = `"${d.threads[0].title}" finished.`;
      if (await d.until(async () => ((await needToasts(d)) || []).some((x) => noticeSays(x, said)), 9000, 300)) throw new Error('Agent Plus showed a notice for a conversation this window shows');
      const counted = await needCountBox(d);
      if (counted) throw new Error(`Agent Plus counted an unread reply as waiting for you: ${JSON.stringify(counted)}`);
      await agentRowWhere(d, list, titleNow(d, d.threads[0]), (s) => s.unread === 1 && s.dot === 'none', 20000, 'does not show one envelope and no dot');
      return d.body();
    },
  },
  {
    name: 'need-you-count', features: ['need-you-notices'],
    expect: 'A close-up of the status bar around Agent Plus\'s Conversations entry: on a yellow background it '
      + 'reads "1 conversation needs you", the conversation of another window that waits for you to approve Bash, '
      + 'or "2 conversations need you" if the count already includes the demo conversation. Its plan has '
      + 'questions for you to decide. The conversation here with an unread reply is not counted.',
    unchanged: 'The window is as before.',
    act: async (d) => {
      /* The entry's text counts every conversation that needs you, the demo conversation too once Agent Plus has read the
         questions of its plan; its hover lists the waiting ones in a group of their own. */
      const waits = Number(((await needCountBox(d)) || {}).text) || 0;
      const want = needTotal(((await needEntry(d)) || {}).says) + 1;
      otherWindow(d, [{ sessionId: LOOK_ID(15), title: 'Tag the release build', waitingFor: { kind: 'permission', tool: 'Bash' } }]);
      /* The status bar around the entry, also for the picture of a step that fails. */
      const near = async (c) => {
        if (!c) return null;
        const width = await d.page.evaluate(() => innerWidth);
        const x = Math.max(0, c.x - 200);
        return { x, y: c.y - 4, width: Math.min(width, c.x + c.width + 200) - x, height: c.height + 8 };
      };
      const b = await d.until(async () => { const c = await needCountBox(d); return c && Number(c.text) === waits + 1 && c; }, 20000, 300);
      if (!b) {
        throw Object.assign(new Error(`Agent Plus did not count the waiting conversation of another window in 20 s: ${JSON.stringify({ waits, now: await needCountBox(d) })}`),
          { area: await near(await needEntry(d)) });
      }
      const says = `${want} ${want === 1 ? 'conversation needs' : 'conversations need'} you`;
      const e = await d.until(async () => { const x = await needEntry(d); return x && x.says === says && x; }, 5000, 300);
      if (!e) throw Object.assign(new Error(`the entry reads "${((await needEntry(d)) || {}).says}", not "${says}"`), { area: await near(await needEntry(d)) });
      return near(e);
    },
    undo: async (d) => {
      noOtherWindow(d);
      await d.until(async () => !(await needCountBox(d)), 20000, 300);
      await d.exec('notifications.clearAll');
      await d.sleep(1500);
    },
  },
  {
    name: 'need-you-list', features: ['need-you-notices'],
    expect: 'After Agent Plus: Show the Conversations That Need You, a list opens at the top of the '
      + 'window with the placeholder "Conversations that need you" and one row: "Find where the retry delay for the inventory '
      + 'sync is set", described as finished.',
    unchanged: 'The editor and the side bar are as before.',
    act: async (d) => {
      await d.call('vscode.commands.executeCommand("agentPlus.showAttention"); return true;');
      const open = () => d.page.evaluate(() => { const q = document.querySelector('.quick-input-widget'); return !!q && !!q.offsetParent && q.innerText; });
      if (!await d.until(async () => /finished/.test((await open()) || ''), 10000, 300)) throw new Error(`the list did not open with the conversation: ${await open()}`);
      await d.sleep(600);
      /* The list lies over the title bar, which the other pictures leave out. */
      const b = await d.page.evaluate(() => { const r = document.querySelector('.quick-input-widget').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
      const pad = 16;
      return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad };
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(500); await d.exec('notifications.clearAll'); await d.sleep(300); },
  },
  {
    name: 'wait-notice-tool', features: ['wait-notices'],
    expect: 'At the bottom right, one notification from Agent Plus with an Open and a Dismiss button. '
      + 'It reads: "Deploy the staging stack" is waiting for you to approve Bash. The conversation is in another window. '
      + 'No notification from Claude Code saying it is requesting permission. ' + NOTICE_SOURCE,
    unchanged: 'The editor and the side bar are as before.',
    ...waitNotice(LOOK_ID(1), 'Deploy the staging stack', { kind: 'permission', tool: 'Bash' }, '"Deploy the staging stack" is waiting for you to approve Bash.'),
  },
  {
    name: 'wait-notice-question', features: ['wait-notices'],
    expect: 'At the bottom right, one notification from Agent Plus with an Open and a Dismiss button, wholly inside the window and '
      + 'readable. It reads: "Pick the region for the new cluster" has a question for you. No notification from Claude Code. '
      + NOTICE_SOURCE,
    unchanged: 'The editor and the side bar are as before.',
    ...waitNotice(LOOK_ID(2), 'Pick the region for the new cluster', { kind: 'question' }, '"Pick the region for the new cluster" has a question for you.'),
  },
  {
    name: 'wait-notice-replay', features: ['wait-notices'],
    expect: 'While no VS Code window had the focus, two conversations of another window started to wait; then this window got the focus back. '
      + 'At the bottom right, two notifications from Agent Plus, one above the other, each with its own '
      + 'Open and Dismiss button. One reads: "Rotate the '
      + 'signing keys" is waiting for you to approve Edit. The other reads: "Choose the import config" has a question for you. No '
      + 'notification naming both. ' + NOTICE_SOURCE,
    unchanged: 'The editor and the side bar are as before.',
    ...replayNotice({ sessionId: LOOK_ID(3), title: 'Rotate the signing keys', waitingFor: { kind: 'permission', tool: 'Edit' } },
      { sessionId: LOOK_ID(4), title: 'Choose the import config', waitingFor: { kind: 'question' } },
      ['"Rotate the signing keys" is waiting for you to approve Edit.', '"Choose the import config" has a question for you.']),
  },
  {
    name: 'renamed-unread', features: ['rename-without-marks', 'long-title-envelope', 'unread-envelope'],
    expect: 'Before the screenshot, the test changed the name of the conversation with an unread reply using its '
      + 'row\'s rename box in Claude Code\'s own session list. The test entered an envelope, then a very long '
      + 'name, then an envelope and a crown. Now the side bar is narrow and shows Agent Plus\'s session list, the '
      + 'demo conversation is in front, and the Steward panel is open at the bottom. In Agent Plus\'s list, the '
      + 'renamed conversation\'s row shows "Where the retry delay..." cut short with an ellipsis, then exactly '
      + 'one envelope icon, whole and not inside the title, and then the time; no crown. In the Steward panel its '
      + 'row\'s title is cut short the same way and is followed by one envelope. Its tab\'s title ends in one '
      + 'envelope and has no crown.',
    unchanged: 'The other conversations\' rows are as before.',
    act: async (d) => {
      const list = await sessionList(d);
      const id = d.threads[0].id;
      const name = `\u2709\uFE0F ${LONG} \u2709\uFE0F ${CROWN}`;
      const held = await renameInList(d, list, id, name);
      await d.exec('claude-vscode.editor.open', d.sid);
      await d.sleep(1200);
      const agents = await agentList(d);
      await d.sideTo(300);
      await d.exec('workbench.view.extension.claudeCodePlusSteward');
      const frame = await d.frameWhere(() => /Managed by/.test(document.body ? document.body.innerText : ''), 30000);
      if (frame) await d.until(() => frame.evaluate(() => !!document.querySelector('.env')), 20000, 1000);
      await agentRowWhere(d, agents, LONG, (s) => s.unread === 1 && !s.crowns, 20000, 'does not show one envelope and no crown');
      await d.away();
      const stored = storedTitle(d, id), labels = await tabLabels(d);
      if (MARK_RE.test(held)) throw new Error(`the rename box held a mark: "${held}"`);
      if (stored !== LONG) throw new Error(`the transcript stored "${stored}"`);
      const tab = labels.find((l) => l.startsWith('Where the retry')) || '';
      if (!/ (?:\u{1F4E9}|\u2709\uFE0E)$/u.test(tab) || /\u{1F451}/u.test(tab) || (tab.match(/\u{1F4E9}|\u2709/gu) || []).length !== 1) {
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
    name: 'live-background', features: ['dot-background', 'unread-envelope'],
    expect: 'A turn that put a command in the background ("sleep 40") ended while the conversation\'s tab was '
      + 'behind notes.txt: the tab\'s logo carries a green ring, not a filled dot, and its title ends in a white '
      + 'envelope, so both show at once. In Agent Plus\'s session list in the side bar, the same green ring '
      + 'appears on its row\'s logo. An envelope icon sits between the title and the time. Agent Plus does not '
      + 'count it in the status bar or show a notice for it while its work still runs.',
    unchanged: 'The tab bar has the same tabs as before; notes.txt is in front.',
    act: async (d) => {
      const frame = await live(d);
      const list = await agentList(d);
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
      const tab = (await tabLabels(d)).find((l) => l.startsWith('Where the retry')) || '';
      if (!/ \u{1F4E9}$/u.test(tab)) throw new Error(`the tab reads "${tab}", not ending in an envelope`);
      await agentRowWhere(d, list, titleNow(d, d.threads[0]), (s) => s.dot === 'greenRing' && s.unread === 1, 20000, 'does not show a green ring and one envelope');
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
    expect: 'Claude Code asks for permission to run "npm test": the question and its Yes and No choices are in '
      + 'the panel. The tab\'s logo carries a filled red dot at its top right, and the tab has no blue dot. Agent '
      + 'Plus marks a dialog that waits for you with a filled blue dot on the conversation\'s logo in the session '
      + 'list in the side bar. The tool row of that call has its time on a line of its own above "Bash" and its '
      + 'description, which stays on one line.',
    unchanged: 'The earlier messages are as before, but higher and dimmed: the conversation has scrolled to show the question, '
      + 'and Claude Code draws the rows before it greyed out while it waits for the answer. Claude Code also keeps a message of '
      + 'yours pinned at the top while the rows that answer it scroll up behind it, so some of those rows may be hidden under '
      + 'it. The tab\'s title has no envelope now that the tab is in front.',
    act: async (d) => {
      const frame = await live(d);
      const list = await agentList(d);
      await askPermission(d, frame);
      await agentRowWhere(d, list, titleNow(d, d.threads[0]), (s) => s.dot === 'blue', 20000, 'has no blue dot');
      await d.away();
      return d.body();
    },
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
    name: 'live-helper', features: ['view-filter', 'agent-map'],
    expect: 'The conversation started a helper (a sub-agent) in the background, which has finished: an Agent row "Look through the '
      + 'notes" with the helper\'s prompt in a box and "Finished" under it, then the replies that followed. Claude Code keeps a '
      + 'background helper\'s own messages in a transcript of their own and draws none of them in the conversation, so no row '
      + 'here carries the tag with the helper\'s task. A filter control reading "All . 1", which counts the helper, has appeared in '
      + 'the footer.',
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
    expect: 'The footer\'s filter control has been clicked and its menu is open: All, Main (the main thread), and one entry for '
      + 'the helper named by its task. The menu is readable and wholly inside the panel.',
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
    name: 'view-filter-helper', features: ['view-filter'],
    expect: 'The helper was picked in the filter: the control names it by the start of its task, and as none of the helper\'s '
      + 'messages are drawn in this conversation (see the step that started it), a note near the top says "No messages loaded for '
      + 'this agent." and why. The main thread\'s messages are hidden.',
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
    name: 'off-view-filter', features: ['view-filter'], ...off('claudeCodePlus.show.footerViewFilter'),
    expect: 'The filter control is gone from the footer; the other footer buttons stay, without overlapping.',
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
    name: 'live-work-running', only: ['linux'], features: ['agent-map', 'dot-background'],
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
    name: 'live-work-map', only: ['linux'], features: ['agent-map', 'dot-background'],
    expect: 'The agent map, opened from that button. At the top THIS CONVERSATION and the conversation\'s own card (its title, '
      + 'with the tokens in context), which starts with a green ring. After it BACKGROUND TASKS 1, the '
      + 'command\'s card (sleep 40) with a filled dot in the same green as the ring, and a section headed "claude -p SESSIONS" with a '
      + 'count badge 1: a card with a green dot, release-notes-worker, and its process id, start and running time. No card lists '
      + 'a detached command or the shell that started the worker.',
    unchanged: 'The conversation behind the map is as before.',
    act: async (d) => {
      const frame = await live(d);
      await frame.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
      if (!await d.until(() => frame.evaluate(() => !!document.querySelector('[data-cce-map-section="workers"]')), 10000, 500)) throw new Error('the map lists no worker');
      await d.sleep(1200);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); },
  },
  {
    name: 'live-work-ended', only: ['linux'], features: ['agent-map'],
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
    name: 'live-work-ended-map', only: ['linux'], features: ['agent-map'],
    expect: 'The agent map once both have ended: no claude -p SESSIONS and no BACKGROUND TASKS section; the conversation\'s own '
      + 'card starts with a grey dot, not a green one, and under SUBAGENTS the finished helper of an earlier step is still listed '
      + 'with a grey dot.',
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
  /* A `claude --bg` session the conversation started, through the stand-in of lib/fake-model.js (BG_SESSION_SCRIPT): the
     agents button and the map while it runs, once it has finished and the conversation has answered the notice of its
     end, and once the setting that lists such sessions is turned off. */
  {
    name: 'live-bg-running', features: ['background-sessions', 'agent-map'],
    expect: 'A close-up of the footer under the message box. The conversation started a session with claude --bg and its turn '
      + 'has ended; the session still runs. The agents button reads "1 bg" and the small dot at its start is filled and green, '
      + 'not grey.',
    unchanged: 'The conversation is as before, with one more short exchange at its end.',
    act: async (d) => {
      const frame = await live(d);
      const bin = path.join(d.profile.home, 'fake-bg');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'claude'), fakeModel.BG_SESSION_SCRIPT(120), { mode: 0o755 });
      d.bgStarted = Date.now();
      d.bgFrom = d.model.seen.length;
      await runAsked(d, frame, `Please ${fakeModel.ASK_FOR_BG_SESSION}.`, '--bg');
      const shown = await d.until(async () => { const b = await agentsButton(frame); return b && b.dot === 'running' && /\b1 bg\b/.test(b.label) && b; }, 40000, 500);
      if (!shown) throw new Error(`the agents button did not count the session within 40 s: ${JSON.stringify(await agentsButton(frame))}`);
      await toBottom(frame);
      await d.away();
      await d.sleep(800);
      return around(d, frame, 'button[data-agents-dot]');
    },
  },
  {
    name: 'live-bg-map', features: ['background-sessions', 'agent-map'],
    expect: 'Clicking that button opens the agent map. A section headed "claude --bg SESSIONS" ("claude --bg" in a code font) '
      + 'with a count badge 1 holds one card: a green dot, nightly-report, and under it "running", for how long and its '
      + 'eight-digit job id. The conversation\'s own card, first under THIS CONVERSATION, starts with a green ring, '
      + 'not a filled dot. Nothing in the map overlaps.',
    unchanged: 'The conversation behind the map is as before.',
    act: async (d) => {
      const frame = await live(d);
      await frame.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
      if (!await d.until(() => frame.evaluate(() => !!document.querySelector('[data-cce-map-section="background"]')), 10000, 500)) throw new Error('the map lists no background session');
      await d.sleep(1200);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); },
  },
  {
    name: 'live-bg-ended', features: ['background-sessions', 'detached-end-notices'],
    expect: 'The conversation once the claude --bg session has finished. Claude Code Plus has told it so through its inbox, '
      + 'and Claude Code draws no row for that: the conversation ends with the fake model\'s reply to the notice. No message '
      + 'of yours comes before that reply, and the reply\'s first line says the turn took a few seconds, not the minutes since '
      + 'you last typed. In the footer the agents button reads "1 bg done" and its dot is grey, not green; the tab\'s logo has no '
      + 'green ring.',
    unchanged: 'The conversation is as before, with that reply at its end.',
    act: async (d) => {
      const frame = await live(d);
      const due = (d.bgStarted || Date.now()) + 120000 - Date.now();
      const over = await d.until(async () => { const b = await agentsButton(frame); return b && b.dot !== 'running' && /\b1 bg done\b/.test(b.label) && b; }, Math.max(due, 0) + 90000, 1000);
      if (!over) throw new Error(`the agents button did not say 1 bg done: ${JSON.stringify(await agentsButton(frame))}`);
      const from = d.bgFrom || 0;
      if (!await d.until(() => d.model.seen.slice(from).some((x) => /news of a `claude --bg` session/.test(x.ask || '')), 60000, 1000)) throw new Error('the conversation was not told the session ended within 60 s');
      await d.sleep(6000);
      await toBottom(frame);
      await d.away();
      await d.sleep(800);
      return d.editor();
    },
  },
  {
    name: 'live-bg-ended-map', features: ['background-sessions', 'agent-map'],
    expect: 'The agent map once the session has finished, its card clicked open: under claude --bg SESSIONS 1, nightly-report '
      + 'with a grey dot and "done" on its second line, and under the card its result in a box ("The nightly report is written: '
      + '2 failed tests, both in the export job.") and buttons for claude attach and claude logs with its id. The conversation\'s '
      + 'own card starts with a grey dot.',
    unchanged: 'The conversation behind the map is as before.',
    act: async (d) => {
      const frame = await live(d);
      await frame.locator('button[data-agents-dot]').first().click({ timeout: 5000 });
      const row = frame.locator('details > summary').filter({ hasText: 'nightly-report' }).first();
      if (await d.until(() => row.isVisible().catch(() => false), 10000, 500)) await row.click();
      await d.sleep(1200);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); },
  },
  {
    name: 'off-background-sessions', features: ['background-sessions'],
    expect: 'A close-up of the footer with the setting that lists claude --bg sessions turned off: the agents '
      + 'button no longer counts the session. The button now reads "0 agents" with a grey dot in place of "1 bg '
      + 'done". It stays in the footer because the agent map still lists the finished helper an earlier step ran. '
      + 'The footer\'s other buttons are in place and nothing overlaps.',
    unchanged: 'The conversation is as before.',
    act: async (d) => {
      const frame = await live(d);
      /* The close-up is taken where the button is now, since turning the setting off removes it. */
      const was = await frame.locator('button[data-agents-dot]').first().boundingBox().catch(() => null);
      await setting(d, 'claudeCodePlus.show.backgroundSessions', false);
      await d.until(async () => { const b = await agentsButton(frame); return !b || !/\bbg\b/.test(b.label); }, 15000, 500);
      await toBottom(frame);
      await d.away();
      await d.sleep(800);
      const ed = await d.editor();
      if (!was || !ed) return around(d, frame, '[data-cce-info]');
      const x = Math.max(ed.x, was.x - 240), y = Math.max(ed.y, was.y - 40);
      return { x, y, width: Math.min(ed.x + ed.width, was.x + was.width + 240) - x, height: Math.min(ed.y + ed.height, was.y + was.height + 40) - y };
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await setting(d, 'claudeCodePlus.show.backgroundSessions', undefined); await d.sleep(1500); },
  },

  /* This extension's commands. */
  {
    name: 'command-status', features: ['show-status'],
    expect: 'After Claude Code Plus: Show Status, a notification at the bottom right says Claude Code\'s panel and host are both '
      + 'patched and names the token mode. It is readable and not cut off.',
    unchanged: 'The editor and side bar are as before.',
    act: async (d) => { await showStatus(d); await d.sleep(1500); return d.body(); },
  },
  {
    name: 'agent-plus-status', features: ['agent-plus-status'],
    expect: 'After Agent Plus: Show Status, the Output panel at the bottom shows Agent Plus\'s lines: its version and protocol, '
      + '"Extensions using it" naming xnervwang.claude-code-plus, and a line beginning "Source claude-code: Claude Code, from '
      + 'xnervwang.claude-code-plus, plans in" followed by a folder.',
    unchanged: 'The editor and the side bar are as before.',
    act: async (d) => {
      /* The notice from the previous step's Show Status would otherwise cover the panel. */
      await d.exec('notifications.clearAll');
      const lines = await d.call('return await vscode.commands.executeCommand("agentPlus.showStatus");');
      if (!Array.isArray(lines) || !lines.some((l) => /^Source claude-code: Claude Code, from xnervwang\.claude-code-plus, plans in /.test(l))) {
        throw new Error(`Agent Plus's status names no Claude Code source: ${JSON.stringify(lines)}`);
      }
      /* The panel's default height holds fewer lines than the status, and the Output view keeps its last line in view. */
      d.panelHeight = ((await d.part('workbench.parts.panel')) || {}).height || 0;
      await panelTo(d, 470);
      const ends = [lines[0], lines[lines.length - 1]].map((l) => String(l).slice(0, 24));
      if (!await d.until(() => outputShows(d, ends), 10000, 300)) throw new Error(`the Output panel does not show both ${JSON.stringify(ends)}`);
      await d.sleep(800);
      return (await d.part('workbench.parts.panel')) || d.body();
    },
    undo: async (d) => {
      if (d.panelHeight) await panelTo(d, d.panelHeight);
      await d.exec('workbench.action.closePanel');
      await d.sleep(500);
    },
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
    act: async (d) => { await modeTo(d, 'essential'); await showStatus(d); await d.sleep(1500); return d.body(); },
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
    unchanged: 'The side bar and the tab bar\'s tabs are as before; the demo conversation, whose box this is, is the one in front '
      + 'now.',
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
    act: async (d) => { await showStatus(d); await d.sleep(1500); return d.body(); },
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
      await showStatus(d);
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
      /* At the bottom right, Show Status's notification, opened out, would lie over the information box. */
      await setting(d, 'workbench.notifications.position', 'top-right');
      await d.sleep(500);
      await showStatus(d);
      await d.sleep(1500);
      await d.away();
      return d.body();
    },
    undo: async (d) => {
      await d.exec('notifications.clearAll');
      await setting(d, 'workbench.notifications.position', undefined);
      await d.sleep(500);
      if (await infoOpen(d.conv)) { await d.conv.locator('[data-cce-info]').first().click(); await d.sleep(400); }
    },
  },

  {
    name: 'conversation-again', features: ['timestamps', 'reply-figures', 'self-check'],
    expect: 'The demo conversation at the same place as in the first step\'s picture (conversation.jpg), minutes later, with '
      + 'tool rows shown. Everything that step\'s expect lists is there: a time on every row, start->end on each tool row on a '
      + 'line of its own above the tool\'s name, and the figures on the first row of each reply. Steps in between renamed the '
      + 'conversation, opened other tabs and gave it replies from the fake model, so these may differ from the first picture: '
      + 'the title in the tab and in the header ("CSV export and budgets"), the other tabs beside it, the message box\'s '
      + 'placeholder, the chips of the footer and of the plan bar, the usage meter, which follows the latest reply, and the '
      + 'notification that covers part of the footer in the first picture. Any other difference, apart from the times on tool '
      + 'rows, is a finding.',
    unchanged: 'The tab bar has the same tabs as before; the side bar now shows Agent Plus\'s work plan.',
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
    expect: 'The agent map in the light theme: its headings (THIS CONVERSATION, ' + (LINUX ? 'DETACHED COMMANDS, ' : '') + 'SCHEDULED PROMPTS), '
      + 'their count badges and the thin lines above them, and its cards readable against the light background; the map set '
      + 'apart from the conversation behind it; the ' + (LINUX ? 'green ring' : 'grey dot')
      + ' at the start of the conversation\'s own card visible.',
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
    name: 'light-session-list', features: ['light-theme', 'agent-plus-session-list'],
    expect: 'Agent Plus\'s session list in the light theme: dark text on a light background, the section bands a '
      + 'little darker than the rows. The titles and times are readable against the light background, including '
      + 'the blue title. The Claude Code logos, any dots on them and the stripes at the start of the rows are '
      + 'easy to see. The pin, crown and envelope are also readable on rows that have them. Nothing retains the '
      + 'dark theme\'s colours.',
    unchanged: 'The editor is as before; the map is closed.',
    act: async (d) => { await agentList(d); await d.away(); return d.sidebar(); },
  },
  {
    name: 'light-envelope', features: ['light-envelope', 'light-theme', 'unread-envelope', 'need-you-notices'],
    expect: 'In the light theme, a reply landed while the conversation "Where the retry delay..." was behind notes.txt: its tab\'s '
      + 'title ends in an envelope drawn as a dark outline on the light tab, not a white or faint shape. In Agent Plus\'s session '
      + 'list in the side bar, its row shows an envelope icon after the title, before the time, drawn dark like the text. No '
      + 'colour emoji envelope anywhere. No notification at the bottom right: Agent Plus shows none for a conversation this window '
      + 'shows.',
    unchanged: 'Agent Plus\'s session list is as before, apart from the envelope.',
    act: async (d) => {
      const frame = await live(d);
      const list = await agentList(d);
      await d.exec('claude-vscode.editor.open', d.threads[0].id);
      await d.sleep(600);
      // A permission question left open by an earlier step holds back any new message.
      if (await permissionAsked(frame)) { await permissionButton(frame, 'No').click({ timeout: 5000 }).catch(() => {}); await d.sleep(2000); }
      if (!await d.front()) throw new Error('the window did not get the focus, which Agent Plus needs before it shows a notice');
      await d.exec('notifications.clearAll');
      d.model.hold();
      const turns = d.model.turns();
      await send(d, frame, 'And in the production config?');
      if (!await d.until(() => d.model.turns() > turns, 30000, 300)) throw new Error('the message did not reach the model in 30 s');
      if (!await d.until(() => seenWorking(d, d.threads[0].id), SEEN_MS, 300)) throw new Error('Agent Plus did not see the turn running in 60 s');
      await notesInFront(d);
      await d.sleep(800);
      d.model.release();
      await d.sleep(5000);
      await d.away();
      const tab = (await tabLabels(d)).find((l) => l.startsWith('Where the retry')) || '';
      if (!tab.endsWith(' \u2709\uFE0E')) throw new Error(`the tab reads "${tab}", not ending in the envelope's text form`);
      /* The envelope in the Steward panel is checked against the theme in ui.js, which has another conversation in
         front. */
      await agentRowWhere(d, list, titleNow(d, d.threads[0]), (s) => s.unread === 1, 20000, 'has no envelope');
      if (!await d.until(() => seenUnread(d, d.threads[0].id), SEEN_MS, 300)) throw new Error('Agent Plus did not see the reply unread in 60 s');
      if (await d.until(async () => ((await needToasts(d)) || []).some((x) => / finished\.$/.test(x) && x.includes('Where the retry delay')), 9000, 300)) {
        throw new Error('Agent Plus showed a notice for a conversation this window shows');
      }
      return d.body();
    },
    undo: async (d) => { d.model.release(); await d.exec('claude-vscode.editor.open', d.threads[0].id); await d.exec('notifications.clearAll'); await d.sleep(2000); },
  },
  {
    name: 'light-wait-notice-tool', features: ['wait-notices', 'light-theme'],
    expect: 'In the light theme, at the bottom right, one notification from Agent Plus with Open and Dismiss. '
      + 'It reads: "Deploy the staging stack" is waiting for you to approve Bash. ' + NOTICE_SOURCE,
    unchanged: 'The editor and the side bar are as before.',
    ...waitNotice(LOOK_ID(11), 'Deploy the staging stack', { kind: 'permission', tool: 'Bash' }, '"Deploy the staging stack" is waiting for you to approve Bash.'),
  },
  {
    name: 'light-wait-notice-question', features: ['wait-notices', 'light-theme'],
    expect: 'In the light theme, at the bottom right, one notification from Agent Plus with Open and Dismiss. '
      + 'It reads: "Pick the region for the new cluster" has a question for you. ' + NOTICE_SOURCE,
    unchanged: 'The editor and the side bar are as before.',
    ...waitNotice(LOOK_ID(12), 'Pick the region for the new cluster', { kind: 'question' }, '"Pick the region for the new cluster" has a question for you.'),
  },
  {
    name: 'light-wait-notice-replay', features: ['wait-notices', 'light-theme'],
    expect: 'In the light theme, after the window got the focus back: at the bottom right, two notifications from Agent Plus, one '
      + 'above the other, each with its own Open and Dismiss. '
      + 'One reads: "Rotate the signing keys" is waiting for you to approve Edit. The other reads: '
      + '"Choose the import config" has a question for you. No notification naming both. ' + NOTICE_SOURCE,
    unchanged: 'The editor and the side bar are as before.',
    ...replayNotice({ sessionId: LOOK_ID(13), title: 'Rotate the signing keys', waitingFor: { kind: 'permission', tool: 'Edit' } },
      { sessionId: LOOK_ID(14), title: 'Choose the import config', waitingFor: { kind: 'question' } },
      ['"Rotate the signing keys" is waiting for you to approve Edit.', '"Choose the import config" has a question for you.']),
  },
  {
    name: 'light-conversation-links', features: ['light-theme', 'conversation-links'],
    expect: 'The light theme. The last reply in the demo conversation names "Add a dry-run flag to the cleanup script" twice, on its '
      + 'own and inside corner brackets, and both are drawn like any other link Claude Code draws in a reply, readable against the '
      + 'light background.',
    unchanged: 'Still the light theme.',
    act: async (d) => { await toMentions(d, d.threads[2], false); await d.away(); return d.editor(); },
  },
  {
    name: 'light-work-plan', features: ['light-theme', 'work-plan-view'],
    expect: 'Agent Plus\'s work plan view in the light theme: the state marks and titles readable against the light background.',
    unchanged: 'The editor is as before.',
    /* The demo conversation in front, the one with a plan; the previous step left another conversation there. */
    act: async (d) => { await demoAt(d, ''); await d.exec('workbench.view.extension.agentPlus'); await d.sleep(1500); await d.away(); return d.sidebar(); },
    undo: async (d) => { await theme(d, 'Default Dark Modern'); await d.sleep(2000); },
  },

  /* The agent map, one state at a time, in the conversation "Why does the nightly export skip archived rows?" (the
     second fake one) in a tab: alone, with a command in the background, a claude -p worker, claude --bg sessions, a
     command left running detached and two scheduled prompts, each added to what the previous step left; a helper in a
     third conversation on its own; then everything at once, in both themes and in the secondary side bar. Nothing
     started here ends within a quarter of an hour, so no picture has to wait for something to end; the last step stops
     it all. */
  {
    name: 'map-alone', features: ['agent-map'],
    expect: 'The agent map, opened with /tasks, of a conversation that has no background work. Under the dialog\'s title '
      + '"Agent map" a small bold heading in capitals, THIS CONVERSATION, and under it the conversation\'s own card: a grey '
      + 'dot, its title, and under it the model and the tokens in context. Nothing else: no "0 agents" line above '
      + 'or below the card, no empty heading, no divider.',
    unchanged: 'The window is in the dark theme again; the conversation behind the map is the one named above.',
    act: async (d) => {
      await theme(d, 'Default Dark Modern');
      await d.sleep(2000);
      const frame = await thread(d, mapThread(d));
      await openMap(d, frame);
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-task', features: ['agent-map'],
    expect: 'The same map once the conversation has put a command in the background. Under the conversation\'s card a thin '
      + 'line across the dialog, then the heading BACKGROUND TASKS with a small count badge "1", and under it one card in '
      + 'the same form as the conversation\'s: a filled green dot, "Start the nightly build" on one line, "shell" and how long '
      + 'it has run on a second. No text says "click a task for details"; there is no SUBAGENTS heading.',
    unchanged: 'The conversation behind the map has one more exchange at its end.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      await runAsked(d, frame, `Please ${fakeModel.ASK_TO_BACKGROUND_LONG}.`, fakeModel.BG_LONG_RUN);
      await openMap(d, frame, 'Start the nightly build');
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-worker', only: ['linux'], features: ['agent-map'],
    expect: 'With a claude -p worker also started, the map has another thin line after BACKGROUND TASKS and '
      + 'a heading reading "claude -p SESSIONS", with "claude -p" in lower case in a code font, and a count '
      + 'badge "1". Its card: a green dot, release-notes-worker on one line, and on a second its process id, when it started '
      + 'and how long it has run. No card shows the shell that started the worker.',
    unchanged: 'Behind the map, the conversation ends with one more exchange than in the step before.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      const bin = path.join(d.profile.home, 'fake-bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'claude'), fakeModel.WORKER_SCRIPT(MAP_WORKER, 1800), { mode: 0o755 });
      await runAsked(d, frame, `Please ${fakeModel.ASK_FOR_WORKER}.`, 'fake-bin');
      await openMap(d, frame, fakeModel.WORKER_NAME);
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-bg', features: ['agent-map', 'background-sessions'],
    expect: 'After the conversation has started two claude --bg sessions, the first already finished, the map has a section '
      + 'headed "claude --bg SESSIONS" ("claude --bg" in a code font), count badge "2", with two nightly-report cards: the '
      + 'running one with a filled green dot and "running", how long and an eight-digit job id on its second line; the '
      + 'finished one with a grey dot and "done", when it finished and its job id. Each card has a small arrow at the end of '
      + 'its title line, pointing right.',
    unchanged: 'The conversation behind the map ends with three more replies than before: one after each of two messages of yours '
      + 'asking for a claude --bg session, and one with no message of yours before it, the answer to the notice Claude Code Plus '
      + 'sends when the first session has finished, which may come between the two or after both.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      const from = d.model.seen.length;
      const bin = path.join(d.profile.home, 'fake-bg');
      fs.mkdirSync(bin, { recursive: true });
      const script = path.join(bin, 'claude');
      const jobs = () => { try { return fs.readdirSync(path.join(d.profile.home, '.claude', 'jobs')); } catch (_) { return []; } };
      const done = (id) => { try { return JSON.parse(fs.readFileSync(path.join(d.profile.home, '.claude', 'jobs', id, 'state.json'), 'utf8')).state === 'done'; } catch (_) { return false; } };
      fs.writeFileSync(script, fakeModel.BG_SESSION_SCRIPT(3), { mode: 0o755 });
      const had = jobs();
      await runAsked(d, frame, `Please ${fakeModel.ASK_FOR_BG_SESSION}.`, '--bg');
      const first = await d.until(() => jobs().find((j) => !had.includes(j) && done(j)), 30000, 500);
      if (!first) throw new Error('the first claude --bg session did not finish within 30 s');
      fs.writeFileSync(script, fakeModel.BG_SESSION_SCRIPT(1800), { mode: 0o755 });
      await runAsked(d, frame, `Please ${fakeModel.ASK_FOR_BG_SESSION}.`, '--bg');
      /* Claude Code Plus tells the conversation of the first session's end on a timer of its own, and the conversation
         answers; that is let happen here, so that the steps after find the conversation as it stays. */
      if (!await d.until(() => d.model.seen.slice(from).some((x) => /news of a `claude --bg` session/.test(x.ask || '')), 120000, 1000)) {
        throw new Error('the conversation was not told the first claude --bg session ended within 120 s');
      }
      if (!await d.until(() => liveOf(d, mapThread(d).id).some((r) => r.status === 'idle'), 30000, 500)) throw new Error('the conversation did not go idle after it answered the notice');
      await openMap(d, frame, `${fakeModel.BG_SESSION_NAME}[\\s\\S]*${fakeModel.BG_SESSION_NAME}`);
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-detached', only: ['linux'], features: ['agent-map'],
    expect: 'The same map once a command has been left running detached in the conversation\'s name: a section headed '
      + 'DETACHED COMMANDS, count badge "1", comes right after BACKGROUND TASKS. Its card has a green dot, a title made of '
      + 'the program and the argument that identifies what it runs ("perl -e ... cache-relay:demo") rather than the whole '
      + 'command line, and a second line with its process id, start time and running time.',
    unchanged: 'The conversation behind the map is as before.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      const sock = path.join(d.profile.folder, '.relay', 'cache.sock');
      detachFor(d, mapThread(d).id, ['perl', '-e', 'sleep 1800', '2014', sock, 'cache-relay:demo']);
      await openMap(d, frame, 'cache-relay:demo');
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-scheduled', features: ['agent-map'],
    expect: 'The same map once the conversation has two scheduled prompts: a section headed SCHEDULED PROMPTS, count badge '
      + '"2", after DETACHED COMMANDS where there is one. Each card has a grey dot (nothing runs before its '
      + 'prompt is due), the start of its prompt as its title, cut with an ellipsis, and a second line saying when it fires and when '
      + 'it last fired: "every 20 min . last fired 7 min ago" and "daily at 9:30 . never fired".',
    unchanged: 'The conversation behind the map is as before.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      addSchedules(d, mapThread(d).id);
      await openMap(d, frame, 'every 20 min');
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-subagent', features: ['agent-map'],
    expect: 'The agent map of another conversation, "Add a dry-run flag to the cleanup script", whose only background work '
      + 'is a helper (a sub-agent) still running. THIS CONVERSATION and its card, a thin line, then SUBAGENTS with a count '
      + 'badge "1" and under it one card: a filled green dot, "Look through the notes" and how long it has run. The helper\'s '
      + 'card sits under its heading at the left, in line with the conversation\'s card, not to the right of it on a line.',
    unchanged: 'A different conversation is in front.',
    act: async (d) => {
      const frame = await thread(d, d.threads[2]);
      d.model.holdHelper();
      const before = d.model.seen.length;
      await send(d, frame, `Please ${fakeModel.ASK_FOR_HELPER}.`);
      if (!await d.until(() => d.model.seen.slice(before).some((x) => x.helping), 40000, 300)) throw new Error('the helper did not start within 40 s');
      await d.sleep(3000);
      await openMap(d, frame, 'Look through the notes');
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-busy', features: ['agent-map', 'background-sessions'],
    expect: 'The agent map of the first conversation once it has also started a helper: everything at once. From the top: '
      + 'THIS CONVERSATION and its card; then these sections, each with a thin line above it and a count badge: SUBAGENTS 1, BACKGROUND '
      + 'TASKS 1, ' + (LINUX ? 'DETACHED COMMANDS 1, ' : '') + 'SCHEDULED PROMPTS 2, ' + (LINUX ? 'claude -p SESSIONS 1, ' : '')
      + 'claude --bg SESSIONS 2. Every card has a dot, a title on one line and a second, dimmer line. The headings are '
      + 'smaller than the card text, bold and in capitals. Nothing overlaps, nothing is cut off at the right edge. The map is '
      + 'taller than the editor and scrolls: shown from its top, its last section\'s cards may lie below the bottom edge, which '
      + 'the next step scrolls to.',
    unchanged: 'The first conversation is in front again.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      const before = d.model.seen.length;
      await send(d, frame, `Please ${fakeModel.ASK_FOR_HELPER}.`);
      if (!await d.until(() => d.model.seen.slice(before).some((x) => x.helping), 40000, 300)) throw new Error('the helper did not start within 40 s');
      await d.sleep(3000);
      await openMap(d, frame, 'Look through the notes');
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-opened', features: ['agent-map', 'background-sessions'],
    expect: 'The same map with the finished nightly-report card clicked open and scrolled into view: under the card its result '
      + 'in a box ("The nightly report is written: 2 failed tests, both in the export job."), a folded row "Task" with the task it was '
      + 'given, and two buttons, claude attach and claude logs, each with the job id; the arrow at the end of that card\'s title line now points down. The other cards '
      + 'are as before, closed.',
    unchanged: 'The conversation behind the map is as before; the map, closed in the picture before, is open again.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      await openMap(d, frame, 'every 20 min');
      await openCard(d, frame, /\bdone\b/);
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-opened-prompt', features: ['agent-map'],
    expect: 'Clicked open, the first scheduled prompt\'s card shows the whole prompt in a box under it ("Check whether the '
      + 'nightly build has finished, and report the tests that failed."), and its arrow points down; the other cards in view are '
      + 'closed.',
    unchanged: 'The conversation behind the map is as before; the map, closed in the picture before, is open again.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      await openMap(d, frame, 'every 20 min');
      await openCard(d, frame, /every 20 min/);
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-agent-detail', features: ['agent-map'],
    expect: 'The helper\'s card in the map clicked: Claude Code\'s own dialog for that agent is open over the map, with a back '
      + 'arrow, the title "Look through the notes" next to a green dot, and what the helper is doing.',
    unchanged: 'The map is closed and opened again behind that dialog.',
    act: async (d) => {
      const frame = await thread(d, mapThread(d));
      await openMap(d, frame, 'Look through the notes');
      await frame.locator('[role="dialog"] button').filter({ hasText: 'Look through the notes' }).first().click({ timeout: 5000 });
      if (!await d.until(() => frame.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].length >= 2), 5000, 200)) throw new Error('no dialog opened for the helper');
      await d.sleep(1000);
      await d.away();
      return d.editor();
    },
    undo: async (d) => { await d.page.keyboard.press('Escape'); await d.sleep(400); await closeMap(d); },
  },
  {
    name: 'map-busy-light', features: ['agent-map', 'light-theme'],
    expect: 'The map of the map-busy step in the light theme: the same headings, count badges, dividers and cards.',
    unchanged: 'The conversation behind the map is the same.',
    act: async (d) => {
      await theme(d, 'Default Light Modern');
      await d.sleep(2500);
      const frame = await thread(d, mapThread(d));
      await openMap(d, frame, 'Look through the notes');
      return d.editor();
    },
    undo: closeMap,
  },
  {
    name: 'map-sidebar-light', features: ['agent-map', 'light-theme', 'narrow-panel'],
    expect: 'The light theme. The same conversation is open again in the narrow secondary side bar on the right. '
      + '"Open in Sidebar" in its row menu in Agent Plus\'s session list reopened it there. The conversation has '
      + 'again started a helper and a command in the background there. Its agent map is open. The same sections '
      + 'as in map-busy-light, but SUBAGENTS 2: besides the new helper, the one started while the conversation '
      + 'was in a tab, stopped when that tab closed, with a red dot. In the narrow width the cards\' second lines '
      + 'may end in an ellipsis (each card\'s hover text holds the whole line); cards no wider than the side bar '
      + 'or the map scrolls sideways.',
    unchanged: 'The tab of that conversation is gone from the editor.',
    act: async (d) => {
      const t = mapThread(d), title = titleNow(d, t);
      await closeTab(d, t);
      const list = await agentList(d);
      await agentRowWhere(d, list, title, (s) => s.stripe !== 'here', 20000, 'still has the stripe of a conversation open here');
      await agentMenuPick(d, list, title, 'Open in Sidebar');
      const side = await d.frameWhere(ownPage, 60000, ownPageOf(t, true));
      if (!side) throw new Error('the conversation did not open in the side bar within 60 s');
      d.mapSide = side;
      await d.sleep(2000);
      await runAsked(d, side, `Please ${fakeModel.ASK_TO_BACKGROUND_LONG}.`, fakeModel.BG_LONG_RUN);
      const before = d.model.seen.length;
      await send(d, side, `Please ${fakeModel.ASK_FOR_HELPER}.`);
      if (!await d.until(() => d.model.seen.slice(before).some((x) => x.helping), 40000, 300)) throw new Error('the helper did not start within 40 s');
      await d.sleep(3000);
      await openMap(d, side, 'Look through the notes');
      return d.part('workbench.parts.auxiliarybar');
    },
    undo: closeMap,
  },
  {
    name: 'map-sidebar-end', features: ['agent-map', 'light-theme', 'narrow-panel'],
    expect: 'The same side bar map scrolled to its end: the last sections and their cards; '
      + 'no card cut in half at the bottom without a way to scroll to it.',
    unchanged: 'The side bar shows the same conversation; its map, closed in the picture before, is open again.',
    act: async (d) => {
      if (!d.mapSide) throw new Error('the conversation is not open in the side bar');
      await openMap(d, d.mapSide, 'Look through the notes');
      await d.mapSide.evaluate(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Agent map/.test(x.textContent));
        for (const e of dialog.querySelectorAll('*')) if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight;
      });
      await d.sleep(800);
      return d.part('workbench.parts.auxiliarybar');
    },
    undo: closeMap,
  },
  {
    name: 'map-sidebar', features: ['agent-map', 'narrow-panel'],
    expect: 'The same side bar map in the dark theme.',
    unchanged: 'The side bar shows the same conversation.',
    act: async (d) => {
      await theme(d, 'Default Dark Modern');
      await d.sleep(2500);
      if (!d.mapSide) throw new Error('the conversation is not open in the side bar');
      await openMap(d, d.mapSide, 'Look through the notes');
      return d.part('workbench.parts.auxiliarybar');
    },
    undo: async (d) => {
      await closeMap(d);
      d.model.releaseHelper();
      stopMapWork(d, [mapThread(d).id, d.threads[2].id]);
      removeSchedules(d);
      await d.exec('workbench.action.closeAuxiliaryBar').catch(() => {});
      await d.sleep(1000);
    },
  },
  /* Last, as it closes every tab: with no Claude Code conversation running in the window, Account & usage keeps the Claude
     Code part and says so (src/claude-session-list.js accountInfo). */
  {
    name: 'agent-plus-account-idle', features: ['agent-plus-account'],
    expect: 'Agent Plus\'s session list in the side bar, its ACCOUNT & USAGE section at the top opened. In it a Claude Code part, '
      + 'headed by the Claude Code logo and its name, with two rows, each a label and a value: Sign-in with "API key", and This '
      + 'window with "No conversation running". There is no THIS CONVERSATION heading and no figures. The rows line up with the '
      + 'other parts\' rows, are readable, and nothing is cut off at the side bar\'s edge. No Claude Code tab is open.',
    act: async (d) => {
      await d.exec('workbench.action.closeAllEditors');
      await d.exec('workbench.action.closeAuxiliaryBar').catch(() => {});
      const list = await agentList(d);
      const section = () => list.evaluate(() => {
        const a = document.querySelector('.sl-section[data-key="account"]');
        return a && !a.classList.contains('sl-hidden') ? { open: a.classList.contains('sl-open'), text: a.textContent } : null;
      }).catch(() => null);
      /* A closed tab's process ends a moment after, and the section follows the next time the figures change. */
      if (!await d.until(async () => { const s = await section(); return s && /No conversation running/.test(s.text); }, 60000, 500)) {
        throw new Error(`Account & usage does not say that no conversation runs in this window: ${JSON.stringify(await section())}`);
      }
      if (!(await section()).open) await list.locator('.sl-section[data-key="account"] .sl-head').first().click();
      await d.until(async () => { const s = await section(); return s && s.open && s; }, 10000, 300);
      d.liveFrame = null;
      await d.away();
      return d.sidebar();
    },
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
    throw new Error('usage: ui-look.js --pack <dir with pack.json> --vsix <claude-code-plus .vsix> [--core <Agent Plus .vsix>] [--out <dir>] [--cache <dir>] [<step> ...]'
      + `${unknown.length ? `\nunknown step: ${unknown.join(', ')}` : ''}\nsteps: ${names.join(' ')}`);
  }
  const named = opt.rest.length ? STEPS.filter((s) => opt.rest.includes(s.name)) : STEPS;
  const steps = named.filter((s) => !s.only || s.only.includes(process.platform));
  for (const s of named) if (!steps.includes(s)) demo.log('skipped', s.name, `runs on ${s.only.join(', ')} only`);
  fs.mkdirSync(opt.out, { recursive: true });
  const started = Date.now();
  /* The salt holds the root folder, so that two runs at once under different temporary folders give the demo conversation
     different session ids: lib/demo.js stops the demo's sleep by its session id, which would stop the other run's too. */
  const d = await demo.open({ pack: opt.pack, vsix: opt.vsix, core: opt.core, cache: opt.cache, root: ROOT, salt: `ui-look:${ROOT}`,
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
      try { area = await step.act(d, step.area); } catch (e) { note = e.message.split('\n')[0]; area = e.area || null; }
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
