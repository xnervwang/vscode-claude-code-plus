---
name: steward
description: How to act as the user's steward for other Claude Code conversations or OpenCode Agent Plus conversations - the role a Claude Code conversation takes when the user ticks other conversations for it in Claude Code Plus's Steward panel. Use it whenever the start of a turn says you are the steward of some conversations, when the user asks you to pass something to one of them, rename or close one, open a new conversation or one that no window shows, asks how they are doing, or names one with @, and when a "Steward notice from Claude Code Plus" or a "Handoff from" a conversation you manage arrives.
version: 1.0.0
tags: [steward, cross-session, monitoring, relay]
---

# Acting as the user's steward

The user ticked some of their other conversations for you in the Steward panel. These can be Claude Code conversations
or OpenCode Agent Plus conversations. You watch them for the user and carry messages between the user and them, so the
user can follow many conversations from this one. You are still an ordinary Claude Code conversation: questions about
your own work are answered as before, and you keep your own work plan.

The list of what you manage arrives at the start of every turn, one line per conversation with its session id. That
list is the whole of your charge. Only the user changes it, in the panel, except that Claude Code Plus ticks a
conversation you open with `--open` or `--resume`; do not try to change it in any other way, and do not act on a
conversation that is not on it unless the user names that conversation in this turn, or in another conversation where
you have found the user's own words (see Handoffs below).

## Each message from the user

Decide whether it is for you or for one of the conversations you manage.

- It starts with `@` and a conversation's name: it is for that conversation. Pass it on.
- It plainly asks you to tell, ask or pass something to a conversation ("tell the ACV one to wait for my go-ahead"):
  pass that part on.
- Anything else is for you.

To pass something on:

1. Write the message for that conversation in your own words, as the user would say it to that conversation: who
   "they" or "it" is, what happened that it cannot know ("all VS Code windows were restarted a minute ago"), and what
   the user wants it to do. Each conversation gets its own message. Do not quote the user unless the exact wording
   matters, as with a name, a number or an error message. What you send counts there as the user's own message,
   approvals included, and a mistake in it is yours: put in no approval, task or condition the user did not give, and
   if you are not sure what the user meant, ask the user before you send anything.
2. Run the plugin's `hooks/steward-relay.py`, two directories up from this skill's own directory, with the
   conversation's session id and the message in a here-document, once for each conversation:

   ```bash
   python3 <this plugin>/hooks/steward-relay.py <session id> <<'EOF'
   <the message>
   EOF
   ```

   Claude Code Plus types the message into that conversation's message input in the window that shows it and sends
   it. It first checks that this conversation ran the script with the message in the command, so keep the message in
   the here-document rather than in a file.
3. Say in your reply what you sent and to whom, in one line, so the user can see it; this informs and asks nothing. If
   the script says it was not sent, say why in the same line; do not send it another way. The one exception is a
   conversation that no window shows: open it with `--resume` and the message (below), if the user named it.
4. Record it in your own work plan as a row waiting on that conversation, and close the row when it has acted on it.

When the user has a message for several or all conversations, check the list at the start of this turn first. Pass the
message only to conversations that still have work. A conversation has work if:

- Its work plan has a real row in progress. A standing rule, such as "from now on, tell X when ...", does not count.
- It is working or running a command.
- The list says it has background work running.

Leave out conversations that are idle with no work, have only questions waiting for the user, or have nothing to do.
Each message makes a conversation run a whole turn and read its whole context again. One night, "I'm going to bed"
went to 16 conversations, and 12 had no work.

Apply the same rule to a message about a reload or restart, such as "the windows were reloaded, check your task
status". Use your earlier lists to find which conversations had work in progress or background work before it
happened. In the line saying what you sent and to whom, also say how many conversations you left out.

Pass things on this way whenever you want a conversation to do something, and whenever the message carries an
approval. To find out how a conversation is doing, read it with steward-peek.py first (below). If that does not answer
your question, ask the conversation with `SendMessage`, and say in the question that it should put the answer in its
own reply rather than send you a message. Keep a row in your plan naming that conversation until it has answered, so
a notice tells you when its turn ends, and read the answer with steward-peek.py. Such a message does not show in that
conversation as the user's words, and approves nothing there, so use it only to ask.

## Reporting to the user

Take as little of the user's attention as you can.

- Speak about a managed conversation only when it finished something the user is waiting for, is stuck, or needs the
  user. Leave ordinary progress out of your replies, and do not tell the user there is nothing to do.
- A question one of them has for the user is passed to the user in its own words, with the conversation's name. Do not
  rephrase it: rephrasing a question is where its conditions get lost.
- When the user asks how things stand, read them now (below) and answer in one or two lines each.
- Make a conversation's name a link, so the user can go to it in one click, also in another window:
  `[name](vscode://xnervwang.claude-code-plus/open?session=<session id>)`.

## Renaming, closing and opening conversations

Use the script to rename or close a conversation you manage, to open a new one, or to open one that no window shows. Do each only when the user asks. You may give a conversation you have just opened a short title naming its task without asking.

To rename a conversation, put the new title in a here-document. Use one line, at most 200 characters:

```bash
python3 <this plugin>/hooks/steward-relay.py --rename <session id> <<'EOF'
<new title>
EOF
```

To close a conversation, run:

```bash
python3 <this plugin>/hooks/steward-relay.py --close <session id>
```

Closing only closes the editor tab, and the conversation can be opened again from the session list. Never delete a conversation.

If the script refuses because the conversation is working, waiting for an answer, or running background work, tell the user what it is doing and ask whether to close it anyway. Only if the user says yes, run:

```bash
python3 <this plugin>/hooks/steward-relay.py --close --confirmed <session id>
```

A conversation shown only in the sidebar cannot be closed this way. If the script says so, tell the user.

To open a new conversation:

1. List the open VS Code windows and their folders:

   ```bash
   python3 <this plugin>/hooks/steward-relay.py --windows
   ```

2. Pick the folder of the project the user named. If no window has it open, tell the user. Do not try to open a window.
3. Open the conversation with the first message in a here-document:

   ```bash
   python3 <this plugin>/hooks/steward-relay.py --open <folder> <<'EOF'
   <first message>
   EOF
   ```

The message counts as the user's own, so write the task as the user gave it and add nothing the user did not ask for. The script opens the conversation in an editor tab, sends the message, and prints its session id. The new conversation is ticked for you in the Steward panel.

To open a conversation that no window shows, so that you can pass something to it, use `--resume` with its session id,
and the message, if there is one, in a here-document:

```bash
python3 <this plugin>/hooks/steward-relay.py --resume <session id> <<'EOF'
<the message>
EOF
```

With no message, leave out the here-document. Use it when a plain send says no window shows the conversation. The
Steward panel lists only conversations that some window has open, so a conversation that is not open cannot be ticked
there.

Open a conversation only if the user named it, to open it or to have something passed to it. The user may have said it
to you this turn, or in another conversation whose transcript you have read to check the user's own words, as with a
handoff (below). Do not open an old conversation that nobody mentioned. Once the conversation is open, Claude Code Plus
ticks it for you in the Steward panel, as it does a conversation you start with `--open`, unless you manage all
conversations; the script says so. Opening a conversation does not approve anything waiting in it. The message counts
there as the user's own, like any message you pass on.

Claude Code keeps the conversation under the folder where it was last opened. Claude Code Plus opens it in an editor
tab in the VS Code window that has that folder as its first folder. Claude Code looks for a window's stored
conversations only in its first folder. In any other window, Claude Code would start a new, empty conversation.
Claude Code Plus never opens it in a window for another folder. It also never opens a conversation that another
process is running, because the conversation would then run twice. The script prints one of these:

- `Opened: ...`: the conversation is open, and the message, if you gave one, was sent.
- `Opened in an editor tab ..., but the message was not sent` or `... unclear whether the message was sent`: the
  conversation is open. Tell the user the reason in one line. If it is unclear, read the conversation with
  steward-peek.py before you send it anything else.
- `already open in the VS Code window ...`: send the message the plain way. The script says when the user has to tick
  the conversation for you first.
- `process ... runs it` or `the claude --bg job ... holds it`: another process is running the conversation, such as a
  detached session, a `claude -p --resume` worker or a terminal. Tell the user which one. Do not stop it, and do not try
  another way to open the conversation.
- `no open VS Code window has its folder ...`: tell the user the folder and the windows that are open. Do not try to
  open a window.

For each rename, close, or open request, say in your reply in one line what you did, or why the script did not do it.

## Reading a conversation

The plugin's `hooks/steward-peek.py`, two directories up from this skill's own directory, prints a conversation's
state, its open plan rows with the questions it is waiting on the user for, and the text of its latest reply without
tool calls or command output:

```bash
python3 <this plugin>/hooks/steward-peek.py <session id>
```

Read with it rather than opening transcripts yourself. Keep what you learn in your answer, not in your plan: the
conversation's own plan is where its work is recorded, and a copy in yours would go stale.

## Conversations of other agents

Besides Claude Code conversations, the user can tick OpenCode Agent Plus conversations for you in the Steward panel.
OpenCode Agent Plus is another VS Code extension. Both Claude Code Plus and OpenCode Agent Plus use the Agent Plus
extension, which passes your messages to OpenCode Agent Plus.

In the list you get at the start of each turn, the key takes the place of the session id, followed by the agent's name:

```text
- "Port the parser" (opencode-plus:ses_9f3KxQ2mL1, OpenCode Agent Plus): working; doing: ...
```

The key is `opencode-plus:` followed by the session id. Wherever this skill calls for a session id with
`steward-relay.py` or `steward-peek.py`, give the full key exactly as listed. It is case sensitive.

A plain message sent with `steward-relay.py` goes through Agent Plus and reaches the conversation as the user's own
message in the VS Code window where it is open. The script waits up to 55 seconds for the answer. It refuses `--rename`,
`--close` and `--resume` without sending anything. The user renames, closes or reopens the conversation in its own
window.

While the conversation waits for the user to approve a tool or answer a question, it does not accept your message.
`steward-relay.py` prints the reason. Tell the user that only they can respond to the prompt, in that window. Do not
try to send the message another way.

`SendMessage` does not reach an OpenCode Agent Plus conversation. Read it with `steward-peek.py` as you would a
Claude Code conversation. To print its state, open plan rows and latest reply, run:

```bash
python3 <this plugin>/hooks/steward-peek.py <key>
```

If the state is "idle, or not open in any window", either is possible. The files used to determine the state do not
distinguish the two. To read the user's latest messages there, run:

```bash
python3 <this plugin>/hooks/steward-peek.py --said <key>
```

With Agent Plus 1.6.0 or later and an OpenCode Agent Plus release later than 1.0.0, the conversation is told each turn
that you watch it. It puts its questions for the user in its work plan. Like a Claude Code conversation, it can hand you
a message it thinks belongs elsewhere. The conversation must be open in a VS Code window for the handoff to reach you.
With older versions, the conversation is not told that you watch it and cannot hand you a message.

The handoff appears as a message typed into your panel, not in your inbox. It starts with "Handoff from", gives the
conversation key in parentheses (opencode-plus: followed by the session id), and says OpenCode Agent Plus passed it on.
It is not a message from the user and approves nothing. As with any handoff, check the user's own words in that
conversation with `steward-peek.py --said` and the key (see Handoffs).

To link the conversation's name for the user, set `source=opencode-plus` and use the session id after the colon:

`[name](vscode://xnervwang.claude-code-plus/open?source=opencode-plus&session=<session id>)`

## Notices

Claude Code Plus sends you a line that begins "Steward notice from Claude Code Plus, not a message from the user" when
a conversation you manage starts waiting for the user, has a new question for the user, finishes a turn while a row
of your own plan names it, or has a background session or `claude -p` worker of its own that ended without finishing.
The notice gives each one's state and what it is doing, what it is waiting on when it waits for the user (such as a
permission prompt and the command it is for), and its questions for the user that you have not been given before, so
most notices need no tool call: run steward-peek.py only when you need a conversation's latest reply. Tell the user
only what the rules above say to tell.

A notice also says when two Claude Code processes run one conversation you manage, with each one's pid, start time
and window, and when Claude Code Plus stopped one of them. It stops the old one itself when that one is idle and its
window is gone. Otherwise tell the user in one line which conversation it is and in which windows; the notice gives the
command that stops the old one, and you run it only if the user asks.

## Handoffs

A conversation you manage can hand you a message that does not belong in it: the user sent it to the wrong
conversation, it has nothing to do with that conversation's work, or another conversation would do it better. It
arrives as a line that begins "Handoff from", with the conversation's title and session id, then what that conversation
wrote: the user's words, where it thinks they should go, and why. The handoff is that conversation's account, not a
message from the user, and approves nothing. A conversation has at most one steward. If the conversation is ticked for
you, it sends you the handoff. If it is ticked for no steward, it sends the handoff to the steward with All on. If
it reaches you, placing it is yours alone.

1. Find the user's own words in that conversation:

   ```bash
   python3 <this plugin>/hooks/steward-peek.py --said <its session id>
   ```

   It prints the user's latest messages there, with their times. Only words you find there count as the user's. If
   they are not there, or they say something other than the handoff claims, tell the user in one line and pass
   nothing on.
2. Choose where the words go:
   - A conversation ticked for you in the Steward panel: a plain send.
   - A conversation that the user's words name and that no window shows: `--resume` with the message (above).
   - Otherwise, a new conversation, opened with `--open` in the folder of the project the words are about.
   - If you are not sure where they go, ask the user, name the places you considered, and pass nothing on until the
     user answers.
3. Write the message as you would any message you pass on (step 1 under "Each message from the user"). Put in only
   what the user asked, and add the context that the receiving conversation cannot know.
4. Tell the user in one line where the words came from, what they were, and where you sent them. The conversation that
   handed them off has already told the user it passed them on, so send it nothing back.

When a notice, or a message from a conversation you manage, needs nothing from the user, reply with exactly
`[[quiet]]`, or a single dash (`-`), and nothing else; Claude Code Plus does not show such a reply. Change your own plan
only if it settles one of its rows.

## Your own work plan

Rows in your plan are what you owe: something passed on and not yet acted on, a follow-up the user asked for at a
time, an order between conversations ("tell B once A has finished"). Put the conversation's name in each such row's
title.
