// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The figures of a conversation running in this window, for the Claude Code part of the session list's Account & usage
 * section (Agent Plus's protocol, accountInfo).
 *
 * Claude Code's host asks a conversation's CLI for them when the conversation starts and after every turn, and keeps
 * them by session id; the host edit "session totals reach this extension" (src/host.js) hands each one here. Claude
 * Code's own session list shows the same four figures under Session: the estimated cost, the time spent in API calls,
 * the time since the conversation started, and the lines added and removed. A conversation that does not run in this
 * window has none, as in Claude Code's list.
 */
const MAX_KEPT = 200;

const number = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/* "$0.42", "<$0.01", "$12.30". */
function cost(usd) {
  if (usd === null) return '';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return '$' + usd.toFixed(2);
}
/* "0.8s", "45s", "2m 10s", "1h 3m". */
function duration(ms) {
  if (ms === null) return '';
  if (ms < 10000) return (Math.round(ms / 100) / 10) + 's';
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
const lines = (n) => `${n} ${n === 1 ? 'line' : 'lines'}`;

/* The four figures of one report, or null when it has none of them. */
function figures(totals) {
  if (!totals || typeof totals !== 'object') return null;
  const f = {
    costUsd: number(totals.total_cost_usd), apiMs: number(totals.total_api_duration_ms), wallMs: number(totals.total_duration_ms),
    added: number(totals.total_lines_added), removed: number(totals.total_lines_removed),
  };
  return Object.values(f).some((v) => v !== null) ? f : null;
}

/* The rows of the Account & usage section for `f`. */
function rows(f) {
  if (!f) return [];
  const out = [];
  if (f.costUsd !== null) out.push({ label: 'Estimated cost', value: cost(f.costUsd) });
  if (f.apiMs !== null) out.push({ label: 'Total duration (API)', value: duration(f.apiMs) });
  if (f.wallMs !== null) out.push({ label: 'Total duration (wall)', value: duration(f.wallMs) });
  if (f.added !== null || f.removed !== null) out.push({ label: 'Total code changes', value: `${lines(f.added || 0)} added, ${lines(f.removed || 0)} removed` });
  return out;
}

/* Keeps the latest figures of each conversation and calls `changed(sessionId)` when they differ from the ones kept. */
function create({ changed = () => {} } = {}) {
  const kept = new Map();
  return {
    /* For the host edit: a report for `sessionId`, null when the host has none for it. */
    note(sessionId, totals) {
      if (typeof sessionId !== 'string' || !sessionId) return;
      const f = figures(totals);
      const before = JSON.stringify(kept.get(sessionId) || null);
      if (f) { kept.delete(sessionId); kept.set(sessionId, f); } else kept.delete(sessionId);
      while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
      if (JSON.stringify(f) !== before) { try { changed(sessionId); } catch (_) { /* the next report */ } }
    },
    of: (sessionId) => kept.get(sessionId) || null,
    rows: (sessionId) => rows(kept.get(sessionId) || null),
  };
}

module.exports = { create, figures, rows, cost, duration };
