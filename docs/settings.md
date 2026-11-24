# Settings and commands

Back to the [README](../README.md).

## Settings

Open `Claude Code Plus: Settings` for all 43 settings. Most take effect without a reload. Installing or upgrading the patch needs one.

**Work plan settings**

| Setting | Default | What it does |
| --- | --- | --- |
| `claudeCodePlus.workPlan` | on | Turns the work plan on or off in Custom. When off, Claude is told nothing about plans and cannot write one. |
| `claudeCodePlus.workPlanOfferMinTurns` | 3 | Messages you must have sent before a conversation without a plan is offered one. |
| `claudeCodePlus.workPlanOfferMinToolCalls` | 25 | Tool calls one turn must make before that offer. |
| `claudeCodePlus.workPlanQuietWhenReplyMatches` | empty | A regular expression tested on the latest reply. If it matches, the prompts before and after compaction are not sent. Use it for conversations that relay another model's replies word for word. When empty, it never matches. |
| `claudeCodePlus.conversationBrief` | on | In Custom, each conversation is asked to keep a brief: a summary, and where it stands now. Clicking the conversation in Agent Plus's Conversations panel then shows the brief instead of going to the conversation. |

**To turn off**

| What | How |
| --- | --- |
| Timestamps, reply figures and sub-agent tags | Set `claudeCodePlus.enabled` to off. Every other addition has its own `claudeCodePlus.show.*` setting. The patch stays and its scripts keep running. |
| Everything added to Claude's context | Choose Interface features in Agent Plus's token mode entry in the status bar. |
| Your time zone in Claude's context | Choose a token mode without it, or in Custom set `claudeCodePlus.tellClaudeYourTimeZone` to off. |
| Work plan plugin, skill description included | Run `Claude Code Plus: Stop Loading the Work Plan Plugin`. |
| Reopening Claude Code tabs VS Code did not restore | Set `claudeCodePlus.reopenDroppedTabs` to off. |
| Pins on the session list | Set `claudeCodePlus.sessionPins` to off. Pinned conversations are then cleaned up and archived as usual. |
| Patch and restore Claude Code's files | Run `Claude Code Plus: Remove from Claude Code (restore original files)`, or uninstall. |

Message appearance: `claudeCodePlus.userMessageColor` and `claudeCodePlus.userMessageEdge`.

## Commands

| Command | What it does |
| --- | --- |
| `Claude Code Plus: Install the Work Plan Plugin for Claude Code` | Register the plugin again. |
| `Claude Code Plus: Stop Loading the Work Plan Plugin` | Remove the plugin from Claude Code's settings. |
| `Claude Code Plus: Settings` | Open this extension's settings. |
| `Claude Code Plus: Toggle On/Off` | Toggle the timestamps, reply figures and sub-agent tags. |
| `Claude Code Plus: Turn On` | Show them. |
| `Claude Code Plus: Turn Off` | Hide them. |
| `Claude Code Plus: Remove from Claude Code (restore original files)` | Restore Claude Code's files. |
| `Claude Code Plus: Show Status` | Show patch status and what was patched. |
| `Claude Code Plus: Show How Long Opening a Panel Took` | Show recorded panel-opening times. |
