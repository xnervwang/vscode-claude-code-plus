#!/usr/bin/env python3
# BSD 3-Clause License
# Copyright (c) 2026, Xnerv Wang
# All rights reserved.

"""UserPromptSubmit hook: for a steward, list the conversations it manages and the state of each; for a managed
conversation, say that a steward watches it.

Claude Code Plus's Steward panel keeps who manages whom in stewards.json in this plugin's data directory
(src/stewards.js in the extension).

Each managed conversation gets one line: its state from Claude Code's session records, what its plan has in progress,
whether it has background work running, and how many questions it has for the user. Background work is what Claude Code
Plus's windows last found (WORKING_FILE, written by extension.js), used only while the window that wrote it still
runs. Then what changed since the steward's previous turn, kept in <steward>.steward-seen beside its plan.

Another agent's conversation (a key "<source id>:<session id>", steward_table.py) gets its state from Agent Plus's
attention files (agent_states.py) and its plan from the path the table recorded for it. It has no background work
here. Such a conversation takes only plain messages, and none while it waits for the user to approve a tool or answer
a question in its window; the last line of the list tells the steward this.

If nothing in the list changed since the steward's previous turn, it gets one sentence saying so: the list is already
in its context, and a steward wakes many times with nothing new. After each compaction the whole list is sent again
(COMPACTED_SUFFIX, written by resume-work-plan.py).
"""

import hashlib
import json
import os
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from plan_common import (  # noqa: E402
    COMPACTED_SUFFIX, SESSION_NAME, children, data_dir, launcher, listed, read_payload, side_file, write_quietly,
)
from proc_alive import alive  # noqa: E402
import agent_states  # noqa: E402
import steward_table  # noqa: E402

SEEN_SUFFIX = ".steward-seen"
MAX_LISTED = 30
MAX_DOING = 2
TITLE_CHARS = 80
STATE_WORDS = {"busy": "working", "shell": "running a command", "waiting": "waiting for the user", "idle": "idle"}
STOPPED = "not running"
RELAY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "steward-relay.py")
WORKING_FILE = "working.json"
OTHERS_HINT = ("The conversations of other agents above take only plain messages: no --rename, --close or --resume. While "
               "one waits for the user to approve a tool or to answer a question in its window, no message reaches it; "
               "only the user can answer it there, so ask the user to.")


def claude_dir():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")


def states():
    """session id -> state word, from the records of running claude processes."""
    out = {}
    folder = os.path.join(claude_dir(), "sessions")
    try:
        names = [n for n in os.listdir(folder) if n.endswith(".json") and n[:-5].isdigit()]
    except OSError:
        return out
    for name in names:
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        sid = str(rec.get("sessionId") or "").lower() if isinstance(rec, dict) else ""
        pid = rec.get("pid") if isinstance(rec, dict) else None
        if not SESSION_NAME.match(sid) or not isinstance(pid, int) or not alive(pid):
            continue
        word = STATE_WORDS.get(rec.get("status"), "running")
        # A conversation held by two processes reads as the busier of them.
        if out.get(sid) in (None, "idle"):
            out[sid] = word
    return out


def background(directory):
    """Session ids with background work running, from the set a Claude Code Plus window wrote; empty when no running
    window wrote one."""
    try:
        with open(os.path.join(directory, WORKING_FILE), encoding="utf-8") as fh:
            d = json.load(fh)
    except (OSError, ValueError):
        return set()
    if not isinstance(d, dict) or not isinstance(d.get("pid"), int) or not alive(d["pid"]):
        return set()
    return {s.lower() for s in listed(d.get("sessions")) if isinstance(s, str) and SESSION_NAME.match(s)}


def plan_summary(path):
    """(titles of rows in progress, questions waiting on the user) from the plan at `path`."""
    try:
        with open(path, encoding="utf-8") as fh:
            plan = json.load(fh)
    except (OSError, ValueError):
        return [], 0
    doing, questions = [], [0]

    def walk(nodes):
        for n in listed(nodes):
            if not isinstance(n, dict):
                continue
            if n.get("state") == "doing" and len(doing) < MAX_DOING:
                doing.append(str(n.get("title") or "")[:TITLE_CHARS])
            if n.get("waitingOn") == "user" and n.get("state") in ("waiting", "discussing"):
                questions[0] += 1
            walk(children(n))

    walk(plan.get("nodes") if isinstance(plan, dict) else None)
    return doing, questions[0]


def managed_by(directory, sid):
    """(keys, names, plan paths) of what this conversation manages."""
    entry = steward_table.read(directory).get(sid)
    if not entry:
        return [], {}, {}
    return entry["manages"][:MAX_LISTED], entry["names"], entry["paths"]


def stewards_of(directory, sid):
    """A one-item list with the steward that has this conversation on its list, or [] when none has."""
    return [s for s, e in steward_table.read(directory).items() if sid in e["manages"]]


def watched():
    """The line a managed conversation gets each turn. It names no steward: the window that delivers a handoff finds
    this conversation's steward."""
    handoff = " ".join([shlex.quote(w) for w in launcher()] + [shlex.quote(RELAY), "--handoff"])
    return ("A steward conversation watches this one for the user through Claude Code Plus: it reads your work plan and "
            "latest reply, and speaks for the user by typing messages here, which come as the user's own. Do not send it "
            "status messages; put questions for the user in your plan as rows waiting on the user, where it sees them. "
            "If a message plainly belongs elsewhere (meant for another conversation, unrelated to the work here, or "
            "better done by another one), do not start background work for it here: run %s with a here-document "
            "holding the user's words, where it should go (a session id, or a folder for a new conversation) and why, "
            "and say in one sentence what it answered."
            % handoff)


def lines_of(ids, names, now, directory, paths=None):
    lines = []
    running = background(directory)
    paths = paths or {}
    for m in ids:
        name = str(names.get(m) or m)[:TITLE_CHARS]
        other = steward_table.is_other(m)
        plan = paths.get(m) if other else os.path.join(directory, m + ".json")
        doing, questions = plan_summary(plan) if plan else ([], 0)
        parts = [now.get(m, STOPPED)]
        if other and not plan:
            parts.append("where its plan is was not recorded")
        if m in running:
            parts.append("background work running")
        if doing:
            parts.append("doing: " + " / ".join(doing))
        if questions:
            parts.append("%d question%s for the user" % (questions, "" if questions == 1 else "s"))
        where = "%s, %s" % (m, steward_table.label_of(m)) if other else m
        lines.append('- "%s" (%s): %s' % (name, where, "; ".join(parts)))
    return lines


def lead(ids):
    others = [steward_table.label_of(m) for m in ids if steward_table.is_other(m)]
    if not others:
        return ("You are the steward of %d Claude Code conversation%s the user picked for you in the Steward panel; "
                "follow the steward skill." % (len(ids), "" if len(ids) == 1 else "s"))
    counts = ["%d Claude Code" % (len(ids) - len(others))] if len(ids) > len(others) else []
    counts += ["%d %s" % (others.count(label), label) for label in sorted(set(others))]
    return ("You are the steward of %d conversation%s the user picked for you in the Steward panel (%s); "
            "follow the steward skill." % (len(ids), "" if len(ids) == 1 else "s", ", ".join(counts)))


def block(ids, names, now, seen, lines):
    changed = ['"%s": %s -> %s' % (str(names.get(m) or m)[:TITLE_CHARS], seen[m], now.get(m, STOPPED))
               for m in ids if m in seen and seen[m] != now.get(m, STOPPED)]
    text = lead(ids) + " Where they stand now:\n" + "\n".join(lines)
    if any(steward_table.is_other(m) for m in ids):
        text += "\n" + OTHERS_HINT
    if changed:
        text += "\nChanged since your previous turn: " + "; ".join(changed) + "."
    return text


def main():
    try:
        payload = read_payload()
    except Exception:
        return 0
    sid = str(payload.get("session_id") or "").lower()
    if not SESSION_NAME.match(sid):
        return 0
    directory = data_dir()
    ids, names, paths = managed_by(directory, sid)
    over = stewards_of(directory, sid)
    if not ids:
        if over:
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": payload.get("hook_event_name", "UserPromptSubmit"), "additionalContext": watched()}}))
        return 0
    now = states()
    if any(steward_table.is_other(m) for m in ids):
        found = agent_states.read()
        for m in ids:
            if steward_table.is_other(m):
                now[m] = agent_states.words(found.get(m))
    seen_path = side_file(os.path.join(directory, sid + ".json"), SEEN_SUFFIX)
    try:
        with open(seen_path, encoding="utf-8") as fh:
            last = json.load(fh)
        last = last if isinstance(last, dict) else {}
    except (OSError, ValueError):
        last = {}
    # Older builds stored the states map on its own.
    seen = last.get("states") if isinstance(last.get("states"), dict) else ({} if "digest" in last else last)
    try:
        with open(side_file(os.path.join(directory, sid + ".json"), COMPACTED_SUFFIX), encoding="utf-8") as fh:
            compacted = fh.read().strip()
    except OSError:
        compacted = ""
    lines = lines_of(ids, names, now, directory, paths)
    digest = hashlib.sha1("\n".join(lines).encode("utf-8")).hexdigest()
    if last.get("digest") == digest and last.get("compacted", "") == compacted:
        text = lead(ids) + " Nothing has changed since the list you were given at your previous turn."
    else:
        text = block(ids, names, now, seen, lines)
    if over:
        text += "\n" + watched()
    write_quietly(seen_path, json.dumps({"states": {m: now.get(m, STOPPED) for m in ids}, "digest": digest, "compacted": compacted}))
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": payload.get("hook_event_name", "UserPromptSubmit"), "additionalContext": text}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
