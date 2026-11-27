// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * How Claude Code's CLI signs in, for the Sign-in row of Account & usage in the session list.
 *
 * The CLI the panel starts gets the extension host's environment, the variables of the setting
 * claudeCode.environmentVariables and the env of ~/.claude/settings.json. With one of them it uses Amazon Bedrock, Google
 * Vertex AI or Microsoft Foundry; otherwise an API key (from the environment, an apiKeyHelper, or the one stored when
 * the user signed in with a Console account) or an auth token before a claude.ai account. This reads the same places in
 * that order. It does not check that the key or the account still works.
 *
 * With the setting claudeCode.claudeProcessWrapper, Claude Code starts that program instead, with the CLI's path as its
 * first argument, and the program can set any of those variables itself. So while the conversation in front runs in
 * this window, the environment of its CLI is read from /proc where there is one; otherwise, with a wrapper and nothing
 * found elsewhere, the Sign-in row reads "Set by the process wrapper".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { liveRecords } = require('./background');

const LABELS = { bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry', apiKey: 'API key',
  authToken: 'Auth token', claudeAi: 'claude.ai', wrapper: 'Set by the process wrapper', none: 'Not signed in' };
const on = (v) => /^(1|true|yes|on)$/i.test(String(v === undefined || v === null ? '' : v).trim());
const set = (v) => typeof v === 'string' && v.trim() !== '';
const MAX_ANCESTORS = 32;

/* `env`: the variables the CLI gets, each source overriding the ones before it; `settings`: ~/.claude/settings.json;
   `config`: ~/.claude.json. */
function method({ env = {}, settings = {}, config = {} } = {}) {
  const pick = (m) => ({ method: m, label: LABELS[m] });
  if (on(env.CLAUDE_CODE_USE_BEDROCK)) return pick('bedrock');
  if (on(env.CLAUDE_CODE_USE_VERTEX)) return pick('vertex');
  if (on(env.CLAUDE_CODE_USE_FOUNDRY)) return pick('foundry');
  if (set(env.ANTHROPIC_API_KEY) || set(settings && settings.apiKeyHelper) || set(config && config.primaryApiKey)) return pick('apiKey');
  if (set(env.ANTHROPIC_AUTH_TOKEN)) return pick('authToken');
  if (config && config.oauthAccount && typeof config.oauthAccount === 'object') return pick('claudeAi');
  return pick('none');
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; } };

/* Parses a NUL-separated environment block, the format of /proc/<pid>/environ, into an object. */
function parseEnviron(block) {
  const out = {};
  for (const line of String(block || '').split('\0')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/* The parent of `pid`, field 4 of <proc>/<pid>/stat, or 0. */
function parentOf(pid, proc) {
  try {
    const s = fs.readFileSync(path.join(proc, String(pid), 'stat'), 'latin1');
    return Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]) || 0;
  } catch (_) { return 0; }
}
function under(pid, ancestor, proc) {
  for (let p = pid, n = 0; p > 1 && n < MAX_ANCESTORS; n++) {
    if (p === ancestor) return true;
    p = parentOf(p, proc);
  }
  return false;
}

/*
 * The environment the Claude Code CLI of the conversation `sessionId` started with in this window, as { pid, env }, or
 * null. Its record in `sessions` (<config>/sessions/<pid>.json) names the process; it belongs to this window when
 * `ownPid`, the extension host, is among its ancestors, as it is whether or not a wrapper replaced itself with the CLI.
 * If two processes run the conversation, the one started last is read. Only a conversation's own process counts: a
 * panel also starts a CLI for a new conversation before anything is sent, and keeps it while the panel is hidden. Where
 * `proc` does not list `ownPid` there is no /proc to read, and null is returned without reading the records.
 */
function windowProcess({ sessions, proc = '/proc', ownPid = process.pid, sessionId = '', isAlive } = {}) {
  const want = String(sessionId || '').toLowerCase();
  if (!want || !fs.existsSync(path.join(proc, String(ownPid)))) return null;
  const recs = liveRecords(sessions, isAlive, proc)
    .filter((r) => String(r.sessionId || '').toLowerCase() === want && r.pid !== ownPid && under(r.pid, ownPid, proc))
    .sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
  for (const r of recs) {
    let block;
    try { block = fs.readFileSync(path.join(proc, String(r.pid), 'environ'), 'utf8'); } catch (_) { continue; }
    if (block) return { pid: r.pid, env: parseEnviron(block) };
  }
  return null;
}

/*
 * A reader over this machine's files and two settings: `extra` gives claudeCode.environmentVariables
 * ([{ name, value }]), `wrapper` claudeCode.claudeProcessWrapper (a path, or ''). Its argument is the session id of
 * the conversation in front, or '' when no conversation runs in this window; it returns { method, label, tooltip? }.
 * It reads the files again at most every `ms` milliseconds, as the section asks often, and at once when the settings,
 * the conversation asked for or the processes in the session registry change. Tests pass `proc`, `ownPid` and
 * `isAlive`.
 */
function reader({ extra = () => [], wrapper = () => '', env = process.env, home = os.homedir(), ms = 5000,
  proc = '/proc', ownPid = process.pid, isAlive } = {}) {
  let at = 0, last = null, lastKey = '';
  const dirOf = (e) => e.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  const filesOf = (e) => ({ settings: readJson(path.join(dirOf(e), 'settings.json')),
    config: readJson(e.CLAUDE_CONFIG_DIR ? path.join(e.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json')) });
  const withSettings = (base, settings) => (settings && settings.env && typeof settings.env === 'object' ? Object.assign({}, base, settings.env) : base);
  return (sessionId = '') => {
    let list = [], w = '';
    try { list = extra() || []; } catch (_) { list = []; }
    try { w = wrapper(); } catch (_) { w = ''; }
    w = set(w) ? w.trim() : '';
    const sessions = path.join(dirOf(env), 'sessions');
    let names = [];
    try { names = fs.readdirSync(sessions).filter((n) => /^\d+\.json$/.test(n)).sort(); } catch (_) { names = []; }
    const key = JSON.stringify([String(sessionId || ''), w, list, names]);
    if (last && key === lastKey && Date.now() - at < ms) return last;
    const viaWrapper = { method: 'wrapper', label: LABELS.wrapper,
      tooltip: `Claude Code starts its CLI through the process wrapper ${w} (claudeCode.claudeProcessWrapper), which decides how it signs in.` };
    const p = names.length && sessionId ? windowProcess({ sessions, proc, ownPid, sessionId, isAlive }) : null;
    let found;
    if (p) {
      const files = filesOf(p.env);
      const m = method({ env: withSettings(p.env, files.settings), settings: files.settings, config: files.config });
      found = m.method === 'none' && w ? viaWrapper : Object.assign(m, { tooltip:
        `Read from the environment of process ${p.pid}, the Claude Code CLI of this conversation${w ? `, started through the process wrapper ${w}` : ''}.` });
    } else {
      const own = filesOf(env);
      const merged = Object.assign({}, env);
      for (const v of Array.isArray(list) ? list : []) if (v && typeof v.name === 'string') merged[v.name] = v.value;
      const m = method({ env: withSettings(merged, own.settings), settings: own.settings, config: own.config });
      found = m.method === 'none' && w ? viaWrapper : m;
    }
    last = found;
    lastKey = key;
    at = Date.now();
    return last;
  };
}

module.exports = { method, reader, windowProcess, parseEnviron, LABELS };
