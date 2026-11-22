// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The dot on the Claude logo of a Claude Code tab, which says what the conversation is doing (src/activity.js works it
 * out): green while a turn runs, a green ring once the turn has ended and only background work still runs, red while it
 * waits for you, and none once it has stopped. A reply not read yet is an envelope after the tab's title
 * (src/steward-marks.js), not on the icon. The session list and the Steward panel draw the same dots.
 *
 * The icons are Claude Code's waiting icon from the running build with its blue dot redrawn in each style, so this
 * extension ships no copy of the logo. A stopped conversation gets Claude Code's plain logo.
 *
 * The patched host asks for an icon each time it picks the tab's icon, with the icon key it picked ('pending', 'done'
 * or 'plain'), the state the panel reported ('idle', 'running' or 'waiting_input') and whether the conversation has a
 * reply not read yet.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { writeAtomic } = require('./claude-files');

// Claude Code's own icons, in its resources folder.
const FILES = { idle: 'claude-logo.svg', waiting: 'claude-logo-pending.svg' };
const GREEN = '#22c55e';
const RED = '#ef4444';
// The waiting icon's dot, and the circle its mask cuts out of the logo around it.
const DOT = /<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)" fill="#3b82f6"\/>/gi;
const CUT = /<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)" fill="black"\/>/gi;
// How much larger the dot is drawn, in the icon's 24-unit box. The cut keeps its size, so it takes no more of the
// logo's rays than Claude Code's own, and the gap round the dot narrows instead.
const GROW = 1;
const BOX = 24;
// The ring's line, in the same units; the ring's outer edge is where the solid dot's edge is.
const RING = 2.2;
// A title can still end in one of these, written by an older build of this extension when the state went after it.
const MARKS = [' \u{1F539}', ' \u{1F538}', ' \u{1F4D7}', ' \u{1F7E2}', ' \u{1F535}', ' \u{1F7E0}', ' \u25CF'];
// The icon for each state of src/activity.js; 'stopped' is Claude Code's plain logo.
const STYLES = { working: { fill: GREEN }, background: { ring: GREEN }, waiting: { fill: RED } };

/**
 * The waiting icon with its dot redrawn larger, moved in so it stays inside the box: filled with `style.fill`, or a ring
 * in `style.ring`. '' if the icon does not have exactly one blue dot and one cut circle.
 */
function withDot(svg, style) {
  const text = String(svg || '');
  const dots = [...text.matchAll(DOT)], cuts = [...text.matchAll(CUT)];
  if (dots.length !== 1 || cuts.length !== 1 || !style) return '';
  const r = Number(dots[0][1]) + GROW, c = BOX - r;
  const dot = style.ring
    ? `<circle cx="${c}" cy="${r}" r="${r - RING / 2}" fill="none" stroke="${style.ring}" stroke-width="${RING}"/>`
    : `<circle cx="${c}" cy="${r}" r="${r}" fill="${style.fill}"/>`;
  return text.replace(DOT, dot).replace(CUT, `<circle cx="${c}" cy="${r}" r="${cuts[0][1]}" fill="black"/>`);
}

/** Paths by state: Claude Code's plain logo for 'stopped', and the dotted ones, written into `dir` the first time. */
function iconsFor(resources, dir, cache) {
  if (cache && cache.has(resources)) return cache.get(resources);
  let icons = null;
  try {
    const own = Object.fromEntries(Object.entries(FILES).map(([s, name]) => [s, path.join(resources, name)]));
    const waiting = fs.readFileSync(own.waiting, 'utf8');
    const made = Object.fromEntries(Object.entries(STYLES).map(([s, style]) => [s, withDot(waiting, style)]));
    if (Object.values(made).every(Boolean) && fs.existsSync(own.idle)) {
      icons = { stopped: own.idle };
      for (const [s, svg] of Object.entries(made)) {
        const file = path.join(dir, `${crypto.createHash('sha256').update(svg).digest('hex').slice(0, 12)}-${s}.svg`);
        let have = '';
        try { have = fs.readFileSync(file, 'utf8'); } catch (_) { /* not written yet */ }
        if (have !== svg) {
          fs.mkdirSync(dir, { recursive: true });
          writeAtomic(file, svg);
        }
        icons[s] = file;
      }
    }
  } catch (_) { icons = null; }
  if (cache) cache.set(resources, icons);
  return icons;
}

function withoutMark(title) {
  const text = String(title == null ? '' : title);
  const mark = MARKS.find((m) => text.endsWith(m));
  return mark ? text.slice(0, -mark.length) : text;
}

module.exports = { FILES, GREEN, RED, GROW, RING, MARKS, STYLES, withDot, iconsFor, withoutMark };
