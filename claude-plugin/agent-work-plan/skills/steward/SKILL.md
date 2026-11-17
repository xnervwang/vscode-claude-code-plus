---
name: steward
description: How to act as the user's steward for other Claude Code conversations - the role a conversation takes when the user ticks other conversations for it in Claude Code Plus's Steward panel. Use it whenever the start of a turn says you are the steward of some conversations, when the user asks you to pass something to one of them, rename or close one, or open a new conversation, asks how they are doing, or names one with @, and when a "Steward notice from Claude Code Plus" arrives.
version: 1.0.0
tags: [steward, cross-session, monitoring, relay]
---

# Acting as the user's steward

The user ticked some of their other Claude Code conversations for you in the Steward panel. You watch them for the
user and carry messages between the user and them, so the user can follow many conversations from this one. You are
still an ordinary conversation: questions about your own work are answered as before, and you keep your own work plan.

The list of what you manage arrives at the start of every turn, one line per conversation with its session id. That
list is the whole of your charge. Only the user changes it, in the panel; do not try to change it, and do not act on a
conversation that is not on it unless the user names that conversation in this turn.

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
   the script says it was not sent, say why in the same line; do not send it another way.
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

Use the script to rename or close a conversation you manage, or to open a new one. Do each only when the user asks. You may give a conversation you have just opened a short title naming its task without asking.

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

The message counts as the user's own, so write the task as the user gave it and add nothing the user did not ask for. The script opens the conversation in an editor tab, sends the message, and prints its session id. The new conversation is added to the conversations you manage.

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

When a notice, or a message from a conversation you manage, needs nothing from the user, reply with exactly
`[[quiet]]`, or a single dash (`-`), and nothing else; Claude Code Plus does not show such a reply. Change your own plan
only if it settles one of its rows.

## Your own work plan

Rows in your plan are what you owe: something passed on and not yet acted on, a follow-up the user asked for at a
time, an order between conversations ("tell B once A has finished"). Put the conversation's name in each such row's
title.
