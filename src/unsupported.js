// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The warning for a Claude Code build whose code the patch no longer fits; src/edits.js ends that error with "build is
 * not supported yet". MESSAGE and DETAILS are vscode.l10n.t keys, translated in src/l10n/.
 */
const fs = require('fs');
const path = require('path');

const UNSUPPORTED = / build is not supported yet$/;
const MESSAGE = 'Claude Code Plus does not support Claude Code {0} yet. Its features are paused until Claude Code Plus is updated.';
const DETAILS = 'Show Details';

const isUnsupported = (message) => UNSUPPORTED.test(String(message || ''));

/** The version in an install folder's package.json, or the folder's name when it cannot be read. */
function versionOf(dir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    if (typeof v === 'string' && v) return v;
  } catch (_) { /* fall through */ }
  return path.basename(dir);
}

module.exports = { isUnsupported, versionOf, MESSAGE, DETAILS };
