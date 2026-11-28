// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * What a Claude Code panel needs to draw the badge on a supervisor's message (src/page/97-supervisor-rows.js):
 * claudeCodePlus.supervisorBadgeLanguage, VS Code's display language, and the badge's words. The page picks Chinese or
 * English for each conversation, whatever the display language is, so the Chinese words are read from the translations
 * in src/l10n rather than through vscode.l10n, which gives only the display language's. src/webview.js carries all three
 * to the page in the live stylesheet. No editor API here: the tests load it directly.
 */
const fs = require('fs');
const path = require('path');

const SETTING = 'supervisorBadgeLanguage';
const CHOICES = ['auto', 'zh', 'en'];
const SENT = 'Supervisor "{0}" sent this for you';
const OPEN = 'Open supervisor';
/* The entries each translation in src/l10n carries for the badge. */
const KEYS = [SENT, OPEN];
const L10N_DIR = path.join(__dirname, 'l10n');
const SCRIPTS = { 'zh-cn': 'bundle.l10n.zh-cn.json', 'zh-tw': 'bundle.l10n.zh-tw.json' };

const choiceOf = (v) => (CHOICES.includes(v) ? v : 'auto');
/* A language tag such as en or zh-cn, or ''; nothing else may reach the stylesheet. */
const uiOf = (v) => (/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');

/* { en, 'zh-cn', 'zh-tw' }, each { sent, open }; a translation that cannot be read, or lost its placeholder, is left out
   and the page shows English in its place. */
let kept = null;
function words(dir = L10N_DIR) {
  if (kept && dir === L10N_DIR) return kept;
  const out = { en: { sent: SENT, open: OPEN } };
  for (const [lang, file] of Object.entries(SCRIPTS)) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (typeof b[SENT] === 'string' && b[SENT].includes('{0}') && typeof b[OPEN] === 'string' && b[OPEN].trim()) {
        out[lang] = { sent: b[SENT], open: b[OPEN] };
      }
    } catch (_) { /* English instead */ }
  }
  if (dir === L10N_DIR) kept = out;
  return out;
}

/* What the live stylesheet carries for the page: [setting, display language, words]. */
const live = (choice, ui, dir) => [choiceOf(choice), uiOf(ui), words(dir)];

module.exports = { SETTING, CHOICES, SENT, OPEN, KEYS, choiceOf, uiOf, words, live };
