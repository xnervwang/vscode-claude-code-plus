// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Editor tabs of other agents' conversations, which the Steward panel cannot manage. Codex's conversation tabs are a
 * custom editor whose view type ends in chatgpt.conversationEditor; a tab restored before Codex's editor provider
 * registered can come back as a text editor on an openai-codex: URI. Codex Plus checks its own tabs the same way (its
 * src/codex-tabs.js).
 */
const CODEX_VIEW_TYPE = 'chatgpt.conversationEditor';
const CODEX_SCHEME = 'openai-codex';

const isCodexViewType = (viewType) => typeof viewType === 'string'
  && (viewType === CODEX_VIEW_TYPE || viewType.endsWith('.' + CODEX_VIEW_TYPE) || viewType.endsWith('-' + CODEX_VIEW_TYPE));

/** { agent, title } for another agent's conversation tab, or null for any other tab. */
function agentOfTab(vscode, tab) {
  const input = tab && tab.input;
  if (!input) return null;
  const codex = (vscode.TabInputCustom && input instanceof vscode.TabInputCustom && isCodexViewType(input.viewType))
    || (vscode.TabInputText && input instanceof vscode.TabInputText && input.uri && input.uri.scheme === CODEX_SCHEME);
  if (!codex) return null;
  return { agent: 'Codex', title: typeof tab.label === 'string' ? tab.label : '' };
}

module.exports = { agentOfTab };
