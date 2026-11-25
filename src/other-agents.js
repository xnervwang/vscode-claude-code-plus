// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Editor tabs of other agents' conversations. Codex's conversation tabs are a custom editor whose view type ends in
 * chatgpt.conversationEditor; a tab restored before Codex's editor provider registered can come back as a text editor
 * on an openai-codex: URI. Codex Plus checks its own tabs the same way (its src/codex-tabs.js). The Steward panel cannot
 * manage a Codex conversation.
 *
 * OpenCode Agent Plus's chat tabs are a custom editor of view type opencodeAgentPlus.chat (isChatTab in its
 * src/host/agentplus-source.js). A steward can manage such a conversation, ticked from a Claude Code one; it cannot be
 * a steward itself.
 */
const CODEX_VIEW_TYPE = 'chatgpt.conversationEditor';
const CODEX_SCHEME = 'openai-codex';
const OPENCODE_VIEW_TYPE = 'opencodeAgentPlus.chat';

const viewTypeIs = (viewType, want) => typeof viewType === 'string'
  && (viewType === want || viewType.endsWith('.' + want) || viewType.endsWith('-' + want));

/** { agent, title, manageable } for another agent's conversation tab, or null for any other tab. */
function agentOfTab(vscode, tab) {
  const input = tab && tab.input;
  if (!input) return null;
  const title = typeof tab.label === 'string' ? tab.label : '';
  const custom = vscode.TabInputCustom && input instanceof vscode.TabInputCustom;
  if (custom && viewTypeIs(input.viewType, OPENCODE_VIEW_TYPE)) return { agent: 'OpenCode Agent Plus', title, manageable: true };
  const codex = (custom && viewTypeIs(input.viewType, CODEX_VIEW_TYPE))
    || (vscode.TabInputText && input instanceof vscode.TabInputText && input.uri && input.uri.scheme === CODEX_SCHEME);
  if (!codex) return null;
  return { agent: 'Codex', title, manageable: false };
}

module.exports = { agentOfTab };
