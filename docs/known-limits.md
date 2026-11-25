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

## Steward

- A steward can pass a message on only to a conversation that a VS Code window shows, since Claude Code Plus types it into its message input there. If no window shows the conversation, the steward first opens it.
- Whether an extension host still has its window is told by the Claude Code panels in it, which say so once a minute; a host that has not heard from one for five minutes has no window. A host that has never heard from any panel since it started is taken to have a window, so a process in it is never stopped without asking.
- Steward notices and handoffs go to the steward's inbox socket. Claude Code documents the socket for scripts but does not specify the format of the line it reads from the socket. On native Windows, the socket requires a token that only the session holds. Claude Code Plus sends neither notices nor handoffs there, and a handoff says the steward could not be reached.
- After Claude Code Plus is updated or installed again, a window that has not been reloaded runs the earlier build. Until some window runs the installed build, the windows on the earlier one keep the list of who manages whom, so a steward set to All still gains new conversations. Once a window runs the installed build, windows on the earlier build leave the list to that window. Their Steward panel says ticks there are not saved and offers Reload Window. A steward set to All in one of those windows gains no new conversations until that window is reloaded.
- A steward can manage conversations from another VS Code extension, OpenCode Agent Plus, only while both Agent Plus 1.5.0 or later and OpenCode Agent Plus run in the window that shows the steward. Otherwise, the Steward panel lists only Claude Code conversations and counts any ticked OpenCode Agent Plus conversation among the ticked conversations not open in any window.
- An OpenCode Agent Plus conversation accepts only plain messages from its steward. The steward cannot rename, close or reopen it. It is not told that a steward watches it. Unlike a Claude Code conversation, it cannot pass a message on to its steward when it thinks the message belongs elsewhere. While it waits for you to approve a tool or answer a question in its window, it does not accept the steward's message. Only you can respond there.
- The steward gets the status of OpenCode Agent Plus conversations from files that Agent Plus shares between windows. In the list the steward gets with each message, a stopped conversation whose reply you have read and a conversation not open in any window both read "idle, or not open in any window".
- The list of who manages whom can include OpenCode Agent Plus conversations, but an earlier build of Claude Code Plus does not keep those entries. While a window on an earlier build keeps the list, it drops the ticks for OpenCode Agent Plus conversations when it saves the list. A steward that managed only OpenCode Agent Plus conversations is then no longer a steward. Tick those conversations again once a window runs the installed build.
