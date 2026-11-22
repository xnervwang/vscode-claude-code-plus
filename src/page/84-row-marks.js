// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// The dot, the crown and the envelope on a session list row: the dot says what the conversation is doing, as on its
// tab; the crown that it is a steward; the envelope that it has a reply not read yet.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * The list draws one dot per row, and its unread dot gives way to running, so a reply read late was not seen while
   * the conversation still ran. Here the two are apart: the dot is green while a turn runs, a green ring once only
   * background work runs, red while it waits for you, and absent once it has stopped; the envelope stands after the
   * title and before the time, outside the title, so a long title cut short does not cut it. A steward's crown stands just before the title,
   * outside it too, so the list's rename box, which is filled with the title, never holds one (src/title-marks.js).
   *
   * The extension works out each conversation's dot (src/activity.js) and sends the set, with the stewards' ids, with
   * the host's session states (an edit in src/webview.js). Both are held in a signal of the panel's own kind, so a row
   * that reads it is drawn again when they change. A conversation the set leaves out gets its dot from the list's own state, which covers one running
   * in another window that the set has not caught up with.
   */
  var ENVELOPE_TEXT = 'Reply not read yet';
  var CROWN = '\u{1F451}';
  var CROWN_TEXT = 'Steward: manages other conversations';
  var ROW_DOT_TEXT = { working: 'Working', background: 'Turn ended; background work still running', waiting: 'Waiting for you' };
  var rowActivity = null, rowActivityText = '';
  var marksNow = function(){
    if (!rowActivity && typeof window.__cceSignal === 'function') rowActivity = window.__cceSignal({ dots: {}, stewards: [] });
    var v = rowActivity && rowActivity.value;
    return v && typeof v === 'object' ? v : { dots: {}, stewards: [] };
  };
  window.__cceSetActivity = function(map, stewards){
    try {
      var next = { dots: map && typeof map === 'object' ? map : {},
        stewards: Array.isArray(stewards) ? stewards.filter(function(s){ return typeof s === 'string'; }).map(function(s){ return s.toLowerCase(); }) : [] };
      var text = JSON.stringify(next);
      if (text === rowActivityText) return;
      rowActivityText = text;
      marksNow();
      if (rowActivity) rowActivity.value = next;
    } catch (e) { /* the rows keep the marks they have */ }
  };
  var rowDot = function(id, state){
    var a = id ? marksNow().dots[id] : void 0;
    if (a === 'working' || a === 'background' || a === 'waiting') return a;
    if (state === 'waiting') return 'waiting';
    if (state === 'running') return 'working';
    return '';
  };
  var rowUnread = function(session, id){
    var src = window.__cceSessionList, keys = src && src.comms && src.comms.unreadSessionKeys;
    var list = asList(keys && keys.value);
    if (!id) return false;
    if (list.indexOf(id) >= 0) return true;
    var from = session.teleportedFromSessionId && session.teleportedFromSessionId.value;
    return typeof from === 'string' && !!from && list.indexOf(from) >= 0;
  };
  // `where` is the list's own words for where the conversation is open ("Open in another VS Code window"), or ''.
  var rowDotTitle = function(dot, where){
    return where ? where + ' \u2014 ' + ROW_DOT_TEXT[dot] : ROW_DOT_TEXT[dot];
  };
  // The character is the stylesheet's (src/webview.js), which picks the form for the theme from the body's class.
  /* A title typed in the list's rename box without the marks drawn with titles (TITLE_MARKS, from src/webview.js), as
     src/title-marks.js withoutMarks takes them off: wherever each stands, the spaces around it joined into one. */
  window.__cceCleanTitle = function(t){
    try {
      if (typeof t !== 'string') return t;
      TITLE_MARKS.lastIndex = 0;
      if (!TITLE_MARKS.test(t)) return t;
      TITLE_MARKS.lastIndex = 0;
      return t.split(TITLE_MARKS).map(function(p){ return p.trim(); }).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ');
    } catch (e) { return t; }
  };
  var envelopeFor = function(F){
    return F('span', { 'data-cce-envelope': '', title: ENVELOPE_TEXT, 'aria-label': ENVELOPE_TEXT });
  };
  var crownFor = function(F){
    return F('span', { 'data-cce-crown': '', title: CROWN_TEXT, 'aria-label': CROWN_TEXT, children: CROWN });
  };
  /*
   * The row's dot, crown and envelope, the dot drawn with the list's own dot component, for a local conversation. o: { jsx, Dot,
   * session, state, ring, title, where }, where state, ring and title are what the list would have drawn its dot with.
   * Returns null when the list's own dot should be drawn instead: for a web session, while the extension is off, or on
   * any failure.
   */
  window.__cceRowMarks = function(o){
    try {
      if (!o || typeof o.jsx !== 'function' || typeof o.Dot !== 'function' || !o.session || !isOn()) return null;
      var F = o.jsx, session = o.session;
      if (session.isRemote && session.isRemote.value) return null;
      var id = session.sessionId && session.sessionId.value;
      var dot = rowDot(id, o.state), unseen = rowUnread(session, id);
      var steward = typeof id === 'string' && marksNow().stewards.indexOf(id.toLowerCase()) >= 0;
      return [
        dot ? F(o.Dot, { state: dot === 'waiting' ? 'waiting' : 'running', ring: dot === 'background',
          title: rowDotTitle(dot, typeof o.where === 'string' ? o.where : '') }) : null,
        steward ? crownFor(F) : null,
        unseen ? envelopeFor(F) : null,
      ];
    } catch (e) { return null; }
  };
