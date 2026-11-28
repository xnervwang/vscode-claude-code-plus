// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Each reply's context share and cost, kept on disk so that a panel opened again still shows them.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * A reply's figures are worked out only while it is the newest reply (75-turn-stats.js), so a panel opened again had
   * none for its history. This hands the extension each reply's figures as they settle, keyed by the uuid of the
   * reply's message, and asks it for the conversation's kept ones when the panel starts to show the conversation
   * (src/reply-figures.js keeps one small file per conversation).
   *
   * What is kept is what the page shows: the newest reply's figures whenever no turn runs, and a reply's last figures
   * when a newer reply takes its place, each time only if they differ from what was last sent for it. The exception is
   * a reply whose figures were in the file when the page loaded. What the page works out for such a reply now is not
   * what it showed when its turn ended - a conversation opened again starts its cost from nothing - so it shows the kept
   * figures, even while it is the newest, and is not kept again unless it grows during a turn. Nothing is kept before
   * the file's figures have arrived, since until then the page cannot tell such a reply from any other. A reply from
   * before anything was kept has nothing in the file and shows what it showed before.
   *
   * With both claudeCodePlus.show.contextShare and claudeCodePlus.show.cost off, nothing is asked or kept: there is
   * nothing to show. With one of them off both numbers are still kept, as 75-turn-stats.js keeps both.
   *
   * Growth is told by the reply's row count and its figures both changing during a turn, not by either alone: when the
   * next turn starts, the usage moves with the new reply's first message, and a sweep can see that a moment before the
   * new reply is drawn, while the old one is still the newest; a row count alone moves when Claude Code redraws a fold.
   */
  var KEPT = new Map(), FROM_DISK = new Set(), GREW = new Set(), keptSent = new Map();
  var keptFor = '', keptHas = '', keptAsks = 0, keptAskedAt = 0, keptWired = false;
  var liveUuid = '', liveLast = null, liveBase = null;
  var keptPost = function(m){ try { acquireVsCodeApi().postMessage(m); } catch (e) { /* asked or sent again later */ } };
  var keyOf = function(f){ return f ? f.pct + '|' + f.usd : ''; };

  /* The figures kept for a reply that is not the newest, or null. */
  var keptOf = function(m){
    var id = m && typeof m.uuid === 'string' ? m.uuid.toLowerCase() : '';
    return id ? (KEPT.get(id) || null) : null;
  };
  var keepOne = function(id, f){
    if (!keptFor || !f || keptSent.get(id) === keyOf(f)) return;
    keptSent.set(id, keyOf(f));
    KEPT.set(id, f);
    keptPost({ type: 'cce_figures_keep', sessionId: keptFor, replies: [[id, f.pct, f.usd]] });
  };
  /* Whether the page keeps what it shows for a reply: not before the file's figures have arrived, and not for one that
     came with them unless it has grown since. */
  var keeps = function(id){
    if (!keptFor || keptHas !== keptFor) return false;
    return !FROM_DISK.has(id) || GREW.has(id);
  };

  /* Asked once, then once a second five times, and after that every ten seconds until an answer comes; asked again
     from the start for another conversation. A conversation changing in place leaves the previous one's figures
     behind: the replies on the page are not theirs. */
  var figuresOff = function(){ return isOff('contextShare') && isOff('cost'); };
  var keptFollow = function(){
    if (figuresOff()) return;
    var sid = sigValue('sessionId');
    sid = typeof sid === 'string' && /^[0-9a-f-]{36}$/i.test(sid) ? sid : '';
    if (sid !== keptFor) {
      KEPT = new Map(); FROM_DISK = new Set(); GREW = new Set(); keptSent = new Map();
      keptFor = sid; keptHas = ''; keptAsks = 0; keptAskedAt = 0;
      liveUuid = ''; liveLast = null; liveBase = null;
    }
    if (!keptWired) {
      keptWired = true;
      window.addEventListener('message', function(ev){
        var d = ev && ev.data, m = d && d.type === 'from-extension' ? d.message : null;
        if (!m || m.type !== 'cce_figures' || typeof m.sessionId !== 'string' || m.sessionId !== keptFor || !Array.isArray(m.replies)) return;
        if (keptHas === keptFor) return;
        try { keptArrived(m.replies); } catch (e) { /* asked again on a later sweep */ }
      });
    }
    if (!sid || keptHas === sid) return;
    var now = Date.now();
    if (keptAskedAt && now - keptAskedAt < (keptAsks < 5 ? 1000 : 10000)) return;
    keptAskedAt = now;
    keptAsks++;
    keptPost({ type: 'cce_figures_ask', sessionId: sid });
  };
  /* The conversation's kept figures. A reply this page already kept keeps what it sent; the rest take the file's, and
     the replies on the page that have some are labelled again, since a settled reply is not visited otherwise. */
  var keptArrived = function(list){
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
      var id = r[0].toLowerCase(), f = figuresOf(typeof r[1] === 'number' ? r[1] : null, typeof r[2] === 'number' ? r[2] : null);
      if (!f || keptSent.has(id)) continue;
      KEPT.set(id, f);
      FROM_DISK.add(id);
    }
    keptHas = keptFor;
    if (!FROM_DISK.size) return;
    var msgs = document.querySelectorAll(ASSIST);
    for (var j = 0; j < msgs.length; j++) {
      var uus = UUIDS_OF.get(msgs[j]);
      if (!uus) continue;
      for (var k = 0; k < uus.length; k++) if (FROM_DISK.has(String(uus[k]).toLowerCase())) { unsettle(msgs[j]); break; }
    }
    schedule();
  };

  /*
   * The figures to show for the newest reply, `now` being what 75-turn-stats.js just worked out for it, and the
   * keeping of them. `rows` is the reply's row count on the page.
   */
  var keptLive = function(m, now, rows){
    var id = m && typeof m.uuid === 'string' ? m.uuid.toLowerCase() : '';
    if (!id || !keptFor || figuresOff()) return now;
    if (id !== liveUuid) {
      // A newer reply has taken over: the one before it keeps what it last showed, as the page does.
      if (liveUuid && liveLast && keeps(liveUuid)) keepOne(liveUuid, liveLast);
      liveUuid = id; liveLast = null; liveBase = null;
    }
    var busy = sigOn('busy');
    if (!busy) liveBase = null;
    else if (FROM_DISK.has(id) && !GREW.has(id)) {
      if (!liveBase) liveBase = { key: keyOf(now), rows: rows };
      else if (liveBase.key !== keyOf(now) && liveBase.rows !== rows) GREW.add(id);
    }
    if (keeps(id)) {
      liveLast = now;
      if (!busy && now) keepOne(id, now);
      return now;
    }
    return KEPT.get(id) || now;
  };
