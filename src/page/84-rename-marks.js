// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Taking this extension's marks out of a title typed into one of Claude Code's rename boxes.
// Fragment of the in-page script - see README.md in this folder.

  /* Removes the marks this extension draws with titles (TITLE_MARKS, from src/webview.js), the way withoutMarks in
     src/title-marks.js does, so a mark copied into the box is not stored with the title. */
  window.__cceCleanTitle = function(t){
    try {
      if (typeof t !== 'string') return t;
      TITLE_MARKS.lastIndex = 0;
      if (!TITLE_MARKS.test(t)) return t;
      TITLE_MARKS.lastIndex = 0;
      return t.split(TITLE_MARKS).map(function(p){ return p.trim(); }).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ');
    } catch (e) { return t; }
  };
