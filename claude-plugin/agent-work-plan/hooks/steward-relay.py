#!/usr/bin/env python3
# BSD 3-Clause License
# Copyright (c) 2026, Xnerv Wang
# All rights reserved.

"""A steward's requests for the conversations it manages.

    python3 steward-relay.py <session id> [<plugin data directory>] <<'EOF'
    <the message, worded for that conversation>
    EOF
    python3 steward-relay.py --rename <session id> [<plugin data directory>] <<'EOF'
    <the new title>
    EOF
    python3 steward-relay.py --close [--confirmed] <session id> [<plugin data directory>]
    python3 steward-relay.py --open <folder> [<plugin data directory>] <<'EOF'
    <the new conversation's first message>
    EOF
    python3 steward-relay.py --resume <session id> [<plugin data directory>] [<<'EOF'
    <a message for it, sent once it is open>
    EOF]
    python3 steward-relay.py --windows [<plugin data directory>]
    python3 steward-relay.py --handoff [<plugin data directory>] <<'EOF'
    <the user's words, where they should go, and why>
    EOF

Run from the steward conversation: its session id comes from CLAUDE_CODE_SESSION_ID. Claude Code Plus types the
message into that conversation's input in the VS Code window that has it open and sends it, so it arrives as the
user's own message, approvals included. The window first looks for this command in the steward's transcript, so give
the message in a here-document as above.

--rename gives the conversation a new title. --close closes its editor tab; the conversation is not deleted and can
be opened again from the session list. A conversation that is working, waiting for an answer or running background
work is closed only with --confirmed. --open starts a new conversation in the VS Code window that has <folder> open
and sends it the message, then prints the new conversation's session id; if no window has the folder open, it says so.
--windows prints the open windows and their folders.

--resume opens a conversation that no window shows, in an editor tab of a VS Code window one of whose folders holds the
folder the conversation was started in, and then sends it the message, if one is given. It is not done while a window
shows the conversation or another process runs it; it says which. A conversation opened with --open or --resume is
then ticked for this steward in the Steward panel, unless it manages all conversations.

--handoff is run from a conversation a steward manages, not from the steward: it gives a steward something the
conversation thinks belongs elsewhere, as a notice that is not the user's message. Of the stewards that manage the
conversation, it goes to the one the user last typed to, or, if that one cannot be reached, the next; the answer names
the steward it reached.

Prints what happened and exits 0 when it was done, 1 otherwise.
"""

import glob
import json
import os
import re
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from plan_path import SESSION_NAME, listed, write_atomic  # noqa: E402
import plan_agent as A  # noqa: E402
from proc_alive import alive  # noqa: E402

RELAY_DIR = "relay"
# Claude Code Plus stops taking a request after 60 seconds; the answer panel waits up to 15 seconds for a send.
WAIT_SECONDS = 40
OPEN_WAIT_SECONDS = 50
# A resume waits for the panel to show the conversation (30 seconds) and then to take the message (20 seconds more).
RESUME_WAIT_SECONDS = 110
SAID = {
    "submitted": "Sent: it was typed into the conversation's message input and sent as the user's message.",
    "notReceived": "Not sent",
    "uncertain": "Unclear whether it was sent",
    "refused": "Not sent",
}


WINDOWS_DIR = "windows"
# Claude Code Plus rewrites a window's entry once a minute while the window is open.
WINDOW_STALE_SECONDS = 120
FLAGS = ("--rename", "--close", "--open", "--resume", "--handoff")
TICKED = " It is now ticked for you in the Steward panel."
DONE = {
    "--rename": "Renamed.",
    "--close": "Closed: the conversation's tab was closed; it is not deleted and can be opened again from the session list.",
    "--open": "Opened: a new conversation was started and its first message sent.",
}
HANDED = ("Handed off to the steward %s: it was told, in a notice that is not the user's message. Say so in one sentence in "
          "your reply and leave it to the steward.")
NOT_HANDED = " Say in your reply where it seems to belong, so the user decides."
STEWARDS_FILE = "stewards.json"
HEAD_BYTES = 64 * 1024
CWD = re.compile(r'"cwd":"((?:[^"\\]|\\.)*)"')


def windows(directory):
    """The open windows' entries, as Claude Code Plus writes them: name, folders and the conversations shown."""
    out = []
    folder = os.path.join(directory, WINDOWS_DIR)
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return out
    now = time.time() * 1000
    for name in names:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                w = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(w, dict) or not now - w.get("at", 0) < WINDOW_STALE_SECONDS * 1000 or not alive(w.get("pid")):
            continue
        out.append(w)
    return out


def window_lines(found):
    """The open windows and their folders, one line each, as --windows prints them."""
    return ["%s: %s" % (w.get("name") or "(untitled)", ", ".join(w.get("folders") or []) or "(no folder)") for w in found] \
        or ["No open VS Code window with Claude Code Plus was found."]


def claude_dir():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")


def transcript(sid):
    hits = glob.glob(os.path.join(claude_dir(), "projects", "*", sid + ".jsonl"))
    return max(hits, key=os.path.getmtime) if hits else ""


def started_in(path):
    """The folder a transcript was started in, from the cwd its first records carry, or ''."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(HEAD_BYTES).decode("utf-8", "replace")
    except OSError:
        return ""
    m = CWD.search(head)
    if not m:
        return ""
    try:
        return json.loads('"%s"' % m.group(1))
    except ValueError:
        return ""


def real(path):
    p = os.path.realpath(path)
    return os.path.normcase(p) if sys.platform == "win32" else (p.lower() if sys.platform == "darwin" else p)


def holds(root, path):
    """Whether folder `root` is `path` or one of its parents, symbolic links resolved."""
    try:
        rel = os.path.relpath(real(path), real(root)) if root and path else ".."
    except ValueError:  # on Windows, paths on two drives
        return False
    return rel == "." or not (rel == ".." or rel.startswith(".." + os.sep) or os.path.isabs(rel))


def shows(w, sid):
    return sid in [str(s).lower() for s in listed(w.get("sessions"))]


def stewards_table(directory):
    try:
        with open(os.path.join(directory, STEWARDS_FILE), encoding="utf-8") as fh:
            table = json.load(fh)
    except (OSError, ValueError):
        return {}
    found = table.get("stewards") if isinstance(table, dict) else None
    return {k.lower(): v for k, v in found.items() if isinstance(v, dict)} if isinstance(found, dict) else {}


def manages(table, steward, sid):
    """Whether `steward` manages `sid`, as the windows decide it (src/relay.js)."""
    t = table.get(steward)
    if not t:
        return False
    ids = [str(m).lower() for m in listed(t.get("manages"))]
    return sid in ids or (t.get("all") is True and sid != steward and sid not in table)


def resume_check(data, sid):
    """Why the conversation cannot be opened, as lines to print, or [] and the folder it was started in."""
    found = windows(data)
    showing = [w for w in found if shows(w, sid)]
    if showing:
        managed = manages(stewards_table(data), os.environ.get("CLAUDE_CODE_SESSION_ID", "").lower(), sid)
        return ['Not done: it is already open in the VS Code window "%s"; a plain send reaches it there%s.'
                % (showing[0].get("name") or "(untitled)",
                   "" if managed else " once the user ticks it for this steward in the Steward panel")], ""
    path = transcript(sid)
    if not path:
        return ["Not done: no conversation with that session id was found under %s." % os.path.join(claude_dir(), "projects")], ""
    cwd = started_in(path)
    if not cwd:
        return ["Not done: its transcript does not say which folder it was started in."], ""
    if not any(holds(f, cwd) for w in found for f in listed(w.get("folders"))):
        return (["Not done: no open VS Code window has its folder, %s, or a folder above it, open; it was not opened in "
                 "a window for another folder. The open windows:" % cwd] + ["  " + line for line in window_lines(found)]), cwd
    return [], cwd


def handoff_check(data, me):
    """Why no steward can be given a handoff from conversation `me`, as a line to print, or ''."""
    table = stewards_table(data)
    theirs = [s for s in table if manages(table, s, me)]
    if not theirs:
        return "Not done: no steward manages this conversation, so it cannot be handed off." + NOT_HANDED
    if not any(shows(w, s) for w in windows(data) for s in theirs):
        return "Not done: no steward of this conversation is open in a VS Code window, so none can be told." + NOT_HANDED
    return ""


def resume_said(r, name, text):
    """What a resume's answer says, and whether it was all done."""
    outcome, reason = r.get("outcome", ""), r.get("reason") or r.get("outcome", "")
    where = 'the VS Code window "%s"' % name if name else "a VS Code window"
    ticked = TICKED if r.get("ticked") is True else ""
    if outcome == "submitted":
        return ("Opened: the conversation was opened in an editor tab in %s%s%s" % (where, (
            ", and the message was typed into its input and sent as the user's message." if text else "."), ticked)), True
    if r.get("opened") is True:
        if outcome == "uncertain":
            return "Opened in an editor tab in %s, but it is unclear whether the message was sent: %s.%s" % (where, reason, ticked), False
        return "Opened in an editor tab in %s, but the message was not sent: %s.%s" % (where, reason, ticked), False
    if outcome == "uncertain":
        return "Unclear whether it was opened: %s" % reason, False
    return "Not done: %s" % reason, False


def main(argv):
    args = argv[1:]
    action = next((a for a in args if a in FLAGS), "")
    confirmed = "--confirmed" in args
    listing = "--windows" in args
    rest = [a for a in args if a not in FLAGS + ("--confirmed", "--windows")]
    if listing:
        for line in window_lines(windows(rest[0] if rest else A.FALLBACK)):
            print(line)
        return 0
    handing = action == "--handoff"
    # A handoff names no conversation: its first argument, if any, is the plugin data directory.
    if handing:
        rest = [""] + rest
    target = rest[0] if rest else ""
    opening = action == "--open"
    if (opening and not os.path.isabs(target)) or (not opening and not handing and not SESSION_NAME.match(target)) \
            or (confirmed and action != "--close") or len([a for a in args if a in FLAGS]) > 1 or len(rest) > 2:
        print("usage: steward-relay.py [--rename | --close [--confirmed] | --open | --resume]"
              " <session id or folder> [<plugin data directory>] < text\n"
              "       steward-relay.py --handoff [<plugin data directory>] < text")
        return 2
    steward = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if not SESSION_NAME.match(steward):
        print("Not done: CLAUDE_CODE_SESSION_ID is not set, so this was not run from a Claude Code conversation."
              if action == "--handoff" else
              "Not done: CLAUDE_CODE_SESSION_ID is not set, so this was not run from the steward conversation.")
        return 1
    resuming = action == "--resume"
    text = ""
    # A resume's message is optional, and a terminal would wait for one.
    if action != "--close" and not (resuming and sys.stdin.isatty()):
        # Read as bytes: on Windows the console code page would otherwise decode the message, and fail on Chinese.
        raw = sys.stdin.buffer.read()
        try:
            text = raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            text = raw.decode("utf-8", "replace").strip()
    if not text and action not in ("--close", "--resume"):
        print("Not done: nothing on standard input.")
        return 1
    data = rest[1] if len(rest) > 1 else A.FALLBACK
    target = target if opening else target.lower()
    cwd = ""
    if resuming:
        said, cwd = resume_check(data, target)
        if said:
            print("\n".join(said))
            return 1
    elif handing:
        said = handoff_check(data, steward.lower())
        if said:
            print(said)
            return 1
    directory = os.path.join(data, RELAY_DIR)
    os.makedirs(directory, exist_ok=True)
    rid = str(uuid.uuid4())
    request = {"id": rid, "action": action[2:] if action else "send", "to": target, "text": text,
               "at": int(time.time() * 1000)}
    request["from" if action == "--handoff" else "steward"] = steward.lower()
    if confirmed:
        request["confirmed"] = True
    request_file = os.path.join(directory, rid + ".json")
    result = os.path.join(directory, rid + ".result.json")
    write_atomic(request_file, json.dumps(request, ensure_ascii=False))
    # An open also waits for the new tab to send its first message, and a resume for the panel to show the conversation.
    deadline = time.time() + (RESUME_WAIT_SECONDS if resuming else OPEN_WAIT_SECONDS if opening else WAIT_SECONDS)
    while time.time() < deadline:
        if os.path.exists(result):
            try:
                with open(result, encoding="utf-8") as fh:
                    r = json.load(fh)
            except (OSError, ValueError):
                time.sleep(0.2)
                continue
            try:
                os.remove(result)
            except OSError:
                pass
            outcome = r.get("outcome", "")
            reason = r.get("reason") or ""
            if resuming:
                name = next((w.get("name") or "(untitled)" for w in windows(data) if w.get("pid") == r.get("window")), "")
                line, done = resume_said(r, name, text)
                print(line)
                return 0 if done else 1
            if handing:
                sid = r.get("steward") or ""
                if outcome == "submitted":
                    print(HANDED % ('"%s" (%s)' % (r.get("stewardTitle"), sid) if r.get("stewardTitle") else sid or "(unknown)"))
                    return 0
                print("Not done: %s.%s" % (reason or outcome, NOT_HANDED))
                return 1
            if outcome == "submitted":
                print(DONE.get(action, SAID["submitted"]) + (TICKED if r.get("ticked") is True else ""))
                if opening:
                    sid = r.get("sessionId") or ""
                    print("Session id: %s" % sid if sid else "Its session id was not known yet; it is in the Steward panel.")
                return 0
            line = SAID.get(outcome, "Not sent") if not action else ("Not done" if outcome != "uncertain" else SAID["uncertain"])
            print("%s: %s" % (line, reason or outcome))
            return 1
        time.sleep(0.25)
    try:
        os.remove(request_file)
        if opening:
            print("Not done: no VS Code window that has that folder open took the request. Run --windows to see the open ones.")
        elif resuming:
            print("Not done: no VS Code window that has its folder, %s, open took the request. The open windows:" % cwd)
            for line in window_lines(windows(data)):
                print("  " + line)
        elif handing:
            print("Not done: no VS Code window that shows a steward of this conversation took the request." + NOT_HANDED)
        else:
            print("Not done: no VS Code window that shows that conversation took the request. If no window has it open, "
                  "--resume opens it.")
    except OSError:
        print("Unclear whether it was done: a window took the request but gave no answer in time.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
