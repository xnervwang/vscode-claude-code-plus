// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// The plan bar right above the input box: where this conversation's work plan stands, in one line.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * Agent Plus's fragment draws the bar (04-plan-bar.js, agentPlusPlanBar); this places it and feeds it. It goes in
   * right before the input's form, in the wrapper that also holds the panel's own banners above the form, so it is as
   * wide as the input box, and the room Claude Code keeps under the messages for the input area grows with it. The
   * extension sends the summary of this panel's conversation (cce_plan_bar, src/plan-bar.js) when asked and whenever it
   * changes; a summary of another conversation is ignored. A click goes back to the extension, which opens Agent Plus's
   * work plan view, or its Answer view for the red part, at this conversation. Switched off
   * (claudeCodePlus.show.planBar), or with the extension switched off, the bar is taken out and nothing is asked.
   */
  var PLANBAR = null, planBarSession = '', planBarSummary = null, planBarHas = '', planBarAsks = 0, planBarAskedAt = 0, planBarWired = false;
  var planBarWasOff = false;
  var planBarPost = function(m){ try { acquireVsCodeApi().postMessage(m); } catch (e) { /* asked again on a later sweep */ } };
  var planBarSelf = function(){ var s = sigValue('sessionId'); return typeof s === 'string' ? s : ''; };
  /* Asked once, then once a second five times, and after that every ten seconds until an answer comes. It is also asked
     at once when the extension says it has registered with Agent Plus (cce_plan_bar_ready), since a panel can open
     before the extension listens for its question. */
  var askPlanBar = function(id){
    if (planBarHas === id) return;
    var now = Date.now();
    if (planBarAskedAt && now - planBarAskedAt < (planBarAsks < 5 ? 1000 : 10000)) return;
    planBarAskedAt = now;
    planBarAsks++;
    planBarPost({ type: 'cce_plan_bar_ask', sessionId: id });
  };
  var wirePlanBar = function(){
    if (planBarWired) return;
    planBarWired = true;
    window.addEventListener('message', function(ev){
      var d = ev && ev.data, m = d && d.type === 'from-extension' ? d.message : null;
      if (m && m.type === 'cce_plan_bar_ready') {
        if (planBarHas !== planBarSelf()) { planBarAsks = 0; planBarAskedAt = 0; }
        try { ensurePlanBar(); } catch (e) { /* the next sweep asks */ }
        return;
      }
      if (!m || m.type !== 'cce_plan_bar' || typeof m.sessionId !== 'string' || m.sessionId !== planBarSelf()) return;
      planBarSummary = m.summary && typeof m.summary === 'object' ? m.summary : null;
      planBarHas = m.sessionId;
      try { ensurePlanBar(); } catch (e) { /* the next sweep draws it */ }
    });
  };
  var dropPlanBar = function(){
    if (PLANBAR) { PLANBAR.destroy(); PLANBAR = null; }
  };
  var ensurePlanBar = function(){
    if (!isOn() || isOff('planBar')) { dropPlanBar(); planBarWasOff = true; return; }
    var self = planBarSelf();
    /* A new conversation in this panel, or the bar switched back on: what was drawn may be out of date. */
    if (self !== planBarSession || planBarWasOff) {
      planBarSession = self; planBarSummary = null; planBarHas = ''; planBarAsks = 0; planBarAskedAt = 0; planBarWasOff = false;
    }
    if (self) askPlanBar(self);
    var send = document.querySelector(SEND), form = send && send.closest ? send.closest('form') : null;
    if (!self || !form || !form.parentElement) { if (PLANBAR) PLANBAR.update(null); return; }
    if (!PLANBAR) {
      PLANBAR = agentPlusPlanBar.create(document, {
        onOpen: function(){ planBarPost({ type: 'cce_plan_bar_open', sessionId: planBarSession, part: 'plan' }); },
        onAnswer: function(){ planBarPost({ type: 'cce_plan_bar_open', sessionId: planBarSession, part: 'answer' }); },
        css: 'border-radius:var(--corner-radius-large, 6px);background:var(--app-input-secondary-background, var(--vscode-input-background, #252526))'
      });
    }
    /* The width is read only when the bar is put in place; after that the fragment follows its own width. */
    if (PLANBAR.el.parentElement !== form.parentElement || PLANBAR.el.nextSibling !== form) {
      form.parentElement.insertBefore(PLANBAR.el, form);
      PLANBAR.fit(form.getBoundingClientRect().width);
    }
    PLANBAR.update(planBarSummary);
  };
