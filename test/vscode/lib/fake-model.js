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
 * stops to ask for permission to run it; the turn that carries the tool's result is answered with text again. One whose
 * message contains ASK_TO_BACKGROUND gets a Bash call of BG_RUN with run_in_background, so the turn can end while the
 * command still runs. One whose message contains ASK_TO_DETACH gets a Bash call of DETACH_RUN, which leaves a program
 * running in a session of its own, outside Claude Code's account of its background work; ASK_TO_DETACH_SHORT the same with
 * DETACH_SHORT_RUN, which ends sooner. One whose message contains ASK_FOR_HELPER gets an Agent call run in the background, whose prompt is
 * HELPER_TASK; the helper's own turns are held until releaseHelper(), so it keeps running for as long as a test needs.
 * One whose message contains ASK_FOR_WORKER gets a Bash call of WORKER_RUN, which starts $HOME/fake-bin/claude as a
 * `claude -p` worker under a detached shell; the test writes that script (WORKER_SCRIPT).
 *
 * If a turn asks for "a link to conversation <id>" (LINK_ASK), the reply is a steward link to that conversation. If it
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
const asksForHelper = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_FOR_HELPER); };
const asksToDetach = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_DETACH); };
const asksToDetachShort = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_TO_DETACH_SHORT); };
const asksForWorker = (ask) => { const t = lastAsk(ask); return t !== null && t.toLowerCase().includes(ASK_FOR_WORKER); };
/* The helper's own conversation opens with its prompt; the one that started it does not. */
const isHelper = (ask) => { const first = (ask.messages || []).find((m) => m && m.role === 'user'); return !!first && JSON.stringify(first.content).includes(HELPER_TASK); };
const linkAsked = (ask) => { const m = LINK_ASK.exec(lastAsk(ask) || ''); return m ? m[1].toLowerCase() : null; };
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
/* The skill suggestions block in this turn's input (route-skills.py), from its first words to the end of the hook's
   text; '' without one. Claude Code wraps a hook's text in a system-reminder. */
const ROUTE_MARK = 'Skills that may fit this message';
function routeOf(ask) {
  const msgs = Array.isArray(ask.messages) ? ask.messages : [];
  let i = msgs.length;
  while (i > 0 && !(msgs[i - 1] && msgs[i - 1].role === 'assistant')) i--;
  for (const m of msgs.slice(i)) {
    const texts = !m ? [] : typeof m.content === 'string' ? [m.content]
      : Array.isArray(m.content) ? m.content.map((x) => (x && typeof x.text === 'string' ? x.text : '')) : [];
    for (const text of texts) {
      const at = text.indexOf(ROUTE_MARK);
      if (at >= 0) return text.slice(at).replace(/\n*<\/system-reminder>[\s\S]*$/, '');
    }
  }
  return '';
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
      const background = asksToBackground(ask);
      const helper = asksForHelper(ask);
      const helping = !helper && isHelper(ask);
      const detach = asksToDetach(ask), detachShort = asksToDetachShort(ask);
      const worker = asksForWorker(ask);
      const tool = background || helper || detach || detachShort || worker || asksToRun(ask);
      const linked = linkAsked(ask), picture = imageAsked(ask);
      const reply = linked ? `It is [${LINK_TEXT}](vscode://xnervwang.claude-code-plus/open?session=${linked}).`
        : picture ? `Here it is:\n\n![${IMAGE_ALT}](${picture})\n\nAnd the one on the web:\n\n![a web picture](${IMAGE_WEB})` : plain;
      seen.push({ method: req.method, url: req.url, bytes: body.length, stream: !!ask.stream, model: ask.model || '', tool, helping,
        parts: lastParts(ask).map((p) => (p && p.type) || typeof p), result: resultText(ask), ask: (lastAsk(ask) || '').slice(0, 400),
        typed: typedText(ask).slice(0, 400),
        picture, imagesNote: imagesNote(ask), context: contextOf(ask), route: routeOf(ask) });
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
          : detach ? { command: DETACH_RUN, description: 'Start the long job detached' }
          : detachShort ? { command: DETACH_SHORT_RUN, description: 'Start the short job detached' }
          : worker ? { command: WORKER_RUN, description: 'Start a worker detached' }
          : { command: RUN, description: 'Run the test suite' };
      const block = tool ? { type: 'tool_use', id: `toolu_fake_${n}`, name: helper ? 'Agent' : 'Bash', input } : { type: 'text', text: reply };
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

module.exports = { start, ROUTE_MARK, ASK_TO_RUN, RUN, ASK_TO_BACKGROUND, BG_RUN, ASK_FOR_HELPER, HELPER_TASK, ASK_TO_DETACH, DETACH_RUN, ASK_TO_DETACH_SHORT,
  DETACH_SHORT_RUN, LINK_TEXT,
  IMAGE_ALT, IMAGE_WEB, ASK_FOR_WORKER, WORKER_RUN, WORKER_NAME, WORKER_SCRIPT };
