// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Steward reply links: clicking a conversation's name opens that conversation, by the same route as the Steward panel.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * A steward writes a conversation's name as a link to vscode://xnervwang.claude-code-plus/open?session=<id>. Left to
   * VS Code, such a link goes through the system's URL handler, and from a Mac it has been seen to reach no window at
   * all. This listener cancels the click and posts the session id to the extension instead (steward.open in
   * src/steward-view.js), which shows the conversation in whichever window has it. A link that 95-conversation-links.js
   * draws for a conversation named in a reply also carries the agent's id, and goes to Agent Plus's
   * agentPlus.openConversation, which opens the conversation through the agent it belongs to.
   */
  var STEWARD_LINK = 'vscode://xnervwang.claude-code-plus/open?';
  var STEWARD_SESSION = /[?&]session=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:&|$)/;
  var STEWARD_SOURCE = /[?&]source=([\w.%-]{1,240})(?:&|$)/;
  var stewardLinksWired = false;
  var wireStewardLinks = function(){
    if (stewardLinksWired) return;
    stewardLinksWired = true;
    document.addEventListener('click', function(ev){
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      var href = a ? String(a.getAttribute('href') || '') : '';
      if (href.indexOf(STEWARD_LINK) !== 0) return;
      var m = STEWARD_SESSION.exec(href);
      if (!m) return;
      ev.preventDefault();
      ev.stopPropagation();
      var src = STEWARD_SOURCE.exec(href), sourceId = '';
      try { sourceId = src ? decodeURIComponent(src[1]) : ''; } catch (e) { sourceId = ''; }
      try {
        acquireVsCodeApi().postMessage(sourceId ? { type: 'cce_open_conversation', sourceId: sourceId, sessionId: m[1].toLowerCase() }
          : { type: 'cce_open_session', sessionId: m[1].toLowerCase() });
      } catch (e) { /* nothing opens, as before */ }
      try { hideLabel(); } catch (e) { /* no label shown */ }
    }, true);
  };
