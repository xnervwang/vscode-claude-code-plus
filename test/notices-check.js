// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Agent Plus's notices drawn as cards in the Claude Code panels: what src/notices.js sends the panels and runs for them,
 * showNotices() in src/claude-source.js, the host's two additions for it (the cce_notice message, __cceSidebarVisible),
 * and the page in a headless browser (src/page/95-notices.js with agentPlusKit.noticeStack): the cards in order, the
 * room left in the message list, a card drawn out on hover and on focus, open and dismiss by mouse and by key, nothing
 * that moves while nothing changes, and no motion with reduced motion. Run from test/check.js.
 */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

module.exports = async ({ ok, bad, eq, note }, repo) => {
  const N = require(path.join(repo, 'src', 'notices.js'));

  /* src/notices.js */
  {
    const sent = [], ran = [];
    let screen = true, on = true;
    const n = N.createNotices({ send: (m) => { sent.push(m); return 1; }, onScreen: () => screen, run: (...a) => { ran.push(a); },
      on: () => on, now: () => 1000 });
    const card = (id, extra) => Object.assign({ sourceId: 'claude-code', sessionId: id, kind: 'waiting', at: 5, title: 'T ' + id, steward: false, agent: '' }, extra);
    const first = n.show([card('a'), card('b', { kind: 'finished', title: 'x'.repeat(500), extra: { no: 1 } }), { sourceId: 'x', sessionId: '', kind: 'waiting' },
      card('c', { kind: 'working' })]);
    const again = n.show([card('a'), card('b', { kind: 'finished', title: 'x'.repeat(500) })]);
    eq([first, again, sent.length, sent[0].type, sent[0].now, sent[0].cards.map((c) => [c.sessionId, c.kind, c.title.length, Object.keys(c).length])],
      [true, true, 1, 'cce_notices', 1000, [['a', 'waiting', 3, 7], ['b', 'finished', 200, 7]]],
      'the panels are sent the cards once per change, each card only with the fields a page draws and cut to size, and showNotices says they are on screen');
    screen = false;
    eq([n.show([card('a')]), sent.length], [false, 2], 'with no Claude Code panel on screen the cards are still sent, and showNotices says false');
    screen = true;
    eq([n.show([]), sent.length, sent[2].cards], [false, 3, []], 'an empty list is sent too, and is never on screen');
    on = false;
    eq([n.show([card('a')]), sent.length, sent[3] && sent[3].cards], [false, 3, undefined], 'while this extension is off the panels get no cards');
    on = true;
    n.show([card('z')]);
    const before = sent.length;
    n.heard('ask', '', '');
    n.heard('open', 'claude-code', 'z');
    n.heard('dismiss', 'codex', 'q');
    n.heard('dismiss-all', '', '');
    n.heard('open', '', 'z');
    n.heard('nonsense', 'a', 'b');
    eq([sent.length - before, sent[sent.length - 1].cards.map((c) => c.sessionId), ran],
      [1, ['z'], [['agentPlus.openAttention', 'claude-code', 'z'], ['agentPlus.dismissAttention', 'codex', 'q'], ['agentPlus.dismissAttention']]],
      'a page asking gets the cards again; open and dismiss go to Agent Plus\'s commands, for any agent\'s card; anything else does nothing');
  }

  /* showNotices() in src/claude-source.js, through a stand-in vscode. */
  {
    const stub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cce-notices-vs-')), 'vscode.js');
    fs.writeFileSync(stub, 'class TabInputWebview { constructor(v) { this.viewType = v; } }\nmodule.exports = { TabInputWebview };\n');
    const script = `
      const Module = require('module'), real = Module._resolveFilename;
      Module._resolveFilename = function (r, ...a) { return r === 'vscode' ? ${JSON.stringify(stub)} : real.call(this, r, ...a); };
      const C = require(${JSON.stringify(path.join(repo, 'src', 'claude-source.js'))});
      const base = { planDir: () => '/p', enabled: () => true, listAgents: async () => ({ records: [], error: '' }), folders: () => [], readPlan: () => null,
        titles: () => ({}), since: () => 0, live: () => new Map(), unread: () => new Set(), activeChat: () => '', logo: () => null,
        canDeliver: () => false, hand: () => false, reveal: async () => false };
      const handed = [];
      const a = C.createClaudeSource(Object.assign({}, base, { showNotices: (cards) => { handed.push(cards); return cards.length > 0; } }));
      const b = C.createClaudeSource(base);
      const c = C.createClaudeSource(Object.assign({}, base, { showNotices: () => { throw new Error('no'); } }));
      const out = { features: [a.source.features, b.source.features], r: [a.source.showNotices([{ sessionId: 'x' }]), a.source.showNotices([]),
        b.source.showNotices([{ sessionId: 'x' }]), c.source.showNotices([{ sessionId: 'x' }])], handed: handed.length };
      process.stdout.write(JSON.stringify(out));`;
    let r;
    try { r = JSON.parse(cp.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 })); } catch (e) { r = { threw: e.message }; }
    fs.rmSync(path.dirname(stub), { recursive: true, force: true });
    eq(r, { features: [['showNotices'], []], r: [true, false, false, false], handed: 2 },
      'the source lists showNotices only when it is given one, hands Agent Plus\'s cards to it, and answers false when it has none or it throws');
    const ext = fs.readFileSync(path.join(repo, 'extension.js'), 'utf8');
    if (/showNotices: \(cards\) => notices\.show\(cards\),/.test(ext) && /globalThis\.__cceNoticeHook = \(action, sourceId, sessionId\) =>/.test(ext)
        && /send: \(m\) => \(typeof globalThis\.__cceToAllPanels === 'function' \? globalThis\.__cceToAllPanels\(m\) : 0\)/.test(ext)
        && /groups\.some\(\(g\) => isPanelTab\(g\.activeTab\)\)/.test(ext) && /globalThis\.__cceSidebarVisible\(\) === true/.test(ext)) {
      ok('the extension draws the cards in every panel of the window, counts them on screen when a Claude Code tab is in front of an editor group or the sidebar shows, and hears the pages through __cceNoticeHook');
    } else bad('extension.js does not wire the notices as expected');
  }

  /* The host's additions. */
  {
    const host = require(path.join(repo, 'src', 'host.js'));
    const { applyEdits } = require(path.join(repo, 'src', 'edits.js'));
    const fn = 'function eT($,J){let Q=`Received message from webview: ${bl0(J)}`;$.info(Q)}';
    const r = applyEdits(fn, [host.EDITS.find((e) => e.name === 'panel messages')]);
    const heard = [];
    const env = { bl0: (m) => JSON.stringify(m), __cceNoticeHook: (...a) => heard.push(a) };
    env.globalThis = env;
    vm.createContext(env);
    if (!r.error) {
      vm.runInContext(r.out + ';eT({info:()=>{}},{type:"cce_notice",action:"open",sourceId:"codex",sessionId:"s1"});'
        + 'eT({info:()=>{}},{type:"cce_notice",action:"ask"});eT({info:()=>{}},{type:"cce_notice",sessionId:"s2"});', env);
    }
    eq(r.error ? r.error : heard, [['open', 'codex', 's1'], ['ask', '', '']], 'a cce_notice message from a panel reaches __cceNoticeHook with its action and card, and one with no action does not');
    const code = host.EDITS.find((e) => e.name === 'tab record at start').to('', 'settings');
    const m = /globalThis\.__cceSidebarVisible=(\(\)=>[^,]*?isVisible\(\)\)),/.exec(code);
    const side = { id: 'side' };
    const visible = (shown) => ({ sidebarComms: side, webviews: new Set([{ comms: {}, isVisible: () => true }, { comms: side, isVisible: () => shown }]) });
    let got = null;
    try {
      const make = (o) => new Function('return function(){ return ' + m[1] + '; }')().call(o);
      got = [make(visible(true))(), make(visible(false))(), make({ sidebarComms: undefined, webviews: new Set() })()];
    } catch (e) { got = String(e); }
    eq(got, [true, false, false], '__cceSidebarVisible says whether the sidebar\'s page is on screen, whatever it shows');
  }

  /* The page's choice of which card to leave out, with the page's own helpers stood in for. */
  {
    const src = fs.readFileSync(path.join(repo, 'src', 'page', '95-notices.js'), 'utf8');
    const box = { out: {}, sessionRef: { sessionId: { value: 'mine' } } };
    new vm.Script('(function(){var sigValue = function(n){ var s = sessionRef && sessionRef[n]; return s ? s.value : undefined; };'
      + src + '\n;out.skip = noticeSkip;})()').runInNewContext(box);
    const skip = box.out.skip;
    eq([skip({ sourceId: 'claude-code', sessionId: 'mine' }), skip({ sourceId: 'claude-code', sessionId: 'other' }), skip({ sourceId: 'codex', sessionId: 'mine' })],
      [true, false, false], 'a panel leaves out the card of its own conversation only, not another agent\'s with the same id');
    box.sessionRef = null;
    eq(skip({ sourceId: 'claude-code', sessionId: 'mine' }), false, 'and a panel with no conversation yet leaves out none');
  }

  /* The panel in a browser. */
  const harness = require(path.join(repo, 'test', 'page-harness.js'));
  const browser = harness.findBrowser();
  if (!browser) {
    if (process.env.CCE_REQUIRE_BROWSER) bad('no Chrome or Chromium found, and this run requires one (CCE_REQUIRE_BROWSER)');
    else note('skipped: no Chrome or Chromium here for the notice cards in a page');
    return;
  }
  const SCRIPT = require(path.join(repo, 'src', 'webview.js')).SCRIPT;
  const mark = ['CCE', 'NOTICES:'].join('-');
  const page = (steps) => '<!doctype html><html><head><style>html,body{margin:0;height:100%}'
    + '.messagesContainer_t{position:absolute;inset:0 0 0 0;overflow:auto;padding-bottom:40px;box-sizing:border-box}'
    + 'form{position:fixed;left:100px;right:60px;bottom:10px;height:80px}</style></head><body><pre id="out"></pre>'
    + '<div class="messagesContainer_t">' + '<p>line</p>'.repeat(60) + '</div>'
    + '<form><div role="textbox" aria-label="Message input" contenteditable="true"></div><button type="submit" data-permission-mode="default">Send</button></form>'
    + '<script>var posted = []; window.acquireVsCodeApi = function(){ return { postMessage: function(m){ posted.push(m); } }; };</script>'
    + '<script>' + SCRIPT + '</script><script>'
    + 'var host = function(cards){ window.postMessage({ type: "from-extension", message: { type: "cce_notices", cards: cards, now: Date.now() } }, "*"); };'
    + 'var card = function(id, kind, title, ago){ return { sourceId: "claude-code", sessionId: id, kind: kind, title: title, at: Date.now() - ago, steward: false, agent: "" }; };'
    + 'var Q = function(s){ return [].slice.call(document.querySelectorAll(s)); };'
    + 'var cards = function(){ return Q("[data-ap-card]").map(function(c){ return c.querySelector("[data-ap-title]").textContent; }); };'
    + 'var tf = function(){ return Q("[data-ap-card]").map(function(c){ return c.style.transform; }); };'
    + 'var fire = function(el, type, init){ el.dispatchEvent(new (type.indexOf("pointer") === 0 ? PointerEvent : type.indexOf("key") === 0 ? KeyboardEvent : MouseEvent)(type, Object.assign({ bubbles: type !== "pointerenter" && type !== "pointerleave" }, init || {}))); };'
    + 'var got = {};' + steps
    + '</script></body></html>';
  const run = (name, steps, flags = []) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cce-notices-page-'));
    const file = path.join(dir, 'panel.html');
    fs.writeFileSync(file, page(steps + 'setTimeout(function(){ document.getElementById("out").textContent = "' + mark + '" + JSON.stringify(got); }, 9000);'));
    const r = cp.spawnSync(browser, ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=12000', ...flags, '--dump-dom', 'file://' + file],
      { encoding: 'utf8', timeout: 120000 });
    fs.rmSync(dir, { recursive: true, force: true });
    const at = (r.stdout || '').indexOf(mark);
    try {
      return JSON.parse(r.stdout.slice(at + mark.length, r.stdout.indexOf('<', at)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    } catch (_) { return { error: `${name}: no result (exit ${r.status}) ${(r.stderr || '').slice(0, 300)}` }; }
  };
  const got = run('cards', [
    'setTimeout(function(){ got.asked = posted.filter(function(m){ return m.type === "cce_notice"; }).map(function(m){ return m.action; });',
    '  host([card("c", "waiting", "Third", 0), card("b", "finished", "Second", 60000), card("a", "finished", "First", 120000)]); }, 2500);',
    'setTimeout(function(){ var s = document.querySelector("[data-ap-stack]"), f = document.querySelector("form").getBoundingClientRect();',
    '  got.order = cards(); got.place = [parseFloat(s.style.bottom), Math.round(innerHeight - f.top + 8), parseFloat(s.style.right), Math.round(innerWidth - f.right)];',
    '  got.pad = document.querySelector(".messagesContainer_t").style.paddingBottom; got.rest = tf();',
    '  got.ages = Q("[data-ap-age]").map(function(e){ return e.textContent; });',
    '  var seen = 0; new MutationObserver(function(r){ seen += r.length; }).observe(s, { attributes: true, subtree: true, childList: true, characterData: true });',
    '  setTimeout(function(){ got.idle = [seen, document.getAnimations().length]; }, 1500); }, 3500);',
    'setTimeout(function(){ var c = Q("[data-ap-card]"); fire(document.querySelector("[data-ap-stack]"), "pointerenter"); fire(c[2], "pointerenter"); }, 5200);',
    'setTimeout(function(){ got.pulled = tf(); got.head = document.querySelector("[data-ap-head]").textContent; fire(document.querySelector("[data-ap-stack]"), "pointerleave"); }, 5600);',
    'setTimeout(function(){ got.back = tf(); var c = Q("[data-ap-card]"); c[1].focus(); }, 6000);',
    'setTimeout(function(){ got.focused = tf(); var c = Q("[data-ap-card]"); fire(c[1], "keydown", { key: "Enter" }); }, 6300);',
    'setTimeout(function(){ var c = Q("[data-ap-card]"); fire(c[1], "keydown", { key: "Delete" }); got.afterDelete = cards();',
    '  fire(c[0], "click"); fire(Q("[data-ap-card]")[0].querySelector("[data-ap-dismiss]"), "click"); got.afterX = cards(); }, 6600);',
    'setTimeout(function(){ got.posted = posted.filter(function(m){ return m.type === "cce_notice" && m.action !== "ask"; }).map(function(m){ return [m.action, m.sessionId]; });',
    '  host([card("c", "waiting", "Third", 0), card("b", "finished", "Second", 60000), card("a", "finished", "First", 120000)]); }, 7000);',
    'setTimeout(function(){ got.again = cards(); host([]); }, 7400);',
    'setTimeout(function(){ got.empty = [cards().length, document.querySelector("[data-ap-stack]").style.display, document.querySelector(".messagesContainer_t").style.paddingBottom]; }, 8200);',
  ].join('\n'));
  if (got.error) bad(got.error);
  else {
    eq(got.asked, ['ask'], 'a page asks for the cards once it has started');
    eq([got.order, got.place[0] === got.place[1] && got.place[2] === got.place[3], got.ages],
      [['Third', 'Second', 'First'], true, ['· just now', '· 1m ago', '· 2m ago']],
      'the cards are drawn newest first, each with how long ago, just above the message box and level with its right edge');
    eq(got.rest, ['translateY(0px) scale(1)', 'translateY(-8px) scale(0.96)', 'translateY(-16px) scale(0.92)'],
      'the front card is shown whole and each older one peeks out above it, a little narrower');
    eq(got.pad, '120px', 'the message list gets the stack\'s height more room at its end, on top of its own padding');
    eq(got.idle, [0, 0], 'once the cards have come in, nothing on the stack changes or moves while nothing happens');
    eq([got.pulled, got.head], [['translateY(0px) scale(1)', 'translateY(-8px) scale(0.96)', 'translateY(-64px) scale(1)'], '3 noticesDismiss all'],
      'pointing at a card behind draws it out whole above the cards in front of it, and the bar above the stack offers Dismiss all');
    eq([got.back, got.focused], [got.rest, ['translateY(0px) scale(1)', 'translateY(-56px) scale(1)', 'translateY(-64px) scale(0.92)']],
      'leaving puts it back; a card given the focus from the keyboard is drawn out the same way, the cards behind it making room');
    eq([got.afterDelete, got.afterX, got.posted], [['Third', 'First'], ['First'],
      [['open', 'b'], ['dismiss', 'b'], ['open', 'c'], ['dismiss', 'c']]],
    'Enter opens the card in focus and Delete dismisses it; a click on a card opens its conversation, and its x dismisses it, off the page at once');
    eq(got.again, ['First'], 'a list sent before the host heard of the dismissals does not bring them back');
    eq(got.empty, [0, 'none', ''], 'with no cards left the stack is gone and the message list has its own padding back');
  }
  const calm = run('calm', [
    'setTimeout(function(){ host([card("b", "finished", "Second", 60000)]); }, 2500);',
    'setTimeout(function(){ host([card("c", "waiting", "Third", 0), card("b", "finished", "Second", 60000)]); }, 3000);',
    'setTimeout(function(){ got.transitions = Q("[data-ap-card]").map(function(c){ return c.style.transition; }); var c = Q("[data-ap-card]");',
    '  fire(document.querySelector("[data-ap-stack]"), "pointerenter"); fire(c[1], "pointerenter"); got.pulled = Q("[data-ap-card]").map(function(c){ return c.style.transition; }); }, 3100);',
  ].join('\n'), ['--force-prefers-reduced-motion']);
  if (calm.error) bad(calm.error);
  else eq(calm, { transitions: ['none', 'none'], pulled: ['none', 'none'] }, 'with reduced motion asked for, a card comes in and is drawn out with no motion at all');
};
