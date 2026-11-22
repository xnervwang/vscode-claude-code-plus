// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The effort each reply was actually sent with, read from the conversation's own transcripts.
 *
 * The panel knows the effort only as the menu's current value, which is not what a past reply used: a setting can pin
 * it, a model can quietly lower it, and the menu changes the moment it is clicked. The transcript records the effort of
 * each request in the reply's own row, and the stream the panel reads does not carry it at all, so this side reads it
 * and hands it over. The model needs none of this - every reply the panel holds carries the model that served it.
 *
 * What is handed over is where the effort changed rather than the effort of every reply: the uuid that starts each run,
 * and the uuid of the last reply read. A long conversation holds tens of thousands of replies and a few dozen changes,
 * and the page walks its replies in order anyway, so a run start is all it needs. A reply after the last one read is
 * one this side has not seen yet, and the page leaves it blank rather than carrying the previous run forward over it.
 *
 * The transcripts are read incrementally (src/claude-files.js), with the offsets saved beside the plan so that a
 * restart resumes. A reply row is classified from the end of its line, where the top-level type, uuid and effort follow
 * the message; any other line that mentions a reply is parsed in full, so a reply quoted inside another row is not
 * mistaken for one.
 *
 * The same pass reads which skills the skill search (route-skills.py in the work plan plugin) gave each turn. Claude
 * Code records the hook's text as an attachment row after the row of the message it came with and before the turn's
 * first reply, and that row carries nothing that names the message. So a block's names wait for the next reply of the
 * conversation's own and are kept against that reply's uuid; a message the user sends before any reply came drops
 * them, as it starts a turn of its own.
 */
const fs = require('fs');
const path = require('path');
const { planDir, SESSION, transcriptOf, readLines, oneAtATime, writeAtomic } = require('./claude-files');

const SUFFIX = '.effort';
const STATE_FILE = /^[0-9a-f][0-9a-f-]{7,}\.effort$/i;
const REPLY = '"type":"assistant"';
const TAIL = '"type":"assistant","uuid":"';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD = /^[a-z]+$/;
/* The conversation's own transcript, keyed apart from the sub-agents' file names; the empty name sorts first. */
const MAIN = '';

/*
 * The skill search's block: its first words (MARK in skill_route.py), and the line under them that, when some of the
 * turn's skills were given in full earlier in the conversation, names every skill of the turn in order of fit
 * (ORDER_LINE, GIVEN_EARLIER and the start of ORDER_END there). Without that line, each skill is a line of its own.
 */
const ROUTE_MARK = 'Skills that may fit this message';
const ORDER_LINE = 'In order of fit: ';
const GIVEN_EARLIER = ' (given earlier)';
const ORDER_END = '. Those given earlier';
const SKILL_LINE = /^- ([^\s:]+(?::[^\s:]+)?): /;
const SKILL_NAME = /^[^\s:]+(?::[^\s:]+)?$/;
/* The hook gives a turn at most ten skills. */
const SKILLS_PER_TURN = 10;
const NAME_CHARS = 120;
/* Turns with skills kept per conversation, the newest. */
const SKILL_TURNS = 200;

const word = (v) => (typeof v === 'string' && WORD.test(v) ? v : '');

/* The names one text of the hook gives, in its order. An order line cut off before its end loses its last name, which
   may be cut off too. */
function skillNames(text) {
  const at = typeof text === 'string' ? text.indexOf(ROUTE_MARK) : -1;
  if (at < 0) return [];
  const below = text.slice(at).split('\n').slice(1);
  let names = [];
  if (below.length && below[0].startsWith(ORDER_LINE)) {
    const end = below[0].indexOf(ORDER_END);
    const items = below[0].slice(ORDER_LINE.length, end < 0 ? undefined : end).split(', ');
    if (end < 0) items.pop();
    names = items.map((i) => (i.endsWith(GIVEN_EARLIER) ? i.slice(0, -GIVEN_EARLIER.length) : i)).filter((n) => SKILL_NAME.test(n));
  } else {
    for (const l of below) {
      const m = SKILL_LINE.exec(l);
      if (!m) break;
      names.push(m[1]);
    }
  }
  return names.slice(0, SKILLS_PER_TURN).map((n) => n.slice(0, NAME_CHARS));
}

/* The names of the skill search's block in one row, or null for a row that is not one: the hook's added text, recorded
   as an attachment of the conversation's own. */
function blockOf(line) {
  let row;
  try { row = JSON.parse(line); } catch (_) { return null; }
  const att = row && row.type === 'attachment' && row.isSidechain !== true ? row.attachment : null;
  if (!att || att.type !== 'hook_additional_context' || !Array.isArray(att.content)) return null;
  if (att.hookEvent !== undefined && att.hookEvent !== 'UserPromptSubmit') return null;
  for (const text of att.content) {
    const names = skillNames(text);
    if (names.length) return names;
  }
  return null;
}

/* Whether a row is a message the user sent: a user row of the conversation's own with text in it, and not a tool's
   result, a row Claude Code adds unseen, or the summary a compaction leaves. */
function typedRow(line) {
  let row;
  try { row = JSON.parse(line); } catch (_) { return false; }
  if (!row || row.type !== 'user' || row.isSidechain === true || row.isMeta === true || row.isCompactSummary === true) return false;
  const c = row.message && row.message.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.some((p) => p && p.type === 'text') && !c.some((p) => p && p.type === 'tool_result');
}

/* What the end of a reply's row says, from just after the `"uuid":` key to the end of the line. */
function fromTail(tail, head, sidechains) {
  if (!sidechains && head.includes('"isSidechain":true')) return null;
  const id = tail.slice(1, 37);
  if (!UUID.test(id)) return null;
  const per = /,"perTurnEffort":"([a-z]+)"/.exec(tail);
  const plain = /,"effort":"([a-z]+)"/.exec(tail);
  return { uuid: id, effort: (per && per[1]) || (plain && plain[1]) || '' };
}

/* One line, as { uuid, effort } for a reply, or null for anything else. `sidechains` says whether a sub-agent's rows
   belong here: they do in a sub-agent's own transcript, and not in the conversation's, where an older client wrote them
   too and taking one as the conversation's last reply would mark it read past where it was. */
function readLine(line, sidechains) {
  const at = line.lastIndexOf(TAIL);
  if (at !== -1) {
    const tail = line.slice(at + TAIL.length - 1);
    if (!/[{[]/.test(tail)) return fromTail(tail, line.slice(0, 160), sidechains);
  }
  if (!line.includes(REPLY)) return null;
  let row;
  try { row = JSON.parse(line); } catch (_) { return null; }
  if (!row || row.type !== 'assistant' || typeof row.uuid !== 'string' || !UUID.test(row.uuid)) return null;
  if (!sidechains && row.isSidechain === true) return null;
  return { uuid: row.uuid, effort: word(row.perTurnEffort) || word(row.effort) };
}

const REPLY_BYTES = Buffer.from(REPLY, 'utf8');
const TAIL_BYTES = Buffer.from(TAIL, 'utf8');
const MARK_BYTES = Buffer.from(ROUTE_MARK, 'utf8');
const USER_BYTES = Buffer.from('"type":"user"', 'utf8');
const RESULT_BYTES = Buffer.from('"tool_use_id"', 'utf8');
const HOOK_BYTES = Buffer.from('"hook_additional_context"', 'utf8');

/* Where `pat` next occurs in `data` at or after a position, before `end`; Infinity once there is none. Each stretch of
   the data is searched once however often it is asked. */
function cursor(data, pat, end) {
  let at = -1, done = false;
  return (from) => {
    if (done) return Infinity;
    if (at < from) {
      at = data.indexOf(pat, from);
      if (at === -1 || at >= end) { done = true; return Infinity; }
    }
    return at;
  };
}

/* The line between `s` and `e` of a buffer, read as readLine reads it but decoding only its end where it can. */
function readRow(data, s, e, sidechains) {
  const at = data.lastIndexOf(TAIL_BYTES, e - 1);
  if (at >= s) {
    const tail = data.toString('utf8', at + TAIL_BYTES.length - 1, e);
    if (!/[{[]/.test(tail)) return fromTail(tail, data.toString('utf8', s, Math.min(e, s + 160)), sidechains);
  }
  return readLine(data.toString('utf8', s, e), sidechains);
}

/* Keep a turn's skills against its first reply. */
function keepSkills(st, uuid, names) {
  st.skills.push([uuid, names]);
  if (st.skills.length > SKILL_TURNS) st.skills.splice(0, st.skills.length - SKILL_TURNS);
}

/*
 * Advance one transcript from `st.pos`, updating its runs and last reply, and with `skills` the skills of its turns; a
 * file shorter than `st.pos` has been replaced and is read from the start. A transcript read so far without its skills
 * is read again from the start when they are asked for, so turning them on shows the turns before it too.
 */
async function readFile(file, st, sidechains, skills = false) {
  const before = JSON.stringify([st.runs, st.last, st.skills, st.sk]);
  if (skills && st.sk !== true) Object.assign(st, { pos: 0, runs: [], last: '', eff: '', skills: [], pend: null, sk: true });
  if (!skills && st.sk) Object.assign(st, { skills: [], pend: null, sk: false });
  if (skills && !Array.isArray(st.skills)) st.skills = [];
  const reader = {
    pos: st.pos,
    reset: () => Object.assign(st, { runs: [], last: '', eff: '', skills: [], pend: null }),
    /* Only the lines that mention a reply or the skill search's block are decoded at all, and of a reply only the end;
       a user row is looked at only between a block and the reply it waits for. Almost every byte of a transcript is
       content, and turning all of it into strings was most of what a first pass cost. */
    take: (data) => {
      const end = data.length - 1;
      const nextReply = cursor(data, REPLY_BYTES, end), nextMark = cursor(data, MARK_BYTES, end), nextUser = cursor(data, USER_BYTES, end);
      for (let from = 0; ;) {
        const r = nextReply(from), m = skills ? nextMark(from) : Infinity, u = skills && st.pend ? nextUser(from) : Infinity;
        const at = Math.min(r, m, u);
        if (at === Infinity) break;
        const s = data.lastIndexOf(0x0a, at) + 1;
        const e = data.indexOf(0x0a, at);
        from = e + 1;
        if (m < e && data.subarray(s, e).indexOf(HOOK_BYTES) !== -1) {
          const names = blockOf(data.toString('utf8', s, e));
          if (names) { st.pend = names; continue; }
        }
        if (r < e) {
          const row = readRow(data, s, e, sidechains);
          if (row) {
            st.last = row.uuid;
            if (row.effort && row.effort !== st.eff) { st.runs.push([row.uuid, row.effort]); st.eff = row.effort; }
            if (st.pend) { keepSkills(st, row.uuid, st.pend); st.pend = null; }
            continue;
          }
        }
        if (u < e && st.pend && data.subarray(s, e).indexOf(RESULT_BYTES) === -1 && typedRow(data.toString('utf8', s, e))) st.pend = null;
      }
    },
  };
  if (!(await readLines(file, reader))) return false;
  st.pos = reader.pos;
  return JSON.stringify([st.runs, st.last, st.skills, st.sk]) !== before;
}

function readState(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return d && typeof d.files === 'object' && d.files ? d : { files: {} };
  } catch (_) {
    return { files: {} };
  }
}

function writeState(file, state) {
  writeAtomic(file, JSON.stringify(state) + '\n');
}

const hex = (uuid) => uuid.replace(/-/g, '');

/**
 * The rule the page reads: one section per transcript, the conversation's first and then its sub-agents' by name, each
 * its run starts and then its last reply - `<uuid>=<effort>,...!<uuid>`. Built only from the files, in a fixed order, so
 * every window writes the same bytes for the same conversation. It is scoped to an element of its own rather than the
 * root: a custom property set on the root is inherited by every element, and changing it would restyle the whole page.
 */
function css(state) {
  const names = Object.keys(state.files).sort();
  const sections = [];
  for (const name of names) {
    const f = state.files[name];
    if (!f || !f.last) continue;
    sections.push(f.runs.map(([u, e]) => hex(u) + '=' + e).join(',') + '!' + hex(f.last));
  }
  return '#cce-effort{--cce-effort:"' + sections.join(';') + '"' + skillsProperty(state.files[MAIN]) + '}\n';
}

/* The turns' skills as a second property of the same rule, `<uuid>=<name>,...;...`, each name URI-encoded so that no
   character of it can end the string or the list; nothing at all for a conversation without any. */
function skillsProperty(f) {
  const turns = f && Array.isArray(f.skills) ? f.skills : [];
  if (!turns.length) return '';
  return ';--cce-skills:"' + turns.map(([u, names]) => hex(u) + '=' + names.map(encodeURIComponent).join(',')).join(';') + '"';
}

/* What this host has read per conversation, so a pass does not re-read the state file it wrote itself. */
const known = new Map();

/**
 * Read what one conversation's transcripts have added since the last call. Resolves to { changed, css }; `css` is empty
 * without a transcript. One pass runs at a time per conversation (oneAtATime in src/claude-files.js), and a queued pass
 * includes the sub-agents if any caller asked for them.
 *
 * `subagents: false` leaves the sub-agents' transcripts out of this pass, for a pass started by a change to the
 * conversation's own: a conversation can hold hundreds of them, and looking at each costs more than reading what the
 * conversation added. `skills: false` leaves out the skills of its turns, which only the conversation's own transcript
 * holds.
 */
function scan(session, opts = {}) {
  if (!SESSION.test(String(session || ''))) return Promise.resolve({ changed: false, css: '' });
  return scanQueued(session, opts);
}

async function scanOnce(session, opts) {
  const dir = opts.dir || planDir();
  const transcript = opts.transcript || transcriptOf(session, opts.projects);
  if (!transcript) return { changed: false, css: '' };
  const file = path.join(dir, session + SUFFIX);
  const state = known.get(session) || readState(file);
  known.set(session, state);
  const fileState = (name) => state.files[name] || (state.files[name] = { pos: 0, runs: [], last: '', eff: '' });
  /* Request the conversation's own transcript before the first await, so that an agent-map scan of the same transcript
     started at the same moment shares the pass. */
  const main = readFile(transcript, fileState(MAIN), false, opts.skills !== false);
  main.catch(() => { /* reported where it is awaited below */ });
  const sub = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  let subs = [];
  if (opts.subagents !== false) {
    try { subs = (await fs.promises.readdir(sub)).filter((n) => n.endsWith('.jsonl')).sort(); } catch (_) { /* none */ }
  }
  let changed = await main;
  for (const n of subs) {
    if (await readFile(path.join(sub, n), fileState(n), true)) changed = true;
  }
  if (changed) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      writeState(file, state);
    } catch (_) { /* the next pass writes it */ }
  }
  return { changed, css: css(state) };
}
/* A request that reads the sub-agents and one that does not make, together, a pass that reads them. */
const scanQueued = oneAtATime(scanOnce, (a, b) => Object.assign({}, a, b, { subagents: a.subagents !== false || b.subagents !== false }));

module.exports = { scan, css, readLine, skillNames, SUFFIX, STATE_FILE, ROUTE_MARK, ORDER_LINE, GIVEN_EARLIER, ORDER_END };
