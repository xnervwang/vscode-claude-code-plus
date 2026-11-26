// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Which of ui.js's window steps a run takes. Every run takes the steps in ALWAYS: the patch, the reload and the first
 * conversation, which most steps rely on, and the closing check for the page's warning.
 *
 * Of the other steps, CLAUDE_CODE_PLUS_UI_STEPS, step names separated by commas, and CLAUDE_CODE_PLUS_UI_STEPS_RE, a
 * regular expression a step's name has to match, take only those. CLAUDE_CODE_PLUS_UI_SHARD=i/n takes the i-th of n
 * runs of consecutive steps, cut so that each takes about as long by the seconds in step-seconds.json: the longest a
 * step took on any of the three systems of the CI, as each step prints its time when it ends.
 * CLAUDE_CODE_PLUS_UI_SHARD=suite takes none of them and leaves the run to the suite inside VS Code and test/check.js.
 */
const fs = require('fs');
const path = require('path');

const UI = path.join(__dirname, '..', 'ui.js');
const SECONDS = path.join(__dirname, '..', 'step-seconds.json');
const ALWAYS = ['the patch', 'the reload', 'a conversation in a tab', 'no self-check warning'];
/* A step step-seconds.json does not have yet counts as this many seconds. */
const UNMEASURED = 20;

/* The steps of ui.js in the order they run. */
function names(source = fs.readFileSync(UI, 'utf8')) {
  return [...source.matchAll(/await step\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
}

/* The steps outside ALWAYS cut into n runs of consecutive steps: a step goes to the run its middle falls in. */
function shards(all, seconds, n) {
  const rest = all.filter((x) => !ALWAYS.includes(x));
  const cost = (x) => seconds[x] || UNMEASURED;
  const total = rest.reduce((a, x) => a + cost(x), 0);
  const out = Array.from({ length: n }, () => []);
  let before = 0;
  for (const x of rest) {
    out[Math.min(n - 1, Math.floor((before + cost(x) / 2) / (total / n)))].push(x);
    before += cost(x);
  }
  return out;
}

/* Whether a run leaves out some of the window steps, and with them the suite inside VS Code and test/check.js. */
function partial(env = process.env) {
  const shard = env.CLAUDE_CODE_PLUS_UI_SHARD || '';
  return !!(env.CLAUDE_CODE_PLUS_UI_STEPS || env.CLAUDE_CODE_PLUS_UI_STEPS_RE || (shard && shard !== 'suite'));
}

/* A function that says whether a run with these variables takes a step. */
function chooser(env = process.env, { source, seconds } = {}) {
  const only = (env.CLAUDE_CODE_PLUS_UI_STEPS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const re = env.CLAUDE_CODE_PLUS_UI_STEPS_RE ? new RegExp(env.CLAUDE_CODE_PLUS_UI_STEPS_RE) : null;
  const want = env.CLAUDE_CODE_PLUS_UI_SHARD || '';
  let inShard = () => true;
  if (want === 'suite') inShard = () => false;
  else if (want) {
    const m = /^(\d+)\/(\d+)$/.exec(want);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) throw new Error(`CLAUDE_CODE_PLUS_UI_SHARD is "${want}"; it takes i/n or suite`);
    const mine = new Set(shards(names(source), seconds || JSON.parse(fs.readFileSync(SECONDS, 'utf8')), Number(m[2]))[Number(m[1]) - 1]);
    inShard = (name) => mine.has(name);
  }
  return (name) => ALWAYS.includes(name) || ((!only.length || only.includes(name)) && (!re || re.test(name)) && inShard(name));
}

module.exports = { ALWAYS, UNMEASURED, SECONDS, names, shards, partial, chooser };
