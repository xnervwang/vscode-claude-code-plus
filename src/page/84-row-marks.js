// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// The dot and the envelope on a session list row: the dot says what the conversation is doing, as on its tab; the
// envelope that it has a reply not read yet.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * The list draws one dot per row, and its unread dot gives way to running, so a reply read late was not seen while
   * the conversation still ran. Here the two are apart: the dot is green while a turn runs, a green ring once only
   * background work runs, red while it waits for you, and absent once it has stopped; the envelope stands at the row's
   * end, outside the title, so a long title cut short does not cut it.
   *
   * The extension works out each conversation's dot (src/activity.js) and sends the set with the host's session states
   * (an edit in src/webview.js). It is held in a signal of the panel's own kind, so a row that reads it is drawn again
   * when it changes. A conversation the set leaves out gets its dot from the list's own state, which covers one running
   * in another window that the set has not caught up with.
   */
  var ENVELOPE = '\u2709\uFE0F';
  var ENVELOPE_TEXT = 'Reply not read yet';
  var ROW_DOT_TEXT = { working: 'Working', background: 'Turn ended; background work still running', waiting: 'Waiting for you' };
  var rowActivity = null, rowActivityText = '';
  var activityNow = function(){
    if (!rowActivity && typeof window.__cceSignal === 'function') rowActivity = window.__cceSignal({});
    return rowActivity && rowActivity.value && typeof rowActivity.value === 'object' ? rowActivity.value : {};
  };
  window.__cceSetActivity = function(map){
    try {
      var text = JSON.stringify(map && typeof map === 'object' ? map : {});
      if (text === rowActivityText) return;
      rowActivityText = text;
      activityNow();
      if (rowActivity) rowActivity.value = JSON.parse(text);
    } catch (e) { /* the rows keep the dots they have */ }
  };
  var rowDot = function(id, state){
    var a = id ? activityNow()[id] : void 0;
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
  var envelopeFor = function(F){
    return F('span', { 'data-cce-envelope': '', title: ENVELOPE_TEXT, 'aria-label': ENVELOPE_TEXT, children: ENVELOPE });
  };
  /*
   * The row's dot and envelope, drawn with the list's own dot component, for a local conversation. o: { jsx, Dot,
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
      return [
        dot ? F(o.Dot, { state: dot === 'waiting' ? 'waiting' : 'running', ring: dot === 'background',
          title: rowDotTitle(dot, typeof o.where === 'string' ? o.where : '') }) : null,
        unseen ? envelopeFor(F) : null,
      ];
    } catch (e) { return null; }
  };
