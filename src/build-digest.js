// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * A digest of the code in an installed copy of this extension: every file under the folder, by relative path and
 * content, with package.json read without the __metadata VS Code writes into it at each install, so two installs of
 * the same package give the same digest.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKIP_DIR = new Set(['__pycache__', 'node_modules']);

function files(root, rel = '') {
  let out = [];
  let names;
  try { names = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (_) { return out; }
  for (const e of names) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) out = out.concat(files(root, r)); } else if (e.isFile() && !e.name.endsWith('.pyc')) out.push(r);
  }
  return out;
}

/** Hex digest, or '' when the folder cannot be read. */
function digest(root) {
  const list = files(root).sort();
  if (!list.length) return '';
  const h = crypto.createHash('sha256');
  try {
    for (const r of list) {
      let body = fs.readFileSync(path.join(root, r));
      if (r === 'package.json') {
        const pkg = JSON.parse(body.toString('utf8'));
        delete pkg.__metadata;
        body = Buffer.from(JSON.stringify(pkg));
      }
      h.update(r).update('\0').update(String(body.length)).update('\0').update(body);
    }
  } catch (_) { return ''; }
  return h.digest('hex');
}

module.exports = { digest };
