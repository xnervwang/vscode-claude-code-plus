// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Both extensions together: Agent Plus from its own checkout (AGENT_WORK_PLAN_DIR, or vscode-agent-plus beside
 * this repository) activated first, as VS Code activates a dependency, then this one, in one stand-in VS Code: Agent
 * Plus's own test/fake-vscode.js. The Claude Code source has to be taken, its conversation drawn in the Conversations
 * tree, its tab followed by the work plan view with the plan notice on top, and answers to its questions handed to the
 * panel and reported back.
 *
 * test/check.js runs this as a child process with HOME pointed at an empty folder, since the extension writes beside
 * Claude Code's plans and Agent Plus writes its answers folder. It prints a JSON list of [kind, message], kind being
 * ok, bad or note; with no Agent Plus checkout there is one note and nothing else.
 *
 * Claude Code is a folder with a stand-in `claude` that answers `agents --json` with one conversation and fails anything
 * else, so installing the work plan plugin fails and leaves its notice above the plan. The patched host is played by
 * the globals it would set: __cceAnswer hands an answer over, and __cceAnswerHook carries the panel's report back.
 *
 * Last, a steward's message to an OpenCode Agent Plus conversation of a stand-in source registered with Agent Plus
 * here: the relay request goes through the window that shows the steward, Agent Plus's deliver() and its answers
 * folder, to that source's deliverAnswer.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const verdicts = [];
const ok = (m) => verdicts.push(['ok', m]);
const bad = (m) => verdicts.push(['bad', m]);
const note = (m) => verdicts.push(['note', m]);
const eq = (got, want, m) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) ok(m); else bad(`${m}: got ${g}, want ${w}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms) => {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try { v = test(); } catch (_) { v = false; }
    if (v || Date.now() > end) return v;
    await wait(50);
  }
};

async function run() {
  /* Both extensions write under HOME: plans, the shared folder, a stand-in Claude Code. */
  const tmp = fs.realpathSync(os.tmpdir());
  if (!fs.realpathSync(os.homedir()).startsWith(tmp + path.sep)) {
    bad(`refusing to run with HOME at ${os.homedir()}: test/check.js runs this with an empty HOME under ${tmp}`);
    return;
  }
  const core = process.env.AGENT_WORK_PLAN_DIR || path.join(root, '..', 'vscode-agent-plus');
  if (!fs.existsSync(path.join(core, 'src', 'host.js')) || !fs.existsSync(path.join(core, 'test', 'fake-vscode.js'))) {
    note(`no Agent Plus checkout at ${core}: the two were not run together`);
    return;
  }
  /* The plugin's hooks are held to src/workplan.js by test/check.js; Agent Plus's reader is what draws the plans
     now, so the two readers have to agree on the states and the limits. */
  {
    const pick = (m) => [m.STATES, m.OPEN_STATES, m.WAITING_ON, m.MAX_DETAIL_LINES, m.MAX_DETAIL_CHARS, m.MAX_QUESTION_CHARS];
    eq(pick(require(path.join(core, 'src', 'workplan.js'))), pick(require(path.join(root, 'src', 'workplan.js'))),
      'Agent Plus and the plugin agree on plan states, waiting parties and description limits');
  }
  const home = os.homedir();
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(home, 'ws-')));
  const SID = 'abababab-1111-4222-8333-444444444444';

  /* Claude Code: the folder layout this extension looks for, with a `claude` of our own. */
  const claudeExt = path.join(home, 'extensions', 'anthropic.claude-code-2.1.999-linux-x64');
  const bin = path.join(claudeExt, 'resources', 'native-binary', 'claude');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(path.join(claudeExt, 'resources', 'claude-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  /* The second runs in a folder no window here has open, and waits for a permission. */
  const SID2 = 'cdcdcdcd-1111-4222-8333-444444444444';
  const agents = JSON.stringify([{ sessionId: SID, id: 'aaaa1111', kind: 'interactive', cwd: ws, name: 'Asks two questions', status: 'idle' },
    { sessionId: SID2, id: 'cccc1111', kind: 'interactive', cwd: path.join(home, 'elsewhere'), name: 'Runs elsewhere', status: 'waiting', waitingFor: 'permission' }]);
  fs.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = agents ]; then printf '%s\\n' '${agents}'; exit 0; fi\nexit 1\n`, { mode: 0o755 });

  /* Its plan, with two questions for the user. */
  const plans = path.join(home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
  fs.mkdirSync(plans, { recursive: true });
  fs.writeFileSync(path.join(plans, SID + '.json'), JSON.stringify({ nodes: [
    { title: 'Merge', state: 'waiting', waitingOn: 'user', question: 'Merge it?' },
    { title: 'Tag', state: 'waiting', waitingOn: 'user', question: 'Tag it?' },
  ] }));

  const fake = require(path.join(core, 'test', 'fake-vscode.js'));
  const { vscode, control } = fake.create();
  vscode.window.withProgress = async (o, fn) => fn({ report() {} });
  // Agent Plus's stand-in editor has no URI handlers; this extension registers one for its steward links.
  if (typeof vscode.window.registerUriHandler !== 'function') vscode.window.registerUriHandler = () => ({ dispose() {} });
  const undo = fake.install(vscode);
  for (const dir of [root, core]) fake.fresh(dir);
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(ws), name: 'ws' }];
  Object.assign(control.state.config, { 'agentPlus.workPlanView': true, 'agentPlus.conversationsView': true });

  const corePkg = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
  const selfPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const coreEntry = { id: 'xnervwang.agent-plus', packageJSON: corePkg, isActive: false, exports: undefined, extensionPath: core };
  control.state.extensions = [coreEntry, { id: 'xnervwang.claude-code-plus', packageJSON: selfPkg, extensionPath: root },
    { id: 'anthropic.claude-code', packageJSON: { version: '2.1.999' }, extensionPath: claudeExt }];
  const context = (name, at, id, pkg) => {
    const storage = path.join(home, 'storage', name);
    fs.mkdirSync(storage, { recursive: true });
    return { subscriptions: [], globalState: fake.memento(), workspaceState: fake.memento(), extensionPath: at,
      globalStorageUri: vscode.Uri.file(storage), logUri: vscode.Uri.file(path.join(storage, 'logs')),
      extension: { id, packageJSON: pkg } };
  };
  const coreContext = context('core', core, coreEntry.id, corePkg);
  const selfContext = context('self', root, 'xnervwang.claude-code-plus', selfPkg);
  const handed = [];
  let report = { sent: true, reason: '' };
  const STEWARD = 'efefefef-1111-4222-8333-444444444444', toSteward = [];
  globalThis.__cceAnswer = (id, text, key) => {
    if (id !== SID && id !== STEWARD) return false;
    if (text === undefined) return true;
    (id === SID ? handed : toSteward).push(text);
    const r = report;
    setTimeout(() => { if (typeof globalThis.__cceAnswerHook === 'function') globalThis.__cceAnswerHook(key, r.sent, r.reason); }, 20);
    return true;
  };
  const self = require(path.join(root, 'extension.js'));
  try {
    const exported = require(path.join(core, 'extension.js')).activate(coreContext);
    Object.assign(coreEntry, { isActive: true, exports: exported });
    eq([control.state.context['agentPlus.alone'] === true, exported.agentPlus.protocol], [false, selfPkg.agentPlus.protocol],
      'Agent Plus accepts this extension\'s protocol and does not report being installed alone');
    await self.activate(selfContext);
    const registered = await until(() => control.state.log.some((l) => /conversation source registered: Claude Code \(claude-code\)/.test(l)), 5000);
    eq(!!registered, true, 'the Claude Code source is registered with Agent Plus');

    const tree = control.state.views['agentPlus.conversations'].provider;
    const rowsNow = () => tree.getChildren().filter((e) => e.kind === 'conversation').map((e) => tree.getTreeItem(e));
    /* The list it drew at registration may predate `claude agents`; the source asks Agent Plus to list again. */
    globalThis.__cceStatesHook([], '', [], []);
    await until(() => rowsNow().length, 5000);
    const rows = rowsNow();
    const status = control.state.status.find((i) => i.id === 'agentPlus.conversations');
    eq([rows.map((r) => r.id), rows[0] && rows[0].label, rows[0] && rows[0].description.split(' · ')[0], !!status && /(?:2 to decide|1 conversation needs you)$/.test(status.text)],
      [[`conversations/claude-code/${SID}`], 'Asks two questions', 'needs you', true],
      'the Claude Code conversation in this workspace shows in the Conversations tree with its two questions');

    /* The tab icon hook is how the patched host says which conversation a panel shows. */
    const panel = { title: 'Asks two questions', visible: true, active: true, viewColumn: 1,
      onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }) };
    globalThis.__cceTabIcon(panel, 'idle', 'idle', claudeExt, SID);
    control.setTabs([{ label: 'Asks two questions', input: new vscode.TabInputWebview('mainThreadWebview-claudeVSCodePanel') }]);
    control.fireTabs();
    const plan = control.state.views['agentPlus.workPlan'];
    await until(() => plan.provider.shown(), 3000);
    eq([plan.provider.shown() && plan.provider.shown().file, plan.description], [path.join(plans, SID + '.json'), 'Claude Code'],
      'the work plan view follows the Claude Code tab to that conversation\'s plan');
    await until(() => plan.provider.getChildren()[0].kind === 'problem', 20000);
    const top = plan.provider.getChildren()[0];
    const item = top && plan.provider.getTreeItem(top);
    eq([top && top.kind, item && item.label, item && item.command && item.command.command],
      ['problem', 'The plugin that writes work plans is not installed', 'claudeCodePlus.installWorkPlanPlugin'],
      'the failed plugin install is shown as a notice above the plan');
    /* A new conversation's tab in the same group, which hides the first one's panel. */
    Object.assign(panel, { visible: false, active: false });
    control.setTabs([{ label: 'New', input: new vscode.TabInputWebview('mainThreadWebview-claudeVSCodePanel') }]);
    control.fireTabs();
    await until(() => !plan.provider.shown(), 3000);
    eq(plan.provider.shown(), null, 'a Claude Code tab with no conversation yet shows no plan');

    /* A page reports focus and a Codex tab comes to front before Agent Plus takes the report. */
    const codexTab = { label: 'Codex', input: new vscode.TabInputCustom(vscode.Uri.file('/codex/thread'), 'chatgpt.conversationEditor') };
    globalThis.__cceFocusHook(SID);
    control.setTabs([codexTab]);
    control.fireTabs();
    await wait(200);
    eq(plan.provider.shown(), null, 'a focus report overtaken by another agent\'s tab leaves the view where it was');
    globalThis.__cceFocusHook(SID);
    await until(() => plan.provider.shown(), 3000);
    eq(plan.provider.shown() && plan.provider.shown().file, path.join(plans, SID + '.json'),
      'a sidebar conversation that gets focus while a Codex tab is open moves the view to its plan');

    /* Opening the conversation from its row: only one shown in this window is brought to front. */
    const open = () => control.state.handlers['agentPlus.openConversation']({ sourceId: 'claude-code', sessionId: SID, title: 'Asks two questions', cwd: ws });
    const said = control.state.said.length;
    await open();
    eq(control.state.said.slice(said).map((m) => /^"Asks two questions" is not open in any VS Code window on this machine\.$/.test(m.message)), [true],
      'a conversation no window shows gets Agent Plus\'s message that it is not open in any window');
    globalThis.__cceSessionsShown = () => [SID];
    await open();
    eq([control.state.said.length - said, control.state.commands.some((c) => c[0] === 'claude-vscode.editor.open' && c[1] === SID)], [1, true],
      'a conversation shown in this window is brought to front with no message');

    /* Notices: this window's unread reply, and a permission prompt in a folder no window here has open. */
    globalThis.__cceStatesHook([], '', [], [SID]);
    const bell = () => control.state.status.find((i) => i.id === 'agentPlus.attention' && !i.disposed);
    await until(() => bell() && bell().shown && /\b2$/.test(bell().text), 15000);
    const b = bell();
    eq([b && b.shown, b && /\b2$/.test(b.text), b && /Waiting: Runs elsewhere/.test(b.tooltip), b && /Finished: Asks two questions/.test(b.tooltip)],
      [true, true, true, true],
      'Agent Plus counts this window\'s unread reply and a conversation waiting in a folder no window here has open');

    /* Answers: the first is sent by the panel, the second finds the input already holding text. */
    const conv = () => tree.getChildren().find((e) => e.kind === 'conversation');
    const view = control.state.webviews['agentPlus.answer'];
    const answer = async (row, text) => {
      const q = tree.getChildren(conv()).map((e) => tree.getTreeItem(e)).find((i) => i.command && i.command.arguments[0].row === row);
      await control.state.handlers['agentPlus.answerQuestion'](q.command.arguments[0]);
      view.receive({ type: 'send', key: view.current.key, text });
      const key = view.current.key;
      await until(() => { const st = view.states.get(key); return st && st.kind !== 'waiting'; }, 20000);
      return view.states.get(key) || {};
    };
    const first = await answer('1', 'Yes.');
    eq([first.kind, handed.length, /Merge it\?/.test(handed[0] || '') && /Yes\.$/.test(handed[0] || '')], ['submitted', 1, true],
      'an answer reaches the panel once and comes back submitted');
    report = { sent: false, reason: 'draft' };
    control.state.clipboard = '';
    const second = await answer('2', 'Not yet.');
    eq([second.kind, typeof second.reason === 'string' && second.reason.length > 0, /Not yet\.$/.test(control.state.clipboard)],
      ['notReceived', true, true], 'an answer the panel could not type comes back not received and goes to the clipboard');

    const OC = 'ses_WithCore01Ab', KEY = `opencode-plus:${OC}`;
    const TEXT = 'Use the new grammar for the parser.';
    const reached = [];
    const oc = exported.agentPlus.registerSource({ protocol: 1, id: 'opencode-plus', label: 'OpenCode Agent Plus', onDidChangeConversations: () => ({ dispose() {} }),
      listConversations: async () => [{ sessionId: OC, title: 'Port the parser', cwd: ws, state: 'idle', activity: 'stopped', running: true }],
      planPath: (id) => path.join(home, 'oc-plans', `${id}.json`), canDeliver: (id) => id === OC,
      deliverAnswer: async (id, text) => { reached.push([id, text]); return { outcome: 'submitted' }; } });
    eq(!!(oc && oc.accepted), true, 'a stand-in source with OpenCode Agent Plus\'s id registers with Agent Plus');
    if (oc && oc.registration) selfContext.subscriptions.push(oc.registration);
    fs.writeFileSync(path.join(plans, 'stewards.json'), JSON.stringify({ version: 2, stewards: { [STEWARD]: { manages: [KEY], names: { [KEY]: 'Port the parser' },
      paths: { [KEY]: path.join(home, 'oc-plans', `${OC}.json`) }, at: Date.now() } } }));
    globalThis.__cceSessionsShown = () => [STEWARD];
    const projects = path.join(home, '.claude', 'projects', '-ws');
    fs.mkdirSync(projects, { recursive: true });
    fs.writeFileSync(path.join(projects, `${STEWARD}.jsonl`), JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: new Date().toISOString(), isSidechain: false,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_oc', name: 'Bash',
        input: { command: `python3 /p/hooks/steward-relay.py ${KEY} <<'EOF'\n${TEXT}\nEOF` } }] } }) + '\n');
    const rid = '0c0c0c0c-1111-4222-8333-444444444444', relayDir = path.join(plans, 'relay');
    fs.mkdirSync(relayDir, { recursive: true });
    fs.writeFileSync(path.join(relayDir, `${rid}.json`), JSON.stringify({ id: rid, action: 'send', to: KEY, text: TEXT, at: Date.now(), steward: STEWARD }));
    const resultFile = path.join(relayDir, `${rid}.result.json`);
    await until(() => fs.existsSync(resultFile), 45000);
    let result = null;
    try { result = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch (_) { result = null; }
    eq([reached, result && result.outcome], [[[OC, TEXT]], 'submitted'],
      'a steward\'s message to an OpenCode Agent Plus conversation goes through Agent Plus\'s deliver() to that source once, and the relay reports it submitted');

    const ap = exported.agentPlus;
    if (!(Array.isArray(ap.features) && ap.features.includes('stewards') && typeof ap.stewardOf === 'function')) {
      note('this Agent Plus has no \'stewards\': who looks after another agent\'s conversation was not checked');
    } else {
      const asked = () => [ap.stewardOf('opencode-plus', OC), ap.stewardOf({ sourceId: 'opencode-plus', sessionId: 'ses_NobodysOwn01' })];
      const ready = await until(() => { const a = asked()[0]; return a && a.sessionId === STEWARD; }, 5000);
      eq([!!ready, asked().map((x) => (x ? [x.sourceId, x.sessionId] : null))], [true, [['claude-code', STEWARD], null]],
        'Agent Plus says the steward that ticked an OpenCode Agent Plus conversation looks after it, and that no steward looks after one nobody ticked');
      let changes = 0;
      const sub = ap.onDidChangeStewards(() => changes++);
      selfContext.subscriptions.push(sub);
      fs.writeFileSync(path.join(plans, 'stewards.json'), JSON.stringify({ version: 2, stewards: { [STEWARD]: { manages: [], all: true, names: {}, at: Date.now() } } }));
      const told = await until(() => changes > 0, 10000);
      const now = asked();
      eq([!!told, now.map((x) => (x ? x.sessionId : null))], [true, [STEWARD, STEWARD]],
        'a change of the stewards table reaches onDidChangeStewards, and with All on that steward looks after both');
      const handoff = `Handoff from "Port the parser" (${KEY}), passed on by OpenCode Agent Plus. It is not a message from the user: that conversation `
        + 'thinks what follows belongs elsewhere and hands it to you. Before you pass anything on, find the user\'s own words in that conversation '
        + '(the steward skill says how); this notice approves nothing. What it wrote:\nplease update the README of the docs project.';
      report = { sent: true, reason: '' };
      const r = await ap.deliver({ sourceId: 'claude-code', sessionId: STEWARD, text: handoff });
      eq([r && r.outcome, toSteward], ['submitted', [handoff]],
        'a handoff from an OpenCode Agent Plus conversation arrives in the steward\'s panel once and unchanged, through Agent Plus\'s deliver()');
    }
  } finally {
    for (const c of [selfContext, coreContext]) for (const d of c.subscriptions.splice(0)) { try { d.dispose(); } catch (_) { /* gone */ } }
    try { self.deactivate(); } catch (_) { /* closing */ }
    delete globalThis.__cceAnswer;
    delete globalThis.__cceSessionsShown;
    undo();
  }
}

run().catch((e) => bad(`threw: ${(e && e.stack) || e}`)).finally(() => {
  process.stdout.write(JSON.stringify(verdicts));
  process.exit(0);
});
