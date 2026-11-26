// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * How Claude Code's CLI signs in, for the Claude Code part of the session list's Account & usage section.
 *
 * The CLI the panel starts gets the extension host's environment, the variables of the setting
 * claudeCode.environmentVariables and the env of ~/.claude/settings.json. With one of them it uses Amazon Bedrock, Google
 * Vertex AI or Microsoft Foundry; otherwise an API key (from the environment, an apiKeyHelper, or the one stored when
 * the user signed in with a Console account) or an auth token before a claude.ai account. This reads the same places in
 * that order. It does not check that the key or the account still works.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const LABELS = { bedrock: 'Amazon Bedrock', vertex: 'Google Vertex AI', foundry: 'Microsoft Foundry', apiKey: 'API key',
  authToken: 'Auth token', claudeAi: 'claude.ai', none: 'Not signed in' };
const on = (v) => /^(1|true|yes|on)$/i.test(String(v === undefined || v === null ? '' : v).trim());
const set = (v) => typeof v === 'string' && v.trim() !== '';

/* `env`: the variables the CLI gets, later sources first overridden; `settings`: ~/.claude/settings.json; `config`:
   ~/.claude.json. Returns { method, label }. */
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

/*
 * A reader over this machine's files and `extra`, a function giving the claudeCode.environmentVariables setting
 * ([{ name, value }]). It reads again at most every `ms` milliseconds, as the section asks often.
 */
function reader({ extra = () => [], env = process.env, home = os.homedir(), ms = 5000 } = {}) {
  let at = 0, last = null;
  return () => {
    if (last && Date.now() - at < ms) return last;
    const dir = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    const settings = readJson(path.join(dir, 'settings.json'));
    const config = readJson(env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json'));
    const merged = Object.assign({}, env);
    let list = [];
    try { list = extra() || []; } catch (_) { list = []; }
    for (const v of Array.isArray(list) ? list : []) if (v && typeof v.name === 'string') merged[v.name] = v.value;
    if (settings && settings.env && typeof settings.env === 'object') Object.assign(merged, settings.env);
    last = method({ env: merged, settings, config });
    at = Date.now();
    return last;
  };
}

module.exports = { method, reader, LABELS };
