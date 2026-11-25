// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// An answer from the Conversations tab (src/answers.js), sent from this panel as if typed here: the text goes into
// the message input and Enter sends it, so it reaches the conversation as the user's own message and is queued like
// one when a turn is running. The host only hands it to the panel showing that conversation.
// Fragment of the in-page script - see README.md in this folder.

  var ANSWER_INPUT = '[role="textbox"][aria-label="Message input"]';
  var answerResult = function(id, sent, reason, detail){
    /* The handle the panel's own bundle asked for, which src/panel-tz.js hands out again rather than asking twice. */
    try { acquireVsCodeApi().postMessage({ type: 'cce_answer_result', id: id, sent: sent, reason: reason || '', detail: detail || '' }); }
    catch (e) { /* the sender reports it as not sent when its wait runs out */ }
  };
  var inputText = function(box){ return String(box.textContent || '').replace(/\u200b/g, '').trim(); };
  /* Line breaks typed into the input can become elements rather than characters, so text is compared without spaces. */
  var squash = function(s){ return String(s || '').replace(/[\s\u200b]+/g, ''); };
  /* The input was empty before the answer went in, so clearing it removes only the answer. */
  var emptyInput = function(box){
    try {
      var range = document.createRange();
      range.selectNodeContents(box);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false);
    } catch (e) { /* left as it is */ }
    if (inputText(box)) box.textContent = '';
  };
  /* Claude Code can replace the input element. It saves the old element's text in the session's composerDraft and fills
     the new element with it. So the input is looked up again each time, and a kept draft that is just the answer is
     dropped; otherwise the answer reappears after it was sent. */
  var currentInput = function(box){ return document.querySelector(ANSWER_INPUT) || box; };
  var dropDraft = function(text){
    try {
      if (sessionRef && typeof sessionRef.composerDraft === 'string' && squash(sessionRef.composerDraft) === squash(text)) {
        sessionRef.composerDraft = '';
      }
    } catch (e) { /* the draft is kept */ }
  };
  /* For the host's log when Enter seemed not to send. */
  var inputDetail = function(box, now){
    var all = 0;
    try { all = document.querySelectorAll(ANSWER_INPUT).length; } catch (e) { all = 0; }
    return 'input replaced: ' + (now !== box ? 'yes' : 'no') + '; inputs on the page: ' + all + '; page hidden: ' + (document.hidden ? 'yes' : 'no');
  };
  /* The sidebar may have switched conversations since the host checked which one it shows. */
  var showsOther = function(m){
    var now = sigValue('sessionId');
    return typeof now === 'string' && !!now && typeof m.sessionId === 'string' && !!m.sessionId && now !== m.sessionId;
  };
  /* Claude Code sends the input's textContent. One insertText with a newline in it puts the next line in an element of
     its own, which textContent joins to the line before; so the text goes in line by line, with the line break Claude
     Code itself types for Shift+Enter between them. */
  var typeLines = function(text){
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (i) document.execCommand('insertLineBreak', false);
      /* insertText goes through the browser's own editing, so the input's handlers see it as typing. */
      if (lines[i]) document.execCommand('insertText', false, lines[i]);
    }
  };
  /* Why the answer cannot go into the input now, or null. The input's own text comes back with 'draft', so that the
     host can see whether it typed that text itself. */
  var MAX_DRAFT = 8000;
  var refusal = function(m){
    if (showsOther(m)) return { reason: 'not-shown' };
    var box = document.querySelector(ANSWER_INPUT);
    if (!box) return { reason: 'no-input' };
    /* Text already in the input would be sent along with the answer. */
    var had = inputText(box);
    if (had) return { reason: 'draft', detail: had.slice(0, MAX_DRAFT) };
    return null;
  };
  var sendAnswer = function(m){
    var no = refusal(m);
    if (no) { answerResult(m.id, false, no.reason, no.detail); return; }
    if (m.confirm === true) { waitForGo(m); return; }
    typeAnswer(m);
  };
  /*
   * With `confirm`, the panel says it is ready and types only once the host answers go within GO_WAIT_MS. A host that has
   * given up never says go, so an answer that reached the panel late, after a lost connection or a frozen page, is
   * dropped rather than typed after the host has reported it (ANSWER_READY_MS in src/claude-source.js).
   */
  var GO_WAIT_MS = 2000;
  /* Enter is pressed no later than this after the page said it was ready, or the text is taken back out: a throttled
     timer must not send it after the host has stopped waiting. */
  var GO_SEND_MS = 3000;
  var awaitingGo = {};
  var waitForGo = function(m){
    var at = Date.now();
    var drop = function(){ if (awaitingGo[m.id]) { delete awaitingGo[m.id]; answerResult(m.id, false, 'late'); } };
    awaitingGo[m.id] = { m: m, at: at, timer: setTimeout(drop, GO_WAIT_MS) };
    answerResult(m.id, false, 'ready');
  };
  var takeGo = function(id){
    var w = awaitingGo[id];
    if (!w) return;
    delete awaitingGo[id];
    clearTimeout(w.timer);
    /* A frozen page can get to the go after its own timer was due. */
    if (Date.now() - w.at > GO_WAIT_MS) { answerResult(id, false, 'late'); return; }
    var no = refusal(w.m);
    if (no) { answerResult(id, false, no.reason, no.detail); return; }
    typeAnswer(w.m, w.at + GO_SEND_MS);
  };
  /* Typed with the caret placed in the input rather than by focusing it. The panel can be on screen beside the one the
     user is typing in, and taking the focus would move the user's next keys into this conversation's input. */
  var typeAnswer = function(m, sendBy){
    var box = document.querySelector(ANSWER_INPUT);
    if (!box) { answerResult(m.id, false, 'no-input'); return; }
    var text = m.text.replace(/\r\n?/g, '\n');
    try {
      var range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      typeLines(text);
    } catch (e) { /* checked below */ }
    /* Sent without its line breaks, an answer reads differently, so the input has to hold it as it is. */
    if (String(box.textContent || '').replace(/\u200b/g, '') !== text) {
      emptyInput(box);
      answerResult(m.id, false, 'insert');
      return;
    }
    setTimeout(function(){
      if (showsOther(m)) { emptyInput(box); answerResult(m.id, false, 'not-shown'); return; }
      if (sendBy && Date.now() > sendBy) { emptyInput(box); answerResult(m.id, false, 'late'); return; }
      pressSend(box, text, function(sent, reason, detail){ answerResult(m.id, sent, reason, detail); });
    }, 60);
  };
  /* Presses Enter to send the input. Sent once the input is first seen empty; anything typed after that is left alone.
     When the wait runs out, the input is cleared only if it still holds just `text`. */
  var pressSend = function(box, text, done){
    /* With Ctrl, Enter sends whether or not Claude Code is set to send on Ctrl+Enter; Shift+Enter would be a new line. */
    try {
      box.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    } catch (e) { /* checked below */ }
    var waited = 0;
    var look = function(){
      var now = currentInput(box);
      if (!inputText(now)) { dropDraft(text); done(true, ''); return; }
      if ((waited += 50) < 800) { setTimeout(look, 50); return; }
      if (squash(now.textContent) === squash(text)) emptyInput(now);
      dropDraft(text);
      done(false, 'left-in-input', inputDetail(box, now));
    };
    setTimeout(look, 50);
  };

  /* A steward's new conversation (src/relay.js). The host opened this tab with the first message already in its input,
     and asks every panel of the window to send it. Only a panel with no conversation yet whose input holds exactly that
     text sends it, once per id, and it answers when its conversation has a session id. */
  var submittedNew = {};
  var NEW_ID_WAIT_MS = 15000;
  var submitResult = function(id, sent, reason, sessionId){
    try { acquireVsCodeApi().postMessage({ type: 'cce_submit_result', id: id, sent: sent, reason: reason || '', sessionId: sessionId || '' }); }
    catch (e) { /* the host reports it as not known when its wait runs out */ }
  };
  var submitNew = function(m){
    if (submittedNew[m.id]) return;
    var sid = sigValue('sessionId');
    if (typeof sid === 'string' && sid) return;
    var box = document.querySelector(ANSWER_INPUT);
    if (!box || !squash(m.text) || squash(box.textContent) !== squash(m.text)) return;
    submittedNew[m.id] = true;
    pressSend(box, m.text, function(sent, reason){
      if (!sent) { submitResult(m.id, false, reason, ''); return; }
      var waited = 0;
      var look = function(){
        var now = sigValue('sessionId');
        if (typeof now === 'string' && now) { submitResult(m.id, true, '', now); return; }
        if ((waited += 250) < NEW_ID_WAIT_MS) { setTimeout(look, 250); return; }
        submitResult(m.id, true, '', '');
      };
      look();
    });
  };
  /* An answer handed over before this page listens is lost, and a tab a steward has just opened on a stored conversation
     (src/relay.js) is sent its text at once. So the page says, through the answers' own reply, when it listens for its
     conversation: as it starts listening, and when it finds which conversation it shows. */
  var ANSWERS_READY = 'cce-answers-ready';
  var answersOn = false;
  var sayAnswersReady = function(){
    var sid = sigValue('sessionId');
    if (!answersOn || typeof sid !== 'string' || !sid) return;
    /* 'confirms' tells the host that this page waits for its go (waitForGo above). */
    try { acquireVsCodeApi().postMessage({ type: 'cce_answer_result', id: ANSWERS_READY, sent: false, reason: 'confirms', detail: sid }); }
    catch (e) { /* the steward's text then waits until its wait runs out */ }
  };
  var listenForAnswers = function(){
    window.addEventListener('message', function(ev){
      var d = ev && ev.data, m = d && d.type === 'from-extension' ? d.message : null;
      if (m && m.type === 'cce_submit' && typeof m.text === 'string' && typeof m.id === 'string') {
        try { submitNew(m); } catch (e) { submitResult(m.id, false, 'error', ''); }
        return;
      }
      if (m && m.type === 'cce_answer_go' && typeof m.id === 'string') {
        try { takeGo(m.id); } catch (e) { answerResult(m.id, false, 'error'); }
        return;
      }
      if (!m || m.type !== 'cce_answer' || typeof m.text !== 'string' || typeof m.id !== 'string') return;
      try { sendAnswer(m); } catch (e) { answerResult(m.id, false, 'error'); }
    });
    answersOn = true;
    sayAnswersReady();
  };
