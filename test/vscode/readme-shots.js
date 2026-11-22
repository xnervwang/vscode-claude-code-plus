// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Usage: xvfb-run -a -s "-screen 0 3200x2000x24" node test/vscode/readme-shots.js --pack <dir> --vsix <file>
 *          [--core <Agent Plus .vsix>] [--out <dir>] [--cache <dir>] [<shot> ...]
 *
 * Takes the README's screenshots in a separate VS Code install: the current stable release, with the latest Claude Code
 * build that supported-versions.json lists, Agent Plus from the marketplace and this extension from --vsix, so a
 * feature can be shown before it is published. With shot names it takes only those. Needs @vscode/test-electron and
 * playwright-core, as run.js does, and a display (xvfb-run on Linux).
 *
 * The pack is a folder holding a demo project and demo conversations (pack.json says which); lib/demo.js copies them
 * under ROOT and opens the window on them, so a screenshot shows only paths under ROOT. VS Code and the marketplace
 * extensions are kept in --cache between runs. The window runs at twice the pixel density, and each shot leaves out the
 * title bar and status bar, which show the window's name.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const demo = require('./lib/demo');
const { sleep, until, log, SCALE } = demo;

const REPO = path.join(__dirname, '..', '..');
const ROOT = path.join(os.tmpdir(), 'claude-code-plus-demo');
const SHOTS = ['overview', 'work-plan', 'images-in-replies', 'reply-figures', 'navigation', 'context-meter', 'session-info',
  'agent-map', 'session-list'];

const opt = demo.options(process.argv.slice(2), { out: path.join(REPO, 'images', 'shots') });
const OUT = opt.out;
const ONLY = opt.rest.filter((a) => SHOTS.includes(a));

async function main() {
  if (!fs.existsSync(path.join(opt.pack, 'pack.json')) || !fs.existsSync(opt.vsix)) {
    throw new Error('usage: readme-shots.js --pack <dir with pack.json> --vsix <claude-code-plus .vsix> [--core <Agent Plus .vsix>] [--out <dir>] [--cache <dir>] [<shot> ...]');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const d = await demo.open({ pack: opt.pack, vsix: opt.vsix, core: opt.core, cache: opt.cache, root: ROOT, salt: 'readme-shots' });
  const { page, conv, sid, exec, frameWhere, body, editor, sidebar, focus, widen, toMessage, away, quiet } = d;
  const snap = async (name, clip) => {
    await quiet();
    const c = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) };
    await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', clip: c });
    log('shot', name, `${c.width * SCALE}x${c.height * SCALE}`);
  };
  const want = (name) => !ONLY.length || ONLY.includes(name);

  try {
    if (want('overview')) {
      await exec('workbench.view.extension.agentPlus');
      await sleep(2500);
      await widen();
      await focus(true);
      await toMessage(conv, 'Leave the README for later');
      await away();
      await snap('overview', await body());
    }
    if (want('work-plan')) {
      await exec('workbench.view.extension.agentPlus');
      await sleep(1500);
      await widen();
      await away();
      await snap('work-plan', await sidebar());
    }
    if (want('images-in-replies')) {
      await focus(true);
      await until(() => conv.evaluate(() => [...document.querySelectorAll('img')].some((i) => /^data:image\//.test(i.src) && i.naturalWidth > 0)), 30000, 500);
      await conv.evaluate(() => [...document.querySelectorAll('img')].find((i) => /^data:image\//.test(i.src)).scrollIntoView({ block: 'center' }));
      await sleep(1000);
      await away();
      await snap('images-in-replies', await editor());
    }
    if (want('reply-figures')) {
      await focus(false);
      await toMessage(conv, 'Start with the CSV export. Write it and its tests');
      await sleep(800);
      await away();
      await snap('reply-figures', await editor());
    }
    if (want('navigation')) {
      await focus(false);
      await toMessage(conv, 'What happens if someone sets a budget for a category');
      await conv.locator('#cce-toc-handle').click();
      await until(() => conv.evaluate(() => { const t = document.getElementById('cce-toc'); return t && t.style.display === 'block'; }), 5000, 200);
      await away();
      await conv.locator('#cce-toc > div:nth-child(2) > div').nth(3).hover();
      await sleep(600);
      await snap('navigation', await editor());
      await conv.locator('#cce-toc-handle').click();
      await sleep(400);
    }
    if (want('context-meter')) {
      const meter = conv.locator('button[class*="usageButtonV2"]').first();
      if (await meter.count()) {
        await meter.hover();
        await sleep(2800);
        await snap('context-meter', await editor());
        await away();
      } else log('no usage meter in the footer: context-meter skipped');
    }
    if (want('session-info')) {
      await conv.locator('[data-cce-info]').first().click();
      await until(() => conv.evaluate(() => { const b = document.getElementById('cce-info'); return b && b.style.display === 'block'; }), 5000, 200);
      await away();
      await snap('session-info', await editor());
      await conv.locator('[data-cce-info]').first().click();
      await sleep(400);
    }
    if (want('agent-map')) {
      const button = conv.locator('button, [role="button"]').filter({ hasText: /\bdetached\b|\btimer\b/ }).first();
      if (!await until(() => button.isVisible().catch(() => false), 60000, 500)) log('the Agents button counted nothing: agent-map skipped');
      else {
        await until(() => conv.evaluate(() => /\bdetached\b/.test(document.body.innerText)), process.platform === 'linux' ? 30000 : 1, 500);
        await button.click({ timeout: 5000 });
        await sleep(1500);
        await away();
        await snap('agent-map', await editor());
        await page.keyboard.press('Escape');
        await sleep(400);
      }
    }
    if (want('session-list')) {
      await exec('workbench.view.extension.claude-sessions-sidebar');
      const list = await frameWhere(() => !!document.querySelector('[data-cce-new-session]'), 60000);
      if (!list) log('the session list did not open: session-list skipped');
      else {
        await sleep(2500);
        await widen();
        const row = list.locator(`[class*="sessionItem_"][id$="${sid}"]`).last();
        if (await row.count()) { await row.hover(); await sleep(1800); }
        await snap('session-list', await sidebar());
      }
    }
  } finally {
    await d.close();
  }
}

main().catch((e) => { console.error((e && e.stack) || e); process.exitCode = 1; });
