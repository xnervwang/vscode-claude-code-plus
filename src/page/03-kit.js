// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.
// Source: vscode-agent-plus shared/page/kit.js; sync-shared.js copies it, so edit it there.

/*
 * Helpers shared by the Claude Code Plus and Codex Plus page scripts, exported as a single object, agentPlusKit, so
 * that its names cannot collide with names already in either page. Claude Code Plus adds this file to its page script
 * as a fragment; Codex Plus puts it in front of its page script, and each patch's marker is a digest of the combined
 * script. Under Node it is also a module, for the session list Codex Plus draws in the extension host. The source is
 * ASCII and ES5, like the page scripts.
 */
var agentPlusKit = (function () {
  'use strict';
  var ARROW = String.fromCharCode(8594);
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /* HH:MM:SS, or HH:MM without seconds. A day other than today goes in front as MM/DD, with the year when it is not
     this one: month before day everywhere, so 01/10 never reads as two different days. */
  function stamp(ms, secs) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '';
    var d = new Date(ms), now = new Date();
    var t = p2(d.getHours()) + ':' + p2(d.getMinutes()) + (secs === false ? '' : ':' + p2(d.getSeconds()));
    if (d.toDateString() === now.toDateString()) return t;
    var md = p2(d.getMonth() + 1) + '/' + p2(d.getDate());
    return (d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '/' + md) + ' ' + t;
  }

  /* How long ago, as Claude Code's own session list writes it: now, then whole minutes, hours, days, months of 30 days
     and years. */
  function age(ms, now) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '';
    var s = Math.max(0, Math.floor(((now == null ? Date.now() : now) - ms) / 1000));
    var m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24), mo = Math.floor(d / 30), y = Math.floor(d / 365);
    return y > 0 ? y + 'y' : mo > 0 ? mo + 'mo' : d > 0 ? d + 'd' : h > 0 ? h + 'h' : m > 0 ? m + 'm' : 'now';
  }

  /* The days a conversation spans, from its first message to its last, or one day when both are the same: 11/05->11/09.
     A year other than the current one is written once, in front, for a span within that year. */
  function span(firstMs, lastMs, now) {
    if (typeof lastMs !== 'number' || !isFinite(lastMs) || !lastMs) return '';
    var year = new Date(now == null ? Date.now() : now).getFullYear();
    var ymd = function (ms) { var t = new Date(ms); return { y: t.getFullYear(), md: p2(t.getMonth() + 1) + '/' + p2(t.getDate()) }; };
    var one = function (v) { return v.y === year ? v.md : v.y + '/' + v.md; };
    var e = ymd(lastMs), s = typeof firstMs === 'number' && isFinite(firstMs) && firstMs ? ymd(firstMs) : null;
    if (!s || (s.y === e.y && s.md === e.md)) return one(e);
    return s.y === e.y && s.y !== year ? s.y + '/' + s.md + ARROW + e.md : one(s) + ARROW + one(e);
  }

  function kfmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '-';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n));
  }
  function pct(n, of) {
    if (!(of > 0)) return '';
    var v = 100 * n / of;
    return v < 0.1 && v > 0 ? '<0.1%' : v.toFixed(1) + '%';
  }

  /* Each chime has its own pattern: rising for a finished turn, three equal notes when the agent waits for a
     permission, falling for a question. Each step is [Hz, start in s, length in s]. */
  var TONES = {
    done: [[880, 0, 0.09], [1174, 0.09, 0.16]],
    permission: [[880, 0, 0.07], [880, 0.13, 0.07], [880, 0.26, 0.11]],
    question: [[1174, 0, 0.09], [880, 0.10, 0.16]],
  };
  TONES.approval = TONES.permission;
  var GAIN = 0.05, RESUME_WAIT_MS = 300;
  var audio = null;
  function audioCtx() {
    var Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    if (!audio || audio.state === 'closed') { try { audio = new Ctor(); } catch (e) { audio = null; } }
    return audio;
  }
  /* A context made before anyone has clicked or typed in the page starts suspended under the browser's autoplay rule.
     The page calls this from its first click or key. */
  function unlockAudio() {
    var ac = audioCtx();
    if (ac && ac.state === 'suspended' && typeof ac.resume === 'function') { try { ac.resume(); } catch (e) { /* refused */ } }
  }
  /* Plays `kind` and calls tell(kind, state) with the context's state, 'unavailable' when there is none. A suspended
     context is resumed first; a refused resume() never settles, so the chime is dropped after RESUME_WAIT_MS rather
     than sounding at some later click. */
  function chime(kind, tell) {
    var say = typeof tell === 'function' ? tell : function () {};
    var ac = audioCtx();
    if (!ac) { say(kind, 'unavailable'); return; }
    var play = function () {
      try {
        var steps = TONES[kind] || TONES.done, t0 = ac.currentTime + 0.01;
        for (var i = 0; i < steps.length; i++) {
          var at = t0 + steps[i][1], dur = steps[i][2];
          var o = ac.createOscillator(), g = ac.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(steps[i][0], at);
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(GAIN, at + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
          o.connect(g); g.connect(ac.destination);
          o.start(at); o.stop(at + dur + 0.02);
        }
      } catch (e) { /* no audio here */ }
      say(kind, ac.state);
    };
    if (ac.state !== 'suspended' || typeof ac.resume !== 'function') { play(); return; }
    var settled = false;
    var go = function () {
      if (settled) return;
      settled = true;
      if (ac.state === 'running') play(); else say(kind, ac.state);
    };
    try { Promise.resolve(ac.resume()).then(go, go); } catch (e) { go(); }
    setTimeout(go, RESUME_WAIT_MS);
  }

  /*
   * A hover label drawn by the page, since neither panel shows a native title. `opts.mark` is [attribute, value] put on
   * the box, `opts.css` its look. The box is placed after it is in the document, because its height depends on how the
   * text wrapped: centred over the control and kept 8px inside the window, above it when there is room and below
   * otherwise. It is removed on leave and on click, since a label left over a control after it is clicked looks stuck.
   */
  function labels(opts) {
    var box = null;
    var rect = function (el) { try { return el.getBoundingClientRect(); } catch (e) { return null; } };
    function hide() { if (box) { try { box.parentNode && box.parentNode.removeChild(box); } catch (e) { /* gone */ } box = null; } }
    function show(el, text) {
      var said = typeof text === 'string' && text ? text : el && el.getAttribute && el.getAttribute('aria-label');
      if (!said || !document.body) return;
      hide();
      var b = document.createElement('div');
      if (opts.mark) b.setAttribute(opts.mark[0], opts.mark[1]);
      b.style.cssText = 'position:fixed;pointer-events:none;max-width:260px;line-height:1.35;white-space:pre-line;overflow-wrap:anywhere;'
        + (opts.css || '');
      b.textContent = said;
      document.body.appendChild(b);
      var r = rect(el), s = rect(b);
      if (r && s) {
        var vw = +globalThis.innerWidth || 0, w = s.width || 0, h = s.height || 0;
        var top = r.top || 0, bottom = r.bottom != null ? r.bottom : top + (r.height || 0);
        var left = (r.left || 0) + (r.width || 0) / 2 - w / 2;
        b.style.left = Math.round(Math.max(8, vw ? Math.min(vw - w - 8, left) : left)) + 'px';
        b.style.top = Math.round(top - h - 8 >= 8 ? top - h - 8 : bottom + 8) + 'px';
      }
      box = b;
    }
    /* Gives `el` its label text and, once, the listeners; `wired` is the attribute that says it has them. */
    function wire(el, text, wired) {
      if (!el) return;
      if (el.getAttribute('aria-label') !== text) el.setAttribute('aria-label', text);
      if (el.getAttribute(wired) !== null) return;
      el.setAttribute(wired, '1');
      el.addEventListener('mouseenter', function () { show(el); });
      el.addEventListener('mouseleave', hide);
      el.addEventListener('click', hide);
    }
    return { show: show, hide: hide, wire: wire, current: function () { return box; } };
  }


  /*
   * The cards of the conversations that need the user (Agent Plus's notices), stacked at the bottom right of a page: the
   * newest in front and fully shown, up to STACK.depth older ones peeking out above it, each a little narrower, and a
   * count of the rest. Pointing at a card behind the front one, or giving it the focus, draws it out above the cards in
   * front of it, and the cards behind it move up to make room; leaving puts it back. All of it is transforms on cards
   * that keep their place in the document, so the browser's own hit testing follows the cards: the strip a card shows
   * lies inside where it is drawn out to, all the way there, and the pointer stays on it while it moves.
   *
   * The mode (agentPlus.notifications.cards) says which cards are drawn: every one ('normal'); one that arrives while
   * the page is open, for STACK.foldMs and for as long after as the pointer or the focus is on the stack, then none
   * ('folded'); or none ('quiet'). The bar over the stack offers the other two modes beside Dismiss all.
   *
   * opts: post(action, card), action 'open', 'dismiss', 'dismiss-all', 'mode-normal', 'mode-folded' or 'mode-quiet';
   * anchor(), { bottom, right, width }: the stack's distance from the bottom and the right of the window and the most it
   * may be wide, in px; room(px), told how tall the stack stands at rest, 0 once nothing is drawn, so the page can leave
   * that much free below what it shows; skip(card), true for a card this page leaves out; colors, { waiting, finished };
   * leave(), where Escape sends the focus. Returns set(cards, hostNow, mode), place() after the page has changed size,
   * refresh() after skip() has changed, and dispose().
   */
  var STACK = { width: 320, height: 56, peek: 8, depth: 3, shrink: 0.04, margin: 10, enterMs: 260, pullMs: 170, leaveMs: 200, foldMs: 5000 };
  var MODES = { normal: { label: 'Normal', title: 'Normal: every card stays' },
    folded: { label: 'Fold', title: 'Folded: a new card shows for 5 seconds, then goes; the cards are kept' },
    quiet: { label: 'Do not disturb', title: 'Do not disturb: new cards are kept but not shown' } };
  var EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
  var KIND_TEXT = { waiting: 'Waiting for you', finished: 'Finished' };
  var DOT = String.fromCharCode(183), TIMES = String.fromCharCode(215);
  /* #rgb or #rrggbb at `alpha`; anything else as it is. */
  function tint(color, alpha) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || ''));
    if (!m) return color;
    var h = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + alpha + ')';
  }

  /* Where card i of n is drawn, given the card drawn out (-1 for none): a move up in px and a scale, and whether it
     shows. The cards are laid out at the bottom and scaled from their top edge, so each one behind shows `peek` px. */
  function stackLayout(n, pulled, o) {
    var s = o || STACK, out = [];
    for (var i = 0; i < n; i++) {
      var level = Math.min(i, s.depth);
      var y = -s.peek * level, scale = 1 - s.shrink * level, shown = i <= s.depth;
      if (pulled > 0 && i === pulled) { y = -s.height - s.peek * (Math.min(i, s.depth + 1) - 1); scale = 1; shown = true; }
      else if (pulled > 0 && i > pulled) y -= s.height - s.peek;
      out.push({ y: y, scale: scale, shown: shown });
    }
    return out;
  }

  /* One card: the same conversation needing the user again is another card. */
  function cardId(c) { return JSON.stringify([String(c.sourceId), String(c.sessionId), Number(c.at) || 0]); }

  /* Which of `cards` are drawn in `mode`: all of them in normal (and in a mode not known), none in quiet, and in folded
     those whose time (`until[cardId]`, ms) is later than `now` or that are held (`held[cardId]`). */
  function inMode(cards, mode, until, held, now) {
    if (mode === 'quiet') return [];
    if (mode !== 'folded') return cards.slice();
    return cards.filter(function (c) { var id = cardId(c); return (until[id] || 0) > now || !!held[id]; });
  }

  function noticeStack(opts) {
    var doc = document, root = null, head = null, count = null, all = null, live = null;
    var els = {}, order = [], last = [], pulled = -1, hovered = -1, focused = -1, inside = false, within = false, drawn = false;
    var mode = 'normal', known = {}, until = {}, primed = false, foldTimer = 0, kept = 0, modeButtons = {}, hideTimer = 0;
    var skew = 0, placer = 0, gone = {}, room = -1, spot = { bottom: 12, right: STACK.margin, width: STACK.width };
    var GONE_WAIT_MS = 3000;
    var colors = (opts && opts.colors) || { waiting: '#ef4444', finished: '#22c55e' };
    var keyOf = function (c) { return JSON.stringify([String(c.sourceId), String(c.sessionId)]); };
    var calm = function () {
      try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    };
    var quick = function () { return !calm() && !doc.hidden && drawn; };
    var post = function (action, card) { try { opts.post(action, card || null); } catch (e) { /* the host never hears */ } };
    var el = function (tag, css, attrs) {
      var e = doc.createElement(tag);
      if (css) e.style.cssText = css;
      for (var k in attrs || {}) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
      return e;
    };
    var width = function () {
      return Math.max(160, Math.min(STACK.width, spot.width, (doc.documentElement.clientWidth || 0) - spot.right - STACK.margin));
    };
    var ageOf = function (c) {
      var a = age(c.at + skew, Date.now());
      return a === 'now' ? 'just now' : a + ' ago';
    };

    function build() {
      root = el('div', 'position:fixed;right:' + STACK.margin + 'px;bottom:12px;height:' + STACK.height + 'px;z-index:900;pointer-events:none;'
        + 'font-family:var(--vscode-font-family, system-ui, sans-serif);', { 'data-ap-stack': '1', role: 'region', 'aria-label': 'Conversations that need you' });
      /* In a narrow panel the buttons go on to a second row above the first. */
      head = el('div', 'position:absolute;right:0;bottom:0;min-height:26px;box-sizing:border-box;padding-bottom:6px;display:flex;flex-wrap:wrap;'
        + 'align-items:flex-end;justify-content:flex-end;gap:4px 6px;opacity:0;pointer-events:none;transition:opacity 120ms linear;font-size:11px;line-height:18px;'
        + 'color:var(--vscode-descriptionForeground, #9d9d9d);', { 'data-ap-head': '1' });
      count = el('span', 'padding:0 7px;border-radius:9px;background:var(--vscode-badge-background, #616161);color:var(--vscode-badge-foreground, #fff);', { 'data-ap-count': '1' });
      var button = 'font:inherit;padding:0 8px;border-radius:9px;cursor:pointer;color:var(--vscode-foreground, #ccc);white-space:nowrap;'
        + 'border:1px solid var(--vscode-widget-border, rgba(128,128,128,.4));background:var(--vscode-notifications-background, var(--vscode-editorWidget-background, #252526));';
      all = el('button', button, { type: 'button', 'data-ap-dismiss-all': '1' });
      all.textContent = 'Dismiss all';
      all.addEventListener('click', function (e) { e.stopPropagation(); post('dismiss-all'); });
      head.appendChild(count);
      Object.keys(MODES).forEach(function (m) {
        var b = el('button', button, { type: 'button', 'data-ap-mode': m, title: MODES[m].title, 'aria-label': MODES[m].title });
        b.textContent = MODES[m].label;
        b.addEventListener('click', function (e) { e.stopPropagation(); choose(m); });
        modeButtons[m] = b;
        head.appendChild(b);
      });
      head.appendChild(all);
      live = el('div', 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;', { 'aria-live': 'polite' });
      root.appendChild(head);
      root.appendChild(live);
      root.addEventListener('pointerenter', function () { inside = true; paintHead(); });
      root.addEventListener('pointerleave', function () { inside = false; hovered = -1; pull(); paintHead(); letGo(); });
      root.addEventListener('focusin', function (e) { within = true; focused = indexOf(e.target); pull(); paintHead(); });
      root.addEventListener('focusout', function (e) {
        if (e.relatedTarget && root.contains(e.relatedTarget)) return;
        within = false; focused = -1; pull(); paintHead(); letGo();
      });
      /* The pointer can leave the whole page without passing over anything else in it, as when it moves straight onto
         another part of the window; and a page that loses the focus is not being read. */
      var away = function () {
        if (hovered < 0 && !inside) return;
        inside = false; hovered = -1; pull(); paintHead(); letGo();
      };
      doc.documentElement.addEventListener('mouseleave', away);
      globalThis.addEventListener('blur', away);
      /* A ring on what has the keyboard focus, which inline styles cannot say. */
      var ring = el('style', '', { 'data-ap-stack-style': '1' });
      ring.textContent = '[data-ap-card]:focus-visible>[data-ap-face],[data-ap-head] button:focus-visible{outline:1px solid var(--vscode-focusBorder, #0078d4);'
        + 'outline-offset:-1px;}';
      (doc.head || doc.documentElement).appendChild(ring);
      (doc.body || doc.documentElement).appendChild(root);
    }

    function indexOf(target) {
      var card = target && target.closest ? target.closest('[data-ap-card]') : null;
      return card ? order.indexOf(card.getAttribute('data-ap-key')) : -1;
    }

    function makeCard(key) {
      var card = el('div', 'position:absolute;left:0;bottom:0;width:100%;height:' + STACK.height + 'px;box-sizing:border-box;pointer-events:auto;'
        + 'transform-origin:50% 0;cursor:pointer;outline:none;', { 'data-ap-card': '1', 'data-ap-key': key, role: 'button', tabindex: '0',
        'aria-keyshortcuts': 'Enter Delete' });
      var face = el('div', 'position:absolute;inset:0;box-sizing:border-box;padding:7px 6px 7px 11px;border-radius:6px;overflow:hidden;'
        + 'background:var(--vscode-notifications-background, var(--vscode-editorWidget-background, #252526));'
        + 'color:var(--vscode-notifications-foreground, var(--vscode-foreground, #ccc));'
        + 'border:1px solid var(--vscode-notifications-border, var(--vscode-widget-border, rgba(128,128,128,.35)));border-top-width:2px;'
        + 'box-shadow:0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.36));transition:box-shadow 170ms linear, border-color 120ms linear;', { 'data-ap-face': '1' });
      var top = el('div', 'display:flex;align-items:center;gap:6px;height:18px;font-size:11px;line-height:18px;white-space:nowrap;');
      var dot = el('span', 'flex:none;width:8px;height:8px;border-radius:50%;', { 'data-ap-dot': '1' });
      var kind = el('span', 'flex:none;font-weight:600;', { 'data-ap-kind': '1' });
      /* The agent's name gives way in a narrow panel; the time does not. */
      var meta = el('span', 'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground, #9d9d9d);',
        { 'data-ap-meta': '1' });
      var when = el('span', 'flex:none;margin-right:auto;color:var(--vscode-descriptionForeground, #9d9d9d);', { 'data-ap-age': '1' });
      var x = el('button', 'flex:none;width:20px;height:18px;padding:0;margin:0;border:0;border-radius:4px;background:transparent;cursor:pointer;'
        + 'color:inherit;opacity:.75;font:14px/18px var(--vscode-font-family, sans-serif);', { type: 'button', tabindex: '-1', 'aria-label': 'Dismiss', 'data-ap-dismiss': '1' });
      x.textContent = TIMES;
      x.addEventListener('mouseenter', function () { x.style.opacity = '1'; x.style.background = 'var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.2))'; });
      x.addEventListener('mouseleave', function () { x.style.opacity = '.75'; x.style.background = 'transparent'; });
      var title = el('div', 'margin-top:4px;font-size:13px;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', { 'data-ap-title': '1' });
      top.appendChild(dot); top.appendChild(kind); top.appendChild(meta); top.appendChild(when); top.appendChild(x);
      face.appendChild(top); face.appendChild(title);
      card.appendChild(face);
      var cardOf = function () { return card.__apCard; };
      x.addEventListener('click', function (e) { e.stopPropagation(); dismiss(cardOf()); });
      card.addEventListener('click', function () { var c = cardOf(); if (c) post('open', c); });
      card.addEventListener('pointerenter', function () { hovered = order.indexOf(key); pull(); });
      card.addEventListener('keydown', function (e) {
        var i = order.indexOf(key), c = cardOf();
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (c) post('open', c); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); dismiss(c); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          var next = els[order[Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowUp' ? 1 : -1)))]];
          if (next) next.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          try { card.blur(); if (opts.leave) opts.leave(); } catch (err) { /* stays */ }
        }
      });
      return card;
    }

    /* Taken off this page at once, and kept off until a list without it comes or GONE_WAIT_MS has passed: a list sent
       before the host heard of it can still hold it. */
    function dismiss(c) {
      if (!c) return;
      gone[keyOf(c)] = Date.now();
      post('dismiss', c);
      var i = order.indexOf(keyOf(c));
      var next = i >= 0 ? els[order[i + 1]] || els[order[i - 1]] : null;
      var had = doc.activeElement && root.contains(doc.activeElement);
      render(last);
      if (had && next && next.isConnected) next.focus();
    }

    /* Writes only what reads differently, since it runs every half second. */
    function fill(card, c) {
      card.__apCard = c;
      var kindText = KIND_TEXT[c.kind] || '';
      var title = String(c.title || c.sessionId || '');
      var meta = c.agent ? DOT + ' ' + c.agent : '';
      var when = ageOf(c);
      var set = function (sel, text) { var n = card.querySelector(sel); if (n && n.textContent !== text) n.textContent = text; };
      var put = function (el, prop, value) { if (el && el.style[prop] !== value) el.style[prop] = value; };
      var attr = function (name, value) { if (card.getAttribute(name) !== value) card.setAttribute(name, value); };
      set('[data-ap-kind]', kindText);
      set('[data-ap-meta]', meta);
      put(card.querySelector('[data-ap-meta]'), 'display', meta ? '' : 'none');
      set('[data-ap-age]', DOT + ' ' + when);
      set('[data-ap-title]', title);
      if (card.__apColor !== c.kind) {
        card.__apColor = c.kind;
        var color = colors[c.kind] || colors.finished;
        card.querySelector('[data-ap-dot]').style.background = color;
        card.firstChild.style.borderTopColor = tint(color, 0.75);
      }
      attr('data-ap-card-kind', c.kind);
      attr('aria-label', kindText + ': ' + title + (c.agent ? ', ' + c.agent : '') + ', ' + when);
    }

    function pull() {
      var want = hovered > 0 ? hovered : focused > 0 ? focused : -1;
      if (want >= order.length) want = -1;
      if (want === pulled) return;
      pulled = want;
      lay(true);
    }

    /* Over the stack while it is pointed at or holds the focus: the count of the cards kept, the other two modes, and
       Dismiss all; otherwise only the count of the cards not drawn. */
    function paintHead() {
      if (!head) return;
      var n = order.length, hidden = Math.max(0, n - 1 - STACK.depth);
      var open = n >= 1 && (inside || within);
      count.textContent = open ? kept + ' notices' : '+' + hidden;
      count.style.display = (open && kept >= 2) || (!open && hidden) ? '' : 'none';
      for (var m in modeButtons) modeButtons[m].style.display = open && m !== mode ? '' : 'none';
      all.style.display = open && kept >= 2 ? '' : 'none';
      head.style.opacity = open || hidden ? '1' : '0';
      head.style.pointerEvents = open ? 'auto' : 'none';
    }

    /* A folded card held by the pointer or the focus goes once they leave, if its time is over. */
    function letGo() { if (mode === 'folded' && root) render(last); }

    function choose(m) {
      var had = doc.activeElement && root.contains(doc.activeElement);
      post('mode-' + m);
      useMode(m);
      if (had && !order.length) { try { if (opts.leave) opts.leave(); } catch (e) { /* stays */ } }
    }

    /* A new mode starts with no card in its few seconds: what was drawn goes, unless the pointer or the focus holds it. */
    function useMode(m) {
      var next = MODES[m] ? m : 'normal';
      if (next === mode) return false;
      mode = next;
      until = {};
      if (root) render(last);
      return true;
    }

    function lay(animate) {
      var n = order.length, L = stackLayout(n, pulled), w = width(), top = 0;
      root.style.width = w + 'px';
      for (var i = 0; i < n; i++) {
        var card = els[order[i]], p = L[i], ms = card.__apEnter ? STACK.enterMs : STACK.pullMs;
        card.__apEnter = false;
        card.style.transition = animate && quick() ? 'transform ' + ms + 'ms ' + EASE + ', opacity ' + ms + 'ms linear' : 'none';
        card.style.transform = 'translateY(' + p.y + 'px) scale(' + p.scale + ')';
        /* A card past the depth is not shown but can still take the keyboard focus, which draws it out. */
        card.style.opacity = p.shown ? '1' : '0';
        card.style.pointerEvents = p.shown ? 'auto' : 'none';
        card.style.zIndex = String(n - i);
        card.firstChild.style.boxShadow = i === pulled ? '0 6px 18px var(--vscode-widget-shadow, rgba(0,0,0,.45))'
          : '0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.36))';
        if (p.shown) top = Math.min(top, p.y - STACK.height);
      }
      head.style.transition = animate && quick() ? 'opacity 120ms linear, transform ' + STACK.pullMs + 'ms ' + EASE : 'opacity 120ms linear';
      head.style.transform = 'translateY(' + top + 'px)';
      var rest = n ? STACK.height + STACK.peek * Math.min(n - 1, STACK.depth) + (n - 1 > STACK.depth ? 26 : 0) : 0;
      if (rest !== room) { room = rest; try { if (opts.room) opts.room(rest); } catch (e) { /* the page keeps its layout */ } }
    }

    function render(cards) {
      if (!root) build();
      locate();
      var shown = [], seen = {};
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (!c || typeof c.sessionId !== 'string' || typeof c.sourceId !== 'string') continue;
        var k = keyOf(c);
        if (seen[k] || gone[k]) continue;
        try { if (opts.skip && opts.skip(c)) continue; } catch (e) { /* shown */ }
        seen[k] = true;
        shown.push(c);
      }
      kept = shown.length;
      var held = {};
      if (inside || within) for (var h = 0; h < order.length; h++) if (els[order[h]] && els[order[h]].__apCard) held[cardId(els[order[h]].__apCard)] = true;
      var now = Date.now();
      shown = inMode(shown, mode, until, held, now);
      seen = {};
      for (var q = 0; q < shown.length; q++) seen[keyOf(shown[q])] = true;
      if (foldTimer) { clearTimeout(foldTimer); foldTimer = 0; }
      if (mode === 'folded') {
        var soon = Infinity;
        for (var id in until) if (until[id] > now && until[id] < soon) soon = until[id];
        if (soon < Infinity) foldTimer = setTimeout(function () { foldTimer = 0; render(last); }, soon - now + 20);
      }
      var was = order, first = order.length ? els[order[0]] : null;
      order = shown.map(keyOf);
      for (var j = 0; j < was.length; j++) if (!seen[was[j]]) leave(was[j]);
      var arrived = null;
      for (var m = 0; m < shown.length; m++) {
        var key = order[m], card = els[key];
        if (!card) {
          card = els[key] = makeCard(key);
          fill(card, shown[m]);
          root.insertBefore(card, head);
          if (quick() && m === 0) enter(card);
          if (m === 0 && drawn) arrived = shown[m];
        } else fill(card, shown[m]);
      }
      /* Document order is newest first, so Tab goes from the front card back. */
      for (var r = order.length - 1; r >= 0; r--) root.insertBefore(els[order[r]], r + 1 < order.length ? els[order[r + 1]] : head);
      if (pulled >= order.length) pulled = -1;
      if (hovered >= order.length) hovered = -1;
      /* A stack taken away from under the pointer or the focus hears no leaving, so it lets go here. */
      if (!order.length) {
        inside = false; hovered = -1;
        if (!(doc.activeElement && root.contains(doc.activeElement))) { within = false; focused = -1; }
      }
      /* The last card to go slides out before the stack is hidden. */
      if (order.length || !(quick() && root.querySelector('[data-ap-leaving]'))) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
        root.style.display = order.length ? '' : 'none';
      } else if (!hideTimer) {
        hideTimer = setTimeout(function () { hideTimer = 0; if (root && !order.length) root.style.display = 'none'; }, STACK.leaveMs + 60);
      }
      lay(true);
      paintHead();
      if (arrived && first !== els[order[0]]) live.textContent = (KIND_TEXT[arrived.kind] || '') + ': ' + String(arrived.title || '');
      drawn = true;
      tick();
    }

    /* A new front card starts just past the right edge of the page and lay() slides it in, opaque all the way, so the card
       it covers never shows through it. */
    function enter(card) {
      card.style.transition = 'none';
      card.style.transform = 'translateX(' + (width() + spot.right) + 'px)';
      card.style.opacity = '1';
      void card.offsetWidth;
      card.__apEnter = true;
    }

    function leave(key) {
      var card = els[key];
      delete els[key];
      if (!card) return;
      card.removeAttribute('data-ap-card');
      card.setAttribute('data-ap-leaving', '1');
      card.style.pointerEvents = 'none';
      if (!quick()) { if (card.parentNode) card.parentNode.removeChild(card); return; }
      /* Out past the right edge of the page, opaque all the way, so the card coming forward never shows through it. */
      card.style.transition = 'transform ' + STACK.leaveMs + 'ms cubic-bezier(0.4, 0, 1, 1)';
      card.style.transform = String(card.style.transform || '') + ' translateX(' + (width() + spot.right + 24) + 'px)';
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, STACK.leaveMs + 40);
    }

    /* The place, since the page below can grow, and the time on each card, every half second while there are cards; a
       card's text is written only when it reads differently. */
    function tick() {
      if (order.length && !placer) placer = setInterval(function () { place(); for (var i = 0; i < order.length; i++) fill(els[order[i]], els[order[i]].__apCard); }, 500);
      else if (!order.length && placer) { clearInterval(placer); placer = 0; }
      place();
    }

    function locate() {
      var a = null;
      try { a = opts.anchor ? opts.anchor() : null; } catch (e) { a = null; }
      var num = function (v, d) { return typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : d; };
      spot = { bottom: num(a && a.bottom, 12), right: num(a && a.right, STACK.margin), width: num(a && a.width, STACK.width) };
      if (root.style.bottom !== spot.bottom + 'px') root.style.bottom = spot.bottom + 'px';
      if (root.style.right !== spot.right + 'px') root.style.right = spot.right + 'px';
    }
    function place() {
      if (!root) return;
      locate();
      if (root.style.width !== width() + 'px') lay(false);
    }

    function set(cards, hostNow, m) {
      if (typeof hostNow === 'number' && isFinite(hostNow)) skew = Date.now() - hostNow;
      last = Array.isArray(cards) ? cards.slice() : [];
      var next = MODES[m] ? m : 'normal';
      if (next !== mode) { mode = next; until = {}; }
      var listed = {}, ids = {}, now = Date.now();
      for (var i = 0; i < last.length; i++) {
        var c = last[i];
        if (!c) continue;
        listed[keyOf(c)] = true;
        var id = cardId(c);
        ids[id] = true;
        /* A card already there when the page started, or when the mode changed, is not one that arrives. */
        if (!known[id]) { known[id] = true; if (primed && mode === 'folded') until[id] = now + STACK.foldMs; }
      }
      for (var x in known) if (!ids[x]) delete known[x];
      for (var y in until) if (!ids[y]) delete until[y];
      primed = true;
      for (var k in gone) if (!listed[k] || Date.now() - gone[k] > GONE_WAIT_MS) delete gone[k];
      render(last);
    }

    return {
      set: set,
      place: place,
      /* Draws the last list again, after what skip() says has changed. */
      refresh: function () { if (root) render(last); },
      dispose: function () {
        if (placer) { clearInterval(placer); placer = 0; }
        if (foldTimer) { clearTimeout(foldTimer); foldTimer = 0; }
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
        if (root && root.parentNode) root.parentNode.removeChild(root);
        var ring = doc.querySelector('style[data-ap-stack-style]');
        if (ring && ring.parentNode) ring.parentNode.removeChild(ring);
        if (room > 0) { try { if (opts.room) opts.room(0); } catch (e) { /* gone with the page */ } }
        root = null; els = {}; order = []; room = -1;
      },
    };
  }

  return { p2: p2, stamp: stamp, age: age, span: span, kfmt: kfmt, pct: pct, TONES: TONES, chime: chime, unlockAudio: unlockAudio,
    labels: labels, STACK: STACK, stackLayout: stackLayout, cardId: cardId, inMode: inMode, noticeStack: noticeStack };
})();
if (typeof module === 'object' && module) module['exports'] = agentPlusKit;
