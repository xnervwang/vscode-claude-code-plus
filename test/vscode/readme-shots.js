// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Usage: xvfb-run -a -s "-screen 0 3200x2000x24" node test/vscode/readme-shots.js --pack <dir> --vsix <file>
 *          [--out <dir>] [--cache <dir>] [<shot> ...]
 *
 * Takes the README's screenshots in a separate VS Code install: the current stable release, with the latest Claude Code
 * build that supported-versions.json lists, Agent Plus from the marketplace and this extension from --vsix, so a
 * feature can be shown before it is published. With shot names it takes only those. Needs @vscode/test-electron and
 * playwright-core, as run.js does, and a display (xvfb-run on Linux).
 *
 * The pack is a folder holding a demo project and demo conversations (pack.json says which). Each run copies them into
 * a new HOME and workspace under ROOT and rewrites the records to match, so a screenshot shows only paths under ROOT.
 * Each Claude Code conversation gets a new session id, because other VS Code windows on the machine scan the same
 * processes and would otherwise count the demo's sleep as the original conversation's command.
 *
 * VS Code and the marketplace extensions are kept in --cache between runs. The window runs at twice the pixel density,
 * and each shot leaves out the title bar and status bar, which show the window's name.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const REPO = path.join(HERE, '..', '..');
const SCALE = 2;
/* VS Code takes the device scale factor only on its command line, which window.js builds; this adds it to that one
   executable's command line. */
const realSpawn = cp.spawn;
let EXE = '';
cp.spawn = (exe, args, opts) => realSpawn(exe, exe === EXE ? [...args, `--force-device-scale-factor=${SCALE}`] : args, opts);
const win = require('./lib/window');
const { cleanEnv } = require('./lib/env');
const fakeModel = require('./lib/fake-model');
const fakeHome = require('./lib/fake-home');
const { sleep, until } = win;
const { folderName, KEY } = fakeHome;

const MINE = 'xnervwang.claude-code-plus';
const ROOT = path.join(os.tmpdir(), 'claude-code-plus-demo');
const SHOTS = ['overview', 'work-plan', 'images-in-replies', 'reply-figures', 'navigation', 'context-meter', 'session-info',
  'agent-map', 'session-list'];

const args = process.argv.slice(2);
const flag = (name, dflt = '') => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1] || ''; args.splice(i, 2); return v; };
const PACK = path.resolve(flag('--pack'));
const VSIX = path.resolve(flag('--vsix'));
const OUT = path.resolve(flag('--out', path.join(REPO, 'images', 'shots')));
const CACHE = path.resolve(flag('--cache', path.join(os.homedir(), '.cache', 'claude-code-plus-shots')));
const ONLY = args.filter((a) => SHOTS.includes(a));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* The newest Claude Code build this commit was verified against. */
function claudeVersion() {
  const v = Object.keys(JSON.parse(fs.readFileSync(path.join(REPO, 'supported-versions.json'), 'utf8')).claudeCode || {});
  const num = (s) => s.split('.').map(Number);
  v.sort((a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  if (!v.length) throw new Error('supported-versions.json lists no Claude Code build');
  return v[v.length - 1];
}

/* The copy's session id, derived from the original's so that it does not change from one run to the next. */
function demoId(id) {
  const h = crypto.createHash('sha1').update(`readme-shots:${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function cli(te, exe) {
  const tool = te.resolveCliArgsFromVSCodeExecutablePath(exe, { reuseMachineInstall: true })[0];
  return (argv, env) => {
    const r = cp.spawnSync(tool, argv, { env, encoding: 'utf8', maxBuffer: 64 << 20 });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  };
}

function seed(pack, manifest, home, folder, user) {
  const skip = /(^|\/)(\.git|__pycache__)(\/|$)/;
  fs.cpSync(path.join(pack, 'project'), folder, { recursive: true, filter: (src) => !skip.test(path.relative(pack, src)) });
  const others = fakeHome.write(home, { folder });
  const srcHome = manifest.sourceHome, srcProject = manifest.sourceProject;
  const pairs = [[srcProject, folder], [folderName(srcProject), folderName(folder)]];
  const ids = manifest.claude.map((id) => [id, demoId(id)]);
  for (const [a, b] of ids) pairs.push([a, b]);
  pairs.push([srcHome, home]);
  if (manifest.linkedHome) pairs.push([manifest.linkedHome, home]);
  const fix = (text) => pairs.reduce((t, [a, b]) => t.split(a).join(b), text);
  const projects = path.join(home, '.claude', 'projects', folderName(folder));
  const plans = path.join(home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
  fs.mkdirSync(plans, { recursive: true });
  for (const [id, as] of ids) {
    const src = path.join(pack, 'claude', id);
    fs.writeFileSync(path.join(projects, `${as}.jsonl`), fix(fs.readFileSync(path.join(src, 'transcript.jsonl'), 'utf8')));
    if (fs.existsSync(path.join(src, 'plan.json'))) fs.writeFileSync(path.join(plans, `${as}.json`), fix(fs.readFileSync(path.join(src, 'plan.json'), 'utf8')));
    if (fs.existsSync(path.join(src, 'scratch'))) fs.cpSync(path.join(src, 'scratch'), path.join(home, '.claude', 'scratch', folderName(folder), as), { recursive: true });
  }
  const main = ids[0][1];
  const store = path.join(user, 'User', 'globalStorage', MINE);
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'session-pins.json'), JSON.stringify({ pinned: [main], times: {} }, null, 1) + '\n');
  fs.writeFileSync(path.join(store, 'session-colors.json'), JSON.stringify({ colors: { [others.threads[1].id]: 'blue' } }, null, 1) + '\n');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'scheduled_tasks.json'), JSON.stringify({ tasks: [{ id: 'b0d9e7c1', cron: '0 9 * * 1',
    prompt: 'Every Monday morning, import last week\'s bank statement and report anything over budget.', createdAt: Date.now() - 3600000,
    recurring: true, createdBySessionId: main, createdInProject: folder }] }, null, 2));
  return main;
}

function writeSettings(user, model) {
  fs.mkdirSync(path.join(user, 'User'), { recursive: true });
  fs.writeFileSync(path.join(user, 'User', 'settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'update.mode': 'none',
    'workbench.startupEditor': 'none', 'workbench.tips.enabled': false, 'security.workspace.trust.enabled': false, 'window.restoreWindows': 'none',
    'workbench.colorTheme': 'Default Dark Modern', 'chat.disableAIFeatures': true, 'git.enabled': false,
    'window.newWindowDimensions': 'maximized', 'window.dialogStyle': 'custom', 'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'claudeCode.disableLoginPrompt': true, 'claudeCode.hideOnboarding': true,
    'claudeCode.environmentVariables': [
      { name: 'ANTHROPIC_BASE_URL', value: model.url }, { name: 'ANTHROPIC_API_KEY', value: KEY },
      { name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', value: '1' }, { name: 'DISABLE_AUTOUPDATER', value: '1' }],
    'agentPlus.webviewRequestLimit': 'leave',
  }, null, 2));
}

async function main() {
  if (!fs.existsSync(path.join(PACK, 'pack.json')) || !fs.existsSync(VSIX)) {
    throw new Error('usage: readme-shots.js --pack <dir with pack.json> --vsix <claude-code-plus .vsix> [--out <dir>] [--cache <dir>] [<shot> ...]');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(PACK, 'pack.json'), 'utf8'));
  const te = require('@vscode/test-electron');
  const playwright = require('playwright-core');
  fs.rmSync(ROOT, { recursive: true, force: true });
  const p = { exts: path.join(CACHE, 'exts'), user: path.join(ROOT, 'user'), folder: path.join(ROOT, 'ws', manifest.project),
    control: path.join(ROOT, 'ctl'), home: path.join(ROOT, 'home') };
  for (const d of [p.exts, p.user, path.dirname(p.folder), p.control, path.join(p.home, '.claude', 'projects'), path.join(ROOT, 'run'), OUT]) fs.mkdirSync(d, { recursive: true });
  const env = cleanEnv(ROOT);
  for (const k of ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME']) if (env[k]) fs.mkdirSync(env[k], { recursive: true });

  const exe = await te.downloadAndUnzipVSCode({ version: 'stable', cachePath: path.join(CACHE, 'vscode') });
  EXE = exe;
  const code = cli(te, exe);
  const profile = [`--extensions-dir=${p.exts}`, `--user-data-dir=${p.user}`];
  const have = code(['--list-extensions', '--show-versions', ...profile], env).out.split('\n');
  for (const ext of [`anthropic.claude-code@${claudeVersion()}`, 'xnervwang.agent-plus']) {
    if (have.some((l) => (ext.includes('@') ? l === ext : l.startsWith(`${ext}@`)))) continue;
    const r = code(['--install-extension', ext, '--force', ...profile], env);
    if (r.status !== 0) throw new Error(`installing ${ext}: ${r.out}`);
  }
  const r = code(['--install-extension', VSIX, '--force', ...profile], env);
  if (r.status !== 0) throw new Error(`installing ${VSIX}: ${r.out}`);
  log('installed', code(['--list-extensions', '--show-versions', ...profile], env).out.replace(/\n/g, ', '));

  const sid = seed(PACK, manifest, p.home, p.folder, p.user);
  const model = await fakeModel.start();
  writeSettings(p.user, model);
  /* Detached commands are found through /proc, so the agent map lists this one on Linux only. Started
     by setsid from a shell that exits at once, it leads its own session and has init as its parent, like a command a
     conversation detaches. The cleanup finds it by the session id in its environment. */
  const mark = `CLAUDE_CODE_SESSION_ID=${sid}`;
  const sleepers = () => (process.platform !== 'linux' ? [] : fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => {
    try { return fs.readFileSync(`/proc/${d}/comm`, 'utf8').trim() === 'sleep' && fs.readFileSync(`/proc/${d}/environ`, 'utf8').split('\0').includes(mark); } catch (_) { return false; }
  }).map(Number));
  if (process.platform === 'linux') {
    cp.spawnSync('sh', ['-c', 'setsid sleep 1800 < /dev/null > /dev/null 2>&1 &'], { env: { ...env, CLAUDE_CODE_SESSION_ID: sid }, cwd: p.folder, stdio: 'ignore' });
  }

  const w = await win.open({ exe, profile: p, env, playwright, log: path.join(ROOT, 'vscode-window.log') });
  const { page, call } = w;
  const exec = (command, ...a) => call(`await vscode.commands.executeCommand(${JSON.stringify(command)}, ...arg); return true;`, a);
  const frameWhere = (test, ms, arg) => until(async () => {
    for (const f of page.frames()) { try { if (await f.evaluate(test, arg)) return f; } catch (_) { /* not ready, or gone */ } }
    return null;
  }, ms, 500);
  const away = async () => { await page.mouse.move(2, 450); await sleep(300); };
  const quiet = async () => { await exec('notifications.hideToasts').catch(() => {}); };
  const part = (id) => page.evaluate((id) => {
    const e = document.getElementById(id);
    if (!e || !e.offsetWidth) return null;
    const b = e.getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height };
  }, id);
  const body = async () => {
    const t = await part('workbench.parts.titlebar'), s = await part('workbench.parts.statusbar');
    const top = t ? t.y + t.height : 0, bottom = s ? s.y : await page.evaluate(() => innerHeight);
    return { x: 0, y: top, width: await page.evaluate(() => innerWidth), height: bottom - top };
  };
  const snap = async (name, clip) => {
    await quiet();
    const c = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) };
    await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', clip: c });
    log('shot', name, `${c.width * SCALE}x${c.height * SCALE}`);
  };
  /* Scrolls the conversation so that your message containing `text` is at the top. It skips the same text in this
     extension's list of your messages and in the copy of the current message that the panel pins at the top. */
  const toMessage = (frame, text) => frame.evaluate((text) => {
    const pinned = (e) => { for (let a = e; a; a = a.parentElement) if (getComputedStyle(a).position === 'sticky') return true; return false; };
    const hits = [...document.querySelectorAll('div, p, span')]
      .filter((e) => e.textContent.includes(text) && e.offsetParent && !e.closest('#cce-toc') && !pinned(e));
    const first = hits.filter((e) => !hits.some((o) => o !== e && e.contains(o)))[0];
    if (!first) return false;
    first.scrollIntoView({ block: 'start' });
    let s = first.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (s) s.scrollBy(0, -12);
    return true;
  }, text);
  const want = (name) => !ONLY.length || ONLY.includes(name);

  try {
    await w.hostUp();
    await sleep(4000);
    await exec('workbench.action.closeAuxiliaryBar').catch(() => {});
    await exec('workbench.action.closePanel').catch(() => {});
    await exec('claude-vscode.editor.open', sid);
    const conv = await frameWhere(() => !!document.querySelector('[data-testid="assistant-message"]') && !!document.getElementById('cce-toc-handle'), 90000);
    if (!conv) throw new Error('the demo conversation did not open in 90 s');
    await sleep(3000);
    /* Claude Code's Focus view, through this extension's footer button. The tool rows are hidden while it is on. */
    const focus = async (on) => {
      const tools = () => conv.evaluate(() => [...document.querySelectorAll('[class*="toolName"], [class*="ToolName"]')].some((e) => e.offsetParent));
      if ((await tools()) === !on) return;
      await conv.locator('[data-cce-focus-btn]').first().click();
      await until(async () => (await tools()) === !on, 5000, 200);
      await sleep(600);
    };
    /* Drags the side bar's sash: at the default width its rows are cut short. */
    const widen = async (to = 460) => {
      const sb = await part('workbench.parts.sidebar');
      if (!sb || sb.width >= to - 4) return;
      const sash = await page.evaluate((edge) => {
        const b = [...document.querySelectorAll('.monaco-sash.vertical')].map((e) => e.getBoundingClientRect())
          .find((r) => r.height > 200 && Math.abs(r.left + r.width / 2 - edge) < 6);
        return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
      }, sb.x + sb.width);
      if (!sash) return;
      await page.mouse.move(sash.x, sash.y);
      await sleep(200);
      await page.mouse.down();
      await page.mouse.move(sash.x + (to - sb.width), sash.y, { steps: 10 });
      await page.mouse.up();
      await sleep(500);
    };
    const editor = () => part('workbench.parts.editor');
    /* Widened once before any shot, so the editor is equally wide whichever shots are taken. */
    await exec('workbench.view.extension.agentPlus');
    await sleep(1500);
    await widen();
    const sidebar = () => part('workbench.parts.sidebar');

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
    await w.close();
    await model.close();
    for (const pid of sleepers()) { try { process.kill(pid, 'SIGTERM'); } catch (_) { /* gone */ } }
  }
}

main().catch((e) => { console.error((e && e.stack) || e); process.exitCode = 1; });
