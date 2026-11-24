// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Whether Agent Plus, rather than Claude Code, shows the notices of waits (the two notice edits in src/webview.js).
// Fragment of the in-page script - see README.md in this folder.

  /* The panel's HTML carries the answer as it was when the panel was built (src/host.js), which covers a permission
     request that arrives before boot; the extension sends the answer again whenever it changes (src/waiting-for.js). */
  var waitsLeft = window.__cceWaitsQuiet === true;
  window.__cceWaitsAnnounced = function(){ return waitsLeft; };
  var listenForWaitNotices = function(){
    window.addEventListener('message', function(ev){
      var d = ev && ev.data, m = d && d.type === 'from-extension' ? d.message : null;
      if (m && m.type === 'cce_waits_announced' && typeof m.on === 'boolean') waitsLeft = m.on;
    });
  };
