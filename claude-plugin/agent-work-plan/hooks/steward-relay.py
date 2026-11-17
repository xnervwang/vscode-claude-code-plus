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
    python3 steward-relay.py --windows [<plugin data directory>]

Run from the steward conversation: its session id comes from CLAUDE_CODE_SESSION_ID. Claude Code Plus types the
message into that conversation's input in the VS Code window that has it open and sends it, so it arrives as the
user's own message, approvals included. The window first looks for this command in the steward's transcript, so give
the message in a here-document as above.

--rename gives the conversation a new title. --close closes its editor tab; the conversation is not deleted and can
be opened again from the session list. A conversation that is working, waiting for an answer or running background
work is closed only with --confirmed. --open starts a new conversation in the VS Code window that has <folder> open
and sends it the message, then prints the new conversation's session id; if no window has the folder open, it says so.
--windows prints the open windows and their folders.

Prints what happened and exits 0 when it was done, 1 otherwise.
"""

import json
import os
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from plan_path import SESSION_NAME, write_atomic  # noqa: E402
import plan_agent as A  # noqa: E402

RELAY_DIR = "relay"
# Claude Code Plus stops taking a request after 60 seconds; the answer panel waits up to 15 seconds for a send.
WAIT_SECONDS = 40
OPEN_WAIT_SECONDS = 50
SAID = {
    "submitted": "Sent: it was typed into the conversation's message input and sent as the user's message.",
    "notReceived": "Not sent",
    "uncertain": "Unclear whether it was sent",
    "refused": "Not sent",
}


WINDOWS_DIR = "windows"
# Claude Code Plus rewrites a window's entry once a minute while the window is open.
WINDOW_STALE_SECONDS = 120
FLAGS = ("--rename", "--close", "--open")
DONE = {
    "--rename": "Renamed.",
    "--close": "Closed: the conversation's tab was closed; it is not deleted and can be opened again from the session list.",
    "--open": "Opened: a new conversation was started and its first message sent.",
}


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (OSError, ValueError, TypeError):
        return False


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


def main(argv):
    args = argv[1:]
    action = next((a for a in args if a in FLAGS), "")
    confirmed = "--confirmed" in args
    listing = "--windows" in args
    rest = [a for a in args if a not in FLAGS + ("--confirmed", "--windows")]
    if listing:
        directory = rest[0] if rest else A.FALLBACK
        found = windows(directory)
        for w in found:
            print("%s: %s" % (w.get("name") or "(untitled)", ", ".join(w.get("folders") or []) or "(no folder)"))
        if not found:
            print("No open VS Code window with Claude Code Plus was found.")
        return 0
    target = rest[0] if rest else ""
    opening = action == "--open"
    if (opening and not os.path.isabs(target)) or (not opening and not SESSION_NAME.match(target)) \
            or (confirmed and action != "--close"):
        print("usage: steward-relay.py [--rename | --close [--confirmed] | --open] <session id or folder>"
              " [<plugin data directory>] < text")
        return 2
    steward = os.environ.get("CLAUDE_CODE_SESSION_ID", "")
    if not SESSION_NAME.match(steward):
        print("Not done: CLAUDE_CODE_SESSION_ID is not set, so this was not run from the steward conversation.")
        return 1
    text = ""
    if action != "--close":
        # Read as bytes: on Windows the console code page would otherwise decode the message, and fail on Chinese.
        raw = sys.stdin.buffer.read()
        try:
            text = raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            text = raw.decode("utf-8", "replace").strip()
        if not text:
            print("Not done: nothing on standard input.")
            return 1
    directory = os.path.join(rest[1] if len(rest) > 1 else A.FALLBACK, RELAY_DIR)
    os.makedirs(directory, exist_ok=True)
    rid = str(uuid.uuid4())
    request = {"id": rid, "steward": steward.lower(), "action": action[2:] if action else "send",
               "to": target if opening else target.lower(), "text": text, "at": int(time.time() * 1000)}
    if confirmed:
        request["confirmed"] = True
    request_file = os.path.join(directory, rid + ".json")
    result = os.path.join(directory, rid + ".result.json")
    write_atomic(request_file, json.dumps(request, ensure_ascii=False))
    # An open also waits for the new tab to send its first message.
    deadline = time.time() + (OPEN_WAIT_SECONDS if opening else WAIT_SECONDS)
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
            if outcome == "submitted":
                print(DONE.get(action, SAID["submitted"]))
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
        else:
            print("Not done: no VS Code window that shows that conversation took the request. Is it open in a window?")
    except OSError:
        print("Unclear whether it was done: a window took the request but gave no answer in time.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
