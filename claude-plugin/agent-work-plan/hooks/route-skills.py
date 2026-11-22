#!/usr/bin/env python3
# BSD 3-Clause License
# Copyright (c) 2026, Xnerv Wang
# All rights reserved.

"""UserPromptSubmit and Stop hook of the skill search (skill_route.py, shared with Codex Plus through Agent Plus).

On UserPromptSubmit it searches the skills Claude Code can call in this conversation for the message and puts the best
few in front of the model, each by the name the Skill tool takes and with its full description. A message under six
characters gets nothing, the whole run is held to 1.5 seconds, and anything that goes wrong leaves the turn alone.

On Stop it logs which skills the turn's Skill tool calls named, so the log shows whether the model used what it was
given.
"""
import time

T0 = time.time()  # the budget counts from here, so that loading the modules below is inside it

import os  # noqa: E402
import sys  # noqa: E402

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import skill_route  # noqa: E402

if __name__ == "__main__":
    sys.exit(skill_route.run_hook(T0))
