# What it costs in tokens

Back to the [README](../README.md).

Claude Code Plus adds text to what Claude Code sends the model. All of it comes from the work plan plugin Claude Code Plus registers with Claude Code; what Claude Code Plus draws in VS Code sends nothing to the model. There are two exceptions. The extension itself posts the steward notice, and handoffs, to the steward conversation. When a command left running outside Claude Code is no longer running, the extension posts a notice to the conversation that started it. Text added to a conversation stays in context and goes with every later model call until compaction replaces the conversation with a summary. A token is about four characters of English.

## Measured sizes

The work plan plugin added each plan from Claude Code Plus's tests to a message with the conversation brief turned on. Those plans have one-word row titles; most of the text is the same for every plan, and each row adds one line whose length depends on the row's title and any question it asks you.

Run `node build/plan-injection-stats.js` from a checkout of the [Agent Plus repository](https://github.com/xnervwang/vscode-agent-plus) to measure your own Claude Code transcripts from the last 14 days (`--days N` for another span). It prints the median, 90th percentile and largest sizes, in characters, of the plan text added to a message, and how many messages carried the same plan as the message before.

[Added to every message](#added-to-every-message) says when each form of the work plan is sent.

| What | Measured | How it was measured |
| --- | --- | --- |
| The work plan, whole block | 1,489 characters with one row, 1,579 with two, 1,983 with eight, plus the plan's path four times and the path of the command that writes it three times | A one-row plan and an eight-row plan with a row in each state other than `done` and `dropped`, from [`test/check.js`](../test/check.js), and a two-row plan with two questions for you, from [`test/with-core.js`](../test/with-core.js) |
| The work plan, short head | 570 characters with one row, 657 with two, 905 with eight, plus the plan's path twice and the command's path once | The same plans, after one row changed state |
| The work plan, one line | 238 characters plus the plan's path | The same plans, with nothing changed since the previous message |
| Messages that repeat the previous message's plan | Not measured here, since it depends on how often a conversation changes its plan | Counted on your own machine by the script above. A plan counts as unchanged when the only difference is how long a row had been in its state |

## Token modes

| Feature | Interface features | Essential features | All features | Custom |
| --- | --- | --- | --- | --- |
| Work plan | Off, plugin not loaded | On | On | `claudeCodePlus.workPlan` |
| Time zone | Off | On | On | `claudeCodePlus.tellClaudeYourTimeZone` |
| Conversation brief | Off | Off | On | `claudeCodePlus.conversationBrief` |
| Detached-command notices | Off | Off | On | `claudeCodePlus.detachedEndNotices` |

Claude Code Plus follows Agent Plus's `agentPlus.tokenMode` setting, which defaults to All features. Outside Custom, the settings in the table's Custom column have no effect, and changing modes leaves their values as they are. Changing one of those settings outside Custom shows a notice with a Switch to Custom button.

In Interface features, Claude Code does not load the work plan plugin, just as when you run `Claude Code Plus: Stop Loading the Work Plan Plugin`. Choosing another mode loads it again unless you stopped loading it yourself. Changes to plugin loading and the work plan skill in Claude Code's list of skills apply only to conversations started after the mode change.

In a running conversation, a mode change applies from the next message to work plan injection and reminders, conversation brief requests, and the time zone. `Claude Code Plus: Show Status` shows the mode and which of these features run. The information button in the footer of a Claude Code conversation names the mode.

## Added to every message

| What | When | At most | Turned off by |
| --- | --- | --- | --- |
| The work plan | Each message, while the conversation's plan has a row that is not `done` or `dropped`. The whole block, with what the states mean and how to change a row, on the conversation's first message and the first after each compaction; a short head in its place otherwise; one line when no row has changed since the message before. While the brief is on, each ends by asking for the status before the final reply of a turn that moves a row | 6,000 characters, the brief included; the one line is about 240 characters and the plan's path | `claudeCodePlus.workPlan` |
| The steward's list | Each message in a conversation that manages others in the Steward panel: one line per conversation, and what changed since its previous message. One sentence in its place when nothing in it changed since the previous message; the whole list again after a compaction | About 150 characters, and about 170 more per conversation it manages with a 40-character title, at most 30 of them; the one sentence is about 200 characters | Unticking them in the Steward panel |
| A steward is watching | Each message in a conversation a steward manages | About 690 characters and the path of the steward's script | Unticking it in the Steward panel |

## Added now and then

| What | When | At most | Turned off by |
| --- | --- | --- | --- |
| End-of-turn reminders | At the end of a turn that left rows `doing`, asked you something while no row waited on you, or changed things without reading or updating the plan | About 2,550 characters and the paths of the plan and of the command that writes it, when every reminder and both of the brief's requests come at once | `claudeCodePlus.workPlan` |
| The brief's requests | At the end of a turn in which a row of the plan changed state: the status once per turn; the summary when there is none, after a top-level row was added, removed or closed, and after a compaction | Included in the end-of-turn reminders | `claudeCodePlus.conversationBrief` |
| No row `doing` | At most once per turn, when the main thread has made three tool calls or changed two things besides the plan and no row is `doing` | About 430 characters, and the paths of the plan and of the command that writes it, twice each | `claudeCodePlus.workPlan` |
| Before a compaction | At 170k, 180k and 195k tokens of a 200K window, or 960k, 970k and 995k of a 1M window, once each between compactions, while a row is `doing`; said once more at the end of the turn if the plan was not written | About 540 characters, and the paths of the plan and of the command that writes it, once each | `claudeCodePlus.workPlan`; `claudeCodePlus.workPlanQuietWhenReplyMatches` |
| After a compaction | Once per compaction | About 950 characters, the plan's path, and the path of its closed rows when it has any. About 360 characters and no path when the plan has no open rows | `claudeCodePlus.workPlan`; `claudeCodePlus.workPlanQuietWhenReplyMatches` |
| The offer of a plan | Once, in a conversation with no plan, after your third message and a turn of 25 tool calls | About 390 characters and the plan's path | `claudeCodePlus.workPlan`; `claudeCodePlus.workPlanOfferMinTurns`, `claudeCodePlus.workPlanOfferMinToolCalls` |
| A write to the plan, refused | When Claude writes or edits the plan file with a row description longer than the view shows, or a question that asks more than one thing | About 450 characters | `claudeCodePlus.workPlan` |
| A steward notice | When a conversation a steward manages starts waiting for you, has a new question for you, stops while a row in the steward's own work plan names it, or has background work of its own that ended without finishing, at most once a minute for each steward. If the steward is idle, the notice starts a turn | About 210 characters, and about 100 more per conversation it names with a 40-character title, up to 380 more for one waiting on a prompt, up to 250 for each piece of background work that ended, and about 350 for each conversation run by two processes | Unticking them in the Steward panel |
| A handoff | When a conversation passes on a message that does not belong there | About 390 characters with a 40-character title, plus up to 4,000 characters from the conversation's message | Unticking that conversation in the Steward panel |
| A detached command has stopped | When a command a conversation left running outside Claude Code is gone, on Linux: one notice per conversation for the commands that stopped close together, in All features token mode or in Custom while `claudeCodePlus.detachedEndNotices` is on. If the conversation is idle, the notice starts a turn | About 200 characters, and up to 300 more per command | `claudeCodePlus.detachedEndNotices` |
| A background session has ended | When a `claude --bg` session a conversation started finishes, fails, is stopped, dies, or waits for an answer: one notice for the sessions that changed close together, in All features token mode or in Custom while `claudeCodePlus.detachedEndNotices` is on. If the conversation is idle, the notice starts a turn | About 210 characters, and up to 440 more per session | `claudeCodePlus.detachedEndNotices` |
| Work stopped with another process | When Claude Code Plus stops a conversation's other process and background work was running in it: one notice to the process that keeps the conversation, under the same setting | About 330 characters, and up to 430 more per command, monitor or subagent | `claudeCodePlus.detachedEndNotices` |
| Your time zone | When the panel reads in another time zone than this machine's: on the conversation's first message and after each compaction, then when either side's date turns over, the offset changes, or the context has grown by 100k tokens | About 300 characters | `claudeCodePlus.tellClaudeYourTimeZone` |
| Images in replies | While `claudeCodePlus.show.replyImages` is on and the panel shows images: on the conversation's first message and after each compaction. Once it is off, one sentence on the next message of a conversation that was told | About 360 characters and the conversation's folder; the sentence is 68 characters | `claudeCodePlus.show.replyImages` |

- The work plan is cut at 6,000 characters by the plugin. The reminders have no cut: each is fixed text with at most six row titles of 60 characters.
- Rows closed more than a day ago are moved out of the plan file to `closed/<session ID>.json` beside it, so reading the plan after a compaction costs less too; Agent Plus's views read both files.

## Sent with every call

| What | When | At most | Turned off by |
| --- | --- | --- | --- |
| The work plan skill in Claude Code's list of skills | Every call | Its name and a 573-character description, about 110 tokens | `Claude Code Plus: Stop Loading the Work Plan Plugin`, or the Interface features token mode |

## Costing nothing

- Everything Claude Code Plus and Agent Plus draw in VS Code.
- An answer you give in Agent Plus's Answer view is typed into the conversation and sent as your message, as if you had typed it there.
- The context meter's breakdown shows, for the conversation in front, how many times the work plan was added since the last compaction, how many characters that came to, and about what share of the context in use.
