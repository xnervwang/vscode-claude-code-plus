// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Agent Plus's notices as a stack of cards at the bottom right of this panel, above the message input and level with its
// right edge (src/notices.js sends them, agentPlusKit.noticeStack draws them). This panel leaves out the card of the
// conversation it shows. While there are cards, the message list gets the height of a full stack more room at its end,
// so the newest reply can still be scrolled clear of them.
// Fragment of the in-page script - see README.md in this folder.

  var NOTICE_SOURCE = 'claude-code';
  var NOTICE_GAP = 8;
  var notices = null, noticeSession = '';
  /* The message list given more room at its end, as { el, own, ownMove, base }: its inline padding and transition, and
     its computed padding, before that; and the room. */
  var noticeRoomed = null, noticeRoomPx = 0;
  /* Each list's own padding, read once, the first time it is given room: read again while the room is still going, as a
     folded card soon after another asks for it, it would be where the padding has got to on its way back. */
  var noticeBases = typeof WeakMap === 'function' ? new WeakMap() : null;
  var noticePost = function(action, card){
    try {
      acquireVsCodeApi().postMessage({ type: 'cce_notice', action: action, sourceId: card ? String(card.sourceId) : '',
        sessionId: card ? String(card.sessionId) : '' });
    } catch (e) { /* the host does not hear it */ }
  };
  /* Above the box the message input sits in (the form around the send button, or the input's own box when there is no
     form), its right edge level with that box's; the bottom right of the window when there is neither. */
  var noticeAnchor = function(){
    var send = document.querySelector(SEND);
    var box = (send && send.closest('form')) || document.querySelector(ANSWER_INPUT);
    var r = box ? box.getBoundingClientRect() : null;
    noticeRoom(noticeRoomPx);
    if (!r || !r.height) return { bottom: 12, right: 10 };
    return { bottom: Math.max(12, (window.innerHeight || 0) - r.top + NOTICE_GAP), right: Math.max(4, (window.innerWidth || 0) - r.right),
      width: r.width };
  };
  /*
   * The message list scrolls inside messagesContainer_. While there are cards its padding at the end grows by the
   * height of a full stack, whatever the number of cards, so a card coming or going does not move the conversation; a
   * list that was scrolled to its end is kept there. The padding comes and goes over NOTICE_ROOM_MS, the list following
   * it, and at once with reduced motion. Also called each time the stack is placed, since the panel can replace the
   * list.
   */
  var NOTICE_ROOM_MS = 220;
  var noticeRoom = function(px){
    var S = agentPlusKit.STACK;
    noticeRoomPx = px > 0 ? S.height + S.peek * S.depth : 0;
    var list = document.querySelector('[class*="messagesContainer_"]');
    if (noticeRoomed && noticeRoomed.el !== list) {
      try { noticeRoomed.el.style.paddingBottom = noticeRoomed.own; noticeRoomed.el.style.transition = noticeRoomed.ownMove; } catch (e) { /* gone */ }
      noticeRoomed = null;
    }
    if (!list) return;
    if (!noticeRoomed) {
      if (!noticeRoomPx) return;
      noticeRoomed = noticeBases && noticeBases.get(list);
      if (!noticeRoomed) {
        noticeRoomed = { el: list, own: list.style.paddingBottom || '', ownMove: list.style.transition || '',
          base: parseFloat(getComputedStyle(list).paddingBottom) || 0 };
        if (noticeBases) noticeBases.set(list, noticeRoomed);
      }
    }
    var want = noticeRoomPx ? (noticeRoomed.base + noticeRoomPx + NOTICE_GAP) + 'px' : noticeRoomed.own;
    if (list.style.paddingBottom === want) return;
    var calm = false;
    try { calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden; } catch (e) { calm = true; }
    var atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 4;
    list.style.transition = calm ? noticeRoomed.ownMove : 'padding-bottom ' + NOTICE_ROOM_MS + 'ms ease-out';
    list.style.paddingBottom = want;
    if (!noticeRoomPx) {
      var gone = noticeRoomed;
      noticeRoomed = null;
      setTimeout(function(){ try { if (!noticeRoomed) gone.el.style.transition = gone.ownMove; } catch (e) { /* gone */ } }, NOTICE_ROOM_MS + 50);
      return;
    }
    if (!atEnd) return;
    if (calm) { list.scrollTop = list.scrollHeight; return; }
    var until = Date.now() + NOTICE_ROOM_MS + 50;
    var follow = function(){ list.scrollTop = list.scrollHeight; if (Date.now() < until) requestAnimationFrame(follow); };
    follow();
  };
  var noticeLeave = function(){
    var box = document.querySelector(ANSWER_INPUT);
    try { if (box) box.focus(); } catch (e) { /* the focus stays */ }
  };
  var noticeSkip = function(card){
    var sid = sigValue('sessionId');
    return card.sourceId === NOTICE_SOURCE && typeof sid === 'string' && !!sid && card.sessionId === sid;
  };
  /* The conversation this panel shows can change in place, which changes the card it leaves out. */
  var noticeFollow = function(){
    var sid = sigValue('sessionId');
    var now = typeof sid === 'string' ? sid : '';
    if (now === noticeSession) return;
    noticeSession = now;
    if (notices) notices.refresh();
  };
  var listenForNotices = function(){
    if (window.IS_SESSION_LIST_ONLY) return;
    notices = agentPlusKit.noticeStack({ post: noticePost, anchor: noticeAnchor, room: noticeRoom, skip: noticeSkip, leave: noticeLeave,
      colors: NOTICE_COLORS });
    window.addEventListener('message', function(ev){
      var d = ev && ev.data, m = d && d.type === 'from-extension' ? d.message : null;
      if (!m || m.type !== 'cce_notices' || !Array.isArray(m.cards)) return;
      try { noticeSession = String(sigValue('sessionId') || ''); notices.set(isOn() ? m.cards : [], m.now, m.mode); } catch (e) { /* the next list */ }
    });
    /* A page that was hidden, or has just been made, asks for the cards rather than waiting for the next change. */
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) noticePost('ask'); });
    window.addEventListener('resize', function(){ try { notices.place(); } catch (e) {} });
    setInterval(function(){ try { noticeFollow(); } catch (e) {} }, 1000);
    noticePost('ask');
  };
