// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The scheduled prompts that wake a session up on an interval.
 *
 * Claude Code keeps them in <project>/.claude/scheduled_tasks.json - one file per project directory, each task
 * carrying the id of the session that created it. The panel is never told they exist, so the extension host reads the
 * files and the injected script matches them against its own session id.
 *
 * Only the host can do this: the panel runs in a webview with no file system of its own. The data reaches the page
 * through the live stylesheet, which is the one channel that already runs between the two.
 *
 * The reading is deliberately forgiving. A task file is written by another process and may be half-written, absent, or
 * shaped differently by a later Claude Code build; every one of those cases yields no tasks rather than an error,
 * because a missing panel section is a far better outcome than a broken one.
 */
const fs = require('fs');
const path = require('path');

/** More than any real session has. The cap exists so a stylesheet cannot grow without bound. */
const MAX_TASKS = 20;
/** The prompt is the most useful field and also the largest; this keeps a long one readable without carrying a novel. */
const MAX_PROMPT = 4000;

/** Where a project directory keeps its task file, plus the case where the directory is itself named `.claude`. */
function candidates(dir) {
  return [path.join(dir, '.claude', 'scheduled_tasks.json'), path.join(dir, 'scheduled_tasks.json')];
}

function readFile(file) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
  const tasks = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : [];
  return tasks.filter((t) => t && typeof t === 'object');
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Every task found under the given directories, trimmed to the fields the panel shows.
 *
 * The directories are read in sorted order, which is what keeps the answer from depending on who asked for it. They
 * arrive most recently opened first - useful for deciding which to drop at the cap, and different in every window - and
 * both the order of this list and, through the cap below, its membership followed that. Two windows then disagreed about
 * a file they both write, so each put its own version back every thirty seconds and every panel reloaded its stylesheet
 * that often.
 *
 * Sorting the input rather than the output, on purpose: collecting everything and ordering it afterwards would turn the
 * early stop at the cap into reading every directory on every pass, which is real file work on a path that runs on a
 * timer.
 */
function readTasks(dirs) {
  const out = [];
  const seen = new Set();
  for (const dir of (dirs || []).slice().sort()) {
    if (!dir) continue;
    for (const file of candidates(dir)) {
      for (const t of readFile(file)) {
        const key = str(t.id) + '\u0000' + str(t.createdBySessionId);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: str(t.id),
          cron: str(t.cron),
          recurring: t.recurring !== false,
          createdAt: num(t.createdAt),
          lastFiredAt: num(t.lastFiredAt),
          session: str(t.createdBySessionId),
          project: str(t.createdInProject),
          prompt: str(t.prompt).slice(0, MAX_PROMPT),
        });
        if (out.length >= MAX_TASKS) return out;
      }
    }
  }
  return out;
}

/* A cap on the directories read on each refresh, for a machine running many sessions. */
const MAX_DIRS = 30;

/*
 * Which project directories to look for scheduled prompts in: the working directory of each running Claude Code
 * session, from its record in ~/.claude/sessions. Claude Code keeps a session's task file under the directory the
 * session was started in, open in a window or not.
 *
 * Every window writes the same stylesheet, so every window must compute the same list. The session records are the
 * same files for all of them, and the list is sorted. A window's open folders would not do: two windows with different
 * folders open would overwrite each other's stylesheet in turn.
 */
const isDirectory = (d) => { try { return fs.statSync(d).isDirectory(); } catch (_) { return false; } };
function taskDirs(records, { isDir = isDirectory, max = MAX_DIRS } = {}) {
  const seen = new Set();
  for (const r of records || []) {
    const cwd = r && typeof r.cwd === 'string' ? r.cwd : '';
    if (cwd && path.isAbsolute(cwd)) seen.add(cwd);
  }
  return [...seen].sort().filter((d) => isDir(d)).slice(0, max);
}

module.exports = { readTasks, taskDirs, MAX_TASKS, MAX_PROMPT, MAX_DIRS };
