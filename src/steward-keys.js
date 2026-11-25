// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * How the stewards table (src/stewards.js) and the relay (src/relay.js) name a conversation. A Claude Code
 * conversation is its session id in lower case, as every build has written it; one of another agent that registers
 * with Agent Plus is `<source id>:<session id>`, the session id in its own case, since OpenCode's ids are case
 * sensitive. hooks/steward_table.py checks keys with the same pattern.
 *
 * A key holds a colon, which a Windows file name cannot, so a file is never named after a key: the plan of another
 * agent's conversation is the path its source gives (planPathOf in src/steward-core.js), kept in the table.
 *
 * The table keeps every well-formed key, also of a source this build does not know, so that a later build's ticks
 * survive this one rewriting the table; which sources the panel lists and the relay passes messages to is
 * OTHER_SOURCES.
 */
const path = require('path');
const { SESSION } = require('./claude-files');

const CLAUDE = 'claude-code';
/* The source id may hold no colon, so the first colon ends it. The session id takes what OpenCode Agent Plus accepts
   in a conversation's URI (sessionOfUri in its src/host/agentplus-source.js). */
const KEY = /^([a-z0-9][a-z0-9-]{0,63}):([A-Za-z0-9][A-Za-z0-9_-]{0,199})$/;
const OTHER_SOURCES = ['opencode-plus'];
/* Shown when Agent Plus gives a conversation no label of its source. */
const LABELS = { 'opencode-plus': 'OpenCode Agent Plus' };

/* The key of a conversation, or '' when the two ids make none. */
function keyOf(sourceId, sessionId) {
  const id = String(sessionId || '');
  if (sourceId === CLAUDE) return SESSION.test(id) ? id.toLowerCase() : '';
  const key = `${sourceId}:${id}`;
  return KEY.test(key) ? key : '';
}

/* { sourceId, sessionId } of a key, or null. */
function parse(key) {
  if (typeof key !== 'string') return null;
  if (SESSION.test(key)) return { sourceId: CLAUDE, sessionId: key.toLowerCase() };
  const m = KEY.exec(key);
  return m ? { sourceId: m[1], sessionId: m[2] } : null;
}

const isClaude = (key) => typeof key === 'string' && SESSION.test(key);
const isOther = (key) => typeof key === 'string' && !SESSION.test(key) && KEY.test(key) && !key.startsWith(CLAUDE + ':');
/* Whether the panel lists, and the relay passes messages to, conversations of this key's source. */
const allowed = (key) => isOther(key) && OTHER_SOURCES.includes(parse(key).sourceId);

/* The key the table keeps for `x`, or '' for anything it does not take. A Claude Code session id written as a key of
   its own source is taken as the session id. */
function managedId(x) {
  if (typeof x !== 'string') return '';
  if (SESSION.test(x)) return x.toLowerCase();
  const p = KEY.exec(x);
  if (!p) return '';
  return p[1] === CLAUDE ? keyOf(CLAUDE, p[2]) : x;
}

/* Whether `file` can be the plan of the conversation of key `key`: an absolute path to <session id>.json. */
function planFileOk(key, file) {
  const p = isOther(key) ? parse(key) : null;
  return !!p && typeof file === 'string' && path.isAbsolute(file) && path.basename(file) === p.sessionId + '.json';
}

const labelOf = (key) => { const p = parse(key); return p ? LABELS[p.sourceId] || p.sourceId : ''; };

module.exports = { CLAUDE, KEY, OTHER_SOURCES, LABELS, keyOf, parse, isClaude, isOther, allowed, managedId, planFileOk, labelOf };
