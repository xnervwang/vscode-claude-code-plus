# BSD 3-Clause License
# Copyright (c) 2026, Xnerv Wang
# All rights reserved.

"""The stewards table: stewards.json in this plugin's data directory, read with the same rules the extension uses
(settle in src/stewards.js), so that a table written by an older build reads the same here.

A conversation has at most one steward, and a steward has no steward of its own; only one steward has "all" on. An
entry's "ticked" is the part of its list ticked by hand rather than added by "all"; it is written only for the steward
with "all" on.

A managed conversation is a key: a Claude Code session id in lower case, or "<source id>:<session id>" for another
agent's conversation, its session id in its own case (src/steward-keys.js, the same pattern). "paths" gives the plan
file of each other agent's conversation, as the panel recorded it when the conversation was ticked; these hooks cannot
ask Agent Plus where it is. A key holds a colon, so no file is ever named after one.
"""
import json
import os
import re

from plan_path import SESSION_NAME, listed

STEWARDS_FILE = "stewards.json"
MAX_MANAGED = 100
MAX_NAME = 200
CLAUDE = "claude-code"
KEY = re.compile(r"^([a-z0-9][a-z0-9-]{0,63}):([A-Za-z0-9][A-Za-z0-9_-]{0,199})$")
OTHER_SOURCES = ("opencode-plus",)
LABELS = {"opencode-plus": "OpenCode Agent Plus"}


def parse(key):
    """(source id, session id) of a key, or None."""
    if not isinstance(key, str):
        return None
    if SESSION_NAME.match(key):
        return CLAUDE, key.lower()
    m = KEY.match(key)
    return (m.group(1), m.group(2)) if m else None


def is_other(key):
    p = parse(key)
    return bool(p) and p[0] != CLAUDE


def allowed(key):
    p = parse(key)
    return bool(p) and p[0] in OTHER_SOURCES


def managed_id(x):
    """The key the table keeps for `x`, or "" when `x` is neither a session id nor a well-formed key."""
    p = parse(x)
    if not p:
        return ""
    if p[0] == CLAUDE:
        return p[1].lower() if SESSION_NAME.match(p[1]) else ""
    return x


def label_of(key):
    p = parse(key)
    return LABELS.get(p[0], p[0]) if p else ""


def plan_file_ok(key, path):
    p = parse(key)
    return bool(p) and p[0] != CLAUDE and isinstance(path, str) and os.path.isabs(path) \
        and os.path.basename(path) == p[1] + ".json"


def _ids(value, not_):
    out = []
    for x in listed(value):
        x = managed_id(x)
        if x and x != not_ and x not in out:
            out.append(x)
    return out[:MAX_MANAGED]


def entries_of(data):
    """The entries of a parsed file, with `ticked` None when it is not written."""
    found = data.get("stewards") if isinstance(data, dict) else None
    out = {}
    for key, v in (found.items() if isinstance(found, dict) else []):
        if not isinstance(key, str) or not SESSION_NAME.match(key) or not isinstance(v, dict):
            continue
        sid = key.lower()
        manages = _ids(v.get("manages"), sid)
        given = v.get("names") if isinstance(v.get("names"), dict) else {}
        names = {m: given[m][:MAX_NAME] for m in manages if isinstance(given.get(m), str)}
        files = v.get("paths") if isinstance(v.get("paths"), dict) else {}
        paths = {m: files[m] for m in manages if plan_file_ok(m, files.get(m))}
        at = v.get("at")
        out[sid] = {"manages": manages, "ticked": _ids(v.get("ticked"), sid) if isinstance(v.get("ticked"), list) else None,
                    "names": names, "paths": paths, "at": at if isinstance(at, (int, float)) and not isinstance(at, bool) and at == at
                    and abs(at) != float("inf") else 0, "all": v.get("all") is True}
    return out


def settle(entries):
    """The table after the rules are applied. "all" stays only with the entry that changed last. Then each entry, oldest
    first, keeps what it manages except conversations that are stewards by then and ones another steward has; one it
    ticked itself it keeps, and the other steward loses it. An entry that keeps anything, or has "all", is a steward,
    so it is taken off the list it was on."""
    order = sorted(entries, key=lambda s: (entries[s]["at"], s))
    every = ([s for s in order if entries[s]["all"]] or [""])[-1]
    out, holder = {}, {}

    def drop(h, c):
        t = out[h]
        t["manages"] = [x for x in t["manages"] if x != c]
        t["ticked"] = [x for x in t["ticked"] if x != c]
        t["names"].pop(c, None)
        t["paths"].pop(c, None)
        holder.pop(c, None)
        if not t["manages"] and not t["all"]:
            del out[h]

    for sid in order:
        e, all_ = entries[sid], sid == every
        mine = set((e["ticked"] or []) if all_ else e["manages"])
        kept = []
        for c in e["manages"]:
            if c == sid or c in out or c in kept:
                continue
            h = holder.get(c)
            if h:
                if c not in mine:
                    continue
                drop(h, c)
            kept.append(c)
        if not kept and not all_:
            continue
        if sid in holder:
            drop(holder[sid], sid)
        out[sid] = {"manages": kept, "ticked": [c for c in kept if c in mine],
                    "names": {c: e["names"][c] for c in kept if c in e["names"]},
                    "paths": {c: e["paths"][c] for c in kept if c in e.get("paths", {})}, "at": e["at"], "all": all_}
        for c in kept:
            holder[c] = sid
    return out


def read(directory):
    """steward id -> {manages, ticked, names, paths, at, all}, settled; {} when there is no readable file."""
    try:
        with open(os.path.join(directory, STEWARDS_FILE), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return settle(entries_of(data))


def manages(table, steward, sid):
    """Whether `steward` manages `sid`: `sid` is on its list, or `steward` has "all" on, `sid` is not a steward, and no
    other steward has it."""
    t = table.get(steward)
    if not t:
        return False
    if sid in t["manages"]:
        return True
    return t["all"] and sid != steward and sid not in table and not any(sid in v["manages"] for v in table.values())
