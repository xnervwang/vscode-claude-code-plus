// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The full list that Show Status writes to the output channel: everything Claude Code Plus has changed outside its own
 * folder, and how each is undone. lines() reads no file: extension.js gathers what it lists.
 */
const fs = require('fs');
const path = require('path');

/* Keyed by what status() returns (src/patch-target.js). */
const STATES = {
  patched: 'patched by this version',
  outdated: 'patched by another version of Claude Code Plus',
  clean: 'not patched',
  missing: 'not found',
};

/**
 * One Claude Code install's patched files as [{ file, state, backup }]: `state` as the adapter's status() gives it, and
 * `backup` the path of the backup of Claude Code's own file, or '' when there is none.
 */
function installFiles(adapters, dir) {
  return adapters.map((a) => {
    const file = a.targetFile(dir);
    const backup = file + a.BACKUP_SUFFIX;
    let state;
    try { state = a.status(dir); } catch (e) { state = 'unreadable: ' + ((e && e.message) || e); }
    return { file, state, backup: fs.existsSync(backup) ? backup : '' };
  });
}

/*
 * installs: [{ dir, files }] from installFiles. plugin: { listed, enabled, unloadedByMode, marketplace, location, ref }.
 * dataDir: the plugin's data directory. pinsMoved: how many transcripts have had their modification time moved forward
 * by a pin. commands: the titles of the Remove and Stop Loading the Work Plan Plugin commands.
 */
function lines({ installs = [], plugin = {}, dataDir = '', pinsMoved = 0, commands = {} }) {
  const out = ['What Claude Code Plus has changed outside its own folder', ''];
  out.push('Claude Code installs:');
  if (!installs.length) out.push('  none found');
  for (const inst of installs) {
    out.push('  ' + inst.dir);
    for (const f of inst.files) {
      const name = (p) => (p.startsWith(inst.dir + path.sep) ? p.slice(inst.dir.length + 1) : p);
      out.push(`    ${name(f.file)}: ${STATES[f.state] || f.state}` + (f.backup ? `; Claude Code's own copy is kept as ${name(f.backup)}` : ''));
    }
  }
  out.push(`  Undo: ${commands.remove || 'Remove'} puts every file back from its copy.`);
  out.push('');
  out.push('Work plan plugin in Claude Code:');
  if (!plugin.listed) out.push('  not installed');
  else {
    out.push(`  ${plugin.ref}: installed from the marketplace ${plugin.marketplace}` + (plugin.location ? ` at ${plugin.location}` : ''));
    out.push('  loaded in new conversations: ' + (plugin.enabled ? 'yes'
      : plugin.unloadedByMode ? 'no (the Interface features token mode turned it off)' : 'no'));
    out.push(`  Undo: ${commands.disablePlugin || 'Stop Loading the Work Plan Plugin'} turns it off; uninstalling Claude Code Plus removes it.`);
  }
  if (dataDir) out.push(`  Plans and the files the hooks keep: ${dataDir}`);
  out.push('');
  out.push('Pinned conversations:');
  out.push(`  transcripts with a modification time moved forward to keep them from Claude Code's cleanup: ${pinsMoved}`);
  return out;
}

module.exports = { installFiles, lines };
