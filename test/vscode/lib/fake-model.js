// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * A stand-in for the model behind Claude Code: an HTTP server on 127.0.0.1 that answers the Messages API's POST
 * /v1/messages with a canned reply, streamed or not as the request asks, and POST /v1/messages/count_tokens with a
 * count. Claude Code's CLI sends each turn here when ANTHROPIC_BASE_URL names this server (run.js passes it through
 * claudeCode.environmentVariables); the key it sends is fake and nothing checks it.
 *
 * A turn whose message contains ASK_TO_RUN is answered with a Bash tool call of RUN instead of text, so that Claude Code
 * stops to ask for permission to run it; the turn that carries the tool's result is answered with text again. A message
 * with ASK_TO_BACKGROUND gets a Bash call of BG_RUN with run_in_background, so the turn can end while the command still
 * runs, and ASK_TO_BACKGROUND_LONG the same with BG_LONG_RUN, which runs for a quarter of an hour. ASK_TO_DETACH gets a
 * Bash call of DETACH_RUN, which leaves a program running in a session of its own, outside Claude Code's account of its
 * background work; ASK_TO_DETACH_SHORT the same with DETACH_SHORT_RUN, which ends sooner. ASK_FOR_HELPER gets an Agent
 * call run in the background, whose prompt is HELPER_TASK; the helper's own turns are held until releaseHelper(), so it
 * keeps running for as long as a test needs. ASK_FOR_WORKER gets a Bash call of WORKER_RUN, which starts
 * $HOME/fake-bin/claude as a `claude -p` worker under a detached shell; the test writes that script (WORKER_SCRIPT).
 * ASK_FOR_BG_SESSION gets a Bash call of BG_SESSION_RUN, which starts a `claude --bg` session with the stand-in at
 * $HOME/fake-bg/claude (BG_SESSION_SCRIPT). ASK_FOR_BG_OUTPUT gets a Bash call of BG_OUTPUT_RUN with
 * run_in_background: the same launch after a wait, cut to the CLI's three hints by `tail -3`, so the call's result names
 * only the file the command writes, and the session starts well after that result. ASK_FOR_CHOICE gets an
 * AskUserQuestion call with CHOICE's question and options, so that Claude Code shows a choice box. ASK_TO_PAUSE gets a
 * Bash call of PAUSE_RUN, which Claude Code runs without asking; a message typed while the turn runs is taken into the
 * turn after that call's result.
 *
 * If a turn asks for "a link to conversation <id>" (LINK_ASK), the reply is a supervisor link to that conversation. If it
 * asks to "show me the picture at <path>" (IMAGE_ASK), the reply links that file as an image, and an image at a web
 * address (IMAGE_WEB) after it.
 *
 * hold() keeps the next turns' replies back until release() is called, so a turn can be watched while it runs.
 */
const http = require('http');

const ASK_TO_RUN = 'run the test suite';
const RUN = 'npm test';
const ASK_TO_BACKGROUND = 'start the long job in the background';
const BG_RUN = 'sleep 40';
const ASK_TO_BACKGROUND_LONG = 'start the nightly build in the background';
const BG_LONG_RUN = 'sleep 900';
const ASK_FOR_HELPER = 'ask a helper in the background';
const ASK_TO_DETACH = 'start the long job detached';
const DETACH_RUN = 'setsid nohup sleep 45 > /dev/null 2>&1 &';
const ASK_TO_DETACH_SHORT = 'start the short job detached';
const DETACH_SHORT_RUN = 'setsid nohup sleep 20 > /dev/null 2>&1 &';
const HELPER_TASK = 'Look through notes.txt for the retry delay.';
const ASK_FOR_WORKER = 'start a worker detached';
/* The shell stays behind as the worker's parent, as the one a `( setsid nohup ... claude -p ... & )` launch leaves. */
const WORKER_RUN = 'setsid nohup bash -c \'"$HOME/fake-bin/claude" -p "Draft the release notes" --output-format stream-json'
  + ' > "$HOME/worker.jsonl" 2>&1; echo done\' > /dev/null 2>&1 < /dev/null &';
const WORKER_NAME = 'release-notes-worker';
const ASK_FOR_BG_SESSION = 'start the nightly report as a background session';
const BG_SESSION_RUN = '"$HOME/fake-bg/claude" --bg "Write the nightly report from the build logs"';
const BG_SESSION_NAME = 'nightly-report';
const ASK_FOR_BG_OUTPUT = 'start the weekly digest from a background command';
const BG_OUTPUT_RUN = 'sleep 15; "$HOME/fake-bg/claude" --bg "Write the weekly digest from the build logs" 2>&1 | tail -3';
/*
 * A stand-in for the CLI's `claude --bg`, a Node script at $HOME/fake-bg/claude, so that it runs the same on Linux,
 * macOS and Windows (where Claude Code's Bash tool is Git Bash). Asked for --bg, it writes the job's record under
 * ~/.claude/jobs/<id>/state.json as working, prints the CLI's `backgrounded · <id>` line and its three hints, and leaves
 * a process running detached from any terminal, in its own process group. That process writes a busy session record of
 * kind "bg" for the job and keeps the job's record fresh; after `seconds` it records the job as done with a result,
 * removes its session record and exits. The session's own transcript says it is a `claude --bg` session.
 */
const BG_SESSION_SCRIPT = (seconds) => `#!/usr/bin/env node
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const claude = path.join(os.homedir(), '.claude');
const [flag, ...rest] = process.argv.slice(2);
const stateFile = (id) => path.join(claude, 'jobs', id, 'state.json');
const write = (file, d) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(d)); fs.renameSync(file + '.tmp', file); };
if (flag === '--bg') {
  const id = crypto.randomBytes(4).toString('hex'), session = crypto.randomUUID(), now = new Date().toISOString();
  write(stateFile(id), { id, name: ${JSON.stringify(BG_SESSION_NAME)}, state: 'working', detail: 'Reading the build logs', intent: rest.join(' '),
    sessionId: session, createdAt: now, updatedAt: now });
  const folder = path.join(claude, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, session + '.jsonl'), JSON.stringify({ parentUuid: null, isSidechain: false, userType: 'external',
    entrypoint: 'cli', sessionKind: 'bg', cwd: process.cwd(), sessionId: session, type: 'user', uuid: crypto.randomUUID(), timestamp: now,
    message: { role: 'user', content: rest.join(' ') } }) + '\\n');
  cp.spawn(process.execPath, [__filename, '--run', id, session], { detached: true, stdio: 'ignore', cwd: process.cwd(), windowsHide: true }).unref();
  console.log('backgrounded \u00b7 ' + id);
  console.log('  claude attach ' + id + '   open in this terminal');
  console.log('  claude logs ' + id + '     show recent output');
  console.log('  claude stop ' + id + '     stop this session');
} else if (flag === '--run') {
  const [id, session] = rest, record = path.join(claude, 'sessions', process.pid + '.json');
  write(record, { pid: process.pid, sessionId: session, cwd: process.cwd(), startedAt: Date.now(), kind: 'bg', jobId: id, entrypoint: 'cli',
    status: 'busy', statusUpdatedAt: Date.now() });
  const fresh = setInterval(() => { try { const d = JSON.parse(fs.readFileSync(stateFile(id), 'utf8')); d.updatedAt = new Date().toISOString(); write(stateFile(id), d); } catch (_) {} }, 5000);
  setTimeout(() => {
    clearInterval(fresh);
    const d = JSON.parse(fs.readFileSync(stateFile(id), 'utf8')), now = new Date().toISOString();
    write(stateFile(id), Object.assign(d, { state: 'done', detail: '', updatedAt: now, firstTerminalAt: now, lastTerminalAt: now,
      output: { result: 'The nightly report is written: 2 failed tests, both in the export job.' } }));
    try { fs.unlinkSync(record); } catch (_) {}
    process.exit(0);
  }, ${Number(seconds) || 60} * 1000);
}
`;
const ASK_FOR_CHOICE = 'ask me which config to change';
const CHOICE = { question: 'Which config should I change?', header: 'Config', options: ['Staging', 'Production'] };
const ASK_TO_PAUSE = 'pause for two seconds';
const PAUSE_RUN = 'sleep 2';
/*
 * A stand-in for the CLI's `claude -p`, at $HOME/fake-bin/claude: it writes a session record of the CLI's shape for
 * its own process, as a worker started with --output-format stream-json does, and runs for `seconds`.
 */
const WORKER_SCRIPT = (sessionId, seconds) => [
  '#!/bin/bash',
  'mkdir -p "$HOME/.claude/sessions"',
  `printf '{"pid":%d,"sessionId":"${sessionId}","cwd":"%s","startedAt":%s,"kind":"interactive","entrypoint":"sdk-cli",`
    + `"name":"${WORKER_NAME}","status":"busy"}\\n' "$$" "$PWD" "$(date +%s%3N)" > "$HOME/.claude/sessions/$$.json"`,
  `sleep ${Number(seconds) || 60}`,
  '',
].join('\n');

function sse(res, type, payload) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}

const LINK_ASK = /link to conversation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const LINK_TEXT = 'that conversation';
/* A reply that names another conversation three ways for the page to link: by its title as it stands, by its title in
   corner brackets, and by the first 8 characters of its id. */
const NAME_ASK = /name the conversation ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) titled (.+?)\.?\s*$/i;
const NAMED_REPLY = (id, title) => `${title} is the one. In brackets: \u300c${title}\u300d. By its short id: ${id.slice(0, 8)}.`;
/* A reply given word for word, base64 in the message so that the message box takes it as typed: code fences, corner
   brackets and new lines included. */
const ECHO_ASK = /reply with the base64 text ([A-Za-z0-9+/=]+)/i;
const ECHO_REQUEST = (text) => `Reply with the base64 text ${Buffer.from(String(text), 'utf8').toString('base64')}.`;
const IMAGE_ASK = /show me the picture at (\S+)/i;
const IMAGE_ALT = 'a red square';
const IMAGE_WEB = 'https://example.com/square.png';

/* The parts of the last user message. The CLI can send a system message after it. */
function lastParts(ask) {
  const last = (ask.messages || []).filter((m) => m && m.role === 'user').pop();
  if (!last) return [];
  return typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content || [];
}
/* The last user message's text; null when it has none, as when it only brings a tool's result back. When the user
   refused a tool call, Claude Code sends that refusal's result in the same message as whatever the user types next. */
function lastAsk(ask) {
  const text = lastParts(ask).filter((p) => p && p.type === 'text').map((p) => String(p.text));
  return text.length ? text.join('\n') : null;
}
/* The last text part of the last user message: what was typed, after any reminder Claude Code puts before it. */
function typedText(ask) {
  const text = lastParts(ask).filter((p) => p && p.type === 'text');
  return text.length ? String(text[text.length - 1].text) : '';
}
/* The start of the first tool result in the last user message, so a test's log shows what a tool call came back with. */
function resultText(ask) {
  const r = lastParts(ask).find((p) => p && p.type === 'tool_result');
  if (!r) return undefined;
  const c = typeof r.content === 'string' ? r.content : (r.content || []).map((x) => (x && x.text) || '').join(' ');
  return c.slice(0, 160);
}
const asksToRun = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_RUN); };
const asksToBackground = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_BACKGROUND); };
const asksToBackgroundLong = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_BACKGROUND_LONG); };
const asksForHelper = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_FOR_HELPER); };
const asksToDetach = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_DETACH); };
const asksToDetachShort = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_DETACH_SHORT); };
const asksForWorker = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_FOR_WORKER); };
const asksForBgSession = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_FOR_BG_SESSION); };
const asksForBgOutput = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_FOR_BG_OUTPUT); };
const asksForChoice = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_FOR_CHOICE); };
const asksToPause = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_PAUSE); };
/* The helper's own conversation opens with its prompt; the one that started it does not. */
const isHelper = (ask) => { const first = (ask.messages || []).find((m) => m && m.role === 'user'); return !!first && JSON.stringify(first.content).includes(HELPER_TASK); };
const linkAsked = (ask) => { const m = LINK_ASK.exec(lastAsk(ask) || ''); return m ? m[1].toLowerCase() : null; };
const nameAsked = (ask) => { const m = NAME_ASK.exec(typedText(ask)); return m ? NAMED_REPLY(m[1].toLowerCase(), m[2]) : null; };
const echoAsked = (ask) => { const m = ECHO_ASK.exec(typedText(ask)); return m ? Buffer.from(m[1], 'base64').toString('utf8') : null; };
const imageAsked = (ask) => { const m = IMAGE_ASK.exec(lastAsk(ask) || ''); return m ? m[1] : null; };
/* Which of the texts the work plan plugin's hooks and this extension add to Claude's context this turn's input carries:
   the messages after the last reply, since Claude Code 2.1.330 sends the hooks' text and its list of skills in a system
   message after the user's. `skill` is whether that list names the work plan skill, which it does only while the plugin
   is loaded; `tools` how many tools the request offers, none for a side request such as a title. */
const CONTEXT = { plan: /This conversation's work plan/, brief: /write the status before your final reply/, zone: /The user is in \S+ \(/,
  images: /This panel shows images in your replies/, detached: /left running detached is no longer running/, skill: /agent-work-plan:maintain/ };
function contextOf(ask) {
  const msgs = Array.isArray(ask.messages) ? ask.messages : [];
  let i = msgs.length;
  while (i > 0 && !(msgs[i - 1] && msgs[i - 1].role === 'assistant')) i--;
  const input = JSON.stringify(msgs.slice(i));
  const out = { tools: Array.isArray(ask.tools) ? ask.tools.length : 0 };
  for (const [k, re] of Object.entries(CONTEXT)) out[k] = re.test(input);
  return out;
}
/* The folder named by the note on images in replies, wherever in the conversation it was added; '' without one. */
const imagesNote = (ask) => {
  const m = /This panel shows images in your replies\. .*? in (\S+) \(create the folder/.exec(JSON.stringify(ask.messages || []));
  return m ? m[1] : '';
};

async function start({ reply: plain = 'Done. The retry delay is set in config/sync.yml.' } = {}) {
  const seen = [];
  let gate = null, helperGate = null;
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      const url = req.url.replace(/\?.*/, '');
      let ask = {};
      try { ask = JSON.parse(body || '{}'); } catch (_) { ask = {}; }
      const background = asksToBackground(ask), backgroundLong = asksToBackgroundLong(ask);
      const helper = asksForHelper(ask);
      const helping = !helper && isHelper(ask);
      const detach = asksToDetach(ask), detachShort = asksToDetachShort(ask);
      const worker = asksForWorker(ask), bgSession = asksForBgSession(ask), bgOutput = asksForBgOutput(ask);
      const choice = asksForChoice(ask), pause = asksToPause(ask);
      const tool = background || backgroundLong || helper || detach || detachShort || worker || bgSession || bgOutput || choice || pause || asksToRun(ask);
      const linked = linkAsked(ask), picture = imageAsked(ask), named = nameAsked(ask) || echoAsked(ask);
      const reply = named || (linked ? `It is [${LINK_TEXT}](vscode://xnervwang.claude-code-plus/open?session=${linked}).`
        : picture ? `Here it is:\n\n![${IMAGE_ALT}](${picture})\n\nAnd the one on the web:\n\n![a web picture](${IMAGE_WEB})` : plain);
      seen.push({ method: req.method, url: req.url, bytes: body.length, stream: !!ask.stream, model: ask.model || '', tool, helping, choice,
        parts: lastParts(ask).map((p) => (p && p.type) || typeof p), result: resultText(ask), ask: (lastAsk(ask) || '').slice(0, 400),
        typed: typedText(ask).slice(0, 400),
        picture, imagesNote: imagesNote(ask), context: contextOf(ask) });
      if (req.method === 'POST' && /\/v1\/messages\/count_tokens$/.test(url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 1200 }));
        return;
      }
      if (req.method !== 'POST' || !/\/v1\/messages$/.test(url)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"type":"error","error":{"type":"not_found_error","message":"not served here"}}');
        return;
      }
      const id = `msg_fake_${++n}`, model = ask.model || 'claude-sonnet-5-5';
      /* About a fifth of a 200k window, so the context share a reply shows is a number worth checking. */
      const usage = { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 40000, output_tokens: 40 };
      const input = helper ? { description: 'Look through the notes', prompt: HELPER_TASK, subagent_type: 'general-purpose', run_in_background: true }
        : background ? { command: BG_RUN, description: 'Start the long job', run_in_background: true }
        : backgroundLong ? { command: BG_LONG_RUN, description: 'Start the nightly build', run_in_background: true }
          : detach ? { command: DETACH_RUN, description: 'Start the long job detached' }
          : detachShort ? { command: DETACH_SHORT_RUN, description: 'Start the short job detached' }
          : worker ? { command: WORKER_RUN, description: 'Start a worker detached' }
          : bgSession ? { command: BG_SESSION_RUN, description: 'Start the nightly report in a background session' }
          // Claude Code's notice that the command ended quotes this description, so it must not repeat the ask.
          : bgOutput ? { command: BG_OUTPUT_RUN, description: 'Launch the weekly digest session after a wait', run_in_background: true }
          : choice ? { questions: [{ question: CHOICE.question, header: CHOICE.header, multiSelect: false,
            options: CHOICE.options.map((label) => ({ label, description: `The ${label.toLowerCase()} config` })) }] }
          : pause ? { command: PAUSE_RUN, description: 'Pause for two seconds' }
          : { command: RUN, description: 'Run the test suite' };
      const block = tool ? { type: 'tool_use', id: `toolu_fake_${n}`, name: helper ? 'Agent' : choice ? 'AskUserQuestion' : 'Bash', input } : { type: 'text', text: reply };
      const stop = tool ? 'tool_use' : 'end_turn';
      if (!ask.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model, content: [block], stop_reason: stop, stop_sequence: null, usage }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sse(res, 'message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null,
        stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
      if (gate) await gate.promise;
      if (helping && helperGate) await helperGate.promise;
      if (tool) {
        sse(res, 'content_block_start', { index: 0, content_block: { ...block, input: {} } });
        sse(res, 'content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      } else {
        sse(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        sse(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } });
      }
      sse(res, 'content_block_stop', { index: 0 });
      sse(res, 'message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
      sse(res, 'message_stop', {});
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hold = () => { if (!gate) { let open; const promise = new Promise((r) => { open = r; }); gate = { promise, open }; } };
  const release = () => { if (gate) { gate.open(); gate = null; } };
  const holdHelper = () => { if (!helperGate) { let open; const promise = new Promise((r) => { open = r; }); helperGate = { promise, open }; } };
  const releaseHelper = () => { if (helperGate) { helperGate.open(); helperGate = null; } };
  const close = () => new Promise((r) => { release(); releaseHelper(); server.close(() => r()); server.closeAllConnections(); setTimeout(r, 2000); });
  return { port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, seen, hold, release, holdHelper, releaseHelper, close,
    turns: () => seen.filter((s) => s.method === 'POST' && s.stream && /\/v1\/messages(\?|$)/.test(s.url)).length };
}

module.exports = { start, ASK_TO_RUN, RUN, ASK_TO_BACKGROUND, BG_RUN, ASK_TO_BACKGROUND_LONG, BG_LONG_RUN, ASK_FOR_HELPER, HELPER_TASK, ASK_TO_DETACH, DETACH_RUN, ASK_TO_DETACH_SHORT,
  DETACH_SHORT_RUN, LINK_TEXT, NAMED_REPLY, ECHO_REQUEST,
  IMAGE_ALT, IMAGE_WEB, ASK_FOR_WORKER, WORKER_RUN, WORKER_NAME, WORKER_SCRIPT, ASK_FOR_BG_SESSION, BG_SESSION_RUN, BG_SESSION_NAME,
  BG_SESSION_SCRIPT, ASK_FOR_BG_OUTPUT, BG_OUTPUT_RUN, ASK_FOR_CHOICE, CHOICE, ASK_TO_PAUSE, PAUSE_RUN };
