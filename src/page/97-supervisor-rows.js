// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// A supervisor's message sent for the user: drawn with a badge that names the supervisor, in place of the line naming it.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * Every message a supervisor sends for the user starts with a line naming it, 'Sent by the supervisor "<title>"
   * (<session id>) for the user:' (fromLine in src/stewards.js). The model reads that line. The panel draws the
   * message without it, through the edit "supervisor messages drawn with a badge" (src/webview.js), which asks this
   * fragment for the block without the line (__cceSupBody) and for a row to put in front of it (__cceSupHead): a badge
   * with the supervisor's title, and a link that opens the supervisor's conversation through Agent Plus
   * (93-steward-links.js takes the click). For any other message both return null and the panel draws it as before.
   * The badge's words are generated content of this fragment's own stylesheet, so a change of language rewrites that
   * stylesheet and needs nothing of the panel drawn again. The message gets a purple bar and
   * tint in place of the bar on the user's own messages, and each sentence the supervisor marked as its own, with "(the
   * supervisor's arrangement)" or the like, a lighter shade. That shade is a CSS highlight, so nothing is written into
   * the text the panel draws.
   *
   * The badge's words are in the language the user writes in this conversation: their last few messages of their own,
   * with code and paths left out, are Chinese when they hold at least as many Han characters as English words, and
   * English otherwise. With too little to go on, the words follow VS Code's display language.
   * claudeCodePlus.supervisorBadgeLanguage can fix them to one language. The host writes that setting, the display
   * language and the Chinese words, which live in src/l10n, into the live stylesheet (--cce-supervisor, src/webview.js);
   * a stylesheet without them leaves the badge in English unless the browser's language is Chinese. The supervisor's
   * title is shown as it is.
   */
  var SUP_FROM = new RegExp('^\\s*Sent by the (?:supervisor|steward) (?:"(.*)" )?\\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
    + '[0-9a-fA-F]{12})\\) for the user:[ \\t]*(?:\\r?\\n|$)', 'i');
  /* The marks the supervisor skill asks for after a sentence of the supervisor's own, in either kind of bracket. The
     escapes spell the Chinese forms of the arrangement and of what the supervisor found. */
  var SUP_MARK = new RegExp('[(\\uff08]\\s*(?:\\u4e3b\\u7ba1(?:\\u7684\\u5b89\\u6392|\\u67e5\\u5230\\u7684)'
    + '|the supervisor[\\u0027\\u2019]s (?:arrangement|findings?)|what the supervisor found)\\s*[)\\uff09]', 'gi');
  var SUP_STOP = /[\u3002\uff01\uff1f!?\n]/;
  var SUP_EN = { sent: 'Supervisor "{0}" sent this for you', open: 'Open supervisor' };
  var SUP_COMPASS = '\ud83e\udded ', SUP_ARROW = ' \u2197';
  /* How many of the user's last messages decide the language, and how many Han characters and English words they need
     between them before they decide it. At most SUP_SCAN messages are looked at, since a long run of tool results can
     come after the last thing the user typed. */
  var SUP_TYPED = 5, SUP_TYPED_MIN = 4, SUP_SCAN = 400;
  var SUP_HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, SUP_WORD = /[A-Za-z]{2,}/g;
  /* Text the user did not type: a supervisor's message, a notice or a handoff from Claude Code Plus, and the rows
     Claude Code and its hooks write, which start with a tag, an interruption or a caveat. */
  var SUP_NOT_TYPED = /^\s*(?:<|\[Request interrupted|Caveat:|Handoff from |(?:Supervisor|Steward) notice from Claude Code Plus)/i;

  var supWeak = function(){ return typeof WeakMap === 'function' ? new WeakMap() : null; };
  var supInfos = supWeak(), supBodies = supWeak(), supMarks = supWeak();
  /* { steward, title, rest } for a block that starts with the line, or null. */
  var supInfo = function(block){
    if (!block || typeof block !== 'object') return null;
    var c = block.content;
    if (!c || c.type !== 'text' || typeof c.text !== 'string') return null;
    if (supInfos && supInfos.has(block)) return supInfos.get(block);
    var m = SUP_FROM.exec(c.text), info = null;
    if (m) info = { steward: m[2].toLowerCase(), title: m[1] || '', rest: c.text.slice(m[0].length) };
    if (supInfos) supInfos.set(block, info);
    return info;
  };
  /* The same block without the line, made by the block's own class and kept, so that the panel's memoized block is
     drawn again only when the message changes. */
  var supBody = function(block){
    var info = supInfo(block);
    if (!info) return null;
    if (supBodies && supBodies.has(block)) return supBodies.get(block);
    var out = null;
    try {
      var C = block.constructor;
      if (typeof C === 'function' && C !== Object) {
        var content = {};
        for (var k in block.content) if (Object.prototype.hasOwnProperty.call(block.content, k)) content[k] = block.content[k];
        content.text = info.rest;
        out = new C(content, block.partial === true, block.narrationHint);
        if (!out || !out.content || out.content.text !== info.rest) out = null;
      }
    } catch (e) { out = null; }
    if (supBodies) supBodies.set(block, out);
    return out;
  };

  /* ── the language ── */
  var supLive = function(){
    var p = typeof readProp === 'function' ? readProp('--cce-supervisor') : [];
    return { choice: typeof p[0] === 'string' ? p[0] : 'auto', ui: typeof p[1] === 'string' ? p[1] : '',
      words: p[2] && typeof p[2] === 'object' ? p[2] : null };
  };
  /* 'zh', 'en', or '' when the text holds too little of either. */
  var supLangOf = function(text){
    var plain = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ').replace(/\S*[\/\\]\S*/g, ' ');
    var han = (plain.match(SUP_HAN) || []).length, words = (plain.match(SUP_WORD) || []).length;
    if (han + words < SUP_TYPED_MIN) return '';
    return han >= words ? 'zh' : 'en';
  };
  /* The text of a message the user typed in this conversation, or ''. */
  var supTypedText = function(m){
    if (!m || m.type !== 'user' || m.isSynthetic || m.hiddenFromChat || m.parentToolUseId || m.notAPrompt || m.agentSender) return '';
    if (m.origin && m.origin.kind !== 'human') return '';
    var blocks = Array.isArray(m.content) ? m.content : [], text = '';
    for (var i = 0; i < blocks.length; i++) {
      var c = blocks[i] && blocks[i].content;
      if (c && c.type === 'text' && typeof c.text === 'string') text += (text ? '\n' : '') + c.text;
    }
    if (!text.trim() || SUP_NOT_TYPED.test(text) || SUP_FROM.test(text)) return '';
    return text;
  };
  var supTypedList = null, supTypedLang = '';
  var supTyped = function(){
    var list = sessionRef && sessionRef.messages && sessionRef.messages.value;
    if (!Array.isArray(list)) return '';
    if (list === supTypedList) return supTypedLang;
    var texts = [];
    for (var i = list.length - 1, seen = 0; i >= 0 && seen < SUP_SCAN && texts.length < SUP_TYPED; i--, seen++) {
      var t = supTypedText(list[i]);
      if (t) texts.push(t);
    }
    supTypedList = list;
    supTypedLang = supLangOf(texts.join('\n'));
    return supTypedLang;
  };
  var supLangNow = function(){
    var live = supLive();
    if (live.choice === 'zh' || live.choice === 'en') return live.choice;
    var typed = supTyped();
    if (typed) return typed;
    var ui = String(live.ui || (typeof navigator === 'object' && navigator && navigator.language) || '').toLowerCase();
    return ui.indexOf('zh') === 0 ? 'zh' : 'en';
  };
  /* { sent, open } in `lang`: Chinese in the traditional script when VS Code's display language is written in it, and
     English when the stylesheet carries no Chinese. */
  var supTemplate = function(lang){
    var live = supLive(), all = live.words || {}, ui = String(live.ui || '').toLowerCase(), set = null;
    if (lang === 'zh') set = all[/^zh-(?:tw|hk|mo|hant)/.test(ui) ? 'zh-tw' : 'zh-cn'] || all['zh-cn'];
    if (!set || typeof set.sent !== 'string' || typeof set.open !== 'string') set = all.en && typeof all.en.sent === 'string' ? all.en : SUP_EN;
    return set;
  };
  /* The badge's words as generated content: the supervisor's title comes from the element's data-cce-sup-name, which
     is its title or, without one, the start of its session id. */
  var supQuote = function(t){ return '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ') + '"'; };
  var supWordsCss = function(lang){
    var t = supTemplate(lang), cut = t.sent.split('{0}');
    return SUP_IN + '[data-cce-sup-full]::before{content:' + supQuote(SUP_COMPASS + cut[0]) + ' attr(data-cce-sup-name) ' + supQuote(cut.slice(1).join('')) + ';}'
      + SUP_IN + '[data-cce-sup-short]::before{content:' + supQuote(SUP_COMPASS) + ' attr(data-cce-sup-name);}'
      + SUP_IN + '[data-cce-sup-open]::before{content:' + supQuote(t.open + SUP_ARROW) + ';}';
  };

  /* ── what the page looks like ── */
  var SUP_ROW = '[class*="userMessage_"]:has(> [data-cce-sup-head])';
  var SUP_IN = '[class*="userMessage_"] > [data-cce-sup-head] ';
  var SUP_CSS = [
    SUP_ROW + '{border-left:3px solid #c084fc !important;padding-left:8px !important;background:rgba(192,132,252,.10) !important;}',
    'body.vscode-light ' + SUP_ROW + '{border-left-color:#7c3aed !important;background:rgba(124,58,237,.06) !important;}',
    'body.vscode-high-contrast ' + SUP_ROW + ',body.vscode-high-contrast-light ' + SUP_ROW + '{background:transparent !important;}',
    /* One row: the time and the link keep their width, and a long title is cut short with an ellipsis. */
    '[data-cce-sup-head]{display:flex;flex-wrap:nowrap;align-items:center;column-gap:.6em;margin:0 0 .4em;min-width:0;container-type:inline-size;}',
    SUP_IN.trim() + '::before{flex:none;white-space:nowrap !important;margin-inline-end:0 !important;}',
    SUP_IN + '[data-cce-sup-badge]{display:block;flex:0 1 auto;min-width:0;padding:0 .7em;border:1px solid #c084fc;border-radius:999px;background:#3b2a52;'
      + 'color:#e9d5ff !important;font-size:.9em;line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    SUP_IN + '[data-cce-sup-short]{display:none;}',
    SUP_IN + '[data-cce-sup-open]{flex:none;color:#a78bfa !important;font-size:.85em;text-decoration:underline;cursor:pointer;white-space:nowrap;}',
    'body.vscode-light ' + SUP_IN + '[data-cce-sup-badge]{background:#ede9fe;border-color:#7c3aed;color:#5b21b6 !important;}',
    'body.vscode-light ' + SUP_IN + '[data-cce-sup-open]{color:#6d28d9 !important;}',
    '@container (max-width: 420px){' + SUP_IN + '[data-cce-sup-full]{display:none;}' + SUP_IN + '[data-cce-sup-short]{display:inline;}'
      + SUP_IN + '[data-cce-sup-open]{display:none;}}',
    '::highlight(cce-sup-own){background-color:rgba(192,132,252,.24);color:#e9d5ff;}',
    'body.vscode-light ::highlight(cce-sup-own){background-color:rgba(124,58,237,.13);color:#4c1d95;}',
  ].join('\n');
  /* The stylesheet, written again only when the language or its words change; data-cce-sup-lang on it says which. */
  var supCss = null, supCssText = '';
  var supStyle = function(lang){
    var text = SUP_CSS + '\n' + supWordsCss(lang);
    try {
      if (!supCss) {
        supCss = document.createElement('style');
        supCss.setAttribute('data-cce-sup', '1');
        (document.head || document.documentElement).appendChild(supCss);
      }
      if (text === supCssText) return;
      supCss.textContent = text;
      supCss.setAttribute('data-cce-sup-lang', lang);
      supCssText = text;
    } catch (e) { /* drawn with the panel's own look */ }
  };

  /* The row in front of a supervisor's message, built with the panel's own element function `h`, or null. */
  var supHead = function(block, h){
    try {
      var info = supInfo(block);
      if (!info || typeof h !== 'function') return null;
      supStyle(supLangNow());
      var name = info.title || info.steward.slice(0, 8);
      return h('div', { 'data-cce-sup-head': info.steward, children: [
        h('span', { 'data-cce-sup-badge': '', children: [
          h('span', { 'data-cce-sup-full': '', 'data-cce-sup-name': name }, 'full'),
          h('span', { 'data-cce-sup-short': '', 'data-cce-sup-name': name }, 'short')] }, 'badge'),
        h('a', { 'data-cce-sup-open': '', role: 'button', href: STEWARD_LINK + 'session=' + info.steward + '&source=claude-code' }, 'open')] });
    } catch (e) { return null; }
  };
  if (typeof window === 'object' && window) {
    window.__cceSupHead = supHead;
    window.__cceSupBody = function(block){ try { return supBody(block); } catch (e) { return null; } };
  }

  /* The badge row of a user message the panel drew, or null. */
  var supHeadOf = function(b){
    var h = b && b.firstElementChild;
    return h && h.hasAttribute && h.hasAttribute('data-cce-sup-head') ? h : null;
  };
  /* For the list of your messages: the message's text after its badge row, behind the compass. */
  var supRowText = function(b, live){
    var h = supHeadOf(b);
    if (!h) return '';
    var all = textOf(b, live), head = String(h.textContent || '').replace(/\s+/g, ' ').trim();
    var rest = all.indexOf(head) === 0 ? all.slice(head.length).trim() : all;
    return SUP_COMPASS + rest;
  };

  /* [start, end] of each sentence in `text` that the supervisor marked as its own, the mark and one stop after it
     included. A sentence starts after the last stop before it: a full stop, question or exclamation mark, a line break,
     or the end of the mark before it. */
  var supOwnSpans = function(text){
    var out = [], last = 0, m, s = String(text || '');
    var stop = function(j){ var c = s.charAt(j); return SUP_STOP.test(c) || (c === '.' && /\s/.test(s.charAt(j + 1) || ' ')); };
    SUP_MARK.lastIndex = 0;
    while ((m = SUP_MARK.exec(s))) {
      var end = m.index + m[0].length, j = m.index - 1;
      while (j >= last && /\s/.test(s.charAt(j))) j--;
      if (j >= last && (SUP_STOP.test(s.charAt(j)) || s.charAt(j) === '.')) j--;
      while (j >= last && !stop(j)) j--;
      var start = Math.max(j + 1, last);
      while (start < m.index && /\s/.test(s.charAt(start))) start++;
      if (end < s.length && /[\u3002\uff01\uff1f!?.]/.test(s.charAt(end))) end++;
      out.push([start, end]);
      last = end;
    }
    return out;
  };
  /* The ranges of those sentences in the message's text as the panel drew it, kept per message until its text or its
     nodes change. */
  var supRangesOf = function(b){
    var body = b.lastElementChild;
    if (!body || body.hasAttribute('data-cce-sup-head')) return [];
    var key = String(body.textContent || ''), kept = supMarks ? supMarks.get(b) : null;
    if (kept && kept.key === key && (!kept.ranges.length || (kept.ranges[0].startContainer.isConnected && body.contains(kept.ranges[0].startContainer)))) {
      return kept.ranges;
    }
    var ranges = [];
    if (SUP_MARK.test(key)) {
      var walk = document.createTreeWalker(body, 4), nodes = [], at = [], text = '', n;
      while ((n = walk.nextNode())) { nodes.push(n); at.push(text.length); text += n.nodeValue; }
      var point = function(off, end){
        for (var i = nodes.length - 1; i >= 0; i--) if (end ? at[i] < off : at[i] <= off) return [nodes[i], off - at[i]];
        return null;
      };
      var spans = supOwnSpans(text);
      for (var k = 0; k < spans.length; k++) {
        var a = point(spans[k][0], false), z = point(spans[k][1], true);
        if (!a || !z) continue;
        try { var r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(z[0], z[1]); ranges.push(r); } catch (e) { /* not shaded */ }
      }
    }
    if (supMarks) supMarks.set(b, { key: key, ranges: ranges });
    return ranges;
  };
  var supHighlight = null, supShaded = [];
  var supShade = function(rows){
    var reg = window.CSS && window.CSS.highlights;
    if (!reg || typeof window.Highlight !== 'function') return;
    var all = [], changed = false;
    for (var i = 0; i < rows.length; i++) all = all.concat(supRangesOf(rows[i]));
    if (all.length !== supShaded.length) changed = true;
    else for (var j = 0; j < all.length && !changed; j++) if (all[j] !== supShaded[j]) changed = true;
    if (!changed) return;
    if (!supHighlight) { supHighlight = new window.Highlight(); reg.set('cce-sup-own', supHighlight); }
    supHighlight.clear();
    for (var k = 0; k < all.length; k++) supHighlight.add(all[k]);
    supShaded = all;
  };
  /* Each sweep (99-sweep.js), given the user messages on the page: keeps the badges' words in the language now in
     effect, and shades the supervisor's own sentences. Nothing happens on a page without a supervisor's message. */
  var supSweep = function(bubbles){
    var rows = [];
    for (var i = 0; i < bubbles.length; i++) if (supHeadOf(bubbles[i])) rows.push(bubbles[i]);
    if (!rows.length && !supShaded.length) return;
    if (rows.length) supStyle(supLangNow());
    supShade(rows);
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { SUP_FROM: SUP_FROM, supInfo: supInfo, supBody: supBody, supLangOf: supLangOf, supTypedText: supTypedText,
      supOwnSpans: supOwnSpans, supTemplate: supTemplate, supWordsCss: supWordsCss };
  }
