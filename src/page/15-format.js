// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Clock and date formatting.
// Fragment of the in-page script - see README.md in this folder.

  // Month before day, and the year only when it is not the current one (agentPlusKit.stamp): the work plan tree writes
  // dates this way, and a different order here would let 01/10 mean two different days.
  var fmt = function(ms){ return agentPlusKit.stamp(ms); };
