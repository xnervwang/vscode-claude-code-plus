// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * Acting as a supervisor, and as the user around it, in the window steps of ui.js, with no model behind it. A
 * supervisor runs steward-relay.py from a tool call, and the window carries a request out only once the asker's own
 * transcript has that call (src/relay.js ranBy), so run() appends the call before the script starts and the call's
 * result once it ends. says() appends a message the user typed, or one that came from elsewhere, which is what the
 * window reads to decide whether the user agreed to a take-over (src/relay.js typedBefore).
 *
 * request() writes a request file itself, as an older or another build of the script would, so that a step sees what
 * the window does with a request the script would have refused before writing it. edit() changes stewards.json under
 * its lock (src/file-lock.js) without working anything out, as when time has passed: a ticket or a hand-over made long
 * ago, or a lead changed by another window. A conversation is { id, title, folder }, its folder the one it was started in.
 */
const crypto = require('crypto');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const fakeHome = require('./fake-home');
const { withLock, writeLocked } = require('../../../src/file-lock');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'claude-plugin', 'agent-work-plan', 'hooks', 'steward-relay.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
/* How long request() waits for the window's answer: src/relay.js drops a request after a minute. */
const ANSWER_MS = 60000;

function create({ home }) {
  const dataDir = path.join(home, '.claude', 'plugins', 'data', 'agent-work-plan-claude-code-extras');
  const file = path.join(dataDir, 'stewards.json');
  const relayDir = path.join(dataDir, 'relay');
  const transcript = (t) => path.join(home, '.claude', 'projects', fakeHome.folderName(t.folder), `${t.id}.jsonl`);
  /* A record id the transcript has not used: Claude Code's own start with the session id's first 24 characters. */
  const uuidOf = (t) => `${t.id.slice(0, 24)}${crypto.randomBytes(6).toString('hex')}`;
  const lastUuid = (t) => {
    for (const l of fs.readFileSync(transcript(t), 'utf8').split('\n').reverse()) {
      try { const r = JSON.parse(l); if ((r.type === 'user' || r.type === 'assistant') && r.uuid) return r.uuid; } catch (_) { /* not an entry */ }
    }
    return null;
  };

  /* A message in `t`'s transcript after its last one: typed by the user, or with `from` arrived another way ('peer' for a
     message from another session, as Claude Code records one). Returns its time. */
  const says = (t, text, from) => {
    const at = new Date();
    const peer = from === 'peer';
    fs.appendFileSync(transcript(t), JSON.stringify({ parentUuid: lastUuid(t), sessionId: t.id, cwd: t.folder, isSidechain: false, type: 'user',
      uuid: uuidOf(t), timestamp: at.toISOString(), permissionMode: 'default', promptSource: from ? 'system' : 'user',
      origin: peer ? { kind: 'peer', from: 'uds:/tmp/cc-socks/9.sock', name: 'Another session', fromMode: 'prompting', body: text } : { kind: from || 'human' },
      message: { role: 'user', content: peer ? `<cross-session-message from="uds:/tmp/cc-socks/9.sock" from-name="Another session">\n${text}\n</cross-session-message>` : text } }) + '\n');
    return at.getTime();
  };

  /* The command line a supervisor's tool call runs. */
  const lineOf = (args, input) => `python3 ${SCRIPT} ${args.join(' ')}` + (input ? ` <<'EOF'\n${input}\nEOF` : '');
  /* Appends `t`'s tool call that runs the script with `args`; returns the function that appends its result. */
  const call = (t, args, input) => fakeHome.appendToolCall(transcript(t), { sessionId: t.id, cwd: t.folder, uuid: uuidOf(t),
    toolId: `toolu_lead_${crypto.randomBytes(4).toString('hex')}`, command: lineOf(args, input), description: 'Act for the user' });

  /*
   * `t` runs the script with `args` and `input` on its standard input; resolves to what it printed. The tool call is in
   * the transcript before the script starts, unless `before` is given: then the script starts first, `before()` is
   * awaited, and the call is appended after it, so that a window that took the request waits for it meanwhile.
   */
  const run = (t, args, input, { before } = {}) => {
    let answered = before ? null : call(t, args, input);
    const said = new Promise((resolve) => {
      const kid = cp.spawn(PYTHON, [SCRIPT, ...args, dataDir], { env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: t.id }) });
      let out = '';
      kid.stdout.on('data', (d) => { out += d; });
      kid.stderr.on('data', (d) => { out += d; });
      kid.on('error', (e) => resolve('could not run the script: ' + e.message));
      kid.on('exit', () => resolve(out.trim()));
      kid.stdin.end(input || '');
    });
    const late = before ? Promise.resolve().then(before).then(() => { answered = call(t, args, input); }) : Promise.resolve();
    return late.then(() => said).then((out) => { if (answered) answered(out); return out; });
  };

  /*
   * Writes request `req` (src/relay.js's fields: action, to, text, term, seq, ask, ...) from supervisor `t` as the file
   * an older script names <id>.json (`old`) or as this build's <id>.v4.json, with `t`'s tool call for it (`args`, `input`)
   * in its transcript; resolves to the window's answer, or null when none came.
   */
  const request = async (t, req, { args, input, old = false, ms = ANSWER_MS } = {}) => {
    const id = crypto.randomUUID();
    const answered = call(t, args, input);
    fs.mkdirSync(relayDir, { recursive: true });
    const body = Object.assign({ id, steward: t.id, text: '', at: Date.now() }, req);
    const tmp = path.join(relayDir, `${id}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(body));
    fs.renameSync(tmp, path.join(relayDir, `${id}${old ? '' : '.v4'}.json`));
    const result = path.join(relayDir, `${id}.result.json`);
    const end = Date.now() + ms;
    let r = null;
    while (Date.now() < end) {
      try { r = JSON.parse(fs.readFileSync(result, 'utf8')); break; } catch (_) { await new Promise((ok) => setTimeout(ok, 250)); }
    }
    try { fs.unlinkSync(result); } catch (_) { /* none */ }
    for (const n of [`${id}.json`, `${id}.v4.json`]) { try { fs.unlinkSync(path.join(relayDir, n)); } catch (_) { /* taken */ } }
    answered(r ? JSON.stringify(r) : 'no answer');
    return r;
  };

  /* stewards.json as the file has it, or null. */
  const table = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
  /* The lead entry of `key`, or null. */
  const leadOf = (key) => { const d = table(); return (d && d.leads && d.leads[key]) || null; };
  /* Changes the file as `fn(d)` changes the parsed table, under the file's lock, with its revision counted up. */
  const edit = (fn) => withLock(file, () => {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    fn(d);
    d.rev = (typeof d.rev === 'number' ? d.rev : 0) + 1;
    writeLocked(file, JSON.stringify(d, null, 1) + '\n');
  });

  /* The text of each message in `t`'s transcript that starts with or contains `head`, oldest first: what Claude Code
     queued for it or recorded as a user row. */
  const messages = (t, head) => {
    let lines = [];
    try { lines = fs.readFileSync(transcript(t), 'utf8').split('\n'); } catch (_) { return []; }
    const out = [];
    for (const l of lines) {
      if (!l.includes(head.slice(0, 40).replace(/"/g, '\\"'))) continue;
      let r;
      try { r = JSON.parse(l); } catch (_) { continue; }
      const c = r.type === 'queue-operation' ? r.content : r.type === 'user' && r.message ? r.message.content : '';
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '';
      if (text.includes(head)) out.push(text);
    }
    return out;
  };
  /* Whether `t`'s transcript holds `text` anywhere, as JSON writes it. */
  const holds = (t, text) => { try { return fs.readFileSync(transcript(t), 'utf8').includes(JSON.stringify(text).slice(1, -1)); } catch (_) { return false; } };
  /* How many times `t`'s transcript holds `text` in a user row of its own. */
  const userRows = (t, text) => {
    let lines = [];
    try { lines = fs.readFileSync(transcript(t), 'utf8').split('\n'); } catch (_) { return 0; }
    let n = 0;
    for (const l of lines) {
      let r;
      try { r = JSON.parse(l); } catch (_) { continue; }
      const c = r && r.type === 'user' && r.message ? r.message.content : null;
      const s = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '';
      if (s.includes(text)) n++;
    }
    return n;
  };

  return { dataDir, file, relayDir, transcript, says, run, request, table, leadOf, edit, messages, holds, userRows, lineOf };
}

module.exports = { create, SCRIPT };
