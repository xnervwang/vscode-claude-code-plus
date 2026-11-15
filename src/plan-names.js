// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The names in the plan directory, kept current from the watch the extension holds on it (watchStewards in
 * extension.js) instead of listing it on every pass: it holds thousands of files, and several timers list it. Each name
 * the watch reports is looked up on its own; a change it reports without a name, or LIST_MS since the last listing,
 * lists the directory again. Without a watch, every call lists the directory.
 */
const fs = require('fs');
const path = require('path');

const LIST_MS = 5 * 60000;
let watched = '';
let cache = null;

/** The directory now watched, or '' when the watch is gone. */
function watching(dir) {
  watched = dir || '';
  if (!cache || cache.dir !== watched) cache = null;
}

/** A change the watch reported in `dir`, for the entry `name`, or for an unknown one when name is empty. */
function changed(dir, name) {
  if (!cache || cache.dir !== dir) return;
  if (!name) { cache = null; return; }
  if (fs.existsSync(path.join(dir, name))) cache.names.add(name);
  else cache.names.delete(name);
}

/** The entries of `dir`, as fs.readdirSync gives them; throws as it does. */
function names(dir, now = Date.now()) {
  if (watched && watched === dir && cache && cache.dir === dir && now - cache.at < LIST_MS) return [...cache.names];
  const list = fs.readdirSync(dir);
  if (watched && watched === dir) cache = { dir, names: new Set(list), at: now };
  return list;
}

module.exports = { names, changed, watching, LIST_MS };
