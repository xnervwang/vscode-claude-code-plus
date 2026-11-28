# Known limits

Back to the [README](../README.md).

## Work plan

- A plan file is deleted once its conversation's transcript is gone and the file has not been written for a week. Claude Code removes old transcripts, apart from those of conversations pinned on the session list.
- Uninstalling tries to copy plans to `~/.claude/agent-work-plan-plans-<timestamp>/` before unregistering the plugin, which deletes its data directory. Uninstalling continues if the copy fails, so keep your own copy of a plan that matters.

## The patch

- Disabling the extension leaves the patch in place. Run `Claude Code Plus: Remove from Claude Code (restore original files)` first.
- A yellow circle with an exclamation mark at the panel's top right means a Claude Code build changed something the patch relies on, and some panel features are not working.
- Editor-tab panels that stay blank in every window after running version 1.0.8 or earlier of the old extension: quit VS Code and delete the `CacheStorage` folders under `WebStorage` in VS Code's data folder (`~/Library/Application Support/Code` on macOS, `%APPDATA%\Code` on Windows, `~/.config/Code` on Linux).

## After the remote connection is lost

- After you reload a window that lost its remote connection, the remote machine keeps the Claude Code processes from before the reload running for five minutes, then stops them. A Claude Code tab that VS Code did not restore, and whose conversation is still running there, opens only then, about five minutes after the reload. If Claude was writing a reply in it, the reply stops at that point; what it had written so far stays in the conversation.
- If you close a Claude Code tab while the window cannot reach its remote machine, the tab opens again the next time the window starts, because the close could not be recorded. Close it again once connected.

## Supervisor

- A supervisor can send a message only to a conversation shown in a VS Code window because the Claude Code panel in that window sends the message. If no window shows the conversation, the supervisor first opens it.
- If a Claude Code update changes how the panel sends messages, Claude Code Plus falls back to typing the message into the input box and pressing `Enter`; if the box already contains text, it leaves the message unsent and tells the supervisor why. Claude Code Plus also types messages starting with `/` into the input box because the box runs some slash commands itself.
- Whether an extension host still has its window is told by the Claude Code panels in it, which say so once a minute; a host that has not heard from one for five minutes has no window. A host that has never heard from any panel since it started is taken to have a window, so a process in it is never stopped without asking.
- Supervisor notices and handoffs go to the supervisor's inbox socket. Claude Code documents the socket for scripts but does not specify the format of the line it reads from the socket. On native Windows, the socket requires a token that only the session holds. Claude Code Plus sends neither notices nor handoffs there, and a handoff says the supervisor could not be reached.
- After Claude Code Plus is updated or installed again, a window that has not been reloaded runs the earlier build. Until some window runs the installed build, the windows on the earlier one keep the list of who manages whom, so a supervisor set to All still gains new conversations. Once a window runs the installed build, windows on the earlier build leave the list to that window. Their Supervisor panel says ticks there are not saved and offers Reload Window. A supervisor set to All in one of those windows gains no new conversations until that window is reloaded.
- A supervisor changes its own list for you only when you type the request in the supervisor conversation. Claude Code Plus keeps a record for one day of each text it sends to a Claude Code conversation on someone else's behalf: an answer you wrote in Agent Plus's Answer view, a handoff from an OpenCode Agent Plus conversation, or a supervisor's message. If your request matches one of those texts, it does not count even if you typed the same words yourself; tick or untick the conversation in the Supervisor panel instead.
- The Supervisor panel's **New conversations** switch, which has a supervisor manage the conversations that start after it is turned on, cannot tell when an [OpenCode Agent Plus conversation](#opencode-agent-plus-conversations) started. Such a conversation counts as new if the panel did not list it when you turned the switch on, even if it is an older conversation you open again later.
- Claude Code Plus 1.5.0 and earlier read the list of who manages whom as if each conversation had at most one supervisor. A window running one of those versions can save the list under the conditions described in the update item above or if you install one of those versions again.
- When such a window saves the list, each conversation managed by several supervisors stays on just one supervisor's list. At most one supervisor keeps All on, and New conversations is off for every supervisor. In a window running a later version, you can tick those conversations again and turn All or New conversations back on for the supervisors that lost those settings.
- A supervisor's message is held back once if another supervisor sent a message to the same conversation in the last 30 minutes from a window running Claude Code Plus 1.6.0 or later ([what the supervisor does then](steward.md#sending-messages-to-a-conversation)).

### OpenCode Agent Plus conversations

- A supervisor can manage conversations from another VS Code extension, OpenCode Agent Plus, only while both Agent Plus 1.5.0 or later (an extension Claude Code Plus and OpenCode Agent Plus share) and OpenCode Agent Plus run in the window that shows the supervisor. Otherwise, the Supervisor panel lists only Claude Code conversations and includes any ticked OpenCode Agent Plus conversations in the count beside the button for unticking those not open in any window.
- An OpenCode Agent Plus conversation accepts only plain messages from its supervisor: the supervisor cannot rename, close or reopen it. While it waits for you to approve a tool or answer a question in its window, it does not accept the supervisor's message.
- With Agent Plus 1.6.0 or later and an OpenCode Agent Plus release later than 1.0.0, a managed conversation is told each turn that a supervisor watches it. It puts its questions for you in its work plan. Like a Claude Code conversation, it can hand its supervisor a message it thinks belongs elsewhere. The conversation must be open in a VS Code window for the handoff to reach the supervisor.
- The status of OpenCode Agent Plus conversations comes from files that Agent Plus shares between windows. Each message you send the supervisor comes with a list of the conversations it manages. In that list, two kinds of conversation both show "idle, or not open in any window": one whose turn has ended and whose reply you have read, and one not open in any window.
- The list of who manages whom can include OpenCode Agent Plus conversations, but Claude Code Plus 1.5.0 and earlier do not keep those entries. If that leaves a supervisor with no conversations to manage, it drops off the list unless it is set to All. Tick the OpenCode Agent Plus conversations again in a window that runs a later version.
