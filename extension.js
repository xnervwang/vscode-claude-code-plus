// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Claude Code Plus - user interface additions for the Claude Code panel in VS Code.
 *
 * This extension owns no user interface of its own. It patches the Claude Code extension's own files at rest, one
 * adapter per target file (see src/adapters.js), and every write is guarded the same way: match the expected code
 * shape exactly once or write nothing, keep the untouched original beside the file, replace atomically, and put the
 * original back on Remove or uninstall. A Claude Code build whose shape does not match is reported and left alone.
 *
 * Because the patch lives in files the editor has already loaded, installing or upgrading it asks for one reload.
 * After that, turning the marks off and changing the message color take effect live, through the stylesheet written
 * next to the panel (see src/live.js).
 */
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const webview = require('./src/webview');
const host = require('./src/host');
const { safeColor } = webview;
const { readTasks, taskDirs } = require('./src/tasks');
const background = require('./src/background');
const planNames = require('./src/plan-names');
const stewardView = require('./src/steward-view');
const relay = require('./src/relay');
const stewardMarks = require('./src/steward-marks');
const titleMarks = require('./src/title-marks');
const envelope = require('./src/envelope');
const stewards = require('./src/stewards');
const stewardLeads = require('./src/steward-leads');
const stewardKeys = require('./src/steward-keys');
const detachedEnds = require('./src/detachedends');
const bgEnds = require('./src/bgends');
const stoppedWork = require('./src/stoppedwork');
const replyImages = require('./src/reply-images');
const conversationLinks = require('./src/conversation-links');
const planBars = require('./src/plan-bar');
const efforts = require('./src/efforts');
const { sweepOrphans, planDir, readPlan } = require('./src/workplan');
const { transcriptOf, projectsDir, projectFolders, claudeDir, writeAtomic } = require('./src/claude-files');
const planInjections = require('./src/plan-injections');
const tokenMode = require('./src/token-mode');
const noticeTime = require('./src/notice-time');
const waiting = require('./src/waiting');
const waitingFor = require('./src/waiting-for');
const { createClaudeSource, isPanelTab } = require('./src/claude-source');
const { agentOfTab } = require('./src/other-agents');
const coreLink = require('./src/core-link');
const hookSettings = require('./src/hook-settings');
const pluginInstall = require('./src/plugin-install');
const pythonRuntime = require('./src/python-runtime');
const pythonOffer = require('./src/python-offer');
const latency = require('./src/openlatency');
const tabdot = require('./src/tabdot');
const activity = require('./src/activity');
const { goneStates } = require('./src/gone-states');
const sessionPins = require('./src/sessionpins');
const sessionColors = require('./src/sessioncolors');
const bgSessions = require('./src/bgsessions');
const droppedTabs = require('./src/droppedtabs');
const loadTabs = require('./src/load-tabs');
const panelRebuild = require('./src/panel-rebuild');
const retitleHost = require('./src/retitle');
/* The fifth argument of claude-vscode.editor.open. Claude Code's own session list opens conversations as full editor
   tabs, without a title row of their own. */
const AS_FULL_EDITOR = true;
const loadMarks = require('./src/load-marks');
const duplicates = require('./src/duplicates');
const deleteSession = require('./src/deletesession');
const ADAPTERS = require('./src/adapters');
const removal = require('./src/removal');
const buildDigest = require('./src/build-digest');
const carryover = require('./src/carryover');
const unsupported = require('./src/unsupported');
const sentCheck = require('./src/sent-check');
const officialList = require('./src/official-list');
const claudeSessionList = require('./src/claude-session-list');
const claudeLogin = require('./src/claude-login');
const claudeElsewhere = require('./src/claude-elsewhere');
const sessionTotalsOf = require('./src/session-totals');
const PACKAGE = require('./package.json');

/* <publisher>.<name>, which is also how the editor names this extension's folders. Read from the manifest rather than
   from the editor's API because deactivate needs it, and by then that API is gone. */
const ID = PACKAGE.publisher + '.' + PACKAGE.name;
/* Where this copy is installed, kept for deactivate for the same reason. */
let selfPath = '';

/* Settings and commands are named under this prefix. The keys this extension keeps in its own state are not settings,
   are not seen by anyone, and keep the names they were first stored under. */
const PREFIX = 'claudeCodePlus.';
/* Earlier prefixes of settings and commands, newest first. */
const LEGACY_PREFIXES = ['claudeCodeWorkPlan.', 'claudeCodeExtras.'];
const SETTING = PREFIX + 'enabled';
const COLOR_SETTING = PREFIX + 'userMessageColor';
const EDGE_SETTING = PREFIX + 'userMessageEdge';
const REMOVED_KEY = 'claudeCodeExtras.removed';
const PLUGIN_KEY = 'claudeCodeExtras.workPlanPlugin';
const SWEEP_KEY = 'claudeCodeExtras.lastOrphanSweep';
const LATENCY_KEY = 'claudeCodeExtras.latencyOffset';
const THRESHOLD_SETTING = PREFIX + 'latencyThresholdSeconds';
const LATENCY_ON_SETTING = PREFIX + 'recordOpenLatency';
const PIN_MARGIN_SETTING = PREFIX + 'sessionPinsMarginDays';
const REOPEN_SETTING = PREFIX + 'reopenDroppedTabs';
const LOAD_TABS_SETTING = PREFIX + 'loadRestoredTabs';
const HIDE_BG_SETTING = PREFIX + 'hideBackgroundSessions';
const HIDE_OFFICIAL_LIST_SETTING = PREFIX + officialList.SETTING;
/* The command the Hide It and Keep It buttons above Agent Plus's session list run; it is not in the Command Palette. */
const OFFICIAL_LIST_ANSWER = 'answerOfficialListQuestion';
const WORK_PLAN_SETTING = PREFIX + 'workPlan';
const BRIEF_SETTING = PREFIX + 'conversationBrief';
const TIME_ZONE_SETTING = PREFIX + 'tellClaudeYourTimeZone';
/* The four settings that agentPlus.tokenMode overrides outside Custom (src/token-mode.js); each is read through runs(). */
const MODE_SWITCHES = tokenMode.SWITCHES.filter((s) => s.key.startsWith(PREFIX)).map((s) => s.key);
const runs = (key) => tokenMode.effective(vscode, key);
/* Read by the plugin's hooks, which are separate processes and cannot see editor settings. Keys match plan_path.py.
   package.json makes them application settings, since they go into one file that every conversation on the machine
   reads. */
const HOOK_SETTINGS = {
  enabled: WORK_PLAN_SETTING,
  offerMinTurns: PREFIX + 'workPlanOfferMinTurns',
  offerMinToolCalls: PREFIX + 'workPlanOfferMinToolCalls',
  quietWhenReplyMatches: PREFIX + 'workPlanQuietWhenReplyMatches',
  tellTimeZone: TIME_ZONE_SETTING,
  brief: BRIEF_SETTING,
};

/*
 * Memoize `read()` for the current turn of the event loop. A timer or event handler asks for the same value several
 * times while it runs, and it is computed once per turn.
 */
function perTick(read) {
  let value, have = false;
  return () => {
    if (!have) { value = read(); have = true; setImmediate(() => { have = false; }); }
    return value;
  };
}

/* Which folders of an extensions directory the editor has marked for deletion, read once per turn of the event loop. */
const marks = new Map();
function markedIn(root) {
  if (!marks.size) setImmediate(() => marks.clear());
  if (!marks.has(root)) marks.set(root, removal.obsolete(root));
  return marks.get(root);
}

/*
 * Every install of Claude Code this adapter can see: the one this window runs plus sibling versions in the same folder,
 * less the siblings the editor has marked for deletion, which nobody will run again. `all` keeps those too, for taking
 * our changes back out: a marked folder can still carry them until the editor deletes it.
 */
function installs(adapter, all = false) {
  const ext = vscode.extensions.getExtension(adapter.id);
  if (!ext) return [];
  const root = path.dirname(ext.extensionPath);
  const found = Array.from(new Set([ext.extensionPath, ...adapter.findInstalls(root)]));
  return all ? found : removal.unmarked(found, ext.extensionPath, markedIn(root));
}

/* The editor's settings as last read. Reading them builds a merged copy of every scope, and a tick asks for a couple of
   dozen values, so the copy is kept until the editor reports a change, when start() drops it. */
let settings = null;
const cfg = () => settings || (settings = vscode.workspace.getConfiguration());
function enabled() { return cfg().get(SETTING, true); }

async function offerReload(text) {
  const pick = await noticeTime.info(vscode, text, 'Reload Window');
  if (pick === 'Reload Window') vscode.commands.executeCommand('workbench.action.reloadWindow');
}

/* A keybinding made before a rename names a command under an old prefix, so the old names stay registered, unlisted.
   The editor refuses a name that another extension in this host holds already, as the old extension does until the host
   restarts after it was updated, and that name is left to it. */
function registerCommand(name, fn) {
  const all = [vscode.commands.registerCommand(PREFIX + name, fn)];
  for (const p of LEGACY_PREFIXES) {
    try { all.push(vscode.commands.registerCommand(p + name, fn)); } catch (_) { /* held by another extension */ }
  }
  return { dispose() { for (const d of all) d.dispose(); } };
}

/*
 * Settings were once named under the old prefixes. A value set under an old name is copied to its new name, in the same
 * scope, from the more recent prefix when both have one. The old ones are then cleared where the editor allows that;
 * it may refuse to write a name no extension declares any more, and then the old line is left in place.
 *
 * A copy is made only where the new name has no value of its own, so nothing set under the new name is overwritten; and
 * each scope is done once, so putting a new name back to its default later does not bring the old value back.
 */
const RENAMED_KEY = PREFIX + 'settingsRenamed';
async function renameSettings(context) {
  const contrib = (context.extension.packageJSON.contributes || {}).configuration || {};
  const names = [].concat(contrib).flatMap((c) => Object.keys((c && c.properties) || {}))
    .filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
  /* An application setting cannot be written to a workspace or folder, so those scopes skip it. An old name's value
     there is left alone and does nothing. */
  const userOnly = new Set([].concat(contrib).flatMap((c) => Object.entries((c && c.properties) || {}))
    .filter(([, v]) => v && v.scope === 'application').map(([k]) => k.slice(PREFIX.length)));
  const T = vscode.ConfigurationTarget;
  const groups = [];
  const all = () => vscode.workspace.getConfiguration();
  if (!context.globalState.get(RENAMED_KEY)) {
    groups.push({ state: context.globalState,
      scopes: [{ where: 'user', target: T.Global, field: 'globalValue', conf: all }] });
  }
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length && !context.workspaceState.get(RENAMED_KEY)) {
    const inFolder = (f) => ({ where: 'folder ' + f.name, target: T.WorkspaceFolder, field: 'workspaceFolderValue',
      conf: () => vscode.workspace.getConfiguration(undefined, f.uri) });
    groups.push({ state: context.workspaceState,
      scopes: [{ where: 'workspace', target: T.Workspace, field: 'workspaceValue', conf: all }].concat(folders.map(inFolder)) });
  }
  const done = [];
  for (const g of groups) {
    let complete = true;
    for (const sc of g.scopes) {
      const conf = sc.conf();
      let moved = 0, left = 0;
      for (const name of names) {
        if (sc.target !== T.Global && userOnly.has(name)) continue;
        const found = LEGACY_PREFIXES.map((p) => {
          const old = conf.inspect(p + name);
          return { key: p + name, value: old ? old[sc.field] : undefined };
        }).filter((o) => o.value !== undefined);
        if (!found.length) continue;
        const now = conf.inspect(PREFIX + name);
        try {
          if (!now || now[sc.field] === undefined) await conf.update(PREFIX + name, found[0].value, sc.target);
          moved++;
        } catch (_) { complete = false; continue; }
        for (const o of found) { try { await conf.update(o.key, undefined, sc.target); } catch (_) { left++; } }
      }
      if (moved) done.push(`${moved} in ${sc.where}` + (left ? ` (${left} old line${left > 1 ? 's' : ''} left in place)` : ''));
    }
    if (complete) await g.state.update(RENAMED_KEY, true);
  }
  return done.join(', ');
}

/* The pins and colors chosen under the old id (src/carryover.js), copied before anything here reads its own. */
function carryOver(context, log) {
  try {
    const r = carryover.copyFiles(context.globalStorageUri.fsPath, [sessionPins.FILE, sessionColors.FILE]);
    if (r.copied.length) log.appendLine(`copied from ${carryover.LEGACY_ID}: ${r.copied.join(', ')}`);
    if (r.failed.length) log.appendLine(`could not copy from ${carryover.LEGACY_ID}: ${r.failed.join(', ')}`);
  } catch (e) { log.appendLine('copying from ' + carryover.LEGACY_ID + ': ' + e.message); }
}

/*
 * An earlier version of the old extension (src/carryover.js) patches Claude Code with its own build, and two extensions
 * doing that take turns rewriting the same files. Until it is updated or uninstalled nothing here starts, since the old
 * one still owns the patch, the plugin and the settings. Its commands share names with ours, and are left to it. The
 * first start after it is gone runs as usual.
 */
const TOLD_KEY = PREFIX + 'toldEarlierBuild';
/* How long the first start waits for export.json from the old id's last version. */
const EXPORT_WAIT_MS = 20000;
/* How often the supervisors' titles and leads are looked at for Agent Plus (stewardsOfKey). */
const STEWARD_ORDER_MS = 5000;
function standAside(context, log, version) {
  log.appendLine(`Work Plan for Claude Code ${version} (${carryover.LEGACY_ID}) is still installed and patches Claude Code itself; `
    + 'this extension does nothing until it is updated or uninstalled');
  const tell = () => noticeTime.warning(vscode,
    'An earlier version of Work Plan for Claude Code is installed. Update or uninstall it to use Claude Code Plus; your work plans come back after uninstall.',
    'Show It',
  ).then((pick) => { if (pick === 'Show It') showOldExtension(); }, () => {});
  for (const c of (context.extension.packageJSON.contributes || {}).commands || []) {
    context.subscriptions.push(vscode.commands.registerCommand(c.command, tell));
  }
  if (context.globalState.get(TOLD_KEY) === version) return;
  Promise.resolve(context.globalState.update(TOLD_KEY, version)).catch(() => {});
  tell();
}

/* The old extension's page in the Extensions view, where it can be updated or uninstalled; a search for its id when the
   editor cannot open the page. */
function showOldExtension() {
  return Promise.resolve(vscode.commands.executeCommand('extension.open', carryover.LEGACY_ID))
    .catch(() => vscode.commands.executeCommand('workbench.extensions.search', '@id:' + carryover.LEGACY_ID))
    .then(undefined, () => {});
}

/*
 * The old id's last version does nothing, and once this extension runs in its place it can be uninstalled. The question
 * is not asked at a start that asks for a reload, so that reload comes first. It is asked again at later starts until
 * its button is used.
 */
const TOLD_OLD_KEY = PREFIX + 'toldUninstallOld';
function offerUninstallOld(context) {
  if (context.globalState.get(TOLD_OLD_KEY) === true) return;
  noticeTime.info(vscode,
    'Claude Code Plus is now running. Work Plan for Claude Code is still installed but no longer does anything; you can uninstall it from its Extensions page.',
    'Show Extension',
  ).then((pick) => {
    if (pick !== 'Show Extension') return;
    Promise.resolve(context.globalState.update(TOLD_OLD_KEY, true)).catch(() => {});
    showOldExtension();
  }, () => {});
}

/*
 * In Restricted Mode nothing starts until the workspace is trusted: everything this extension does writes files or runs
 * Claude Code's command line. deactivate() still restores Claude Code's files on an uninstall, in Restricted Mode too.
 */
async function activate(context) {
  selfPath = context.extensionPath;
  const log = vscode.window.createOutputChannel('Claude Code Plus');
  context.subscriptions.push(log);
  let earlier = '', handing = false;
  try {
    const old = vscode.extensions.getExtension(carryover.LEGACY_ID);
    earlier = carryover.earlierBuild(old);
    handing = !!old && !earlier;
  } catch (_) { /* not there */ }
  if (earlier) { standAside(context, log, earlier); return; }
  /* The title of a tab Claude Code creates without one of its own (src/host.js). The log line is what tells, after a
     tab came back empty, whether it was opened with its conversation's title. */
  globalThis.__cceTitleOf = (sessionId) => {
    let title = '';
    try { title = claudeSessionList.titleOf(sessionId); } catch (_) { title = ''; }
    log.appendLine(`new tab for ${String(sessionId).slice(0, 8)}: ${title ? "its conversation's title" : "no title found, so Claude Code's default"}`);
    return title;
  };
  context.subscriptions.push({ dispose: () => { delete globalThis.__cceTitleOf; } });
  /* The old id's last version writes export.json when it activates, and the editor activates it only after this
     activation has returned, since it depends on this extension. So the start waits for the file, and activation does
     not wait for the start. */
  const storage = context.globalStorageUri.fsPath;
  const exported = path.join(carryover.legacyStorage(storage), carryover.EXPORT_FILE);
  const waiting = handing && !fs.existsSync(exported);
  const go = async () => {
    if (waiting && !(await carryover.waitFor(exported, EXPORT_WAIT_MS))) {
      log.appendLine(`${carryover.LEGACY_ID} wrote no ${carryover.EXPORT_FILE} within ${EXPORT_WAIT_MS / 1000}s; starting without it`);
    }
    try {
      const taken = await carryover.importState(context.globalState, storage);
      if (taken.length) log.appendLine(`taken from ${carryover.LEGACY_ID}: ${taken.join(', ')}`);
    } catch (e) { log.appendLine(`reading ${exported}: ${e && e.message}`); }
    carryOver(context, log);
    let renamed = '';
    try { renamed = await renameSettings(context); } catch (e) { renamed = 'failed: ' + (e && e.message); }
    await start(context, log, renamed, handing);
  };
  if (vscode.workspace.isTrusted !== false) {
    const started = go();
    if (waiting) started.catch((e) => log.appendLine('starting: ' + ((e && e.stack) || e)));
    else await started;
    return;
  }
  log.appendLine('Restricted Mode: nothing starts until this workspace is trusted');
  let started = false;
  const trusted = vscode.workspace.onDidGrantWorkspaceTrust(() => {
    if (started) return;
    started = true;
    go().catch((e) => log.appendLine('starting once trusted: ' + ((e && e.stack) || e)));
  });
  context.subscriptions.push(trusted);
}

function start(context, log, renamed, handing = false) {
  if (renamed) log.appendLine(`settings moved from ${LEGACY_PREFIXES.map((p) => p + '*').join(' and ')} to ${PREFIX}*: ${renamed}`);
  const removed = () => context.globalState.get(REMOVED_KEY, false) === true;
  /*
   * Install state of the copy this window runs (src/removal.js), memoized per turn of the event loop.
   *
   * Uninstalling: the editor has marked it for deletion with no other version staying, and waits for this window to
   * restart its extensions. Until then it must not re-patch files another window has just restored.
   *
   * Replaced: another build of this extension is installed now (another version beside it, or the same version again
   * over it) while this window keeps running this one. It then leaves every shared file alone; the windows that reload
   * run the installed build and keep those files current. If the same package is installed again over this copy and no
   * file differs from what this window loaded, the window adopts the new install stamp and carries on.
   */
  let loadedStamp = removal.installStamp(context.extensionPath);
  const loadedCode = buildDigest.digest(context.extensionPath);
  let comparedStamp = 0;
  const standing = perTick(() => {
    const root = path.dirname(context.extensionPath), marked = markedIn(root);
    const s = removal.standing(context.extensionPath, ID, loadedStamp, marked);
    if (s !== 'replaced' || marked[path.basename(context.extensionPath)] === true || !loadedCode) return s;
    const now = removal.installStamp(context.extensionPath);
    if (!now || now === comparedStamp) return s;
    comparedStamp = now;
    if (buildDigest.digest(context.extensionPath) !== loadedCode) return s;
    log.appendLine('the same package was installed again over this copy; this window keeps its part');
    loadedStamp = now;
    return '';
  });
  const uninstalling = () => standing() === 'uninstalling';
  const replaced = () => standing() === 'replaced';
  /* Whether this window keeps the state all windows share about running work: which conversation started which
     background session, what runs now, and the ends of detached commands and background sessions with their notices. A
     window running the installed build keeps it. So does a window whose build an install has replaced, as long as no
     window runs the installed build; the supervisors table follows the same rule (src/steward-view.js writesTable).
     Otherwise, while every window runs an earlier build, a conversation is told that its work ended only once a window
     is reloaded, which can be hours later. */
  let keepsShared = () => false;
  const keepsWork = () => !uninstalling() && !removed() && (!replaced() || keepsShared());

  const knownDirs = perTick(() => taskDirs(background.liveRecords()));

  /* One setting per switchable addition, named after it. Reading them here rather than in src/webview.js keeps that
     file free of the editor's API, which is what lets the tests run it. */
  const switchedOff = () => webview.SWITCHES.filter((k) => cfg().get(PREFIX + 'show.' + k, true) === false);
  /* The conversations pinned in the session list (src/sessionpins.js). The file is in this extension's storage on the
     machine that holds the transcripts, and every window reads and writes the same one. */
  const pinsFile = () => path.join(context.globalStorageUri.fsPath, sessionPins.FILE);
  const pinsOn = () => !removed();
  const pinMargin = () => cfg().get(PIN_MARGIN_SETTING, sessionPins.MARGIN_DAYS);
  const colorsFile = () => path.join(context.globalStorageUri.fsPath, sessionColors.FILE);
  /* Conversations run by several editor processes (src/duplicates.js), refreshed with the background work, and the
     time of the last heartbeat from a page of this window's panels (src/page/99-sweep.js). */
  let dupGroups = new Map(), pageAt = 0;
  const options = () => {
    const off = switchedOff();
    return {
      enabled: enabled(), userColor: cfg().get(COLOR_SETTING, ''), userEdge: cfg().get(EDGE_SETTING, true) !== false,
      off,
      tasks: readTasks(knownDirs()),
      background: off.includes('backgroundSessions') ? [] : background.collect(),
      workers: off.includes('backgroundSessions') ? [] : background.workersNow() || [],
      detached: off.includes('detachedCommands') ? [] : background.jobRows({ jobs: background.jobsNow() || [] }),
    };
  };
  /* Never after Remove, which has just taken these files out of Claude Code's folder: a scan finishing afterwards would
     put them back. */
  /* A failed write is tried again a second later, up to five times, rather than waiting for the next change; a counter
     the failed write could not move is moved by the next try (src/webview.js). */
  let liveAgain = 0, liveFails = 0;
  const writeLiveNow = () => {
    if (removed() || uninstalling() || replaced()) return;
    try {
      const opts = options();
      for (const dir of installs(webview)) webview.writeLive(dir, opts);
      liveFails = 0;
    } catch (e) {
      log.appendLine('live refresh failed: ' + e.message);
      if (!liveAgain && ++liveFails <= 5) liveAgain = setTimeout(() => { liveAgain = 0; writeLiveNow(); }, 1000);
    }
  };
  /* Reads what the conversation in front of the reader has added to its transcript since last time - the only one, since
     that is the one being looked at; the others were read when they were. A new session is written out at once rather
     than at the next refresh, so it appears in the agent map while the launch is still on screen. */
  /* Where each reply's effort changed, for the conversation in front of the reader, written beside the panel for it to
     read (src/efforts.js). Not read at all when the model is switched off, since the effort is shown with it. */
  const scanEffort = (opts) => {
    if (removed() || !enabled() || uninstalling() || replaced() || switchedOff().includes('modelName')) return;
    const id = activeChat();
    if (!id) return;
    efforts.scan(id, opts || {})
      .then((r) => {
        // Asked again: the scan may have finished after Remove, or once this window no longer runs the installed build.
        if (!r || !r.css || removed() || uninstalling() || replaced()) return;
        for (const dir of installs(webview)) webview.writeEffort(dir, id, r.css);
      })
      .catch((e) => log.appendLine('reply efforts: ' + e.message));
  };
  /* Where Claude Code's own command line can be found: its binary ships inside each install. */
  const claudeFolders = () => Array.from(new Set(ADAPTERS.flatMap((adapter) => installs(adapter))));
  /* A replaced window (running an older build than the installed one) still scans so its own tabs keep their green
     dots, and writes what it found only when keepsWork allows. */
  const scanBackground = () => {
    if (removed() || !enabled() || uninstalling() || switchedOff().includes('backgroundSessions')) return;
    const id = activeChat();
    if (!id) return;
    const write = keepsWork();
    background.scan(id, { write })
      .then((r) => { if (r && r.added && write) writeLiveNow(); })
      .catch((e) => log.appendLine('background sessions: ' + e.message));
  };

  /* Set when a sync here has patched or restored Claude Code's files; either asks for a reload. */
  let reloadOffered = false;
  /* Bring every install in line with the current settings. Only installing, upgrading or removing the patch itself
     asks for a reload; on and off and the color are picked up by an open panel within a couple of seconds. */
  /* Set by each sync: true when every installed Claude Code panel has this build's patch, which draws images in
     replies. */
  let panelShowsImages = false;
  async function sync({ interactive = false } = {}) {
    if (replaced()) {
      log.appendLine('sync: this window runs a build that has since been installed again; leaving the files to the windows running it');
      if (interactive) offerReload('This window is running an earlier build of Claude Code Plus than the one now installed. Reload the window to run it.');
      return;
    }
    const patched = [], restored = [], problems = [], notSupported = new Set();
    let panels = 0, panelsPatched = 0;
    const leaving = uninstalling();
    const restoring = removed() || leaving;
    /* The live stylesheet's options, computed once and only for the panel's bundle (the host bundle ignores them),
       since computing them reads the background sessions, the scheduled prompts and the pins. */
    let opts = null;
    let found = 0;
    for (const adapter of ADAPTERS) {
      for (const dir of installs(adapter, restoring)) {
        found++;
        const label = `${adapter.name} (${path.basename(dir)})`;
        try {
          if (restoring) {
            const r = adapter.restore(dir);
            log.appendLine(`${label}: ${r.message}`);
            if (r.changed && !restored.includes(adapter.name)) restored.push(adapter.name);
          } else {
            const r = adapter.apply(dir, adapter === webview ? (opts || (opts = options())) : undefined);
            log.appendLine(`${label}: ${r.message}${r.liveChanged ? ' (live settings updated)' : ''}`);
            if (adapter === webview) { panels++; if (r.changed || r.current) panelsPatched++; }
            if (r.changed && !patched.includes(adapter.name)) patched.push(adapter.name);
            else if (!r.changed && !r.current) {
              if (unsupported.isUnsupported(r.message)) notSupported.add(unsupported.versionOf(dir));
              else problems.push(`${label}: ${r.message}`);
            }
          }
        } catch (e) {
          problems.push(`${label}: ${e.message}`);
          log.appendLine(`${label}: error ${e.stack || e.message}`);
        }
      }
    }
    if (!found && interactive) noticeTime.warning(vscode, 'Claude Code Plus: the Claude Code extension is not installed, so there is nothing to patch.');
    const showing = !restoring && panels > 0 && panelsPatched === panels;
    if (showing !== panelShowsImages) { panelShowsImages = showing; writeHookSettings(); }
    // Shown in the editor's display language; which rule failed is only in the output channel. Not awaited: a message
    // with a button stays open.
    if (notSupported.size) {
      const details = vscode.l10n.t(unsupported.DETAILS);
      noticeTime.warning(vscode, vscode.l10n.t(unsupported.MESSAGE, [...notSupported].join(', ')), details)
        .then((pick) => { if (pick === details) log.show(true); }, () => {});
    }
    if (problems.length) noticeTime.warning(vscode, 'Claude Code Plus: ' + problems.join(' | '));
    if (patched.length) offerReload(`Claude Code Plus is installed in ${patched.join(' and ')}. Reload the window once to start; after that, On/Off and colors change live.`);
    if (patched.length || restored.length) reloadOffered = true;
    // An uninstall already has the editor asking for a restart of its extensions; a second prompt would only compete.
    if (restored.length && !leaving) offerReload(`Claude Code Plus was removed from ${restored.join(' and ')}. Reload the window to finish.`);
  }

  /* No status bar item for on and off.
   *
   * There was one, reading "Extras: On". It promised more than the setting behind it does: off stops the additions being
   * drawn, while the patch, the injected script, its poll and the hooks all stay - so a reader took it for a switch that
   * turns this extension off, which is the Remove command. It also sat one click away in the left status bar, where
   * hitting it by accident silently changed a global setting. The three commands remain for anyone who wants it.
   */
  const setEnabled = async (value) => {
    const unremoving = value && removed();
    if (unremoving) await context.globalState.update(REMOVED_KEY, false);
    if (enabled() === value) { await sync({ interactive: true }); return; }
    await cfg().update(SETTING, value, vscode.ConfigurationTarget.Global);
    // The setting reaches the live stylesheet only; coming back from Remove needs the patch put back in as well.
    if (unremoving) await sync({ interactive: true });
  };

  context.subscriptions.push(
    registerCommand('enable', () => setEnabled(true)),
    registerCommand('disable', () => setEnabled(false)),
    registerCommand('toggle', () => setEnabled(!(enabled() && !removed()))),
    registerCommand('remove', async () => {
      await context.globalState.update(REMOVED_KEY, true);
      await sync({ interactive: true });
    }),
    registerCommand('status', () => {
      const lines = [];
      for (const adapter of ADAPTERS) for (const d of installs(adapter, true)) lines.push(`${adapter.name} ${path.basename(d)}: ${adapter.status(d)}`);
      noticeTime.info(vscode, 'Claude Code Plus — ' + (lines.join(' | ') || 'Claude Code is not installed') + (removed() ? ' (removed)' : '')
        + ' | ' + tokenModeLine());
    }),
    /* Every setting this extension has, in the editor's own settings UI: search, per-workspace values, sync and a JSON
       view come with it, and none of it is ours to maintain. */
    /*
     * Take the plugin out of Claude Code's own settings, which is the only way to stop its skill description being
     * loaded - about a hundred tokens a session that the switch above cannot reach, because the switch only tells the
     * plugin's hooks to do nothing while the plugin itself stays registered.
     *
     * A command rather than something the switch does, because this writes Claude Code's configuration rather than ours,
     * and an extension that quietly edits another tool's settings is the behaviour nobody wants to discover later.
     * `disable` and not `uninstall`: uninstalling takes the plugin's data directory with it, and that is where every
     * conversation's plan lives.
     */
    registerCommand('disableWorkPlanPlugin', async () => {
      const yes = await noticeTime.warning(vscode,
        'Stop Claude Code loading the work plan plugin? This edits Claude Code\'s own settings, and saves the skill '
        + 'description it loads every session. Your existing plans are left alone.',
        { modal: true }, 'Stop loading it');
      if (yes !== 'Stop loading it') return;
      const r = await pluginInstall.disable(claudeFolders());
      log.appendLine('work plan plugin: ' + r.said);
      log.show(true);
      if (r.ok) await offerReload('The work plan plugin will stop loading in conversations started after a reload.');
    }),
    registerCommand('openSettings',
      // Our own id, so a change of publisher or name cannot leave this pointing at an extension that is not here.
      () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:' + context.extension.id)),
    /* Reads the records rather than measuring anything, so it is also the way to see them after a window restart. */
    registerCommand('showOpenLatency', () => {
      sampleLatency();
      /* Every window's records, not just this one's - a regression shows up across windows, and the window you happen to
         run this from is rarely the one that was slow. */
      const records = latency.readAll(latencyDir());
      log.appendLine('');
      for (const line of latency.report(records, thresholdMs())) log.appendLine(line);
      log.appendLine(`  records: ${path.join(latencyDir(), 'open-latency-<pid>.jsonl')}, one per window`);
      log.show(true);
    }),
    // A Claude Code update arrives as a new folder, so patch it as soon as that folder appears.
    vscode.extensions.onDidChange(() => sync()),
  );

  const REFRESH_MS = 30000;

  /*
   * How long this window makes you wait, taken from the official extension's log rather than measured here - see
   * src/openlatency.js for what is paired with what. It rides the half-minute timer because it costs one stat of one
   * file when nothing has been written, and reads only the bytes appended since the last pass.
   *
   * It is deliberately not in the injected script. A readout added there once made reloading the window crash, and the
   * mechanism was never established; the panel is also the wrong side to measure from, since what is being timed is a
   * panel that has not started yet.
   */
  /* A directory rather than a file: each window writes only its own, since several of them share this folder and
     nothing locks it. src/openlatency.js says what goes wrong when they share one. */
  const latencyDir = () => context.globalStorageUri.fsPath;
  const stamp = () => {
    const ours = context.extension && context.extension.packageJSON && context.extension.packageJSON.version;
    const ext = vscode.extensions.getExtension(webview.id);
    const theirs = ext && ext.packageJSON && ext.packageJSON.version;
    return `${ours || '?'}/${theirs || '?'}`;
  };
  const thresholdMs = () => Math.max(1, cfg().get(THRESHOLD_SETTING, 10)) * 1000;
  /* Read offset, open pairings and the fast-open count for this window's log, kept in memory only: each window has its
     own log and a reload starts a new one, so shared storage would carry this state into the wrong log. */
  let latencyState = {};
  if (context.globalState.get(LATENCY_KEY) !== undefined) context.globalState.update(LATENCY_KEY, undefined);
  function sampleLatency() {
    /* Off means nothing is read either. Stopping only the writing would leave the log being opened and parsed every
       thirty seconds, which is most of what this costs. */
    if (!cfg().get(LATENCY_ON_SETTING, true)) return;
    try {
      const r = latency.sample({
        log: latency.logFile(context.logUri.fsPath),
        dir: latencyDir(),
        state: latencyState,
        version: stamp(),
        thresholdMs: thresholdMs(),
      });
      if (r.state) latencyState = r.state;
      /* Anything recorded is already past the threshold, so it is worth saying without being asked. */
      for (const w of r.added) {
        log.appendLine(`waited ${(w.waited / 1000).toFixed(1)}s for ${w.what} (${w.trigger}) at ${w.at}`);
      }
    } catch (e) {
      log.appendLine('open latency: ' + e.message);
    }
  }
  sampleLatency();

  /* The other half of the same recording runs in the panel itself (src/panel-load-watch.js), put there by the patched
     host bundle as each panel's HTML is built. That bundle runs in this process and reads this flag at that moment, so
     the setting reaches the next panel opened without a reload. */
  const loadWatchOff = () => { globalThis[host.LOAD_WATCH_OFF] = !cfg().get(LATENCY_ON_SETTING, true); };
  loadWatchOff();
  context.subscriptions.push({ dispose: () => { delete globalThis[host.LOAD_WATCH_OFF]; } });

  /*
   * Hand the hooks their thresholds.
   *
   * They run as their own processes, so the editor's settings cannot reach them directly; this is the one file they read
   * instead, which keeps the settings UI as the only place a person edits these. Written on activation and whenever one
   * of them changes, and never required to exist - the plugin ships its own defaults so it works without this extension.
   */
  function writeHookSettings() {
    const values = {};
    for (const [key, setting] of Object.entries(HOOK_SETTINGS)) {
      const v = MODE_SWITCHES.includes(setting) ? runs(setting) : cfg().get(setting);
      if (typeof v === 'boolean') values[key] = v;
      else if (typeof v === 'number' && v >= 1) values[key] = Math.floor(v);
      else if (typeof v === 'string' && v) values[key] = v;
    }
    /* claudeCodePlus.show.replyImages controls both the panel drawing images and the hook that tells the model how to
       add one. The hook stays off until panelShowsImages is true, so the model is never told about images no panel
       can draw. */
    values.replyImages = panelShowsImages && enabled() && !removed() && !uninstalling() && !switchedOff().includes('replyImages');
    /* planDir(), not PLAN_DIR: that one is only the directory's name, and joined on its own it resolves against the
       extension host's working directory - a config.json the hooks never read. Written only when it changes, and
       replaced whole (src/hook-settings.js). */
    try { hookSettings.writeHookSettings(planDir(), values); } catch (e) {
      log.appendLine('work plan hook settings: ' + e.message);
    }
  }
  writeHookSettings();

  /* The day's count is written out when the window closes, which is the other moment it is known to be complete. */
  context.subscriptions.push({
    dispose: () => {
      try { latency.flush({ dir: latencyDir(), state: latencyState }); } catch (_) { /* closing anyway */ }
    },
  });

  /* The id of the conversation in front of the reader, or empty. The patched field writes it on every change; before
     anything has, or when the panel has no conversation open, it is not a string and reads as empty, which Agent Plus
     shows as no plan rather than another conversation's. */
  const activeChat = () => {
    const v = globalThis.__cceActiveChat;
    return typeof v === 'string' ? v : '';
  };
  /*
   * Delete the plans of conversations that no longer exist, at most once a calendar day.
   *
   * There is no timer for this, deliberately. It is reached from activation and from the periodic refresh below noticing
   * that the day has changed - so opening a window is what triggers it, and a window left open for weeks still gets a
   * turn. On every other call the whole cost is one string compare.
   *
   * The day is recorded before the work, not after: several windows are separate extension hosts sharing one unlocked
   * directory, and a reading that keeps failing should not be retried twice a minute until midnight.
   */
  const sweepPlans = async () => {
    if (removed()) return;
    const day = new Date().toISOString().slice(0, 10);
    if (context.globalState.get(SWEEP_KEY, '') === day) return;
    await context.globalState.update(SWEEP_KEY, day);
    const r = sweepOrphans();
    if (r.why) log.appendLine('orphan work plans: ' + r.why);
    else if (r.deleted) log.appendLine(`orphan work plans: deleted ${r.deleted}, kept ${r.kept}`);
    /* Efforts files beside the panel are pruned with the live-session list from the sweep just made; when that list is
       unknown, nothing is removed. */
    if (r.live) for (const dir of installs(webview, true)) webview.pruneEfforts(dir, r.live);
    try { if (r.live) sessionColors.prune(colorsFile(), r.live); } catch (_) { /* tried again tomorrow */ }
  };
  /* The reader's time zone as a panel of this window last reported it (src/panel-tz.js), or empty until one has. */
  const clientZone = () => {
    const v = globalThis.__cceClientTimeZone;
    return typeof v === 'string' ? v : '';
  };
  /* Notifications are timed in that zone once a panel has said it, and until then in this machine's zone, with its
     name. */
  noticeTime.setReaderZone(() => clientZone() || '');
  /* The plugin's hooks tell the model this zone (tell-time-zone.py), and they run beside Claude Code with no way to ask
     a panel, so it is left for them in a file. The last panel to report wins: one person behind several windows reads
     them all in one zone. A window that has not heard from a panel yet writes nothing rather than an empty zone. */
  const writeClientZone = () => {
    try { hookSettings.writeClientZone(planDir(), clientZone()); } catch (e) {
      log.appendLine('client time zone: ' + e.message);
    }
  };
  let closing = false;
  context.subscriptions.push({ dispose: () => { closing = true; } });
  let liveStates = new Map(), unreadKeys = new Set(), statesTimer = 0;
  /* The host's last state of each conversation whose panel here went away (src/gone-states.js, hostStates). */
  const gone = goneStates({ agentsNow: () => claude.agentsNow(), pidsOf: waiting.pidsOf, trustMs: () => AGENTS_TRUST_MS });
  const readTitles = waiting.reader();
  /* Conversations renamed from the session list or by a supervisor, whose new conversation is then not named after its
     first message (nameOpened). */
  const renamedByOthers = new Set();
  /* Account & usage is asked again when the conversation in front or the ones running here change, not only when the
     figures do: one that stopped before it had any would otherwise keep its "No figures yet" line. */
  let accountKey = '';
  const noteAccount = () => {
    const key = `${activeChat()}|${[...liveStates.keys()].sort().join(',')}`;
    if (key === accountKey) return;
    accountKey = key;
    try { sessionList.accountChanged(); } catch (_) { /* the list is not set up yet */ }
  };
  /* A panel reports 'waiting_input'; the rest of this extension calls it 'waiting'. */
  globalThis.__cceStatesHook = (states, active, open, unread) => {
    try {
      const next = new Map((Array.isArray(states) ? states : [])
        .filter((s) => s && typeof s.sessionId === 'string').map((s) => [s.sessionId, s.state === 'waiting_input' ? 'waiting' : s.state]));
      gone.note(liveStates, next);
      liveStates = next;
      unreadKeys = new Set((Array.isArray(unread) ? unread : []).filter((k) => typeof k === 'string'));
      if (!statesTimer) statesTimer = setTimeout(() => { statesTimer = 0; claude.changed(); noteAccount(); }, 300);
    } catch (_) { /* the next update */ }
  };
  /* The info box asks for its conversation's process id, and the context meter's hover asks the same to get the work
     plan's figures. `claude agents` is run for the process id unless the last run is under half a minute old. The work
     plan's figures and the token mode are sent separately, without waiting for it. */
  const sendPlan = (sessionId) => {
    const transcript = runs(WORK_PLAN_SETTING) ? transcriptOf(sessionId) : '';
    const mode = tokenMode.labelOf(tokenMode.modeNow(vscode));
    (transcript ? planInjections.measure(transcript) : Promise.resolve(null)).then((m) => {
      const reply = { type: 'cce_plan', sessionId, text: planInjections.describe(m), plan: planInjections.figures(m), mode };
      if (typeof globalThis.__cceToPanel === 'function') globalThis.__cceToPanel(sessionId, reply);
    }).catch((e) => log.appendLine('work plan figures: ' + (e && e.message)));
  };
  globalThis.__cceProcessHook = (sessionId) => {
    if (removed() || !enabled()) return;
    sendPlan(sessionId);
    if (switchedOff().includes('footerInfo')) return;
    claude.freshAgents().then((r) => {
      const reply = { type: 'cce_process', sessionId, pids: r.records ? waiting.pidsOf(r.records, sessionId) : null };
      if (typeof globalThis.__cceToPanel === 'function') globalThis.__cceToPanel(sessionId, reply);
    }).catch((e) => log.appendLine('process for the info box: ' + (e && e.message)));
  };
  /*
   * What each panel of this window last reported for its conversation besides its state: whether a turn runs and whether
   * background tasks run (src/activity.js). A turn that ends while background work still runs leaves Claude Code's
   * panel marking nothing unread until the work ends too, so a reply nobody saw is marked here, through the host, while
   * no tab or sidebar shows the conversation on screen.
   */
  const turns = activity.turnTracker();
  let marksTimer = 0;
  /* What each panel of this window last reported in front of it, { tool } or { dialog }, for Agent Plus's notices
     (src/waiting-for.js). */
  const waits = new Map();
  const noteWait = (sessionId, wait, farewell) => {
    const next = !farewell && wait && typeof wait === 'object' ? JSON.stringify(wait) : '';
    if ((waits.get(sessionId) || '') === next) return;
    if (next) waits.set(sessionId, next); else waits.delete(sessionId);
    if (!statesTimer) statesTimer = setTimeout(() => { statesTimer = 0; claude.changed(); }, 300);
  };
  globalThis.__cceTurnHook = (sessionId, busy, bg, farewell, wait) => {
    try {
      noteWait(sessionId, wait, farewell);
      const r = turns.report(sessionId, busy, bg, farewell);
      if (!r.changed) return;
      if (r.ended && enabled() && !removed()) {
        const shown = typeof globalThis.__cceShownVisibly === 'function' ? globalThis.__cceShownVisibly(sessionId) === true : true;
        if (activity.marksUnread(true, r.bg || bgWorking.has(sessionId), shown)
            && typeof globalThis.__cceSetUnread === 'function' && globalThis.__cceSetUnread(sessionId, true)) {
          log.appendLine(`marked ${sessionId} unread: its turn ended out of sight while background work runs`);
        }
      }
      // After the host has taken the same report in, which can leave its own state as it was.
      if (!marksTimer) marksTimer = setTimeout(() => { marksTimer = 0; try { refreshMarks(); } catch (_) { /* not set up yet */ } }, 0);
    } catch (e) { log.appendLine('turn report: ' + ((e && e.message) || e)); }
  };
  context.subscriptions.push({ dispose: () => {
    if (statesTimer) clearTimeout(statesTimer);
    if (marksTimer) clearTimeout(marksTimer);
    if (globalThis.__cceStatesHook) delete globalThis.__cceStatesHook;
    if (globalThis.__cceProcessHook) delete globalThis.__cceProcessHook;
    if (globalThis.__cceTurnHook) delete globalThis.__cceTurnHook;
  } });

  /* Conversations with a panel or tab in this window, except those the host sees running in another window. */
  const panelList = (name) => { try { const f = globalThis[name]; return typeof f === 'function' ? f() || [] : []; } catch (_) { return []; } };
  const shownList = () => { const elsewhere = panelList('__cceSessionsElsewhere'); return panelList('__cceSessionsShown').filter((id) => !elsewhere.includes(id)); };
  /* Assigned after the Supervisor panel is created below, which itself needs the source. */
  let openAnywhere = null;
  /* The list of running conversations, shared between windows (listAgents in src/waiting.js). A shared list is at most
     20 seconds old when a window takes it, and src/claude-source.js caches it for that window like any other. */
  const AGENTS_FILE = 'agents.json', AGENTS_SHARE_MS = 20000;
  /* Session ids of the conversations whose page types an answer only after the host says go (src/page/91-answer.js). */
  const confirming = new Set();
  /*
   * Agent Plus's session list (its protocol, Session list): the conversations of this window's first folder, read from
   * their transcripts (src/claude-session-list.js), the places where each is open outside the VS Code windows the list
   * knows of (src/claude-elsewhere.js), and the figures of the conversation in front, which the patched host passes on
   * each time the CLI reports them (src/session-totals.js). Watching the transcripts starts once the list first asks for
   * them.
   */
  let claimed = new Map();
  const places = claudeElsewhere.create({ ownPid: process.pid, claimed: (id) => claimed.has(id) });
  const sessionTotals = sessionTotalsOf.create({ changed: () => { sessionList.accountChanged(); } });
  globalThis.__cceSessionTotalsHook = (id, totals) => { try { sessionTotals.note(id, totals); } catch (_) { /* the next report */ } };
  const effortFiles = (id) => installs(webview, true).map((d) => path.join(d, 'webview', webview.EFFORT_PREFIX + id + '.css'));
  /* Through the panel showing it, so its CLI hears of it too; otherwise in its transcript, which no process has open. */
  const renameAnywhere = async (id, title) => {
    if (claude.source.canDeliver(id)) {
      renamedByOthers.add(id);
      const r = await renameConversation(id, title);
      return r.outcome === 'submitted' ? { outcome: 'done' } : { outcome: r.outcome === 'refused' ? 'refused' : 'failed', reason: r.reason };
    }
    if (deleteSession.runningSessions().has(id)) return { outcome: 'refused', reason: 'a Claude Code process has it open and would write its old title back' };
    const file = transcriptOf(id);
    if (!file) return { outcome: 'refused', reason: 'Claude Code has no transcript of it on this machine' };
    if (!claudeSessionList.appendTitle(file, id, title)) return { outcome: 'failed', reason: 'its transcript could not be written' };
    try { if (typeof globalThis.__cceSessionsChanged === 'function') globalThis.__cceSessionsChanged(); } catch (_) { /* the panels catch up */ }
    sessionList.changed();
    return { outcome: 'done' };
  };
  const sessionList = claudeSessionList.create({
    projects: () => projectsDir(),
    started: () => { watchList(); },
    ready: () => claude.freshAgents(),
    state: (id) => claude.stateOf(id),
    here: (id) => shownList().includes(id),
    lastUserAt: (file) => lastUser.at(file),
    elsewhere: () => {
      try { claimed = deleteSession.shownElsewhere(planDir()); } catch (_) { claimed = new Map(); }
      return places.scan();
    },
    isSteward: (id) => enabled() && !removed() && stewardMarks.stewardIds(stewardTable()).includes(String(id).toLowerCase()),
    open: (id, where) => vscode.commands.executeCommand('claude-vscode.editor.open', id, undefined, undefined, undefined, AS_FULL_EDITOR,
      { programmatic: where === 'sidebar' ? 'cce-pin-to-sidebar' : 'pin-to-panel' }),
    /* A new conversation has no id until its first message is sent, so the core is answered without one. */
    create: async (where) => {
      await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, undefined, undefined, undefined, AS_FULL_EDITOR,
        { programmatic: where === 'sidebar' ? 'cce-pin-to-sidebar' : 'pin-to-panel' });
      return '';
    },
    rename: (id, title) => renameAnywhere(id, title),
    remove: async (ids) => {
      let shown;
      try { shown = typeof globalThis.__cceSessionsShown === 'function' ? globalThis.__cceSessionsShown() : null; } catch (_) { shown = null; }
      const results = claudeSessionList.deleteChecked(ids, {
        shown, running: deleteSession.runningSessions(), elsewhere: deleteSession.shownElsewhere(planDir()),
        findAll: (want) => deleteSession.findAll(want, { planDir: planDir(), extra: effortFiles }),
        remove: (found) => deleteSession.remove(found),
        forget: (id) => {
          try { sessionPins.setPinned(pinsFile(), id, false); } catch (_) { /* not pinned */ }
          try { sessionColors.setColor(colorsFile(), [id], null); } catch (_) { /* not coloured */ }
        },
      });
      for (const r of results) log.appendLine(`session list: deleting ${r.sessionId}: ${r.outcome}${r.reason ? ` (${r.reason})` : ''}`);
      try { if (typeof globalThis.__cceSessionsChanged === 'function') globalThis.__cceSessionsChanged(); } catch (_) { /* the panels catch up */ }
      sessionList.changed();
      return results;
    },
    describe: async (ids) => [...deleteSession.findAll(ids, { planDir: planDir(), extra: effortFiles })]
      .map(([sessionId, found]) => ({ sessionId, what: found.length ? deleteSession.describe(found) : 'nothing of it is left on disk' })),
    officialLists: () => (typeof globalThis.__cceOfficialLists === 'function' ? globalThis.__cceOfficialLists() : null),
    pinned: () => sessionPins.read(pinsFile()).pinned,
    colors: () => sessionColors.read(colorsFile()),
    setUnread: (id, on) => { if (typeof globalThis.__cceSetUnread === 'function') globalThis.__cceSetUnread(id, on === true); },
    unseen: (id) => unreadKeys.has(id),
    totals: (id) => sessionTotals.rows(id),
    login: claudeLogin.reader({ extra: () => vscode.workspace.getConfiguration('claudeCode').get('environmentVariables', []),
      wrapper: () => vscode.workspace.getConfiguration('claudeCode').get('claudeProcessWrapper', '') }),
    front: () => activeChat(),
    /* The note above the list that asks whether to hide Claude Code's own list (src/official-list.js). */
    notice: () => (removed() ? null : officialList.notice({ state: context.globalState, command: PREFIX + OFFICIAL_LIST_ANSWER,
      hidden: () => cfg().get(HIDE_OFFICIAL_LIST_SETTING, false) === true, t: (text) => vscode.l10n.t(text) })),
  });
  context.subscriptions.push(registerCommand(OFFICIAL_LIST_ANSWER, (pick) => officialList.answer({
    state: context.globalState, pick, hide: () => cfg().update(HIDE_OFFICIAL_LIST_SETTING, true, vscode.ConfigurationTarget.Global),
  }).then((r) => { log.appendLine(`official session list question: ${r}`); sessionList.noticeChanged(); },
    (e) => log.appendLine('official session list question: ' + ((e && e.message) || e)))));
  /* The folders the list's rows come from, and Claude Code's session registry, watched for the list's changes. A project
     folder that appears later, as one does with the first conversation in a folder, is picked up within a minute. */
  const listWatches = new Map();
  let listWatchTimer = 0;
  const watchList = () => {
    if (removed()) return;
    const folder = ((vscode.workspace.workspaceFolders || [])[0] || { uri: { fsPath: '' } }).uri.fsPath;
    const want = new Set([path.join(claudeDir(), 'sessions')]);
    if (folder) for (const dir of projectFolders(projectsDir()) || []) if (claudeSessionList.projectOf(path.basename(dir), folder)) want.add(dir);
    for (const [dir, w] of listWatches) if (!want.has(dir)) { try { w.close(); } catch (_) { /* closed */ } listWatches.delete(dir); }
    for (const dir of want) {
      if (listWatches.has(dir)) continue;
      try {
        const w = fs.watch(dir, { persistent: false }, () => { sessionList.changed(); });
        w.on('error', () => { try { w.close(); } catch (_) { /* closed */ } listWatches.delete(dir); });
        listWatches.set(dir, w);
      } catch (_) { /* not there yet */ }
    }
    if (!listWatchTimer) {
      listWatchTimer = setInterval(watchList, 60000);
      if (listWatchTimer.unref) listWatchTimer.unref();
    }
  };
  context.subscriptions.push({ dispose: () => {
    if (listWatchTimer) clearInterval(listWatchTimer);
    for (const w of listWatches.values()) { try { w.close(); } catch (_) { /* closed */ } }
    listWatches.clear();
    sessionList.dispose();
    if (globalThis.__cceSessionTotalsHook) delete globalThis.__cceSessionTotalsHook;
  } });
  /* Created here because it reads globals the patched host sets in this process. */
  const claude = createClaudeSource({
    sessionList,
    planDir,
    enabled: () => runs(WORK_PLAN_SETTING),
    brief: () => runs(BRIEF_SETTING),
    timeZone: () => clientZone(),
    isSteward: (id) => enabled() && !removed() && stewardMarks.stewardIds(stewardTable()).includes(String(id).toLowerCase()),
    stewardsOf: (sourceId, sessionId) => (enabled() && !removed() ? stewardsOfKey(stewardKeys.keyOf(sourceId, sessionId)) : []),
    typed: (text) => relay.noteTyped(planDir(), text),
    listAgents: () => waiting.listAgents(pluginInstall.findClaude(claudeFolders()), undefined,
      { file: path.join(planDir(), AGENTS_FILE), ms: AGENTS_SHARE_MS, write: !replaced() && !uninstalling() }),
    folders: () => (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
    readPlan,
    titles: readTitles.titles,
    since: readTitles.since,
    replyAt: readTitles.replyAt,
    live: () => hostStates(),
    unread: () => unreadKeys,
    activity: (id) => activityFor(id),
    waitingFor: (id) => { const w = waits.get(id); try { return w ? JSON.parse(w) : null; } catch (_) { return null; } },
    lastUserAt: (id) => lastUser.at(transcriptOf(id)),
    activeChat: () => activeChat(),
    logo: () => {
      const ext = vscode.extensions.getExtension(webview.id);
      if (!ext || !ext.extensionPath) return null;
      const file = vscode.Uri.file(path.join(ext.extensionPath, 'resources', 'claude-logo.svg'));
      return { light: file, dark: file };
    },
    canDeliver: (sessionId) => {
      try { return typeof globalThis.__cceAnswer === 'function' && globalThis.__cceAnswer(sessionId) === true; } catch (_) { return false; }
    },
    hand: (sessionId, text, key, confirm) => (confirm && typeof globalThis.__cceToPanel === 'function'
      ? globalThis.__cceToPanel(sessionId, { type: 'cce_answer', sessionId, text, id: key, confirm: true }) === true
      : globalThis.__cceAnswer(sessionId, text, key) === true),
    confirms: (sessionId) => confirming.has(sessionId),
    /* Every panel: only the one holding the answer acts on it, and the conversation may have moved to another panel. */
    go: (key) => typeof globalThis.__cceToAllPanels === 'function' && globalThis.__cceToAllPanels({ type: 'cce_answer_go', id: key }) > 0,
    typedFor: (text) => relay.typedForOthers(planDir(), text, Date.now()),
    sentSince: (sessionId, text, since) => sentCheck.sentSince(transcriptOf(sessionId), text, since),
    log: (line) => log.appendLine(line),
    /* An extension cannot raise another window, and opening the conversation here as well would start a second process on
       it. */
    reveal: async (sessionId) => {
      if (!shownList().includes(sessionId)) return false;
      await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
      return true;
    },
    shown: () => shownList(),
    open: (sessionId) => (openAnywhere ? openAnywhere(sessionId) : 'nowhere'),
    /* Agent Plus's pen on a Work plan row (prefill in src/claude-source.js). When no panel here shows the conversation,
       it opens in a tab the way a supervisor's --resume opens it (resumeConversation below), and its text waits for that
       tab's page. */
    prefillTo: (sessionId, text, key) => typeof globalThis.__cceToPanel === 'function'
      && globalThis.__cceToPanel(sessionId, { type: 'cce_prefill', sessionId, text, id: key }) === true,
    listens: (sessionId) => claude.source.canDeliver(sessionId) && answersReady.has(sessionId),
    openTab: (sessionId) => {
      answersReady.delete(sessionId);
      return vscode.commands.executeCommand('claude-vscode.editor.open', sessionId, undefined, undefined, undefined, AS_FULL_EDITOR, { programmatic: 'pin-to-panel' });
    },
    transcriptOf: (sessionId) => transcriptOf(sessionId),
    elsewhere: (sessionId) => deleteSession.shownElsewhere(planDir()).get(sessionId) || [],
  });
  context.subscriptions.push(claude);
  /* The other agent's conversation tab that came to the front last; null once a Claude Code panel comes to the front.
     Other tabs do not change it; Agent Plus's work plan view does not move for them either. */
  let otherFront = null, otherChanged = () => {};
  const setOther = (next) => {
    if (JSON.stringify(next) === JSON.stringify(otherFront)) return;
    otherFront = next;
    otherChanged();
  };
  {
    const groups = vscode.window.tabGroups;
    const activeTab = () => { const g = groups && groups.activeTabGroup; return g ? g.activeTab : undefined; };
    const onTabs = () => {
      const tab = activeTab();
      claude.tabsChanged(tab);
      if (isPanelTab(tab)) setOther(null);
      else { const other = agentOfTab(vscode, tab); if (other) setOther(other); }
    };
    onTabs();
    for (const name of ['onDidChangeTabs', 'onDidChangeTabGroups']) {
      if (groups && typeof groups[name] === 'function') context.subscriptions.push(groups[name](onTabs));
    }
  }

  /* The Supervisor panel, and the notices it sends a supervisor when a conversation it manages stops (src/steward-view.js). */
  const shownHere = (sessionId) => shownList().includes(sessionId);
  globalThis.__cceAliveHook = () => { pageAt = Date.now(); };
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceAliveHook) delete globalThis.__cceAliveHook; } });
  const stopDuplicate = (sessionId) => {
    const group = dupGroups.get(sessionId);
    if (!group) return null;
    const p = duplicates.oldOne(group);
    return p && stopProcess(sessionId, p, 'button') ? p : null;
  };
  /*
   * Rename, close and open requests from a supervisor (src/relay.js). A rename goes through the panel showing the
   * conversation, so its CLI hears of it too. A conversation that is working, waiting for an answer or running
   * background work is closed only when the supervisor says the user confirmed it. How a new conversation gets its first
   * message is in src/page/91-answer.js.
   */
  const renameConversation = async (sessionId, title) => {
    let r;
    try { r = typeof globalThis.__cceRename === 'function' ? globalThis.__cceRename(sessionId, title) : null; }
    catch (e) { return { outcome: 'notReceived', reason: 'renaming failed here: ' + ((e && e.message) || e) }; }
    if (!r) return { outcome: 'notReceived', reason: 'no Claude Code panel in this window shows the conversation' };
    try { r = await r; } catch (e) { return { outcome: 'uncertain', reason: 'Claude Code reported: ' + ((e && e.message) || e) }; }
    if (r && r.skipped) return { outcome: 'refused', reason: 'Claude Code did not write the title, which it does for a conversation with no transcript yet' };
    return { outcome: 'submitted', reason: '' };
  };
  const closeConversation = async (sessionId, confirmed) => {
    const panel = claude.panelFor(sessionId);
    if (!panel) {
      return shownHere(sessionId) ? { outcome: 'refused', reason: 'it is shown in the sidebar here, and only an editor tab can be closed' }
        : { outcome: 'notReceived', reason: 'no editor tab in this window shows the conversation' };
    }
    const state = liveStates.get(sessionId) || '';
    const busy = bgWorking.has(sessionId) ? 'running background work' : state === 'waiting' ? 'waiting for an answer' : state === 'running' ? 'working' : '';
    if (busy && !confirmed) {
      return { outcome: 'refused', reason: `busy: it is ${busy}; ask the user, and run --close --confirmed if they still want it closed` };
    }
    try { panel.dispose(); } catch (e) { return { outcome: 'uncertain', reason: 'closing the tab failed: ' + ((e && e.message) || e) }; }
    return { outcome: 'submitted', reason: '' };
  };
  const OPEN_WAIT_MS = 40000, OPEN_ASK_MS = 500;
  const opening = new Map();
  globalThis.__cceSubmitHook = (id, sent, reason, sessionId) => {
    const done = opening.get(id);
    if (!done) return;
    opening.delete(id);
    done({ outcome: sent ? 'submitted' : 'notReceived', reason: sent ? '' : `the new tab did not send it (${reason || 'unknown'})`, sessionId });
  };
  context.subscriptions.push({ dispose: () => {
    if (globalThis.__cceSubmitHook) delete globalThis.__cceSubmitHook;
    for (const done of opening.values()) done({ outcome: 'uncertain', reason: 'the window closed' });
    opening.clear();
  } });
  /* Claude Code titles a new conversation with its first message until it has a title of its own, and the first message
     of one a supervisor started is the supervisor's line. Once that message is sent, the conversation is named after the
     user's words instead, unless something named it first. Naming is retried each second while Claude Code has no
     transcript to write the title into. */
  const nameOpened = async (sessionId, text) => {
    const title = stewards.titleOfWords(text);
    if (!title) return;
    renamedByOthers.delete(sessionId);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (renamedByOthers.has(sessionId) || (readTitles.titles({ sessionId }) || {}).custom) return;
      const r = await renameConversation(sessionId, title).catch(() => null);
      if (r && r.outcome === 'submitted') return;
    }
  };
  const openConversation = async (folder, text) => {
    const r = await openAndSend(folder, text);
    if (r && r.outcome === 'submitted' && typeof r.sessionId === 'string' && r.sessionId) {
      nameOpened(r.sessionId, text).catch((e) => log.appendLine('naming the new conversation: ' + ((e && e.message) || e)));
    }
    return r;
  };
  const openAndSend = async (folder, text) => {
    if (typeof globalThis.__cceToAllPanels !== 'function') return { outcome: 'notReceived', reason: 'Claude Code is not patched in this window' };
    relay.noteTyped(planDir(), text);
    try {
      await vscode.commands.executeCommand('claude-vscode.editor.open', undefined, text, undefined, undefined, AS_FULL_EDITOR, { programmatic: 'pin-to-panel' });
    } catch (e) { return { outcome: 'notReceived', reason: 'Claude Code could not open a tab: ' + ((e && e.message) || e) }; }
    const id = 'open-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const started = Date.now();
    return new Promise((resolve) => {
      let timer = 0;
      opening.set(id, (r) => { clearInterval(timer); resolve(r); });
      const ask = () => {
        if (!opening.has(id)) return;
        if (Date.now() - started > OPEN_WAIT_MS) {
          opening.delete(id);
          clearInterval(timer);
          resolve({ outcome: 'uncertain', reason: `the new tab did not report within ${OPEN_WAIT_MS / 1000} seconds; its first message may still be in its input` });
          return;
        }
        try { globalThis.__cceToAllPanels({ type: 'cce_submit', id, text }); } catch (_) { /* asked again */ }
      };
      timer = setInterval(ask, OPEN_ASK_MS);
      ask();
    });
  };
  /* The conversations whose page has said it listens for answers, by session id (src/page/91-answer.js). */
  const ANSWERS_READY = 'cce-answers-ready', answersReady = new Set();
  /* A stored conversation a supervisor asked for, in an editor tab here (src/relay.js). Without `programmatic`, Claude Code
     would also make the editor the user's preferred place to open conversations. The text waits until the new tab's
     page says it listens for that conversation (src/page/91-answer.js); an answer handed over earlier is lost. */
  const resumeConversation = (sessionId, text, loadMs) => {
    let tab = null;
    return relay.resume(sessionId, text, {
      open: async (id) => {
        answersReady.delete(id);
        await vscode.commands.executeCommand('claude-vscode.editor.open', id, undefined, undefined, undefined, AS_FULL_EDITOR, { programmatic: 'pin-to-panel' });
        const g = vscode.window.tabGroups.activeTabGroup;
        tab = g && g.activeTab && isClaudeTab(g.activeTab) ? g.activeTab : null;
      },
      shows: (id) => claude.source.canDeliver(id) && answersReady.has(id),
      tabOpen: (id) => shownList().includes(id),
      deliver: (id, words) => claude.source.deliverAnswer(id, words, {}),
      /* Its page never ran when the tab still has Claude Code's default title: a page that runs names the tab after
         the conversation. */
      giveUp: async (id) => {
        const still = tab && !answersReady.has(id) && vscode.window.tabGroups.all.some((g) => g.tabs.includes(tab));
        const label = still ? stripMark(tab.label).trim() : '';
        if (!still || (label && label !== 'Claude Code')) return false;
        await vscode.window.tabGroups.close(tab);
        log.appendLine(`Closed the tab opened for a supervisor's resume of ${id}: its page did not load`);
        return true;
      },
      loadMs,
    });
  };
  /* Hook for the window test: a supervisor's resume with a shorter load timeout. */
  globalThis.__cceResume = (id, text, loadMs) => resumeConversation(id, text, loadMs);
  context.subscriptions.push({ dispose: () => { delete globalThis.__cceResume; } });
  const steward = stewardView.create(vscode, {
    activeChat, freshAgents: () => claude.freshAgents(), readPlan, titles: readTitles.titles, since: readTitles.since,
    agentsFresh: () => waiting.listAgents(pluginInstall.findClaude(claudeFolders())), resume: resumeConversation,
    live: () => hostStates(), unread: () => unreadKeys, reveal: (sessionId) => claude.source.reveal(sessionId), shownHere,
    activity: (id) => activityFor(id), question: (id) => freshQuestionOf(id),
    canWrite: () => !removed() && !replaced() && !uninstalling(), canShare: () => !removed() && !uninstalling(),
    replaced: () => !removed() && !uninstalling() && replaced(),
    build: () => ({ code: loadedCode, installed: !removed() && !uninstalling() && !replaced() }), offerReload,
    enabled: () => enabled() && !removed(),
    log: (m) => log.appendLine(m), home: os.homedir(), dir: planDir(), shownList,
    changed: () => redrawStewards(),
    focusWindow: () => focusThisWindow(),
    deliver: (sessionId, text) => claude.source.deliverAnswer(sessionId, text, {}),
    pageAt: () => pageAt, duplicates: () => dupGroups, rereadDuplicates: () => readDuplicates(), stopDuplicate, otherFront: () => otherFront,
    rename: (sessionId, title) => { renamedByOthers.add(sessionId); return renameConversation(sessionId, title); },
    close: closeConversation, open: openConversation,
    windowName: () => vscode.workspace.name || '', windowFolders: () => (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
  });
  context.subscriptions.push(steward);
  keepsShared = () => steward.keepsShared();
  openAnywhere = (sessionId) => steward.open(sessionId);
  otherChanged = () => steward.refresh();
  /*
   * Brings this window to the front. The API has no call for this, so this window's own `code` CLI opens the folder or
   * workspace file the window already has open, and VS Code focuses the window rather than opening another. Untitled
   * workspaces have no path, so they are not focused.
   */
  const focusThisWindow = () => {
    const ws = vscode.workspace.workspaceFile;
    const folder = (vscode.workspace.workspaceFolders || [])[0];
    const target = ws && ws.scheme !== 'untitled' ? ws : (!ws && folder ? folder.uri : null);
    if (!target) return;
    const name = process.platform === 'win32' ? 'code.cmd' : 'code';
    /* A remote server's CLI; then the desktop's, inside the app on macOS and beside resources/app on Linux and Windows. */
    const remote = path.join(vscode.env.appRoot, 'bin', 'remote-cli', name);
    const cli = [remote, path.join(vscode.env.appRoot, 'bin', name), path.join(vscode.env.appRoot, '..', '..', 'bin', name)]
      .find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
    if (!cli) { log.appendLine('supervisor panel: no command line found to bring this window to the front'); return; }
    /* The desktop CLI finds the running VS Code by its user data folder, which is not the default one when VS Code was
       started with --user-data-dir; it would then start another VS Code. That folder holds User/globalStorage. */
    const args = [target.fsPath];
    if (cli !== remote && context.globalStorageUri && context.globalStorageUri.scheme === 'file') {
      let dir = context.globalStorageUri.fsPath;
      while (path.dirname(dir) !== dir && path.basename(dir) !== 'User') dir = path.dirname(dir);
      if (path.basename(dir) === 'User') args.unshift('--user-data-dir', path.dirname(dir));
    }
    cp.execFile(cli, args, { timeout: 15000, shell: process.platform === 'win32', windowsHide: true },
      (e) => { if (e) log.appendLine('supervisor panel: bringing this window to the front: ' + e.message); });
  };
  /* The same link clicked in a Claude Code panel, which the page hands here directly (src/page/93-steward-links.js). */
  globalThis.__cceOpenSessionHook = (id) => {
    steward.open(id).then((r) => {
      if (r === 'nowhere') noticeTime.info(vscode, 'That conversation is not open in any VS Code window on this machine.');
    }, (e) => log.appendLine('supervisor panel: ' + ((e && e.message) || e)));
  };
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceOpenSessionHook) delete globalThis.__cceOpenSessionHook; } });
  /* Other conversations named in replies, drawn as links by the panels' page (src/conversation-links.js). */
  const openOwnConversation = (id) => steward.open(id).then((r) => {
    if (r === 'nowhere') noticeTime.info(vscode, 'That conversation is not open in any VS Code window on this machine.');
  }, (e) => log.appendLine('supervisor panel: ' + ((e && e.message) || e)));
  const links = conversationLinks.create({
    on: () => !removed() && !uninstalling() && !switchedOff().includes('conversationLinks'),
    own: async () => {
      const all = await Promise.resolve(claude.source.listAllConversations()).catch(() => []);
      const here = await Promise.resolve(claude.source.listConversations()).catch(() => []);
      return [].concat(Array.isArray(all) ? all : [], Array.isArray(here) ? here : []);
    },
    send: (m) => { if (typeof globalThis.__cceToAllPanels === 'function') globalThis.__cceToAllPanels(m); },
    open: (target) => Promise.resolve(vscode.commands.executeCommand('agentPlus.openConversation', target))
      .catch((e) => log.appendLine('conversation links: ' + ((e && e.message) || e))),
    openOwn: openOwnConversation,
    log: (m) => log.appendLine(m),
  });
  context.subscriptions.push(links);
  /* The session list click handler that the patch in src/host.js calls. */
  globalThis.__cceOpenElsewhere = async (sessionId) => {
    try {
      if (removed() || !enabled() || typeof sessionId !== 'string') return false;
      const id = sessionId.toLowerCase();
      if (shownList().some((s) => s.toLowerCase() === id)) return false;
      const where = deleteSession.shownElsewhere(planDir()).get(id);
      if (!where || !where.length) return false;
      log.appendLine(`session list: ${id} is shown in ${where.map((n) => `"${n}"`).join(', ')}, so it is opened there`);
      await vscode.commands.executeCommand('agentPlus.openConversation', { sourceId: conversationLinks.OWN_SOURCE, sessionId: id });
      return true;
    } catch (e) {
      log.appendLine('session list: ' + ((e && e.message) || e));
      return false;
    }
  };
  context.subscriptions.push({ dispose: () => { delete globalThis.__cceOpenElsewhere; } });
  globalThis.__cceOpenConversationHook = (sourceId, id) => { links.open(sourceId, id).catch((e) => log.appendLine('conversation links: ' + ((e && e.message) || e))); };
  globalThis.__cceConversationsAskHook = () => { links.ask(); };
  context.subscriptions.push({ dispose: () => { delete globalThis.__cceOpenConversationHook; delete globalThis.__cceConversationsAskHook; } });
  context.subscriptions.push(claude.source.onDidChangeConversations(() => links.refresh()));
  /* A panel asks for its conversation's plan summary for the bar above its input box (src/plan-bar.js) and is sent it
     again whenever Agent Plus says it changed; a click on the bar opens Agent Plus's Work plan view, one on its red
     part the Answer view. */
  const planBar = planBars.create({
    on: () => !removed() && !uninstalling() && !switchedOff().includes('planBar'),
    sendTo: (id, m) => typeof globalThis.__cceToPanel === 'function' && globalThis.__cceToPanel(id, m) === true,
    sendAll: (m) => { if (typeof globalThis.__cceToAllPanels === 'function') globalThis.__cceToAllPanels(m); },
    run: (command, arg) => Promise.resolve(vscode.commands.executeCommand(command, arg))
      .catch((e) => log.appendLine('plan bar: ' + ((e && e.message) || e))),
    log: (m) => log.appendLine(m),
  });
  context.subscriptions.push(planBar);
  globalThis.__ccePlanAskHook = (id) => { planBar.ask(id); };
  globalThis.__ccePlanOpenHook = (id, part) => { planBar.open(id, part).catch((e) => log.appendLine('plan bar: ' + ((e && e.message) || e))); };
  context.subscriptions.push({ dispose: () => { delete globalThis.__ccePlanAskHook; delete globalThis.__ccePlanOpenHook; } });
  /* vscode://xnervwang.claude-code-plus/open?session=<id>, the link a supervisor gives for a conversation it names; a link
     the page made for another agent's conversation also says which (&source=). */
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri(uri) {
      if (uri.path !== '/open') return;
      const q = new URLSearchParams(uri.query), id = q.get('session') || '', source = q.get('source') || '';
      if (source && source !== conversationLinks.OWN_SOURCE) { links.open(source, id).catch((e) => log.appendLine('conversation links: ' + ((e && e.message) || e))); return; }
      openOwnConversation(id);
    },
  }));
  /* Tab titles and the session list are redrawn when stewards.json changes, whichever window changed it
     (src/steward-marks.js). The file is replaced by a rename, which a watch on the file itself would miss, so the
     folder is watched. The folder may not exist yet at startup; the ten-second timer below retries the watch. */
  const redrawStewards = () => {
    try { claude.stewardsChanged(); } catch (_) { /* next change */ }
    try { if (typeof globalThis.__cceRefreshTabIcons === 'function') globalThis.__cceRefreshTabIcons(); } catch (_) { /* next change */ }
    try { if (typeof globalThis.__cceSendSessionStates === 'function') globalThis.__cceSendSessionStates(); } catch (_) { /* next change */ }
    try { if (typeof globalThis.__cceSessionsChanged === 'function') globalThis.__cceSessionsChanged(); } catch (_) { /* next change */ }
  };
  /* The supervisors of conversation `key`, as Agent Plus asks for them: its lead first, marked, the observers after it
     (src/steward-leads.js). */
  const userAtOf = relay.lastUserCache();
  const stewardTitleOf = (id, table) => (table[id] && table[id].title) || steward.titleOf(id);
  const stewardsOfKey = (key) => {
    const st = stewards.state(planDir()), table = st.table, lead = stewardLeads.leadOf(table, st.leads, key);
    return stewards.stewardsOf(table, key).sort((a, b) => (b === lead) - (a === lead))
      .map((s) => Object.assign({ sessionId: s, title: stewardTitleOf(s, table) }, s === lead ? { lead: true } : {}));
  };
  /* Their titles change without the table changing, on a rename; the leads are checked here too, as a backstop to the folder watch. */
  let stewardOrder = '';
  const stewardOrderTimer = setInterval(() => {
    try {
      if (!enabled() || removed()) return;
      const table = stewardTable();
      const st = stewards.state(planDir());
      const now = JSON.stringify([Object.keys(table).sort().map((s) => [s, stewardTitleOf(s, table)]),
        Object.keys(st.leads).sort().map((k) => [k, st.leads[k].lead, st.leads[k].term])]);
      if (now !== stewardOrder) { const first = !stewardOrder; stewardOrder = now; if (!first) claude.stewardsChanged(); }
    } catch (e) { log.appendLine('supervisor order: ' + ((e && e.message) || e)); }
  }, STEWARD_ORDER_MS);
  context.subscriptions.push({ dispose: () => clearInterval(stewardOrderTimer) });
  let stewardWatch = null, stewardSettle = 0;
  /* The same watch keeps the plan directory's names current for the passes that list it (src/plan-names.js). */
  const watchStewards = () => {
    if (stewardWatch) return;
    try {
      const dir = planDir();
      stewardWatch = fs.watch(dir, { persistent: false }, (event, name) => {
        planNames.changed(dir, name);
        if (name && name !== stewards.FILE) return;
        if (stewardSettle) clearTimeout(stewardSettle);
        stewardSettle = setTimeout(() => { stewardSettle = 0; redrawStewards(); }, 300);
      });
      stewardWatch.on('error', () => { planNames.watching(''); try { stewardWatch.close(); } catch (_) { /* closed */ } stewardWatch = null; });
      planNames.watching(dir);
    } catch (_) { stewardWatch = null; }
  };
  watchStewards();
  context.subscriptions.push({ dispose: () => {
    if (stewardSettle) clearTimeout(stewardSettle);
    if (stewardWatch) { planNames.watching(''); try { stewardWatch.close(); } catch (_) { /* closed */ } }
  } });

  globalThis.__cceAnswerHook = (key, sent, reason, detail) => {
    if (key !== ANSWERS_READY) { claude.answered(key, sent, reason, detail); return; }
    if (answersReady.size > 500) answersReady.clear();
    if (confirming.size > 500) confirming.clear();
    if (typeof detail !== 'string' || !detail) return;
    answersReady.add(detail);
    if (reason === 'confirms') confirming.add(detail); else confirming.delete(detail);
  };
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceAnswerHook) delete globalThis.__cceAnswerHook; } });
  /*
   * Claude Code's own notices of a permission request, a question, a plan to review and auto mode's choice are left to
   * Agent Plus while Agent Plus shows notices of the same waits (src/waiting-for.js). The patched host puts the answer
   * into each panel's HTML as it is built, and the panels already open are told whenever it changes.
   */
  let agentCore = null, waitsLeft = false;
  /* Claude Code's own Ctrl+Shift+T is left to the session list's while the list archives and deletes on its own in this
     window (the host edit "reopen shortcut left to the session list"). Decided again with the waits below. */
  let listManages = false;
  globalThis.__cceListReopens = () => listManages;
  const decideReopen = () => {
    let next = false;
    try { next = !removed() && !!agentCore && typeof agentCore.sessionListManages === 'function' && agentCore.sessionListManages() === true; } catch (_) { next = false; }
    if (next === listManages) return;
    listManages = next;
    log.appendLine(next ? 'Ctrl+Shift+T is left to the session list' : 'Ctrl+Shift+T reopens Claude Code\'s own closed tabs');
    try { if (typeof globalThis.__cceLastClosedAgain === 'function') globalThis.__cceLastClosedAgain(); } catch (_) { /* the next close works it out */ }
  };
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceListReopens) delete globalThis.__cceListReopens; } });
  const decideWaits = () => {
    const next = waitingFor.leftToAgentPlus({ core: agentCore, on: enabled() && !removed(), announcesWaits: coreLink.announcesWaits });
    globalThis[host.WAITS_LEFT_ON] = next;
    if (next === waitsLeft) return;
    waitsLeft = next;
    log.appendLine(next ? 'Claude Code\'s notices of waits are left to Agent Plus' : 'Claude Code shows its own notices of waits');
    try { if (typeof globalThis.__cceToAllPanels === 'function') globalThis.__cceToAllPanels({ type: 'cce_waits_announced', on: next }); } catch (_) { /* the next change */ }
  };
  /* Asked again when a setting changes (the settings listener below), on each half-minute tick, which also sees the
     extension removed, and when the workspace is trusted. */
  if (typeof vscode.workspace.onDidGrantWorkspaceTrust === 'function') context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(decideWaits));
  context.subscriptions.push({ dispose: () => { delete globalThis[host.WAITS_LEFT_ON]; } });
  coreLink.link(vscode, claude.source, { name: 'the Claude Code source', log: (m) => log.appendLine(m) }).then((r) => {
    if (!r.registered) { links.attach(null); planBar.attach(null); steward.attachCore(null); return; }
    const { registration } = r;
    log.appendLine(`registered with Agent Plus ${r.core.version || ''}`.trim());
    if (closing) { registration.dispose(); return; }
    context.subscriptions.push(registration);
    context.subscriptions.push({ dispose: () => { agentCore = null; decideWaits(); decideReopen(); steward.attachCore(null); } });
    agentCore = r.core;
    decideWaits();
    decideReopen();
    claude.refocus();
    links.attach(r.core);
    planBar.attach(r.core);
    steward.attachCore(r.core);
  }).catch((e) => log.appendLine('registering with Agent Plus: ' + ((e && e.message) || e)));
  /*
   * Following the conversation has to be immediate, so the patched field calls this the moment it is written. Waiting
   * for the periodic scan meant up to half a minute of showing the conversation you just left, which is not "follows
   * the conversation" - it is the same complaint with a delay.
   *
   * The fast tick beside it reads one property and nothing else. It is there because the callback depends on the host
   * patch being in, and a build whose shape did not match would otherwise leave the work plan view frozen with no sign
   * why.
   */
  /*
   * The transcripts of the conversation in front of the reader are watched, so a reply's effort is read within a second
   * of the reply being written rather than at the next thirty-second refresh - which is when the reader is looking at
   * it. A turn appends a row per block in a burst, so a change is scanned after a short pause and one pass reads the
   * burst. Nothing runs while nothing is written. The refresh still scans, and re-establishes a watch that has failed
   * or a sub-agents folder that did not exist yet.
   */
  const EFFORT_SETTLE_MS = 700;
  let effortWatch = { id: '', main: null, sub: null, timer: 0, subs: false };
  const unwatchEffort = () => {
    for (const w of [effortWatch.main, effortWatch.sub]) { if (w) { try { w.close(); } catch (_) { /* closed */ } } }
    if (effortWatch.timer) clearTimeout(effortWatch.timer);
    effortWatch = { id: '', main: null, sub: null, timer: 0, subs: false };
  };
  const watchEffort = () => {
    const id = activeChat();
    if (id !== effortWatch.id) unwatchEffort();
    if (!id || removed() || !enabled() || replaced() || switchedOff().includes('modelName')) { unwatchEffort(); return; }
    const transcript = transcriptOf(id);
    if (!transcript) return;
    effortWatch.id = id;
    /* Only the side that changed is read: the sub-agents are looked at when their folder changed, not on every row the
       conversation itself appends. */
    const soon = (slot) => () => {
      if (slot === 'sub') effortWatch.subs = true;
      if (effortWatch.timer) return;
      effortWatch.timer = setTimeout(() => {
        const subs = effortWatch.subs;
        effortWatch.timer = 0;
        effortWatch.subs = false;
        scanEffort({ subagents: subs });
      }, EFFORT_SETTLE_MS);
    };
    const open = (target, slot) => {
      if (effortWatch[slot]) return;
      try {
        const w = fs.watch(target, { persistent: false }, soon(slot));
        w.on('error', () => { try { w.close(); } catch (_) { /* closed */ } if (effortWatch[slot] === w) effortWatch[slot] = null; });
        effortWatch[slot] = w;
      } catch (_) { /* not there yet: the refresh tries again */ }
    };
    open(transcript, 'main');
    open(path.join(transcript.replace(/\.jsonl$/, ''), 'subagents'), 'sub');
  };
  context.subscriptions.push({ dispose: unwatchEffort });
  /* The background and effort scans are for Claude Code's own panel, so they follow activeSessionId even while the work
     plan view in Agent Plus shows another source's conversation. */
  const followChat = () => {
    if (!claude.followChat()) return;
    scanBackground();
    scanEffort();
    watchEffort();
    if (steward) steward.refresh();
  };
  let chatPoll = 0;
  const stopPolling = () => { if (chatPoll) { clearInterval(chatPoll); chatPoll = 0; } };
  globalThis.__cceChatHook = () => {
    // Being called at all proves the patch is in, so the fallback below has nothing left to do.
    stopPolling();
    try { followChat(); } catch (e) { /* never break the host's own setter */ }
  };
  /* The fallback, for a Claude Code build whose shape the patch could not match: without it the view would sit on one
     conversation with nothing saying why. A tick reads one property and compares a string - no files, no scanning - and
     it stops for good the first time the callback arrives. */
  chatPoll = setInterval(followChat, 1000);
  context.subscriptions.push({
    dispose: () => { stopPolling(); if (globalThis.__cceChatHook) delete globalThis.__cceChatHook; },
  });
  /* A Claude Code panel's page got focus (src/page/92-focus.js). */
  globalThis.__cceFocusHook = (sessionId) => {
    try { claude.pageFocus(sessionId); } catch (e) { log.appendLine('page focus: ' + (e && e.message)); }
    // A Claude Code panel in the sidebar has no tab, so its focus is the only sign it is in front again.
    if (typeof sessionId === 'string' && sessionId) setOther(null);
  };
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceFocusHook) delete globalThis.__cceFocusHook; } });
  /* For the window test only, which sets this variable: what the Claude source counts as in front (focusState). */
  if (process.env.CLAUDE_CODE_PLUS_UI_CONTROL) {
    globalThis.__cceFocusState = () => Object.assign(claude.focusState(), { unread: [...unreadKeys] });
    context.subscriptions.push({ dispose: () => { delete globalThis.__cceFocusState; } });
  }
  /* A panel reports its time zone as it opens, which is usually after this has activated. */
  globalThis.__cceTzHook = () => {
    try { writeClientZone(); } catch (e) { /* never break the host's own message handling */ }
  };
  /* A panel can report before this activates, and then only the global above holds its zone. */
  writeClientZone();
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceTzHook) delete globalThis.__cceTzHook; } });
  /* The patched host asks for each tab's icon here (src/tabdot.js). VS Code sends an icon to the editor only when the
     object changes, so each file keeps one Uri. */
  /*
   * Claude Code shows a conversation as running while its own background commands run. Checked every ten seconds.
   */
  let bgWorking = new Set();
  const SLOW_SCAN_MS = 5000;
  let bgReading = false;
  /* Stops the processes src/duplicates.js allows to be stopped without asking. All windows do this from the same data;
     stop() skips a process that another window has already stopped. */
  /* Read before the stop: the work ends with the process (src/stoppedwork.js). */
  function stopProcess(id, p, how) {
    let work = [];
    try { if (endNoticesOn()) work = stoppedWork.lost({ session: id, p, dir: planDir() }); } catch (_) { /* stopped without the notice */ }
    if (!duplicates.stop(id, p, how, { dir: planDir() })) return false;
    if (work.length && stoppedWork.record({ dir: planDir(), session: id, p, work })) {
      log.appendLine(`background work that stopped with process ${p.pid} of conversation ${id}: ${work.map((w) => w.id).join(', ')}`);
    }
    return true;
  }
  const readDuplicates = () => {
    try {
      dupGroups = removed() || !enabled() ? new Map() : duplicates.find({ records: background.liveRecords(), dir: planDir() });
      if (!replaced() && !uninstalling() && !removed()) {
        for (const [id, group] of dupGroups) {
          for (const p of duplicates.autoStops(group)) {
            if (stopProcess(id, p, 'auto')) log.appendLine(`stopped process ${p.pid} of conversation ${id}: its window is gone and it was idle`);
          }
        }
      }
    } catch (e) { log.appendLine('conversations run twice: ' + ((e && e.message) || e)); }
  };
  /* The supervisor hook (hooks/steward.py) cannot ask the editor, so the set is written to a file for it. Every window
     finds the same set, so a window writes the file only when it holds a different set or its writer has exited. */
  const WORKING_FILE = 'working.json';
  const shareWorking = (set) => {
    const file = path.join(planDir(), WORKING_FILE), ids = [...set].sort();
    let d = null;
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* none yet, or caught mid-write */ }
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } };
    if (d && Number.isInteger(d.pid) && alive(d.pid) && Array.isArray(d.sessions)
        && JSON.stringify(d.sessions) === JSON.stringify(ids)) return;
    try { writeAtomic(file, JSON.stringify({ at: Date.now(), pid: process.pid, sessions: ids }) + '\n'); }
    catch (_) { /* the next scan */ }
  };
  /* The notice that a detached command has stopped (src/detachedends.js) adds to the agent's context, so the token mode
     decides whether it is sent. */
  const DETACHED_NOTICES = PREFIX + 'detachedEndNotices';
  const endNoticesOn = () => !!runs(DETACHED_NOTICES);
  /* A `claude -p` worker is left out: it would take the notice for its next task. So is a process in `avoid`. */
  const inboxOf = (id, avoid = []) => {
    const rec = background.liveRecords().find((r) => r && r.sessionId === id && typeof r.messagingSocketPath === 'string'
      && !/^sdk-/.test(r.entrypoint || '') && !avoid.includes(r.pid));
    return rec ? rec.messagingSocketPath : null;
  };
  /* The cached search can miss a transcript written since, so the project folder for the process's working directory
     is checked too. */
  const transcriptNow = (id) => {
    const found = transcriptOf(id);
    if (found) return found;
    const rec = background.liveRecords().find((r) => r && r.sessionId === id && typeof r.cwd === 'string');
    const folder = rec ? bgSessions.folderName(rec.cwd) : '';
    const file = folder ? path.join(projectsDir(), folder, id + '.jsonl') : '';
    return file && fs.existsSync(file) ? file : '';
  };
  let detachedListed = '', delivering = false;
  const noteDetached = () => {
    const jobs = background.jobsNow();
    const on = endNoticesOn();
    if (Array.isArray(jobs)) {
      const off = switchedOff();
      const listed = JSON.stringify([off.includes('detachedCommands') ? null : jobs, off.includes('backgroundSessions') ? null : background.workersNow()]);
      if (listed !== detachedListed) { detachedListed = listed; writeLiveNow(); }
      try { detachedEnds.update({ dir: planDir(), jobs, claim: on, ran: (id, command, at) => detachedEnds.ranBy(transcriptNow(id), command, at) }); } catch (e) { log.appendLine('detached commands: ' + ((e && e.message) || e)); }
    }
    try { bgEnds.update({ dir: planDir(), records: background.liveRecords(), claim: on }); }
    catch (e) { log.appendLine('background sessions: ' + ((e && e.message) || e)); }
    if (!on || delivering) return;
    delivering = true;
    const dir = planDir(), post = (address, text) => stewards.post(address, text);
    (async () => {
      for (const n of await detachedEnds.deliver({ dir, inbox: inboxOf, post })) {
        log.appendLine(`told ${n.session} that ${n.ends.length === 1 ? 'a detached command has' : n.ends.length + ' detached commands have'}`
          + ` stopped: ${n.ends.map((e) => 'pid ' + e.pid).join(', ')}`);
      }
      for (const n of await detachedEnds.deliver({ dir, inbox: inboxOf, post, sub: bgEnds.ENDS_DIR, text: bgEnds.noticeText })) {
        log.appendLine(`told ${n.session} about its background sessions: ${n.ends.map((e) => `${e.job} ${e.kind}`).join(', ')}`);
      }
      for (const n of await detachedEnds.deliver({ dir, inbox: (id, ends) => inboxOf(id, ends.map((e) => e.pid)), post,
        sub: stoppedWork.STOPPED_WORK_DIR, text: stoppedWork.noticeText })) {
        log.appendLine(`told ${n.session} what stopped with its other process: ${n.ends.map((e) => (e.work || []).map((w) => w.id).join(', ')).join('; ')}`);
      }
    })()
      .catch((e) => log.appendLine('notices of ended work: ' + ((e && e.message) || e)))
      .finally(() => { delivering = false; });
  };
  /* Each change of the set is logged, and a scan that takes long, so that a dot missing from a tab can be put down
     either to the scan or to the drawing. */
  const readBgWorking = async () => {
    if (bgReading) return;
    bgReading = true;
    const began = Date.now();
    let next;
    try {
      next = removed() || !enabled() ? new Set() : await background.workingNow({ write: keepsWork() });
      readDuplicates();
    } finally { bgReading = false; }
    if (Date.now() - began > SLOW_SCAN_MS) log.appendLine(`work running: a scan took ${Math.round((Date.now() - began) / 1000)} s`);
    if (keepsWork()) shareWorking(next);
    if (keepsWork()) noteDetached();
    if (next.size === bgWorking.size && [...next].every((id) => bgWorking.has(id))) return;
    log.appendLine('work running: ' + ([...next].map((id) => id.slice(0, 8)).join(', ') || 'none'));
    bgWorking = next;
    try { if (typeof globalThis.__cceRefreshTabIcons === 'function') globalThis.__cceRefreshTabIcons(); } catch (_) { /* next change */ }
    try { if (typeof globalThis.__cceSendSessionStates === 'function') globalThis.__cceSendSessionStates(); } catch (_) { /* next change */ }
  };
  globalThis.__cceWithBackground = (infos) => (Array.isArray(infos) && bgWorking.size
    ? infos.map((i) => (i && i.state === 'idle' && bgWorking.has(i.sessionId) ? Object.assign({}, i, { state: 'running' }) : i))
    : infos);
  /*
   * Each conversation's dot (src/activity.js). A conversation this window does not show is judged by `claude agents`,
   * as fresh as the last time something asked for it (src/claude-source.js), and not at all once that is older than
   * AGENTS_TRUST_MS: the session list then falls back to Claude Code's own word for it.
   */
  const AGENTS_TRUST_MS = 60000;
  let agentsMerged = { at: -1, map: new Map() };
  const agentOf = (id) => {
    const a = claude.agentsNow();
    if (!a.records || Date.now() - a.at > AGENTS_TRUST_MS) return null;
    if (agentsMerged.at !== a.at) agentsMerged = { at: a.at, map: waiting.merge(a.records) };
    return agentsMerged.map.get(id) || null;
  };
  /*
   * The host's states, and for a conversation whose panel in this window went away, the last state that panel had,
   * while `claude agents` can still list its process and for at most AGENTS_TRUST_MS (src/gone-states.js). The list
   * held until then can also be one the windows share for up to 20 s (src/waiting.js), read while the panel still
   * showed a wait the user has since answered.
   */
  const hostStates = () => gone.over(liveStates);
  const activityFor = (id, host = hostStates().get(id) || '') =>
    activity.activityOf({ host, turn: turns.get(id), bg: bgWorking.has(id), agent: agentOf(id) });
  /* For the window test only: what a conversation's activity here is made of. */
  if (process.env.CLAUDE_CODE_PLUS_UI_CONTROL) {
    globalThis.__cceActivityParts = (id) => {
      const a = claude.agentsNow(), agent = agentOf(id);
      return { activity: activityFor(id), live: liveStates.get(id) || '', host: hostStates().get(id) || '', turn: turns.get(id),
        bg: bgWorking.has(id), agent: agent && { busy: agent.busy, waitingFor: agent.waitingFor }, listAge: a.at > 0 ? Date.now() - a.at : null };
    };
    context.subscriptions.push({ dispose: () => { delete globalThis.__cceActivityParts; } });
  }
  const lastUser = activity.lastUserReader();
  /* Kept while the plan, and the time of the user's last message, stay the same. */
  const questionSeen = new Map();
  const freshQuestionOf = (id) => {
    if (!runs(WORK_PLAN_SETTING) || typeof id !== 'string' || !id) return false;
    let st;
    try { st = fs.statSync(path.join(planDir(), id + '.json')); } catch (_) { questionSeen.delete(id); return false; }
    const since = lastUser.at(transcriptOf(id));
    const key = st.mtimeMs + ':' + st.size + ':' + since, hit = questionSeen.get(id);
    if (hit && hit.key === key) return hit.on;
    const plan = readPlan(id);
    const on = activity.freshQuestion(plan && plan.nodes, since);
    if (questionSeen.size > 1000) questionSeen.clear();
    questionSeen.set(id, { key, on });
    return on;
  };
  const dotFor = (id, host) => {
    const act = activityFor(id, host);
    return activity.dotOf(act, act !== 'working' && act !== 'waiting' && freshQuestionOf(id));
  };
  /* The dots of the conversations with one, by session id, as the session list's rows draw them. */
  const marksNow = () => {
    const ids = new Set([...hostStates().keys(), ...bgWorking]);
    const a = claude.agentsNow();
    if (a.records && Date.now() - a.at <= AGENTS_TRUST_MS) for (const r of a.records) if (r && typeof r.sessionId === 'string') ids.add(r.sessionId);
    const out = {};
    for (const id of [...ids].sort()) { const dot = dotFor(id); if (dot) out[id] = dot; }
    return out;
  };
  /* Each change of the dots is logged, like the set of work running, so that a wrong dot can be put down either to what
     was worked out here or to the drawing. */
  /* A name typed into a rename box, or prefilled in one, without this extension's marks (src/host.js). */
  globalThis.__cceCleanTitle = (title) => (typeof title === 'string' ? titleMarks.withoutMarks(title) : title);
  let marksSent = '', marksLogged = '';
  globalThis.__cceActivityMap = () => {
    try {
      if (!enabled() || removed()) return undefined;
      const m = marksNow();
      marksSent = JSON.stringify(m);
      if (marksSent !== marksLogged) {
        marksLogged = marksSent;
        log.appendLine('dots: ' + (Object.entries(m).map(([id, dot]) => `${id.slice(0, 8)} ${dot}`).join(', ') || 'none'));
      }
      return m;
    } catch (_) { return undefined; }
  };
  /* Sends the dots again when one has changed without the host sending its states: a plan question, `claude agents`. */
  const refreshMarks = () => {
    try {
      if (!enabled() || removed()) return;
      if (JSON.stringify(marksNow()) !== marksSent && typeof globalThis.__cceSendSessionStates === 'function') globalThis.__cceSendSessionStates();
      if (typeof globalThis.__cceRefreshTabIcons === 'function') globalThis.__cceRefreshTabIcons();
    } catch (e) { log.appendLine('conversation dots: ' + ((e && e.message) || e)); }
  };
  const bgTimer = setInterval(() => {
    watchStewards();
    readBgWorking().catch((e) => log.appendLine('work running after a turn: ' + (e && e.message))).finally(refreshMarks);
  }, 10000);
  context.subscriptions.push({ dispose: () => {
    clearInterval(bgTimer);
    if (globalThis.__cceWithBackground) delete globalThis.__cceWithBackground;
    if (globalThis.__cceActivityMap) delete globalThis.__cceActivityMap;
    if (globalThis.__cceCleanTitle) delete globalThis.__cceCleanTitle;
  } });
  const tabIcons = new Map(), tabIconUris = new Map();
  const stewardTable = stewardMarks.tableReader(planDir()), stewardTabs = new WeakMap();
  /* `unread`: whether the conversation has a reply not read yet, which the host works out (src/host.js). */
  globalThis.__cceTabIcon = (panel, state, run, home, sessionId, unread) => {
    try {
      claude.track(panel, sessionId);
      const title = tabdot.withoutMark(panel.title);
      if (panel.title !== title) panel.title = title;
      if (typeof sessionId === 'string' && sessionId) {
        const on = enabled() && !removed();
        const t = on ? stewardTable()[sessionId.toLowerCase()] : null, unseen = on && unread === true;
        const named = t || unseen || stewardMarks.withoutMarks(panel.title) !== panel.title ? readTitles.titles({ sessionId }) || {} : {};
        const next = stewardMarks.tabTitle(panel.title, stewardTabs.get(panel) || null, named.custom, t ? stewardMarks.size(t) : 0,
          named.custom || named.ai, unseen, envelope.envelope(vscode));
        if (next.kept) stewardTabs.set(panel, next.kept); else stewardTabs.delete(panel);
        if (panel.title !== next.title) panel.title = next.title;
      }
      if (!enabled() || removed() || typeof home !== 'string') return undefined;
      const host = state === 'pending' || run === 'waiting_input' ? 'waiting'
        : run === 'running' || bgWorking.has(sessionId) ? 'running' : 'idle';
      const icons = tabdot.iconsFor(path.join(home, 'resources'), path.join(context.globalStorageUri.fsPath, 'tab-icons'),
        tabIcons);
      const file = icons && icons[(typeof sessionId === 'string' && sessionId ? dotFor(sessionId, host) : '') || 'stopped'];
      if (!file) return undefined;
      if (!tabIconUris.has(file)) tabIconUris.set(file, vscode.Uri.file(file));
      return tabIconUris.get(file);
    } catch (e) { return undefined; /* the host sets its own icon */ }
  };
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceTabIcon) delete globalThis.__cceTabIcon; } });
  /* The envelope after a tab's title takes its form from the theme (src/envelope.js); the session list's follows the page's own theme class. */
  context.subscriptions.push(envelope.onEnvelopeChange(vscode, () => {
    try { if (typeof globalThis.__cceRefreshTabIcons === 'function') globalThis.__cceRefreshTabIcons(); } catch (_) { /* next change */ }
  }));
  /* Panels the editor restored before this extension started reported their icons and states before anything listened. */
  try { if (typeof globalThis.__cceRefreshTabIcons === 'function') globalThis.__cceRefreshTabIcons(); } catch (_) { /* next change */ }
  try { if (typeof globalThis.__cceSendSessionStates === 'function') globalThis.__cceSendSessionStates(); } catch (_) { /* next change */ }
  /*
   * Conversations pinned in the session list, kept from Claude Code's transcript cleanup (src/sessionpins.js). The
   * margin it keeps is days, so once every half hour is far more often than it needs; a pin gets a pass of its own a
   * few seconds later, so an old conversation pinned close to its age is not left waiting for the next one.
   */
  let keeping = false;
  /* While Agent Plus has the session list, it says when it will delete each conversation. One it keeps longer than
     Claude Code's cleanup would is moved like a pinned one, so that Claude Code never deletes one the list still shows. */
  const listKeeps = (days) => {
    if (removed() || !agentCore || typeof agentCore.sessionDeletionDue !== 'function') return null;
    let due = null;
    try { if (Array.isArray(agentCore.features) && agentCore.features.includes('sessionList')) due = agentCore.sessionDeletionDue(claude.source.id); } catch (_) { due = null; }
    return claudeSessionList.keepsFor(due, { soonMs: sessionPins.marginDays(days, pinMargin()) * sessionPins.DAY });
  };
  const keepPinned = async () => {
    if (keeping) return;
    const days = sessionPins.retentionDays(), keeps = listKeeps(days);
    if (!pinsOn() && !keeps) return;
    keeping = true;
    try {
      const file = pinsFile();
      const now = pinsOn() ? sessionPins.read(file) : { pinned: [], times: {} };
      const r = await sessionPins.keep({ ids: new Set(now.pinned), times: now.times, days, margin: pinMargin(), keeps });
      const changed = pinsOn() && sessionPins.applyPass(file, r);
      if (r.touched || r.errors || r.gone.length) {
        log.appendLine(`pinned conversations: ${r.found} of ${r.pinned} found, ${r.touched} file(s) given a later `
          + `modification time to stay ahead of the transcript cleanup (${r.kept} for the session list), ${r.gone.length} no longer on disk, ${r.errors} error(s)`);
      }
      if (changed) writeLiveNow();
    } catch (e) {
      log.appendLine('pinned conversations: ' + ((e && e.message) || e));
    } finally { keeping = false; }
  };
  let keepSoon = 0;
  /* Read by the patched host each time it builds the session list (src/bgsessions.js). */
  /* Logs, with the time, the first eight lists a window builds and any later one that takes this extension 200 ms or
     more, to set against when Claude Code's log shows the panel asking for the list. */
  let listsLogged = 0;
  const showBackground = () => cfg().get(HIDE_BG_SETTING, true) === false;
  const officialSessionList = officialList.create({
    execute: (...args) => vscode.commands.executeCommand(...args),
    hidden: () => !removed() && !uninstalling() && enabled() && cfg().get(HIDE_OFFICIAL_LIST_SETTING, false) === true,
    log: (m) => log.appendLine(m),
  });
  officialSessionList.apply();
  context.subscriptions.push({ dispose: () => { officialSessionList.dispose(); } });
  /* Read by the patched host each time it lists sessions: with background sessions shown, Claude Code's listing keeps
     its `claude -p` sessions as well (src/host.js). */
  globalThis.__cceListProgrammatic = () => !removed() && showBackground();
  globalThis.__cceListedSessions = (entries, cwd) => {
    if (removed()) return entries;
    const t0 = Date.now();
    const listed = showBackground() ? bgSessions.withoutDaemons(entries, cwd) : bgSessions.withoutBackground(entries, cwd);
    const out = enabled() ? stewardMarks.cleaned(listed) : listed;
    const ms = Date.now() - t0;
    if (listsLogged < 8 || ms >= 200) {
      listsLogged++;
      log.appendLine(`${new Date().toISOString().slice(11, 23)} session list built: ${Array.isArray(entries) ? entries.length : '?'} sessions, `
        + `${Array.isArray(out) ? out.length : '?'} shown, ${ms} ms in this extension`);
    }
    return out;
  };
  const keepFirst = setTimeout(keepPinned, 60000);
  const keepTimer = setInterval(keepPinned, 30 * 60000);
  context.subscriptions.push({ dispose: () => {
    clearTimeout(keepFirst); clearInterval(keepTimer); if (keepSoon) clearTimeout(keepSoon);
    if (globalThis.__cceListedSessions) delete globalThis.__cceListedSessions;
    if (globalThis.__cceListProgrammatic) delete globalThis.__cceListProgrammatic;
  } });
  /*
   * Claude Code tabs VS Code did not bring back (src/droppedtabs.js), looked for after Claude Code has started: by then
   * VS Code has put back the tabs it kept and Claude Code has matched them to their conversations. They open where Claude
   * Code opens a tab, and the tab that was in front is put back in front.
   *
   * A conversation still running in another window is not opened a second time. After a reload that window is often the
   * same window before it lost its connection: the dev desktop keeps its extension host, and the conversations running
   * in it, for five minutes once a new window connects, and then ends them. So such a tab is looked at again for a while,
   * and opened once its conversation is running nowhere.
   */
  const FOCUS_GROUP = loadTabs.FOCUS_GROUP;
  const DROPPED_WAIT_MS = 10 * 60000, DROPPED_RECHECK_MS = 15000;
  const isClaudeTab = (t) => t.input instanceof vscode.TabInputWebview && String(t.input.viewType).includes('claudeVSCodePanel');
  const claudeLabels = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs.filter(isClaudeTab).map((t) => t.label));
  const stripMark = (t) => tabdot.withoutMark(stewardMarks.withoutMarks(t));
  /* A reopened tab's conversation stays on this window's list of tabs to reopen until its page answers. If the page
     has not answered within REOPEN_ANSWER_MS, as happens in a window that does not draw its pages, the tab is closed:
     after a restart Claude Code would bring it back as an empty new conversation. */
  const PENDING_KEY = 'droppedTabsPending', REOPEN_ANSWER_MS = 60000, REOPEN_LOOK_MS = 1000;
  const keepPending = (change) => context.workspaceState.update(PENDING_KEY, droppedTabs.keepPending(context.workspaceState.get(PENDING_KEY), change))
    .then(undefined, (e) => log.appendLine(`keeping the Claude Code tabs still to reopen: ${e && e.message}`));
  const answeredIn = (t, tab, answerMs = REOPEN_ANSWER_MS) => new Promise((resolve) => {
    const until = Date.now() + answerMs;
    const look = () => {
      if (answersReady.has(t.sessionId)) { resolve(true); return; }
      if (Date.now() < until) { setTimeout(look, REOPEN_LOOK_MS); return; }
      const still = tab && vscode.window.tabGroups.all.some((g) => g.tabs.includes(tab));
      /* A page that runs names the tab after its conversation, shortened to the title's first characters, even when this
         extension could not patch it to answer. */
      const named = still && (() => { const l = stripMark(tab.label).replace(/…$/, ''); return !!l && l !== 'Claude Code' && String(t.title).startsWith(l); })();
      if (still && !named) {
        Promise.resolve(vscode.window.tabGroups.close(tab)).catch(() => {});
        log.appendLine(`Closed the tab reopened for "${t.title}" (${t.sessionId}): its page did not load within ${answerMs / 1000} s; it is reopened once this window is in front`);
      }
      resolve(false);
    };
    look();
  });
  /* Conversations whose reopened tab has not answered yet: they are neither reopened again nor taken off the list. */
  const awaiting = new Set();
  const reopenTabs = async (list, why, answerMs = REOPEN_ANSWER_MS) => {
    const group = vscode.window.tabGroups.activeTabGroup, front = group && group.activeTab;
    const at = front ? group.tabs.indexOf(front) : -1, column = group && group.viewColumn;
    let reopened = 0;
    await keepPending({ add: list });
    const checks = [];
    for (const t of list) {
      try {
        await vscode.commands.executeCommand('claude-vscode.editor.open', t.sessionId, undefined, undefined, undefined, t.fullEditor,
          { programmatic: 'pin-to-panel' });
        const g = vscode.window.tabGroups.activeTabGroup, tab = g && g.activeTab && isClaudeTab(g.activeTab) ? g.activeTab : null;
        awaiting.add(t.sessionId);
        checks.push(answeredIn(t, tab, answerMs).then((ok) => { awaiting.delete(t.sessionId); return ok ? t.sessionId : ''; }));
        reopened++;
      } catch (e) { log.appendLine(`reopening "${t.title}" (${t.sessionId}): ${e && e.message}`); }
    }
    const settled = Promise.all(checks).then((ids) => keepPending({ done: ids.filter(Boolean) })).catch(() => {});
    log.appendLine(`Reopened ${reopened} Claude Code tab(s) VS Code did not restore${why}: ${list.map((t) => `"${t.title}" (${t.sessionId})`).join(', ')}`);
    if (reopened) vscode.window.setStatusBarMessage(`Reopened ${reopened} Claude Code tab${reopened === 1 ? '' : 's'} VS Code did not restore`, 10000);
    if (at >= 0 && FOCUS_GROUP[column - 1]) {
      try {
        await vscode.commands.executeCommand(FOCUS_GROUP[column - 1]);
        await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', at);
      } catch (_) { /* the reopened tab stays in front */ }
    }
    return settled;
  };
  const sessionsElsewhere = () => { try { return typeof globalThis.__cceSessionsElsewhere === 'function' ? globalThis.__cceSessionsElsewhere() : []; } catch (_) { return []; } };
  const sessionsShown = () => { try { return typeof globalThis.__cceSessionsShown === 'function' ? globalThis.__cceSessionsShown() : []; } catch (_) { return []; } };
  /* Reopens the kept conversations that no window shows; those shown somewhere by now are taken off the list. */
  const reopenKept = (why, answerMs) => {
    const kept = droppedTabs.pendingOf(context.workspaceState.get(PENDING_KEY)).filter((k) => !awaiting.has(k.sessionId));
    if (!kept.length) return Promise.resolve();
    let again = [];
    try { again = droppedTabs.find({ record: kept, shown: [...sessionsShown(), ...sessionsElsewhere()], labels: claudeLabels(), strip: stripMark }); } catch (_) { again = []; }
    const gone = kept.filter((k) => !again.some((a) => a.sessionId === k.sessionId)).map((k) => k.sessionId);
    const dropped = gone.length ? keepPending({ done: gone }) : Promise.resolve();
    return dropped.then(() => (again.length ? reopenTabs(again, why, answerMs) : undefined));
  };
  /* Hooks for the window test. __cceReopenDropped(list, answerMs) reopens `list`, or the kept conversations when there
     is no list, and resolves when each tab has answered or been closed. __cceReopenOnFocus = false stops the reopening
     when the window comes to the front. */
  globalThis.__cceReopenDropped = (list, answerMs = REOPEN_ANSWER_MS) => (Array.isArray(list) ? reopenTabs(list, '', answerMs) : reopenKept('', answerMs));
  globalThis.__cceDroppedKept = () => droppedTabs.pendingOf(context.workspaceState.get(PENDING_KEY));
  let droppedTries = 0, droppedTimer = setTimeout(function lookForDropped() {
    droppedTimer = undefined;
    const atStart = globalThis.__cceTabsAtStart, shown = globalThis.__cceSessionsShown;
    if (!Array.isArray(atStart) || typeof shown !== 'function') {
      if (++droppedTries < 45) droppedTimer = setTimeout(lookForDropped, 2000);
      return;
    }
    if (!enabled() || removed() || cfg().get(REOPEN_SETTING, true) === false) return;
    const elsewhere = () => { try { return typeof globalThis.__cceSessionsElsewhere === 'function' ? globalThis.__cceSessionsElsewhere() : []; } catch (_) { return []; } };
    let lost, waiting;
    /* A kept conversation whose tab came back by itself, as one titled for its conversation does, is off the list:
       closing that tab later must not have the window reopen it. */
    try {
      const here = new Set(shown());
      const back = droppedTabs.pendingOf(context.workspaceState.get(PENDING_KEY)).filter((k) => here.has(k.sessionId)).map((k) => k.sessionId);
      if (back.length) keepPending({ done: back }).catch(() => {});
    } catch (_) { /* kept until the window is next in front */ }
    try {
      const record = droppedTabs.withPending(atStart, droppedTabs.pendingOf(context.workspaceState.get(PENDING_KEY)));
      ({ now: lost, later: waiting } = droppedTabs.split({ record, shown: shown(), elsewhere: elsewhere(), labels: claudeLabels(), strip: stripMark }));
    } catch (e) { log.appendLine('looking for Claude Code tabs VS Code did not restore: ' + (e && e.message)); return; }
    if (lost.length) reopenTabs(lost, '').catch(() => {});
    /* Coming to the front, the window reopens the conversations whose tab it closed. */
    let retried = 0;
    if (typeof vscode.window.onDidChangeWindowState === 'function') context.subscriptions.push(vscode.window.onDidChangeWindowState((s) => {
      if (!s.focused || Date.now() - retried < REOPEN_ANSWER_MS || globalThis.__cceReopenOnFocus === false) return;
      retried = Date.now();
      reopenKept(' now that this window is in front').catch(() => {});
    }));
    if (!waiting.length) return;
    log.appendLine(`Waiting to reopen ${waiting.length} Claude Code tab(s) VS Code did not restore, whose conversation is still running in `
      + `another window: ${waiting.map((t) => `"${t.title}" (${t.sessionId})`).join(', ')}`);
    const until = Date.now() + DROPPED_WAIT_MS;
    droppedTimer = setTimeout(function recheck() {
      droppedTimer = undefined;
      let ready = [];
      try {
        ({ ready, waiting } = droppedTabs.settle({ waiting, shown: shown(), elsewhere: elsewhere(), labels: claudeLabels(), strip: stripMark }));
      } catch (_) { waiting = []; }
      if (ready.length) reopenTabs(ready, ' once its conversation stopped running elsewhere').catch(() => {});
      if (waiting.length && Date.now() < until) droppedTimer = setTimeout(recheck, DROPPED_RECHECK_MS);
      else if (waiting.length) log.appendLine(`Not reopened, still running in another window: ${waiting.map((t) => `"${t.title}"`).join(', ')}`);
    }, DROPPED_RECHECK_MS);
  }, 5000);
  /* claudeCodePlus.loadRestoredTabs (src/load-tabs.js): run once per window start, a few seconds after the check for
     dropped tabs above. The unread marks the host clears while a tab is in front are set again afterwards
     (src/load-marks.js). */
  const hostMarks = () => {
    if (!['__cceSendSessionStates', '__cceShownVisibly', '__cceSetUnread'].every((n) => typeof globalThis[n] === 'function')) return null;
    globalThis.__cceSendSessionStates();
    return [...unreadKeys];
  };
  const onScreen = (k) => { try { return globalThis.__cceShownVisibly(k) === true; } catch (_) { return true; } };
  const markAgain = (k) => { try { globalThis.__cceSetUnread(k, true); } catch (e) { log.appendLine(`marking ${k} unread again: ${e && e.message}`); } };
  let loadTries = 0, loadTimer = setTimeout(function loadRestored() {
    loadTimer = undefined;
    if (!Array.isArray(globalThis.__cceTabsAtStart)) {
      if (++loadTries < 45) loadTimer = setTimeout(loadRestored, 2000);
      return;
    }
    if (!enabled() || removed() || cfg().get(LOAD_TABS_SETTING, false) !== true) return;
    loadMarks.keepMarks(() => loadTabs.loadAll({ groups: vscode.window.tabGroups.all, front: vscode.window.tabGroups.activeTabGroup, isTab: isClaudeTab,
      exec: (...a) => vscode.commands.executeCommand(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }),
    { held: hostMarks, onScreen, set: markAgain })
      .then(({ result: n, back }) => {
        if (n) log.appendLine(`Loaded ${n} Claude Code tab(s) VS Code restored without loading them`);
        if (back.length) log.appendLine(`Marked ${back.length} conversation(s) unread again that loading their tabs had marked read: ${back.join(', ')}`);
      }, (e) => log.appendLine('loading restored Claude Code tabs: ' + (e && e.message)));
  }, 8000);
  context.subscriptions.push({ dispose: () => {
    if (loadTimer) clearTimeout(loadTimer);
    if (droppedTimer) clearTimeout(droppedTimer);
    if (globalThis.__cceTabsAtStart) delete globalThis.__cceTabsAtStart;
    delete globalThis.__cceReopenDropped;
    delete globalThis.__cceDroppedKept;
    delete globalThis.__cceReopenOnFocus;
    if (globalThis.__cceSessionsShown) delete globalThis.__cceSessionsShown;
    if (globalThis.__cceSessionsElsewhere) delete globalThis.__cceSessionsElsewhere;
  } });
  /* Reads an image file for the panel that asked (src/page/94-reply-images.js) and sends it back. */
  globalThis.__cceImageHook = (sessionId, id, src) => {
    const answer = (r) => {
      try { if (typeof globalThis.__cceToPanel === 'function') globalThis.__cceToPanel(sessionId, Object.assign({ type: 'cce_image', id }, r)); }
      catch (_) { /* the panel is gone */ }
    };
    if (removed() || !enabled() || switchedOff().includes('replyImages')) { answer({ ok: false, reason: 'Images in replies are switched off.' }); return; }
    replyImages.load(src).then(answer, () => answer({ ok: false, reason: 'The file could not be read.' }));
  };
  context.subscriptions.push({ dispose: () => { if (globalThis.__cceImageHook) delete globalThis.__cceImageHook; } });
  context.subscriptions.push({ dispose: () => {
    if (globalThis.__cceSessionsChanged) delete globalThis.__cceSessionsChanged;
  } });
  /* The patched host reports each tab the person closes; Agent Plus's session list shows it under Recently closed. */
  globalThis.__cceClosedHook = (id) => {
    try { sessionList.closed(id, 'tab'); } catch (_) { /* the core finds it closed itself */ }
    /* Its process ends a moment later; a list of what runs read before then must not stand for 30 s. */
    try { claude.invalidate(); } catch (_) { /* read again on the next tick */ }
  };
  context.subscriptions.push({ dispose: () => {
    if (globalThis.__cceClosedHook) delete globalThis.__cceClosedHook;
    if (globalThis.__cceSendSessionStates) delete globalThis.__cceSendSessionStates;
  } });
  /* The patched host (src/host.js) passes on every report of a panel that failed to load; see src/panel-rebuild.js. */
  globalThis.__ccePanelFailedHook = panelRebuild.create({ log: (line) => log.appendLine(line) });
  context.subscriptions.push({ dispose: () => { if (globalThis.__ccePanelFailedHook) delete globalThis.__ccePanelFailedHook; } });
  /* Rename requests from conversations (src/retitle.js): a window showing the conversation takes one at once, any other
     window after a moment, and a window with this extension switched off takes none. */
  const retitle = retitleHost.create({
    dir: planDir(),
    transcriptOf: (id) => transcriptOf(id),
    shows: (id) => { try { return claude.source.canDeliver(id); } catch (_) { return false; } },
    rename: (id, title) => renameAnywhere(id, title),
    log: (line) => log.appendLine(line),
    later: (ms) => { setTimeout(() => { scanRetitles(); }, ms); },
  });
  const scanRetitles = () => { if (enabled() && !removed()) retitle.scan().catch((e) => log.appendLine('retitle: ' + e.message)); };
  let retitleWatch = null;
  const watchRetitles = () => {
    if (retitleWatch) return;
    try { fs.mkdirSync(retitle.folder, { recursive: true }); } catch (_) { /* the watch below fails too */ }
    try {
      retitleWatch = fs.watch(retitle.folder, { persistent: false }, () => { scanRetitles(); });
      retitleWatch.on('error', () => { try { retitleWatch.close(); } catch (_) { /* closed */ } retitleWatch = null; });
    } catch (_) { retitleWatch = null; }
  };
  /* A watch can miss an event, and a folder made after the window started is watched from the next tick. */
  const retitleTick = setInterval(() => { watchRetitles(); scanRetitles(); }, 5000);
  context.subscriptions.push({ dispose: () => {
    clearInterval(retitleTick);
    if (retitleWatch) { try { retitleWatch.close(); } catch (_) { /* closed */ } retitleWatch = null; }
  } });
  watchRetitles();
  scanRetitles();
  claude.followChat();
  sweepPlans().catch((e) => log.appendLine('orphan work plans: ' + e.message));
  watchEffort();

  /*
   * The plugin that writes the plans travels inside this extension, so the only thing left is to register it with
   * Claude Code. That is done once and then recorded, and it is deliberately not awaited: activation must not sit and
   * wait on a 241 MB binary, and the outcome shows up above the plan either way.
   *
   * Skipped entirely for someone who asked this extension to leave Claude Code alone - that request is about all of it,
   * not only the patched files.
   */
  /*
   * Shown instead of the plan when no Python 3 runs; the plugin is then staged without its hooks and skill. On Windows,
   * clicking the row offers to download Python from python.org into the folder Agent Plus and its extensions share
   * (src/python-runtime.js); a downloaded python.exe comes after the ones on PATH, then one an earlier version of this
   * extension downloaded into its own storage.
   */
  const storage = context.globalStorageUri.fsPath;
  const pythons = () => pythonRuntime.pythons(storage);
  const noPython = () => pythonOffer.notice(pythons(), {
    download: PREFIX + 'downloadPython', install: PREFIX + 'installWorkPlanPlugin',
    without: 'Until this succeeds nothing writes a work plan, so the plan stays empty.',
  });
  const showProblem = (problem) => claude.setNotice(problem ? {
    title: 'The plugin that writes work plans is not installed',
    description: 'click to try again',
    detail: `${problem.step} failed. ${problem.said || 'It gave no reason.'} Until this succeeds nothing writes a work plan, `
      + 'so the plan stays empty.',
    command: PREFIX + 'installWorkPlanPlugin',
    arguments: [],
  } : null);
  /* One download at a time in this window; a second request while one runs waits for it. */
  const getPython = pythonOffer.single(() => vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Downloading Python ${pythonRuntime.VERSION} from python.org` },
    async () => {
      const r = await pythonRuntime.download(undefined, { userAgent: 'claude-code-plus' });
      log.appendLine('python download: ' + r.said);
      if (!r.ok) {
        noticeTime.error(vscode, 'Claude Code Plus: downloading Python failed. ' + r.said);
        return false;
      }
      await syncPlugin(true);
      noticeTime.info(vscode, 'Claude Code Plus: Python is installed. Start a new conversation to get a work plan.');
      return true;
    }));
  /* Once per Python version on this machine, by whichever extension and window asks first. After "Not now" the row above
     the plan is the way to get it. */
  const offerPython = () => pythonOffer.offer({
    ask: (message, ...buttons) => noticeTime.info(vscode, message, ...buttons), get: getPython });
  const syncPlugin = async (retry) => {
    if (removed()) return;
    const state = context.globalState.get(PLUGIN_KEY, {});
    const from = path.join(context.extensionPath, 'claude-plugin');
    /* What is compared is the plugin's own contents, not this extension's version: the version changes when a release is
       cut, so a plugin file that changed without one was staged once and never again, and the registered plugin kept
       running the older file. Nothing said so, because the state recorded agreed with itself. */
    /* The staged copy is fitted to the Python found here (pluginInstall.fitHooks), so which one it was is part of what
       is compared: installing Python, or a different one, stages the copy again. */
    const python = await pluginInstall.findPython(undefined, pythons());
    /* Trying each Python candidate can take seconds, and Remove may have been pressed meanwhile. */
    if (removed() || uninstalling() || replaced()) return;
    const stamp = pluginInstall.digest(from) + '|' + (python ? python.launcher.join(' ') + '|' + python.executable : 'none');
    const to = path.join(context.globalStorageUri.fsPath, 'claude-plugin');
    /* The memory of having registered is kept by the editor and outlives an uninstall of this extension, while the
       uninstall unregisters the plugin and its marketplace together. Both missing from Claude Code's own records is
       that, and then the plugin is registered again; the plugin alone missing is somebody's deliberate removal, and is
       left alone (see registrationGone). */
    const undone = state.registered === true && pluginInstall.registrationGone();
    const registered = state.registered === true && !undone;
    /* The registration points at the copy in this extension's global storage, and the editor deletes that folder along
       with an uninstalled extension, so the registration can outlive the files it names. Check the copy's digest, not
       just that it exists: a partly written copy, or one another window is replacing, exists but is not this plugin. */
    const staged = !!state.staged && pluginInstall.digest(to) === state.staged;
    /* The marketplace can stay registered at a folder that is gone, or at the old id's staged copy (src/carryover.js),
       which the editor deletes along with that extension. Claude Code then loads no plugin; registering here again
       moves the marketplace to this copy. */
    const legacyCopy = path.join(carryover.legacyStorage(context.globalStorageUri.fsPath), 'claude-plugin');
    const strayAt = registered && pluginInstall.strayRegistration(to, legacyCopy) ? pluginInstall.registeredAt() : '';
    if (!retry && registered && state.stamp === stamp && staged && !strayAt) return;
    if (undone) log.appendLine('work plan plugin: registering again - Claude Code lists neither it nor its marketplace, which is what uninstalling this extension leaves');
    if (strayAt) log.appendLine(`work plan plugin: registering again - Claude Code has its marketplace at ${strayAt}, which is gone or is the old extension's copy`);
    // A registered plugin on a new version of this extension needs its files refreshed, not registering again: the
    // path stays where it is, and re-running the install is what would undo a deliberate uninstall.
    const refreshOnly = !retry && registered && !strayAt;
    const dirs = claudeFolders();
    const claudeBin = pluginInstall.findClaude(dirs);
    if (!claudeBin && !refreshOnly) {
      const problem = { step: 'finding Claude Code\'s own command line', said: 'Looked for ' + pluginInstall.BINARY + ' in ' + (dirs.length || 'no') + ' install(s) of Claude Code.' };
      showProblem(problem);
      log.appendLine('work plan plugin: ' + problem.step + ': ' + problem.said);
      return;
    }
    const result = await pluginInstall.install({ claudeBin, from, to, refreshOnly, python });
    log.appendLine('work plan plugin: ' + (result.ok ? result.said : result.step + ' failed: ' + result.said));
    if (python) log.appendLine(`work plan plugin: hooks run with ${python.launcher.join(' ')} (Python ${python.version}, ${python.executable})`);
    if (result.ok) {
      await context.globalState.update(PLUGIN_KEY, { registered: true, stamp, staged: pluginInstall.digest(to), error: '' });
      if (python) showProblem(null);
      else {
        const notice = noPython();
        claude.setNotice(notice);
        log.appendLine('work plan plugin: ' + notice.detail);
        offerPython().catch((e) => log.appendLine('python offer: ' + e.message));
      }
      return undone;
    } else {
      await context.globalState.update(PLUGIN_KEY,
        { registered, stamp: state.stamp, error: result.step + ': ' + result.said });
      showProblem(result);
    }
  };
  /*
   * The plans an uninstall copied aside (restoreRescued in src/carryover.js) are copied back once the plugin is
   * registered again. A rescue folder written too recently is read again later. `unregistered` is what syncPlugin
   * returns: true when it registered the plugin again because the plugin and its marketplace were both gone. By then
   * the plan directory has already been emptied, so no folder needs to wait.
   */
  let rescueTimer = 0;
  const restorePlans = (unregistered) => {
    if (removed() || closing || context.globalState.get(PLUGIN_KEY, {}).registered !== true || !pluginInstall.listed()) return;
    let r;
    try { r = carryover.restoreRescued({ planDir: planDir(), settleMs: unregistered === true ? 0 : undefined }); }
    catch (e) { log.appendLine('copying rescued work plans back: ' + e.message); return; }
    if (r.copied.length) log.appendLine(`work plans copied back from a rescue folder: ${r.copied.length}`);
    if (r.waitMs && !rescueTimer) rescueTimer = setTimeout(() => { rescueTimer = 0; restorePlans(); }, r.waitMs + 1000);
  };
  context.subscriptions.push({ dispose: () => { if (rescueTimer) clearTimeout(rescueTimer); } });
  /*
   * In Interface features Claude Code is told to stop loading the work plan plugin, and in the next mode to load it again
   * (followTokenMode in src/plugin-install.js). One change at a time in this window, so that a quick change of mode and
   * back cannot interleave them. Claude Code reads which plugins to load when a conversation starts, so either applies
   * to conversations started afterwards.
   */
  let following = Promise.resolve('left');
  const followTokenMode = () => {
    following = following.then(async () => {
      if (removed() || uninstalling() || replaced()) return 'left';
      const label = tokenMode.labelOf(tokenMode.modeNow(vscode));
      const r = await pluginInstall.followTokenMode({ unload: tokenMode.unloadsPlugin(tokenMode.modeNow(vscode)), dirs: claudeFolders() });
      if (r === 'unloaded') log.appendLine(`work plan plugin: the token mode is ${label}, so Claude Code stops loading it in conversations started from now on`);
      else if (r === 'loaded') log.appendLine(`work plan plugin: the token mode is ${label}, so Claude Code loads it again in conversations started from now on`);
      else if (r === 'failed') log.appendLine(`work plan plugin: could not follow the token mode ${label}; it is tried again at the next change or start`);
      return r;
    }).catch((e) => { log.appendLine('work plan plugin under the token mode: ' + ((e && e.message) || e)); return 'failed'; });
    return following;
  };
  syncPlugin(false).then((unregistered) => { restorePlans(unregistered); return followTokenMode(); },
    (e) => log.appendLine('work plan plugin: ' + ((e && e.message) || e)));
  /*
   * The old extension's uninstall hook takes the patch out of Claude Code and unregisters the plugin, and the editor
   * runs it at its next start, when it deletes that extension's folder, which can happen after this extension is
   * running. When Claude Code lists neither the plugin nor its marketplace although this extension registered them,
   * that is what happened (see registrationGone): the patch and the plugin are put back and the plans copied back,
   * without waiting for the next start.
   */
  let recovering = false;
  const recover = () => {
    if (recovering || removed() || closing || uninstalling() || replaced()) return;
    if (context.globalState.get(PLUGIN_KEY, {}).registered !== true || !pluginInstall.registrationGone()) return;
    recovering = true;
    log.appendLine('work plan plugin: unregistered while this window was running; checking the patch and registering it again');
    Promise.resolve().then(() => sync()).then(() => syncPlugin(false)).then(restorePlans).then(() => followTokenMode())
      .catch((e) => log.appendLine('putting the patch and the plugin back: ' + ((e && e.message) || e)))
      .finally(() => { recovering = false; });
  };

  /*
   * A single 30-second timer has the next list of conversations run `claude agents` again and sweeps abandoned plans,
   * and, while the additions are on and this window runs the installed build, re-checks the transcript, the live
   * stylesheet and the log. Task files are written by another process, so nothing else would notice them change. Only the live settings are rewritten, and the page's revision moves only when their
   * content changes. While the additions are off the transcript is not watched.
   */
  const tick = setInterval(() => {
    claude.invalidate();
    decideWaits();
    decideReopen();
    sweepPlans().catch((e) => log.appendLine('orphan work plans: ' + e.message));
    recover();
    if (removed() || !enabled() || uninstalling() || replaced()) {
      if (replaced()) scanBackground();
      unwatchEffort();
      return;
    }
    scanBackground();
    scanEffort();
    watchEffort();
    writeLiveNow();
    sampleLatency();
  }, REFRESH_MS);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });
  context.subscriptions.push(
    registerCommand('installWorkPlanPlugin', () => syncPlugin(true).then(restorePlans).then(() => followTokenMode())),
    registerCommand('downloadPython', async () => {
      const pick = await noticeTime.info(vscode,
        `Download Python ${pythonRuntime.VERSION} from python.org?`,
        { modal: true, detail: `11 MB, saved in ${pythonRuntime.home()}.` },
        'Download');
      if (pick === 'Download') await getPython();
    }),
  );

  /*
   * Settings listener. The cached settings are dropped first, so the code below sees the new values. A setting that
   * only affects what the panel shows is applied through the live stylesheet alone; the patched bundles are not
   * checked, since that reads ten megabytes and these settings cannot change them.
   */
  const LIVE_SETTINGS = [SETTING, COLOR_SETTING, EDGE_SETTING]
    .concat(webview.SWITCHES.map((k) => PREFIX + 'show.' + k));
  const listAgain = () => { claude.invalidate(); claude.changed(); };
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(listAgain));
  context.subscriptions.push(tokenMode.warnOutsideCustom(vscode, MODE_SWITCHES, { who: 'Claude Code Plus', log: (m) => log.appendLine(m) }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    settings = null;
    if (e.affectsConfiguration('agentPlus.notifications') || e.affectsConfiguration(SETTING)) decideWaits();
    if (e.affectsConfiguration('agentPlus.sessions') || e.affectsConfiguration(SETTING)) decideReopen();
    if (Object.values(HOOK_SETTINGS).some((k) => e.affectsConfiguration(k)) || e.affectsConfiguration(SETTING)
        || e.affectsConfiguration(PREFIX + 'show.replyImages')) writeHookSettings();
    if (e.affectsConfiguration(LATENCY_ON_SETTING)) loadWatchOff();
    /* A wider margin moves kept files forward on the next pass, so that pass is not left waiting half an hour. */
    if (e.affectsConfiguration(PIN_MARGIN_SETTING) && !keepSoon) keepSoon = setTimeout(() => { keepSoon = 0; keepPinned(); }, 5000);
    const modeChanged = e.affectsConfiguration(tokenMode.SETTING);
    if (modeChanged) writeHookSettings();
    if (modeChanged || e.affectsConfiguration(WORK_PLAN_SETTING)) {
      listAgain();
      /* A page keeps the mode and the work plan's figures it was last sent, for its information box and its context
         meter, and asks again only when one of them opens. */
      if (!removed() && enabled()) for (const id of shownList()) sendPlan(id);
    } else if (e.affectsConfiguration(BRIEF_SETTING)) claude.changed();
    if (modeChanged) followTokenMode();
    if (e.affectsConfiguration(PREFIX + 'show.conversationLinks')) links.settingChanged();
    if (e.affectsConfiguration(PREFIX + 'show.planBar')) planBar.settingChanged();
    if (e.affectsConfiguration(HIDE_OFFICIAL_LIST_SETTING) || e.affectsConfiguration(SETTING)) { officialSessionList.apply(); sessionList.noticeChanged(); }
    /* Account & usage says how Claude Code signs in, which these two settings change. */
    if (e.affectsConfiguration('claudeCode.claudeProcessWrapper') || e.affectsConfiguration('claudeCode.environmentVariables')) sessionList.accountChanged();
    if (e.affectsConfiguration(HIDE_BG_SETTING)) {
      try { if (typeof globalThis.__cceSessionsChanged === 'function') globalThis.__cceSessionsChanged(); } catch (_) { /* the list catches up on its next read */ }
    }
    if (!LIVE_SETTINGS.some((k) => e.affectsConfiguration(k))) return;
    const c = cfg().get(COLOR_SETTING, '');
    if (c && !safeColor(c)) noticeTime.warning(vscode, `Claude Code Plus: "${c}" is not a CSS color (use e.g. #90EE90, lightgreen or rgb(144,238,144)); your message color is left unchanged.`);
    /* A switch has to reach the panel the moment it is flipped, which is what writing the stylesheet does. */
    writeLiveNow();
  }));

  return sync().then(() => { if (handing && !reloadOffered) offerUninstallOld(context); });
}

/*
 * Runs on every reload and every window that closes, and acts only on an uninstall: then it puts Claude Code back at
 * once, rather than leaving the patched files in place until the editor deletes this folder (see src/removal.js).
 *
 * Synchronous and without the editor's API, both for the same reason: the host is shutting down. It gives deactivate five
 * seconds, and restoring takes well under one; unregistering the companion plugin can take longer, so that part is
 * handed to a process that outlives the host.
 */
function deactivate() {
  if (!selfPath || !removal.beingUninstalled(selfPath, ID)) return;
  /* An earlier version of the old extension in this folder still uses the patch and the plugin. */
  if (removal.earlierCopies(path.dirname(selfPath)).length) return;
  /* Only the Claude Code installs in this editor's extensions folder. Another editor on this machine can have this
     extension installed and running, and restoring its folder would take the patch out from under it; the uninstall
     hook, which runs when this folder is deleted, is what looks in every editor's folder. */
  try { removal.restoreAll([path.dirname(selfPath)]); } catch (_) { /* the editor's own hook runs later */ }
  try { removal.finishLater(selfPath); } catch (_) { /* likewise */ }
}

/* The token mode line of Show Status: the mode, and which of the four features it runs. */
function tokenModeLine() {
  const what = tokenMode.SWITCHES.filter((s) => MODE_SWITCHES.includes(s.key))
    .map((s) => `${tokenMode.featureOf(s.feature).name} ${runs(s.key) ? 'on' : 'off'}`);
  return `Token mode: ${tokenMode.labelOf(tokenMode.modeNow(vscode))} (${tokenMode.SETTING}); in Claude Code: ${what.join(', ')}`;
}

/* `_tokenModeLine` is for the tests. */
module.exports = { activate, deactivate, renameSettings, _tokenModeLine: tokenModeLine };
