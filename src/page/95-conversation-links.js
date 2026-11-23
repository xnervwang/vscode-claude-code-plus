// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Links to other conversations in replies: a conversation's title or session id in a reply opens that conversation.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * The extension sends the conversations it knows of, of every agent Agent Plus lists (cce_conversations, src/
   * conversation-links.js). Claude Code renders a reply's markdown through react-markdown, and the panel's own rehype
   * plugins get one more here (the edit "conversation links in replies", src/webview.js): it puts a link where the tree
   * names a conversation (agentPlusKit.linkMentionsTree), so the link is drawn by Claude Code's own link component and
   * nothing is written into the panel's nodes. The link's address is the steward's form with the agent's id after it;
   * a click on it is caught in 93-steward-links.js. A reply's blocks are kept from one render to the next, so a change
   * of the list, of this panel's conversation or of the switch moves a signal the reply reads (__cceMentionsRev), and
   * each of its blocks is rendered again.
   */
  var MENTION_HREF = 'vscode://xnervwang.claude-code-plus/open?session=';
  var MENTION_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  var MENTION_SOURCE = /^[\w.-]{1,80}$/;
  var mentionKnown = [], mentionRev = 0, mentionTick = null, mentionIx = null, mentionIxKey = '', mentionSeen = '';
  var mentionByHref = {}, mentionHrefs = [], mentionWired = false, mentionAsked = 0;
  var mentionRenders = function(){
    if (!mentionTick && typeof window.__cceSignal === 'function') mentionTick = window.__cceSignal(0);
    return mentionTick ? mentionTick.value : 0;
  };
  var mentionRedraw = function(){ if (mentionTick) mentionTick.value = mentionTick.value + 1; };
  var mentionSelf = function(){ var s = sigValue('sessionId'); return typeof s === 'string' ? s : ''; };
  var mentionHrefOf = function(r){ return MENTION_HREF + r.sessionId.toLowerCase() + '&source=' + encodeURIComponent(r.sourceId); };
  var mentionIndexNow = function(){
    var self = mentionSelf(), key = mentionRev + '\n' + self;
    if (key !== mentionIxKey) { mentionIx = agentPlusKit.mentionIndex(mentionKnown, { sourceId: 'claude-code', sessionId: self }); mentionIxKey = key; }
    return mentionIx;
  };
  /* The link for range `r`, kept by its address for its hover label; a session id that is not a UUID cannot pass the
     panel's link check, so it is not linked. */
  var mentionMake = function(r, text){
    if (!MENTION_ID.test(r.sessionId) || !MENTION_SOURCE.test(r.sourceId)) return null;
    var href = mentionHrefOf(r);
    if (!Object.prototype.hasOwnProperty.call(mentionByHref, href)) {
      mentionHrefs.push(href);
      while (mentionHrefs.length > 500) delete mentionByHref[mentionHrefs.shift()];
    }
    mentionByHref[href] = r;
    return { type: 'element', tagName: 'a', properties: { href: href }, children: [{ type: 'text', value: text }] };
  };
  var mentionPlugin = function(){
    return function(tree){
      try { agentPlusKit.linkMentionsTree(tree, mentionIndexNow(), mentionMake); } catch (e) { /* the reply as Claude Code draws it */ }
    };
  };

  // Called by each block of a reply for its rehype plugins; `links` is 'text' where Claude Code draws links as text.
  window.__cceMentionPlugins = function(plugins, links){
    try {
      if (links === 'text' || isOff('conversationLinks') || !mentionKnown.length) return plugins;
      return (Array.isArray(plugins) ? plugins : []).concat([mentionPlugin]);
    } catch (e) { return plugins; }
  };
  // Read by the reply around those blocks, so that it renders them again when what they link changes.
  window.__cceMentionsRev = function(){
    try { return mentionRenders(); } catch (e) { return 0; }
  };

  /* Each sweep: the conversation of this panel and the switch, against what the blocks were last drawn with. */
  var mentionsFollow = function(){
    var seen = (isOff('conversationLinks') ? 'off' : 'on') + '\n' + mentionSelf();
    if (seen !== mentionSeen) { if (mentionSeen) mentionRedraw(); mentionSeen = seen; }
  };

  var mentionTip = function(a){
    var r = a && Object.prototype.hasOwnProperty.call(mentionByHref, a.getAttribute('href') || '') ? mentionByHref[a.getAttribute('href')] : null;
    return r ? agentPlusKit.mentionTip(r) : '';
  };
  var mentionLink = function(t){
    var a = t && t.closest ? t.closest('a[href^="' + MENTION_HREF + '"]') : null;
    return a && /[?&]source=/.test(a.getAttribute('href') || '') ? a : null;
  };
  var wireConversationLinks = function(){
    if (mentionWired) return;
    mentionWired = true;
    window.addEventListener('message', function(ev){
      var d = ev && ev.data, m = d && d.type === 'from-extension' ? d.message : null;
      if (!m || m.type !== 'cce_conversations' || !Array.isArray(m.list)) return;
      var rev = typeof m.rev === 'number' ? m.rev : 0;
      if (rev && rev === mentionRev) return;
      mentionKnown = m.list;
      mentionRev = rev || mentionRev + 1;
      mentionRedraw();
    });
    document.addEventListener('mouseover', function(ev){
      var a = mentionLink(ev.target);
      if (!a) return;
      var text = mentionTip(a);
      if (text) showLabel(a, text);
    });
    document.addEventListener('mouseout', function(ev){
      var a = mentionLink(ev.target);
      if (a && !(ev.relatedTarget && a.contains && a.contains(ev.relatedTarget))) hideLabel();
    });
  };
  /* The list is sent when it changes; a panel that opens later asks for the current one, once a second until it has
     it, at most five times. */
  var askConversations = function(){
    if (mentionRev || mentionAsked >= 5 || isOff('conversationLinks')) return;
    var now = Date.now();
    if (askConversations.at && now - askConversations.at < 1000) return;
    askConversations.at = now;
    mentionAsked++;
    try { acquireVsCodeApi().postMessage({ type: 'cce_conversations_ask' }); } catch (e) { /* asked again next sweep */ }
  };
