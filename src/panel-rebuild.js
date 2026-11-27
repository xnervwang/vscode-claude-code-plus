// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Builds a Claude Code panel again when its script never reached it.
 *
 * A panel's page and every file it asks for go through the editor's webview service worker, and all Claude Code tabs of
 * every window share one of those workers. Its registration's address carries the remote the window is connected to,
 * so when windows on two different remotes are open, each one that builds a panel registers the worker under its own
 * address and the browser installs it again. A page made while that happens is not served by any worker: its request
 * for webview/index.js goes out to the network and fails at once. A request already in flight when the worker changes
 * is answered to the new worker, and the one that holds it gives up after 30 seconds. Either way Claude Code asks once
 * more from the same page, which fails the same way, and then shows its "couldn't load" notice.
 *
 * Setting the panel's HTML again makes the editor build a new page, served by whichever worker is in place by then, as
 * the editor's Reload Webviews command does. Only for a script that was not delivered: one that arrived and threw would
 * throw again. Twice at most for one panel, the second time later, so a file that is really missing ends on Claude
 * Code's notice as before.
 */
const DELAYS_MS = [2000, 10000];
const MARK = /\n?<!-- cce-built-again \d+ -->$/;

/* The HTML with a trailing comment numbered n, so that it differs from what the panel has: the editor sends a page only
   when the HTML changes. */
function marked(html, n) {
  return String(html).replace(MARK, '') + `\n<!-- cce-built-again ${n} -->`;
}

/*
 * Returns onFailed(webview, report) for Claude Code's handler of a panel's failure report, which passes the report as
 * Claude Code parsed it. setTimer(fn, ms) schedules; log(line) records. onFailed returns the delay of the build it
 * scheduled, or 0 when it scheduled none.
 */
function create({ setTimer = setTimeout, log = () => {}, delays = DELAYS_MS } = {}) {
  const tries = new WeakMap();
  return function onFailed(webview, report) {
    if (!webview || typeof webview !== 'object' || !report || report.type !== 'panel_load_failed') return 0;
    if (report.recovered === true || report.reason !== 'not_delivered') return 0;
    const n = (tries.get(webview) || 0) + 1;
    if (n > delays.length) {
      if (n === delays.length + 1) log(`a Claude Code panel still did not get its script after being built again ${delays.length} times; left on its notice`);
      tries.set(webview, n);
      return 0;
    }
    tries.set(webview, n);
    const ms = delays[n - 1];
    setTimer(() => {
      let html;
      try { html = webview.html; } catch (_) { return; }
      if (typeof html !== 'string' || !html) return;
      try {
        webview.html = marked(html, n);
        log(`a Claude Code panel did not get its script; built its page again, time ${n}`);
      } catch (_) { /* the panel was closed meanwhile */ }
    }, ms);
    return ms;
  };
}

module.exports = { create, marked, DELAYS_MS };
