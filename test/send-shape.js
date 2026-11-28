// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Usage: node test/send-shape.js <path to webview/index.js>. Checks that the panel's session still has the send() that
 * src/page/91-direct-send.js hands a message to: the method is read out of the bundle and given to the sendShape the page
 * itself runs on it. Exits 1 when there is no such method, more than one, or one of another shape. The page then types
 * such a message into the input and sends it, which still works but no longer leaves the user's draft alone.
 */
const fs = require('fs');
const { sendShape } = require('../src/page/91-direct-send.js');

const HEAD = 'async send(';

/* The source of the method whose header starts at `at`, through the brace that closes its body. Strings and template
   literals are skipped, a template's substitutions included; the bundle is minified, so it has no comments. */
function methodAt(src, at) {
  const close = src.indexOf(')', at);
  const open = close < 0 ? -1 : src.indexOf('{', close);
  if (open < 0) return '';
  let depth = 0;
  const subs = [];
  const template = (j) => {
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') return j + 1;
      if (src[j] === '$' && src[j + 1] === '{') { subs.push(depth); depth++; return j + 2; }
      j++;
    }
    return j;
  };
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === '\'') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (subs.length && depth === subs[subs.length - 1]) { subs.pop(); i = template(i + 1); continue; }
      if (depth === 0) return src.slice(at, i + 1);
    }
    i++;
  }
  return '';
}

/* Every async send( method in `src`. */
function sendMethods(src) {
  const out = [];
  for (let i = src.indexOf(HEAD); i >= 0; i = src.indexOf(HEAD, i + HEAD.length)) out.push(methodAt(src, i));
  return out;
}

/* { ok, why } for a bundle's source. */
function check(src) {
  const found = sendMethods(String(src || ''));
  if (!found.length) return { ok: false, why: 'the panel has no async send( method any more' };
  if (found.length > 1) return { ok: false, why: `the panel has ${found.length} async send( methods, so which one the session has cannot be told` };
  if (!sendShape(found[0])) return { ok: false, why: `the session's send() has another shape: ${found[0].slice(0, 160)}` };
  return { ok: true, why: '' };
}

function main(file) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch (e) { console.log(`send shape: cannot read ${file}: ${e.message}`); return 1; }
  const r = check(src);
  if (!r.ok) {
    console.log(`send shape: ${r.why}; a message from the host is then typed into the message input instead of handed to the conversation`);
    return 1;
  }
  console.log('send shape: the panel\'s session still sends a message as the user\'s own and queues it while a turn runs');
  return 0;
}

if (require.main === module) process.exit(main(process.argv[2]));

module.exports = { methodAt, sendMethods, check };
