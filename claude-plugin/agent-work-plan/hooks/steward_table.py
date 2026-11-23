# BSD 3-Clause License
# Copyright (c) 2026, Xnerv Wang
# All rights reserved.

"""The stewards table as the hooks read it: stewards.json in this plugin's data directory, taken through the same rules
as the extension takes it (settle in src/stewards.js), so that a table an older build wrote reads the same here.

One conversation has one steward at most, and a steward has none; only one steward has "all" on. An entry's "ticked" is
the part of its list ticked by hand rather than added by "all"; it is written only for the steward with "all" on.
"""
import json
import os

from plan_path import SESSION_NAME, listed

STEWARDS_FILE = "stewards.json"
MAX_MANAGED = 100
MAX_NAME = 200


def _ids(value, not_):
    out = []
    for x in listed(value):
        if isinstance(x, str) and SESSION_NAME.match(x):
            x = x.lower()
            if x != not_ and x not in out:
                out.append(x)
    return out[:MAX_MANAGED]


def entries_of(data):
    """The entries of a parsed file, each {manages, ticked, names, at, all}, with ticked None when it is not written."""
    found = data.get("stewards") if isinstance(data, dict) else None
    out = {}
    for key, v in (found.items() if isinstance(found, dict) else []):
        if not isinstance(key, str) or not SESSION_NAME.match(key) or not isinstance(v, dict):
            continue
        sid = key.lower()
        manages = _ids(v.get("manages"), sid)
        given = v.get("names") if isinstance(v.get("names"), dict) else {}
        names = {m: given[m][:MAX_NAME] for m in manages if isinstance(given.get(m), str)}
        at = v.get("at")
        out[sid] = {"manages": manages, "ticked": _ids(v.get("ticked"), sid) if isinstance(v.get("ticked"), list) else None,
                    "names": names, "at": at if isinstance(at, (int, float)) and not isinstance(at, bool) and at == at
                    and abs(at) != float("inf") else 0, "all": v.get("all") is True}
    return out


def settle(entries):
    """The table as the rules have it: "all" stays only with the entry that changed last; then, oldest entry first, each
    keeps what it manages but conversations that are stewards by then and ones another steward has, unless it ticked
    them itself, which takes them from the earlier one; an entry left with something leaves every list it is on."""
    order = sorted(entries, key=lambda s: (entries[s]["at"], s))
    every = ([s for s in order if entries[s]["all"]] or [""])[-1]
    out, holder = {}, {}

    def drop(h, c):
        t = out[h]
        t["manages"] = [x for x in t["manages"] if x != c]
        t["ticked"] = [x for x in t["ticked"] if x != c]
        t["names"].pop(c, None)
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
                    "names": {c: e["names"][c] for c in kept if c in e["names"]}, "at": e["at"], "all": all_}
        for c in kept:
            holder[c] = sid
    return out


def read(directory):
    """steward id -> {manages, ticked, names, at, all}, settled; {} when there is no readable file."""
    try:
        with open(os.path.join(directory, STEWARDS_FILE), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    return settle(entries_of(data))


def manages(table, steward, sid):
    """Whether `steward` manages `sid`: on its list, or through "all" when it is no steward and no one else has it."""
    t = table.get(steward)
    if not t:
        return False
    if sid in t["manages"]:
        return True
    return t["all"] and sid != steward and sid not in table and not any(sid in v["manages"] for v in table.values())
