// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// A message from the host handed straight to the panel's conversation, without going through the message input.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * The panel's session has the method its message input calls on Enter: send(text, files, withSelection, origin,
   * options). Given the origin {kind:"human"} it sends what the input would send, as the user's own message. While a
   * turn runs it queues the message as the panel queues one typed meanwhile (its heldPrompts), and the CLI takes it in
   * at its next step. The input, and whatever the user is typing there, is left as it is.
   *
   * The method has no published contract, so its shape is checked before it is used (sendShape): five parameters, the
   * fourth compared with the origin "human" and sent along as the message's origin, the fifth read for expandMentions,
   * and the queue. When any of that is missing, the message goes into the input and Enter sends it (91-answer.js).
   * test/send-shape.js runs the same check against each Claude Code build's bundle, and test/against-latest.js against
   * the newest one on the marketplace.
   *
   * expandMentions is false: with it, an @terminal mention would bring the user's terminal into the message, and a
   * connected browser its instructions, neither of which the sender saw. A text that starts with "/" goes to the input,
   * since the input runs some slash commands itself (a dialog, a local command) and send() does not. So does a text
   * longer than the input takes.
   */
  var DIRECT_MAX = 50000;
  var DIRECT_HEAD = /^async\s+send\(([\w$]+),([\w$]+),([\w$]+),([\w$]+),([\w$]+)\)\s*\{/;
  var sendShape = function(src){
    var s = String(src || ''), head = DIRECT_HEAD.exec(s);
    if (!head) return false;
    var origin = head[4], opts = head[5];
    return s.indexOf(origin + '?.kind==="human"') > 0
      && s.indexOf('...' + origin + '&&{origin:' + origin + '}') > 0
      && s.indexOf(opts + '?.expandMentions!==!1') > 0
      && s.indexOf('this.heldPrompts.value=[...this.heldPrompts.value,') > 0;
  };
  var directShapes = typeof WeakMap === 'function' ? new WeakMap() : null;
  /* The session that can take `text` directly, or null. */
  var directSession = function(text){
    var s = sessionRef;
    if (!s || typeof s.send !== 'function' || s.send.length !== 5) return null;
    if (!s.heldPrompts || !Array.isArray(s.heldPrompts.value)) return null;
    if (typeof text !== 'string' || /^\s*\//.test(text) || text.length > DIRECT_MAX) return null;
    var fits = directShapes ? directShapes.get(s.send) : undefined;
    if (fits === undefined) {
      try { fits = sendShape(Function.prototype.toString.call(s.send)); } catch (e) { fits = false; }
      if (directShapes) directShapes.set(s.send, fits);
    }
    return fits ? s : null;
  };
  /* `done(sent, reason, detail)` once send() has settled: 'direct' when it did, 'direct-error' with the error when it
     failed, after which the message may or may not be in the conversation. */
  var sendDirect = function(s, text, done){
    var failed = function(e){ done(false, 'direct-error', String((e && e.message) || e || 'send failed').slice(0, 300)); };
    var p;
    try { p = s.send(text, [], false, { kind: 'human' }, { expandMentions: false }); } catch (e) { failed(e); return; }
    Promise.resolve(p).then(function(){ done(true, 'direct'); }, failed);
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { sendShape: sendShape, DIRECT_MAX: DIRECT_MAX };
