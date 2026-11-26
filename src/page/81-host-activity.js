// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// What the extension host found each conversation doing, for the agent map's own row.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * The extension works out each conversation's dot (src/activity.js) and sends the set with the host's session states
   * (an edit in src/webview.js). It is kept in one of the panel's own signals, so whatever reads it is
   * redrawn when it changes. It covers work the panel does not show, such as a detached command while the map's list of them is
   * switched off (82-scheduled-tasks.js).
   */
  var hostActivity = null, hostActivityText = '';
  var marksNow = function(){
    if (!hostActivity && typeof window.__cceSignal === 'function') hostActivity = window.__cceSignal({ dots: {} });
    var v = hostActivity && hostActivity.value;
    return v && typeof v === 'object' ? v : { dots: {} };
  };
  window.__cceSetActivity = function(map){
    try {
      var next = { dots: map && typeof map === 'object' && !Array.isArray(map) ? map : {} };
      var text = JSON.stringify(next);
      if (text === hostActivityText) return;
      hostActivityText = text;
      marksNow();
      if (hostActivity) hostActivity.value = next;
    } catch (e) { /* the map keeps the dot it has */ }
  };
