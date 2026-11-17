// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The warning for a Claude Code build whose code the patch no longer fits (notSupported in src/edits.js). MESSAGE and
 * DETAILS are vscode.l10n.t keys, translated in src/l10n/.
 */
const fs = require('fs');
const path = require('path');
const { notSupported } = require('./edits');

const MESSAGE = 'Claude Code Plus does not support Claude Code {0} yet. Its additions to Claude Code are paused until Claude Code Plus is updated.';
const DETAILS = 'Show Details';

const isUnsupported = notSupported;

/** The version in an install folder's package.json, or the folder's name when it cannot be read. */
function versionOf(dir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    if (typeof v === 'string' && v) return v;
  } catch (_) { /* fall through */ }
  return path.basename(dir);
}

module.exports = { isUnsupported, versionOf, MESSAGE, DETAILS };
