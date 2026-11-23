// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Sections added to the official agent map: the commands this session left running detached, its scheduled prompts, the
// `claude -p` workers and the `claude --bg` sessions it started; the map's layout, which puts the conversation's own row
// first and gives every section, Claude Code's two among them, a heading of the same kind; and the dots of the map's own
// row and of the footer button that opens the map.
// Fragment of the in-page script - see README.md in this folder.

  // Everything here runs inside the panel's own render, so a throw would take the dialog - and on past evidence the
  // whole page - down with it. Every entry point returns a harmless value instead.
  //
  // The extension host reads the task files and hands them over through the live stylesheet, base64 in a custom
  // property, because a prompt is full of quotes and newlines that a stylesheet would not carry as-is.
  //
  // Cached per stylesheet and cleared with the isOn/isOff cache (05-page-setup.js), since the agent map and the footer
  // read these on every render and getComputedStyle forces a style recalculation.
  var propCache = {};
  var readProp = function(name){
    if (Object.prototype.hasOwnProperty.call(propCache, name)) return propCache[name];
    var raw = '';
    try { raw = String(getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim(); }
    catch (e) { return []; }
    var list = [];
    var packed = raw.replace(/^["']/, '').replace(/["']$/, '');
    if (packed.length > 3) {
      try {
        // base64 decodes to one byte per character, and a prompt is not ASCII, so the bytes are read back as UTF-8.
        var bin = atob(packed), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (parsed && parsed.length) list = parsed;
      } catch (e) {}
    }
    propCache[name] = list;
    return list;
  };
  var allSchedules = function(){ return readProp('--cce-schedule'); };

  // A task names the session that created it, which is how a panel tells its own from every other one on the machine.
  var mySchedules = function(){
    var sid = sigValue('sessionId');
    if (!sid) return [];
    var all = allSchedules(), out = [];
    for (var i = 0; i < all.length; i++) if (all[i] && all[i].session === sid) out.push(all[i]);
    return out;
  };

  var pad2 = function(s){ return String(s).length < 2 ? '0' + s : String(s); };
  /*
   * A reading of the schedule, or the expression as written. An expression this cannot read is shown verbatim: a wrong
   * plain-English reading would be worse than none, since the reader has no way to tell one from the other.
   *
   * The list form gets its own case because it is how a repeating gap is moved off the hour. A step of twenty in the
   * minute field can only fire at :00, :20 and :40, so the same twenty minutes shifted seven past the hour has to be
   * spelled out as `7,27,47`. (The step syntax itself is not written out here: the two characters that open it would
   * close this comment.)
   *
   * The gap is reported only when every gap matches, the wrap from the last minute of one hour to the first of the next
   * included. That last one is what makes the reading true rather than merely plausible: `5,25,40` looks evenly spaced
   * from inside the hour and is not, because the wrap is 25. Requiring it also means a reported gap always divides 60,
   * which is a property of the field itself - its pattern repeats every hour - and not a limit of this reading.
   */
  var minuteList = function(field){
    if (!/^\d+(,\d+)+$/.test(field)) return null;
    var parts = field.split(','), mins = [], i;
    for (i = 0; i < parts.length; i++) {
      var n = Number(parts[i]);
      if (!isFinite(n) || n < 0 || n > 59 || mins.indexOf(n) !== -1) return null;
      mins.push(n);
    }
    mins.sort(function(a, b){ return a - b; });
    return mins;
  };
  var evenGap = function(mins){
    var gap = 60 - mins[mins.length - 1] + mins[0];
    for (var i = 1; i < mins.length; i++) if (mins[i] - mins[i - 1] !== gap) return 0;
    return gap;
  };
  var cronText = function(cron){
    var c = String(cron || '').trim(), m;
    if ((m = /^\*\/(\d+) \* \* \* \*$/.exec(c))) return 'every ' + m[1] + ' min';
    if ((m = /^(\d+) \* \* \* \*$/.exec(c))) return 'hourly at :' + pad2(m[1]);
    if ((m = /^(\d+) (\d+) \* \* \*$/.exec(c))) return 'daily at ' + m[2] + ':' + pad2(m[1]);
    if ((m = /^([\d,]+) \* \* \* \*$/.exec(c))) {
      var mins = minuteList(m[1]);
      if (mins) {
        var gap = evenGap(mins);
        if (gap) return 'every ' + gap + ' min';
        var at = [];
        for (var i = 0; i < mins.length; i++) at.push(':' + pad2(mins[i]));
        return 'hourly at ' + at.join(', ');
      }
    }
    return c || 'unknown interval';
  };
  var agoText = function(ms){
    if (typeof ms !== 'number' || !isFinite(ms)) return 'never';
    var s = Math.round((Date.now() - ms) / 1000);
    if (s < 0) return 'just now';
    if (s < 90) return s + 's ago';
    var mins = Math.round(s / 60);
    if (mins < 90) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    return hrs < 36 ? hrs + 'h ago' : Math.round(hrs / 24) + 'd ago';
  };

  /*
   * How the map looks. Claude Code's dialog draws the conversation's own row, its subagents as a tree beside that row,
   * and the commands it put in the background, each group under a line of plain text the size of the rows. This page
   * draws its sections the way Claude Code draws a row - a card with a dot, a title on one line and one line under it -
   * under a heading that reads as one: a label in capitals and a count, smaller and bolder than the cards, behind a thin
   * line. Claude Code's two headings get the same look from attributes and the stylesheet, its text left in place.
   *
   * The stylesheet then makes the conversation's own row the first thing in the map, under a heading of its own, and
   * puts every section after it, Claude Code's first. It does that only while the dialog has the shape it was written
   * against - its content holding the tree, the tree a node, the node the conversation's row - which :has() tells; any
   * other shape keeps Claude Code's order, with this page's sections above it.
   *
   * An empty section is left out, as Claude Code leaves out its own background tasks when there are none; its "0 agents"
   * is hidden for the same reason, since the conversation's row sits right under it.
   *
   * Nothing of ours goes inside Claude Code's nodes: the sections come back from __cceSchedule as part of the panel's own
   * render, and its headings only get attributes and hover text.
   */
  var MAP_BOX = '[class*="content_"]:has(>[data-cce-map]>[data-cce-map-me]):has(>[class*="tree_"]>[class*="node_"]>[class*="rowMain_"])';
  var MAP_TREE = MAP_BOX + '>[class*="tree_"]', MAP_NODE = MAP_TREE + '>[class*="node_"]', MAP_KIDS = MAP_NODE + '>[class*="children_"]';
  var HEAD_SIZE = 'calc(var(--vscode-chat-font-size, 13px) - 2px)';
  var MAP_CSS = [
    MAP_BOX + '{display:flex;flex-direction:column;align-items:flex-start;box-sizing:border-box;padding-right:8px}',
    MAP_TREE + ',' + MAP_NODE + ',' + MAP_BOX + '>[data-cce-map]{display:contents}',
    // A column that scrolls would otherwise squeeze its items, down to nothing for one that clips what overflows.
    MAP_BOX + '>*,' + MAP_NODE + '>*,' + MAP_BOX + '>[data-cce-map]>*{flex-shrink:0}',
    MAP_BOX + '>[data-cce-map]>[data-cce-map-me]{display:block;order:1}',
    MAP_NODE + '>[class*="rowMain_"]{order:2;position:relative;max-width:100%}',
    MAP_NODE + '>[class*="rowMain_"]::after,' + MAP_KIDS + '::before,' + MAP_KIDS + '>[class*="child_"]::before,'
      + MAP_KIDS + '>[class*="child_"]::after{display:none}',
    MAP_BOX + '>[class*="subtitle_"]{order:3}',
    MAP_KIDS + '{order:4;margin-left:0;max-width:100%}',
    MAP_BOX + '>[class*="tasks_"]{order:5;align-self:stretch;margin-top:0;padding-right:0}',
    MAP_BOX + '>[data-cce-map]>[data-cce-map-section]{order:6;padding-right:0}',
    // A narrow side bar: the rows give up their fixed width rather than run past the edge.
    MAP_BOX + '>[class*="tasks_"]>[class*="row_"],' + MAP_KIDS + '>[class*="child_"]>[class*="node_"]>[class*="row_"]{max-width:100%}',
    '[data-cce-map-me]{display:none}',
    '.cce-map-head,[data-cce-map-cc]{display:block;align-self:stretch;box-sizing:border-box;margin:12px 0 0;padding-top:8px;'
      + 'border-top:1px solid var(--app-primary-border-color, rgba(128,128,128,.35));'
      + 'color:var(--vscode-sideBarSectionHeader-foreground, var(--app-primary-foreground));font-weight:700;letter-spacing:.04em;'
      + 'line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:' + HEAD_SIZE + '}',
    '[data-cce-map-cc]{font-size:0 !important}',
    '[class*="subtitle_"][data-cce-map-cc]{margin-bottom:8px}',
    '[data-cce-map-cc]::before{content:attr(data-cce-map-cc);text-transform:uppercase;font-size:' + HEAD_SIZE + '}',
    '[data-cce-map-cc]::after{content:attr(data-cce-map-count)}',
    '[data-cce-map-cc][data-cce-map-count="0"]{display:none !important}',
    '.cce-map-label{text-transform:uppercase}',
    '.cce-map-cmd{font-family:var(--vscode-editor-font-family, monospace);font-weight:600;letter-spacing:0;margin-right:.4em}',
    '.cce-map-count,[data-cce-map-cc]::after{display:inline-block;box-sizing:border-box;min-width:18px;margin-left:6px;padding:0 5px;'
      + 'border-radius:9px;text-align:center;vertical-align:1px;line-height:16px;font-weight:600;letter-spacing:0;'
      + 'font-size:calc(var(--vscode-chat-font-size, 13px) - 3px);'
      + 'background:var(--vscode-badge-background, rgba(128,128,128,.35));color:var(--vscode-badge-foreground, inherit)}',
    '.cce-map-me{border-top:0;margin:0 0 8px;padding-top:0}',
    '.cce-map-section{display:flex;flex-direction:column;align-items:flex-start;gap:8px;align-self:stretch;padding:0 8px 8px 0}',
    '.cce-map-card{box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:2px;width:300px;max-width:100%;'
      + 'margin:0;padding:6px 10px;color:var(--app-primary-foreground);text-align:left;font-family:inherit;font-size:1em;list-style:none;'
      + 'background-color:var(--app-input-secondary-background);border:1px solid var(--app-input-border);border-radius:4px}',
    'summary.cce-map-card{cursor:pointer}',
    'summary.cce-map-card::-webkit-details-marker{display:none}',
    'summary.cce-map-card:hover{background-color:var(--app-list-hover-background)}',
    '.cce-map-title{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap}',
    '.cce-map-text{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.cce-map-more{margin-left:auto;padding-left:4px;color:var(--app-secondary-foreground);font-size:.8em;line-height:1}',
    'details[open]>summary .cce-map-more{transform:rotate(90deg)}',
    '.cce-map-meta{padding-left:14px;color:var(--app-secondary-foreground);font-size:.85em;white-space:nowrap;overflow:hidden;'
      + 'text-overflow:ellipsis}',
    '.cce-map-dot{display:inline-block;flex-shrink:0;box-sizing:border-box;width:8px;height:8px;border-radius:50%}',
    '[data-cce-map-dot="running"]{background:var(--app-status-busy)}',
    '[data-cce-map-dot="waiting"]{background:var(--app-status-pending)}',
    '[data-cce-map-dot="idle"]{background:var(--app-secondary-foreground);opacity:.4}',
    '[data-cce-map-dot="failed"]{background:var(--app-error-foreground)}',
    '.cce-map-item{max-width:100%}',
    '.cce-map-body{box-sizing:border-box;width:300px;max-width:100%;margin:6px 0 2px;padding-left:14px}',
  ].join('\n');
  var mapStyle = null;
  var putMapStyle = function(){
    if (mapStyle) return;
    try {
      var el = document.createElement('style');
      el.setAttribute('data-cce-map-css', '1');
      el.textContent = MAP_CSS;
      (document.head || document.documentElement).appendChild(el);
      mapStyle = el;
    } catch (e) {}
  };

  /* Claude Code's two headings, known by their words. Worded any other way, a heading is left as Claude Code draws it. */
  var CC_HEADS = [
    { re: /^(\d+) agents? · (click an agent for details)$/, label: 'Subagents' },
    { re: /^(\d+) background tasks? · (click a task for details)$/, label: 'Background tasks' },
  ];
  var ccHead = function(text){
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < CC_HEADS.length; i++) {
      var m = CC_HEADS[i].re.exec(t);
      if (m) return { label: CC_HEADS[i].label, count: m[1], hint: m[2].charAt(0).toUpperCase() + m[2].slice(1) + '.' };
    }
    return null;
  };
  var CC_HEAD_SEL = '[role="dialog"] [class*="subtitle_"], [role="dialog"] [class*="tasksHeader_"]';
  var setAttr = function(el, name, value){ if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
  var tagHeads = function(){
    try {
      var els = document.querySelectorAll(CC_HEAD_SEL);
      for (var i = 0; i < els.length; i++) {
        var el = els[i], got = ccHead(el.textContent);
        if (!got) {
          if (el.getAttribute('data-cce-map-cc') !== null) { el.removeAttribute('data-cce-map-cc'); el.removeAttribute('data-cce-map-count'); }
          continue;
        }
        setAttr(el, 'data-cce-map-cc', got.label);
        setAttr(el, 'data-cce-map-count', got.count);
        if (typeof setLabel === 'function') setLabel(el, got.hint);
      }
    } catch (e) {}
  };
  /* The map's render calls __cceSchedule before the panel has put its new nodes in, and their text changes in that same
     render: the headings are read once it has, before the browser paints. */
  var headsQueued = false;
  var queueHeads = function(){
    if (headsQueued) return;
    headsQueued = true;
    try { Promise.resolve().then(function(){ headsQueued = false; tagHeads(); }); } catch (e) { headsQueued = false; }
  };

  // The panel draws its own hover text, since the native one does not surface in it (05-page-setup.js).
  var hintOn = function(ev){ try { if (typeof showLabel === 'function' && ev && ev.currentTarget) showLabel(ev.currentTarget); } catch (e) {} };
  var hintOff = function(){ try { if (typeof hideLabel === 'function') hideLabel(); } catch (e) {} };
  var hinted = function(props, text){
    if (text) { props['aria-label'] = text; props.onMouseEnter = hintOn; props.onMouseLeave = hintOff; }
    return props;
  };
  /* A heading: an optional command in a code font, which keeps its own case, the label and the count. */
  var mapHead = function(h, label, count, note, cmd){
    var kids = [];
    if (cmd) kids.push(h('code', { className: 'cce-map-cmd', children: [cmd] }));
    kids.push(h('span', { className: 'cce-map-label', children: [label] }), h('span', { className: 'cce-map-count', children: [String(count)] }));
    return h('div', hinted({ className: 'cce-map-head', 'data-cce-map-head': (cmd ? cmd + ' ' : '') + label, children: kids }, note));
  };
  /* A card: dot is one of Claude Code's dot states (running, waiting, idle, failed). A card with a body opens it below
     on a click, and has an arrow that says so. Its hover text ends with its second line, which a narrow side bar cuts
     short. */
  var mapCard = function(h, o){
    var line = [h('span', { className: 'cce-map-dot', 'data-cce-map-dot': o.dot, children: [] }),
      h('span', { className: 'cce-map-text', children: [o.title] })];
    if (o.body) line.push(h('span', { className: 'cce-map-more', children: ['\u25b8'] }));
    var card = hinted({ className: 'cce-map-card', 'data-cce-map-card': o.kind, children: [
      h('span', { className: 'cce-map-title', children: line }),
      h('span', { className: 'cce-map-meta', children: [o.meta] }),
    ] }, o.note ? o.note + '\n' + o.meta : o.meta);
    if (!o.body) return h('div', card);
    return h('details', { className: 'cce-map-item', children: [h('summary', card), h('div', { className: 'cce-map-body', children: o.body })] });
  };
  var mapSection = function(h, kind, head, cards){
    return h('div', { className: 'cce-map-section', 'data-cce-map-section': kind, children: [head].concat(cards) });
  };
  var firstLineOf = function(text){
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i++) if (lines[i].trim()) return lines[i].trim();
    return '';
  };
  var BODY_PRE = {
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    margin: '0', padding: '8px', maxHeight: '200px', overflowY: 'auto',
    fontSize: '0.92em', lineHeight: '1.5', borderRadius: '4px',
    background: 'var(--vscode-textCodeBlock-background, rgba(255,255,255,0.05))',
  };
  var DIM = 'var(--app-secondary-foreground, var(--vscode-descriptionForeground, #9aa))';

  var scheduleRow = function(h, t){
    var prompt = String(t.prompt || '');
    var fired = typeof t.lastFiredAt === 'number' && isFinite(t.lastFiredAt) ? 'last fired ' + agoText(t.lastFiredAt) : 'never fired';
    return mapCard(h, { kind: 'schedule', dot: 'idle', title: firstLineOf(prompt) || '(the prompt was not recorded)',
      meta: cronText(t.cron) + ' · ' + fired, note: [String(t.cron || '').trim(), t.id || ''].filter(Boolean).join(' · '),
      body: [h('pre', { style: BODY_PRE, children: [prompt || '(the prompt was not recorded)'] })] });
  };
  var IDLE_NOTE = 'The interval is a floor on the wait, not a timetable: the prompt is delivered at the first idle '
                + 'moment after it comes due, so a conversation that stays busy pushes it back indefinitely. Click one to read it.';
  var scheduleSection = function(h, list){
    var cards = [];
    for (var i = 0; i < list.length; i++) cards.push(scheduleRow(h, list[i]));
    return mapSection(h, 'scheduled', mapHead(h, 'Scheduled prompts', list.length, IDLE_NOTE), cards);
  };

  /*
   * The detached sessions this conversation started with `claude --bg`, which the extension host finds in the
   * conversation's transcript and hands over the same way as the schedules.
   *
   * Opening one here is deliberately not offered. The panel starts Claude on any conversation it opens, so opening a
   * session that its own process is still writing would put a second process on it. What is offered instead is the
   * command that attaches to it from a terminal, which is the CLI's own way in.
   *
   * A session that has finished stays listed with how it ended, as the panel does for its own agents: the result is the
   * thing most worth reading, and a list that dropped finished sessions could not tell "done" from "never started".
   */
  var myBackground = function(){
    if (isOff('backgroundSessions')) return [];
    var sid = sigValue('sessionId');
    if (!sid) return [];
    var all = readProp('--cce-background'), out = [];
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (b && b.session === sid && typeof b.state === 'string' && b.state && /^[0-9a-f]{8}$/.test(b.id || '')) out.push(b);
    }
    return out;
  };
  var bgLive = function(b){ return b.state === 'working' || b.state === 'blocked'; };
  var BG_WARN = 'var(--vscode-editorWarning-foreground, #cca700)';
  var BG_STATE = { working: 'running', blocked: 'waiting for you', done: 'done', stopped: 'stopped', failed: 'failed' };
  /* Claude Code's dot for an agent in the same state: running, waiting for permission, finished, and stopped or failed. */
  var BG_DOT = { working: 'running', blocked: 'waiting', done: 'idle', stopped: 'failed', failed: 'failed' };
  var bgSpan = function(ms){
    if (!(ms > 0)) return '';
    var m = Math.round(ms / 60000);
    if (m < 1) return 'under a minute';
    if (m < 90) return m + ' min';
    var hr = Math.round(m / 60);
    return hr < 36 ? hr + 'h' : Math.round(hr / 24) + 'd';
  };
  var bgWhen = function(b){
    if (bgLive(b)) return b.startedAt ? 'for ' + bgSpan(Date.now() - b.startedAt) : '';
    return b.endedAt ? agoText(b.endedAt) : '';
  };
  var bgTokens = function(n){ return typeof n === 'number' && n > 0 ? Math.round(n / 1000) + 'k tokens' : ''; };
  // Only an attribute and an inline style change on the button. It is an element of the panel's own render, and
  // putting anything inside one of those is what once made the panel's next render throw and leave the page dead.
  var bgCopy = function(el, text){
    try {
      if (!el || !navigator.clipboard || !navigator.clipboard.writeText) return;
      navigator.clipboard.writeText(text).then(function(){
        el.style.opacity = '0.5';
        el.setAttribute('title', 'Copied');
        setTimeout(function(){ el.style.opacity = ''; el.setAttribute('title', 'Copy to the clipboard'); }, 900);
      }, function(){});
    } catch (e) {}
  };
  var bgButton = function(h, text){
    return h('button', {
      type: 'button', title: 'Copy to the clipboard',
      style: {
        cursor: 'pointer', font: 'inherit', fontSize: '0.92em', padding: '2px 8px', borderRadius: '4px',
        color: 'inherit', background: 'transparent', border: '1px solid var(--app-input-border, rgba(128,128,128,0.4))',
      },
      onClick: function(ev){ try { ev.stopPropagation(); } catch (e) {} bgCopy(ev && ev.currentTarget, text); },
      children: [text],
    });
  };
  var bgRow = function(h, b){
    var body = [];
    if (b.state === 'blocked' && b.needs) body.push(h('div', { style: { color: BG_WARN, marginBottom: '6px' }, children: ['Waiting for you: ' + b.needs] }));
    if (b.state === 'working' && b.detail) body.push(h('div', { style: { marginBottom: '6px' }, children: [b.detail] }));
    if (!bgLive(b)) body.push(h('pre', { style: BODY_PRE, children: [b.result || 'No result was recorded.'] }));
    if (b.task) {
      body.push(h('details', { style: { margin: '6px 0' }, children: [
        h('summary', { style: { cursor: 'pointer', listStyle: 'revert', color: DIM }, children: ['Task'] }),
        h('pre', { style: BODY_PRE, children: [b.task] }),
      ] }));
    }
    body.push(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }, children: [
      bgButton(h, 'claude attach ' + b.id), bgButton(h, 'claude logs ' + b.id),
    ] }));
    var meta = [BG_STATE[b.state] || b.state], at = bgWhen(b), tk = b.state === 'working' ? bgTokens(b.tokens) : '';
    if (at) meta.push(at);
    if (tk) meta.push(tk);
    meta.push(b.id);
    return mapCard(h, { kind: 'background', dot: BG_DOT[b.state] || 'idle', title: b.name || b.id, meta: meta.join(' · '), body: body });
  };
  var BG_NOTE = 'Sessions this conversation started with claude --bg. Each runs in its own process; click one for its '
              + 'result and the commands that reach it from a terminal.';
  var BG_ORDER = ['working', 'blocked', 'failed', 'done', 'stopped'];
  /* The heading's hover text counts each state, which the dots alone tell apart only roughly. */
  var bgSection = function(h, list){
    var by = {}, counts = [], cards = [];
    for (var i = 0; i < list.length; i++) by[list[i].state] = (by[list[i].state] || 0) + 1;
    for (var j = 0; j < BG_ORDER.length; j++) if (by[BG_ORDER[j]]) counts.push(by[BG_ORDER[j]] + ' ' + BG_STATE[BG_ORDER[j]]);
    // Newest first: the one just launched is the one being looked for.
    for (var k = list.length - 1; k >= 0; k--) cards.push(bgRow(h, list[k]));
    return mapSection(h, 'background', mapHead(h, 'sessions', list.length, BG_NOTE + (counts.length ? ' Now ' + counts.join(', ') + '.' : ''), 'claude --bg'), cards);
  };

  /*
   * The `claude -p` workers this conversation started and that still run, from their session records
   * (workerRows in src/background.js). Their output goes wherever the command that started them sent it, often a file,
   * so the panel never learns of them. Not offered for opening, for the reason the detached sessions are not.
   */
  var myWorkers = function(){
    if (isOff('backgroundSessions')) return [];
    var sid = sigValue('sessionId');
    if (!sid) return [];
    var all = readProp('--cce-workers'), out = [];
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      if (w && w.session === sid && typeof w.id === 'string' && typeof w.pid === 'number') out.push(w);
    }
    out.sort(function(a, b){ return (b.startedAt || 0) - (a.startedAt || 0); });
    return out;
  };

  /*
   * The commands this conversation left running detached, which the extension host finds among the machine's processes
   * (src/detached.js). Claude Code keeps no account of them, and they are what keeps the conversation's dot green once
   * its turn is over; the command line shows whether one is the work itself or, say, a server a build left behind.
   * One that holds a worker listed above is that worker's wrapper, and is left out.
   */
  var myDetached = function(){
    if (isOff('detachedCommands')) return [];
    var sid = sigValue('sessionId');
    if (!sid) return [];
    var listed = {}, ws = myWorkers();
    for (var k = 0; k < ws.length; k++) listed[ws[k].id] = true;
    var all = readProp('--cce-detached'), out = [];
    for (var i = 0; i < all.length; i++) {
      var j = all[i];
      if (!j || j.session !== sid || typeof j.pid !== 'number') continue;
      var holds = false;
      if (j.workers && j.workers.length) for (var n = 0; n < j.workers.length; n++) if (listed[j.workers[n]]) holds = true;
      if (!holds) out.push(j);
    }
    out.sort(function(a, b){ return (b.startedAt || 0) - (a.startedAt || 0); });
    return out;
  };
  /* The panel renders the footer button and the agent map from its own state, which a new stylesheet does not touch.
     Reading a signal during those renders subscribes them to it, so bumping it redraws them when a stylesheet changes
     what they show. */
  var mapTick = null, mapSeen = null;
  var mapRenders = function(){
    if (!mapTick && typeof window.__cceSignal === 'function') mapTick = window.__cceSignal(0);
    return mapTick ? mapTick.value : 0;
  };
  window.__cceStyleArrived = function(){
    try {
      var now = JSON.stringify([myDetached(), mySchedules(), myBackground(), myWorkers()]);
      if (now === mapSeen) return;
      mapSeen = now;
      bgCountsAt = 0;
      if (mapTick) mapTick.value = mapTick.value + 1;
    } catch (e) {}
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var startText = function(ms){
    var d = new Date(ms), now = new Date();
    var t = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return d.toDateString() === now.toDateString() ? t : MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + t;
  };
  /* The title is the host's (titleOf in src/detached.js); a window still on an older build hands over only a label. */
  var detachedRow = function(h, j){
    var cmd = String(j.command || ''), meta = ['pid ' + j.pid];
    if (j.startedAt > 0) meta.push('started ' + startText(j.startedAt), bgSpan(Date.now() - j.startedAt));
    return mapCard(h, { kind: 'detached', dot: 'running', title: String(j.title || j.label || cmd || '(command line not read)'),
      meta: meta.join(' · '), note: cmd });
  };
  var DETACHED_NOTE = 'This conversation left these commands running outside Claude Code: a shell or script that outlasted '
                    + 'the command that started it, or a program started with setsid. They keep the conversation\'s dot green. '
                    + 'Claude Code does not wake the conversation when one stops. A card\'s hover text is its whole command line.';
  var detachedSection = function(h, list){
    var cards = [];
    for (var i = 0; i < list.length; i++) cards.push(detachedRow(h, list[i]));
    return mapSection(h, 'detached', mapHead(h, 'Detached commands', list.length, DETACHED_NOTE), cards);
  };

  /* The record's status: busy while a turn runs, shell while a command of its own runs, idle while it waits for input. */
  var WORKER_STATE = { busy: 'running', shell: 'running a command', idle: 'idle' };
  var workerRow = function(h, w){
    var live = w.status === 'busy' || w.status === 'shell', meta = ['pid ' + w.pid];
    if (w.startedAt > 0) meta.push('started ' + startText(w.startedAt), bgSpan(Date.now() - w.startedAt));
    return mapCard(h, { kind: 'worker', dot: live ? 'running' : 'idle', title: w.name || w.id.slice(0, 8), meta: meta.join(' · '),
      note: 'claude -p session ' + w.id + ' · ' + (WORKER_STATE[w.status] || w.status || 'state unknown') });
  };
  var WORKER_NOTE = 'claude -p sessions this conversation started that are still running, found from their session '
                  + 'records. Each runs in its own process and writes its output wherever the command that started it sent it.';
  var workerSection = function(h, list){
    var cards = [];
    for (var i = 0; i < list.length; i++) cards.push(workerRow(h, list[i]));
    return mapSection(h, 'workers', mapHead(h, 'sessions', list.length, WORKER_NOTE, 'claude -p'), cards);
  };

  /* Called by the panel with its own element factory, as the first child of the dialog's content, so this returns a
     real element tree rather than text: the heading over the conversation's own row and this page's sections, in a
     wrapper the stylesheet takes out of the layout (display: contents) so that each lands in its place among Claude
     Code's. */
  var mapMe = function(h){
    return h('div', { className: 'cce-map-head cce-map-me', 'data-cce-map-me': '1', children: [
      h('span', { className: 'cce-map-label', children: ['This conversation'] }),
    ] });
  };
  window.__cceSchedule = function(h){
    try {
      if (typeof h !== 'function') return null;
      mapRenders();
      putMapStyle();
      queueHeads();
      var parts = [mapMe(h)];
      var det = myDetached();
      if (det.length) parts.push(detachedSection(h, det));
      var sched = mySchedules();
      if (sched.length) parts.push(scheduleSection(h, sched));
      var ws = myWorkers();
      if (ws.length) parts.push(workerSection(h, ws));
      var bgs = myBackground();
      if (bgs.length) parts.push(bgSection(h, bgs));
      return h('div', { 'data-cce-map': '1', children: parts });
    } catch (e) { return null; }
  };

  // The footer asks for these on every one of its renders, so the answer is held briefly rather than recomputed each time.
  var bgCountsAt = 0, bgCounts = { detached: 0, timers: 0, bg: 0, live: 0, waiting: 0, tasks: 0, workers: 0, counted: 0, helpers: 0 };
  /* The commands running in the background - a build, a test run, a `sleep` used as a timer. The official agent map
     already lists them under its own heading, but its button appears only once the conversation has started an agent,
     so a conversation whose only background work is a command had no way to the list short of typing /tasks. The
     panel keeps only the running ones here; a finished one moves to a list of outcomes. */
  var runningTasks = function(){
    var m = sigValue('backgroundTasks');
    return m && typeof m.size === 'number' ? m.size : 0;
  };
  // The panel's own set of subagents and workflows running in the background.
  var runningHelpers = function(){
    var s = sigValue('backgroundTaskIds');
    return s && typeof s.size === 'number' ? s.size : 0;
  };
  var ourCounts = function(){
    mapRenders();
    /* The panel's own sets are read on every call, cached or not: a render subscribes only to the signals it reads, and
       one that read none of them would not be drawn again when the work they hold ends. */
    var tasks = runningTasks(), helpers = runningHelpers();
    var now = Date.now();
    if (now - bgCountsAt < 500) { bgCounts.tasks = tasks; bgCounts.helpers = helpers; return bgCounts; }
    bgCountsAt = now;
    var bgs = myBackground(), live = 0, waiting = 0;
    for (var i = 0; i < bgs.length; i++) {
      if (bgLive(bgs[i])) live++;
      if (bgs[i].state === 'blocked') waiting++;
    }
    /* A worker still inside a Bash call of this conversation is that call's work, which the panel already shows as
       a task or as the turn itself; the label names it only once that call is over. */
    var ws = myWorkers(), counted = 0;
    for (var k = 0; k < ws.length; k++) if (!ws[k].inside) counted++;
    bgCounts = { detached: myDetached().length, timers: mySchedules().length, bg: bgs.length, live: live, waiting: waiting,
      tasks: tasks, workers: ws.length, counted: counted, helpers: helpers };
    return bgCounts;
  };
  /* Background work of this conversation running now. A scheduled prompt runs nothing until it comes due, and a
     finished session nothing at all. */
  var workRuns = function(){
    var c = ourCounts();
    return c.tasks + c.detached + c.live + c.workers + c.helpers > 0;
  };
  // Opens the footer button: anything of ours to show is reason enough, finished sessions included, since their results
  // are what someone comes to read.
  window.__cceScheduleCount = function(){
    try { var c = ourCounts(); return c.detached + c.timers + c.bg + c.tasks + c.workers; } catch (e) { return 0; }
  };

  // The button's own label counts agents, so on a session with only our kinds it would read "0 agents". Detached
  // sessions are counted while they run or wait; finished ones are named only when nothing else would be.
  window.__cceAgentsLabel = function(official, count){
    try {
      if (typeof official !== 'string') return official;
      var c = ourCounts(), extra = [];
      // Running work first.
      if (c.detached) extra.push(c.detached + ' detached');
      if (c.timers) extra.push(c.timers + (c.timers === 1 ? ' timer' : ' timers'));
      if (c.tasks) extra.push(c.tasks + (c.tasks === 1 ? ' task' : ' tasks'));
      if (c.counted) extra.push(c.counted + (c.counted === 1 ? ' worker' : ' workers'));
      if (c.live) extra.push(c.live + ' bg' + (c.waiting ? ' (' + c.waiting + ' waiting)' : ''));
      else if (c.bg && !(count > 0) && !c.timers && !c.tasks && !c.detached && !c.workers) extra.push(c.bg + ' bg done');
      if (!extra.length) return official;
      return count > 0 ? official + ' · ' + extra.join(' · ') : extra.join(' · ');
    } catch (e) { return official; }
  };

  /* The button's dot: Claude Code's, which follows its agents alone, turned green while any other background work of
     this conversation runs, so the dot agrees with what the label counts. Waiting for an answer keeps its own colour. */
  window.__cceAgentsDot = function(official){
    try {
      if (official === 'waiting' || official === 'running') return official;
      return workRuns() ? 'running' : official;
    } catch (e) { return official; }
  };
  var WORK_RUNS_TITLE = 'Background work is running · Click to open the agent map';
  window.__cceAgentsTitle = function(text, dot, was){
    try { return dot === 'running' && was !== 'running' ? WORK_RUNS_TITLE : text; } catch (e) { return text; }
  };

  /*
   * The conversation's own row in the map, drawn as its tab and its session list row are (src/activity.js): green while
   * a turn runs, a green ring once the turn has ended and background work still runs, red while it waits for you.
   * Background work is what this page counts, or what the extension host found (84-row-marks.js), which also covers
   * work the panel does not show, such as a detached command while the map's list of them is switched off.
   * busy is the panel's own reading of a turn running; session is the map's.
   */
  window.__cceMainDot = function(busy, session){
    try {
      var sid = (session && session.sessionId && session.sessionId.value) || sigValue('sessionId');
      var host = sid && typeof marksNow === 'function' ? marksNow().dots[sid] : void 0;
      if (host === 'waiting') return { state: 'waiting' };
      if (busy) return { state: 'running' };
      if (host === 'working' || host === 'background' || workRuns()) return { state: 'running', ring: true };
      return { state: 'idle' };
    } catch (e) { return { state: busy ? 'running' : 'idle' }; }
  };
