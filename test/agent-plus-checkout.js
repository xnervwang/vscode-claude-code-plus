// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Where test/check.js and test/with-core.js find Agent Plus's source: AGENT_WORK_PLAN_DIR, else a vscode-agent-plus
 * checkout beside this repository, else one beside its main worktree, which is where a linked worktree (git worktree
 * add) has it. CI checks Agent Plus out beside this repository.
 *
 * A checkout whose history does not hold the Agent Plus commit the window tests build (test/vscode/agent-plus-commit)
 * is older than the Agent Plus this tree is tested with, and is not used: run against it, the checks would fail, or
 * pass, for reasons CI does not share. A shallow clone, as CI makes, has too little history to tell and is used.
 *
 * find() returns { dir } or { dir: '', why }, `why` saying in one sentence why no checkout is used.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const isCheckout = (d) => fs.existsSync(path.join(d, 'src', 'host.js')) && fs.existsSync(path.join(d, 'test', 'fake-vscode.js'));
/* Without git's GIT_* variables: inside a hook, GIT_DIR would point every call at this repository. */
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd, args) => {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() });
  return r.status === 0 ? r.stdout.trim() : null;
};

function candidates(root, env) {
  const out = [];
  if (env.AGENT_WORK_PLAN_DIR) out.push(env.AGENT_WORK_PLAN_DIR);
  out.push(path.join(root, '..', 'vscode-agent-plus'));
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (common) out.push(path.join(path.dirname(common), '..', 'vscode-agent-plus'));
  return [...new Set(out.map((d) => path.resolve(d)))];
}

function find({ root = ROOT, env = process.env } = {}) {
  const tried = candidates(root, env);
  const dir = tried.find(isCheckout);
  if (!dir) return { dir: '', why: `no Agent Plus checkout at ${tried.join(' or ')}; set AGENT_WORK_PLAN_DIR to one` };
  let want = '';
  try { want = fs.readFileSync(path.join(root, 'test', 'vscode', 'agent-plus-commit'), 'utf8').trim(); } catch (_) { want = ''; }
  const tracked = git(dir, ['rev-parse', '--is-shallow-repository']);
  if (want && tracked === 'false' && git(dir, ['merge-base', '--is-ancestor', want, 'HEAD']) === null) {
    return { dir: '', why: `the Agent Plus checkout at ${dir} does not hold ${want.slice(0, 7)}, the commit the window tests build; `
      + 'update it, or set AGENT_WORK_PLAN_DIR to a newer one' };
  }
  return { dir };
}

module.exports = { find };
