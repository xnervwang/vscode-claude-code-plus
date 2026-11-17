#!/usr/bin/env python3
# BSD 3-Clause License
# Copyright (c) 2026, Xnerv Wang
# All rights reserved.

"""Record the background work a conversation has in flight when a turn or a subagent ends.

From 2.1.326 the Stop and SubagentStop hooks get background_tasks, the work registered in the session that is running or
waiting to run (background commands, subagents, monitors, workflows), and session_crons, the timers that will wake it.
This keeps both in <session id>.tasks beside the plan, with the time and the claude process's pid, and removes the file
when both are empty. Claude Code Plus counts the work in it while that process runs (src/background.js). The file does
not go stale while the process runs: work that ends wakes the conversation, and the turn that follows ends with another
Stop.

A build that does not send the fields leaves no file. Nothing is printed and the exit status is always 0, so the hook
adds nothing to the conversation and never keeps a turn from ending.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from plan_common import data_dir, plan_file, read_payload, side_file, write_quietly  # noqa: E402

TASKS_SUFFIX = ".tasks"
MAX_ITEMS = 50
MAX_TEXT = 200
TASK_KEYS = ("id", "type", "status", "description", "agent_type", "name", "server", "tool")
CRON_KEYS = ("id", "schedule", "prompt")


def clip(value):
    return value[:MAX_TEXT] if isinstance(value, str) else ""


def entries(items, keys):
    out = []
    for item in items[:MAX_ITEMS] if isinstance(items, list) else []:
        if isinstance(item, dict):
            entry = {k: clip(item.get(k)) for k in keys if isinstance(item.get(k), str)}
            if "recurring" in item:
                entry["recurring"] = item.get("recurring") is True
            out.append(entry)
    return out


def main():
    payload = read_payload()
    plan = plan_file(payload, data_dir()) if isinstance(payload, dict) else None
    if not plan:
        return
    path = side_file(plan, TASKS_SUFFIX)
    tasks = entries(payload.get("background_tasks"), TASK_KEYS)
    crons = entries(payload.get("session_crons"), CRON_KEYS)
    if not tasks and not crons:
        try:
            os.remove(path)
        except OSError:
            pass
        return
    pid = os.environ.get("CLAUDE_PID", "")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    write_quietly(path, json.dumps({
        "at": int(time.time() * 1000),
        "pid": int(pid) if pid.isdigit() else None,
        "event": clip(payload.get("hook_event_name")),
        "tasks": tasks,
        "crons": crons,
    }, ensure_ascii=False) + "\n")


try:
    main()
except Exception:
    pass
sys.exit(0)
