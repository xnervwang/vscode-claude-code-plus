// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// The skills skill suggestions gave each turn, named after the figures of the turn's first reply on the page.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * The extension names each turn by its first reply (SKILLS in 76-effort.js), which the page may not draw: with Focus
   * view on, Claude Code folds away the thinking and the tool calls a turn starts with. So a turn is found here as the
   * duration finds it, by the latest of your messages at or before a reply (turnStartFor), and its skills go on the
   * first reply the page draws in that turn. The first reply's time comes from the panel's own list of messages, which
   * holds the folded ones too; the list is walked once, and then only as it grows.
   */
  var skillWalk = null;
  var skillTimes = function(){
    var list = sessionRef && sessionRef.messages && sessionRef.messages.value;
    if (!Array.isArray(list)) return null;
    var w = skillWalk;
    if (!w || w.raw !== skillRaw || w.n > list.length || (w.n && list[w.n - 1] !== w.last)) {
      w = skillWalk = { raw: skillRaw, n: 0, last: null, at: [] };
    }
    for (; w.n < list.length; w.n++) {
      var m = list[w.n];
      if (!m || m.type !== 'assistant' || typeof m.uuid !== 'string' || typeof m.timestamp !== 'number') continue;
      var names = SKILLS[hexOf(m.uuid)];
      if (names) w.at.push({ ts: m.timestamp, names: names });
    }
    w.last = list.length ? list[list.length - 1] : null;
    return w.at;
  };
  /* `skills web-fetching, git-identity`, as Codex Plus writes it: a plugin's skill without its plugin. */
  var skillsText = function(names){
    var out = [];
    for (var i = 0; i < names.length; i++) out.push(String(names[i]).split(':').pop());
    return 'skills ' + out.join(', ');
  };
  /* Each turn's text, by the time of your message that started it. */
  var skillsByTurn = function(promptTs){
    var out = {};
    if (isOff('skillNames')) return out;
    var at = skillTimes();
    if (!at) return out;
    for (var i = 0; i < at.length; i++) {
      var t0 = turnStartFor(promptTs, at[i].ts);
      if (t0 !== null) out[t0] = skillsText(at[i].names);
    }
    return out;
  };
  /* The turn a reply was found in, and the skills it was given, when it was last worked out; read for a settled reply. */
  var TURN_OF = new WeakMap(), SKILLS_OF = new WeakMap();
  /* What a reply should carry: its turn's skills when no reply before it on the page is in the same turn. */
  var skillsFor = function(turns, t0, prev){
    return t0 !== null && t0 !== undefined && t0 !== prev && Object.prototype.hasOwnProperty.call(turns, t0) ? turns[t0] : '';
  };
