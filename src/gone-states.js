// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * For each conversation whose panel here went away, the last state that panel had. It stands in for the panel until
 * `claude agents` can speak for the conversation again. Closing a tab ends the panel's claude process a moment later,
 * and a list read before then still shows the process with the last state it wrote, which can be a wait the user
 * answered just before closing. So a gone state is kept until a list read after the panel went has none of the
 * processes the conversation had then. It is kept for at most `trustMs`. A process that was not there then, such as the
 * conversation resumed in a terminal, speaks for it at once. With no list held when the panel went, the first list read
 * after it does.
 *
 *   note(before, after)  the host's states before and after a report from its panels
 *   over(live)           `live` with each gone state that still stands, for a conversation `live` does not have
 *
 * `trustMs` is a number or a function that gives one.
 */
function goneStates({ now = Date.now, agentsNow, pidsOf, trustMs }) {
  const gone = new Map();
  const trust = () => (typeof trustMs === 'function' ? trustMs() : trustMs);
  const held = () => { try { return agentsNow() || {}; } catch (_) { return {}; } };
  return {
    note(before, after) {
      const t = now(), a = held();
      for (const [id, state] of before) {
        if (!after.has(id)) gone.set(id, { state, at: t, pids: a.records ? pidsOf(a.records, id) : [] });
      }
      for (const id of after.keys()) gone.delete(id);
    },
    over(live) {
      if (!gone.size) return live;
      const a = held(), t = now();
      let out = live;
      for (const [id, g] of gone) {
        let ended = false;
        if (a.records && a.at >= g.at) {
          const pids = pidsOf(a.records, id);
          ended = !pids.some((p) => g.pids.includes(p)) || pids.some((p) => !g.pids.includes(p));
        }
        if (ended || t - g.at > trust()) { gone.delete(id); continue; }
        if (out.has(id)) continue;
        if (out === live) out = new Map(live);
        out.set(id, g.state);
      }
      return out;
    },
  };
}

module.exports = { goneStates };
