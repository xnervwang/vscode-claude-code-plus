// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/* The relay's lead checks, run by test/check.js in a process of their own since they wait on the relay: prints one JSON
   array of [what, passed, detail]. */
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const st = require('../src/stewards'), relay = require('../src/relay'), sl = require('../src/steward-leads');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cce-lead-'));
  const dir = path.join(root, 'plans'), rdir = path.join(dir, relay.RELAY_DIR);
  fs.mkdirSync(rdir, { recursive: true });
  const S = (n) => `1eadbeef-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
  const [A, B, X] = [S(1), S(2), S(9)];
  const base = Date.now();
  let clock = base;
  const T = (ms) => new Date(ms).toISOString();
  const files = { [A]: path.join(root, A + '.jsonl'), [B]: path.join(root, B + '.jsonl') };
  for (const f of Object.values(files)) fs.writeFileSync(f, '');
  const add = (who, row) => fs.appendFileSync(files[who], JSON.stringify(row) + '\n');
  const typed = (who, text) => add(who, { type: 'user', timestamp: T(clock), origin: { kind: 'human' }, message: { role: 'user', content: text } });
  let calls = 0;
  /* The supervisor `who` runs steward-relay.py with `args` (and `text` in a here-document), as its transcript shows. */
  const ran = (who, args, text = '') => {
    const id = 'toolu_' + (++calls);
    const command = `python3 ~/.claude/x/steward-relay.py ${args}` + (text ? ` <<'EOF'\n${text}\nEOF` : '');
    add(who, { type: 'assistant', timestamp: T(clock), message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
    return id;
  };
  let reqs = 0;
  const request = (o) => {
    const id = `cafe${String(++reqs).padStart(4, '0')}-0000-4000-8000-000000000000`;
    fs.writeFileSync(path.join(rdir, id + '.v4.json'), JSON.stringify(Object.assign({ id, at: clock }, o)));
    return id;
  };
  const delivered = [], posted = [];
  let aliveA = true;
  const deps = {
    shownHere: () => true, stewards: () => st.read(dir), leadState: () => st.state(dir),
    update: (fn, o) => st.update(dir, fn, Object.assign({ now: clock }, o || {})),
    alive: (s) => (s === A ? aliveA : true), gone: () => false,
    postNotice: (s, text) => { posted.push([s, text]); return Promise.resolve(true); },
    shownAnywhere: () => true,
    transcriptOf: (id) => files[id] || '', titleOf: (id) => ({ [A]: 'Alpha', [B]: 'Beta', [X]: 'Export' })[id] || '',
    deliver: (to, text) => { delivered.push([to, text]); return Promise.resolve({ outcome: 'submitted', reason: '' }); },
    pid: process.pid, now: () => clock, sleep: () => Promise.resolve(),
  };
  const run = async () => { const r = await relay.take(dir, deps); await relay.settled(); return r; };
  const result = (id) => { try { return JSON.parse(fs.readFileSync(path.join(rdir, id + '.result.json'), 'utf8')); } catch (_) { return null; } };
  const cases = [];
  const expect = (what, cond, detail) => cases.push([what, !!cond, detail]);
    st.setManaged(A, [X], {}, { dir, now: clock - 2000 });
    st.setManaged(B, [X], {}, { dir, now: clock - 1000 });
    let s0 = st.state(dir);
    expect('the first supervisor to tick a conversation leads it and the second observes',
      sl.leadOf(s0.table, s0.leads, X) === A && sl.roleOf(s0.table, s0.leads, B, X) === 'observer', s0.leads);
    const term1 = s0.leads[X].term;

    clock += 1000;
    const a1 = request({ steward: A, to: X, text: 'Run the export again.', term: term1, seq: 1 });
    ran(A, X, 'Run the export again.');
    const b1 = request({ steward: B, to: X, text: 'Stop the export.', term: term1, seq: 2 });
    ran(B, X, 'Stop the export.');
    await run();
    expect('the lead\'s message is typed into the conversation', result(a1) && result(a1).outcome === 'submitted' && delivered.some((d) => d[1].includes('Run the export again.')), result(a1));
    expect('an observer\'s message is refused, naming the lead and the way to take it over',
      result(b1) && result(b1).outcome === 'refused' && /led by "Alpha"; you observe it/.test(result(b1).reason) && /--take-lead/.test(result(b1).reason)
        && !delivered.some((d) => d[1].includes('Stop the export.')), result(b1));

    clock += 1000;
    const stale = request({ steward: A, to: X, text: 'Check the log.', term: term1 + 5, seq: 3 });
    ran(A, X, 'Check the log.');
    await run();
    expect('a request written under another lead term is refused', result(stale) && /changed after you wrote this request/.test(result(stale).reason), result(stale));

    clock += 1000;
    const noTicket = request({ steward: B, action: 'take-lead', ask: false, to: X, seq: 4 });
    typed(B, 'yes');
    ran(B, `--take-lead ${X}`);
    await run();
    expect('a take-over with no question asked first is refused', result(noTicket) && result(noTicket).outcome === 'refused' && /no take-over question/.test(result(noTicket).reason), result(noTicket));

    clock += 1000;
    const ask = request({ steward: B, action: 'take-lead', ask: true, to: X, seq: 5 });
    ran(B, `--take-lead ${X} --ask`);
    await run();
    const q = result(ask);
    expect('with ask, take-lead returns the question to put to the user, naming both supervisors and the conversation',
      q && q.outcome === 'ask' && /Should I \("Beta"\) take over "Export"\? It is led by "Alpha" now/.test(q.question || '') && st.state(dir).tickets[`${B} ${X}`], q);

    clock += 1000;
    add(B, { type: 'user', timestamp: T(clock), message: { role: 'user', content: 'Supervisor notice from Claude Code Plus, not a message from the user. x' } });
    const fromNotice = request({ steward: B, action: 'take-lead', ask: false, to: X, seq: 6 });
    ran(B, `--take-lead ${X}`);
    await run();
    expect('a yes that is not the user\'s own typing does not count', result(fromNotice) && result(fromNotice).outcome === 'refused' && /only the user's own answer/.test(result(fromNotice).reason), result(fromNotice));

    clock += 1000;
    const ask2 = request({ steward: B, action: 'take-lead', ask: true, to: X, seq: 7 });
    ran(B, `--take-lead ${X} --ask`);
    await run();
    clock += 1000;
    typed(B, 'Yes, take it over.');
    const yes = request({ steward: B, action: 'take-lead', ask: false, to: X, seq: 8 });
    ran(B, `--take-lead ${X}`);
    await run();
    let s1 = st.state(dir);
    expect('with the user\'s yes and the lead alive, the hand-over starts: the lead does not change yet, and the old lead is told to hand over',
      result(ask2) && result(ask2).outcome === 'ask' && result(yes) && result(yes).outcome === 'pending' && s1.leads[X].lead === A && s1.leads[X].pending && s1.leads[X].pending.to === B
        && posted.some((p) => p[0] === A && /--hand-over/.test(p[1])), [result(yes), s1.leads[X]]);

    clock += 1000;
    const early = request({ steward: B, action: undefined, to: X, text: 'Here I am.', term: s1.leads[X].term, seq: 9 });
    ran(B, X, 'Here I am.');
    await run();
    expect('the new lead cannot act before the old one hands over', result(early) && /being handed over from "Alpha" to you/.test(result(early).reason), result(early));

    clock += 1000;
    const wrong = request({ steward: B, action: 'hand-over', to: X, text: 'I hand it over.', seq: 10 });
    ran(B, `--hand-over ${X}`, 'I hand it over.');
    const handed = request({ steward: A, action: 'hand-over', to: X, text: 'I asked it to rerun the export; Beta follows it up.', seq: 11 });
    ran(A, `--hand-over ${X}`, 'I asked it to rerun the export; Beta follows it up.');
    await run();
    const s2 = st.state(dir);
    const note = delivered.find((d) => d[1].includes('Beta follows it up.'));
    expect('only the old lead can send the hand-over', result(wrong) && result(wrong).outcome === 'refused', result(wrong));
    expect('the hand-over note reaches the conversation with a first line naming both, and then the new supervisor is the lead, with the lead term one higher',
      note && /From your lead supervisor "Alpha": from now on your lead supervisor is "Beta"\./.test(note[1]) && s2.leads[X].lead === B && s2.leads[X].term === s1.leads[X].term + 1
        && !s2.leads[X].pending, [note, s2.leads[X]]);

    clock += 1000;
    const after = request({ steward: A, to: X, text: 'One more thing.', term: s2.leads[X].term, seq: 12 });
    ran(A, X, 'One more thing.');
    await run();
    expect('the old lead observes now and its messages are refused', result(after) && /led by "Beta"; you observe it/.test(result(after).reason), result(after));

    /* A hand-over the old lead never makes. */
    clock += 1000;
    st.update(dir, ({ leads: L }) => { L[X] = Object.assign({}, L[X], { pending: { to: A, at: clock, by: 'panel' } }); }, { now: clock });
    clock += st.HAND_OVER_MS + 1000;
    st.update(dir, () => {}, { now: clock });
    const s3 = st.state(dir);
    clock += 1000;
    const intro = request({ steward: A, to: X, text: 'Picking this up.', term: s3.leads[X].term, seq: 13 });
    ran(A, X, 'Picking this up.');
    await run();
    const introText = delivered.find((d) => d[1].includes('Picking this up.'));
    expect('a hand-over the old lead does not finish in time is made without its note, and the new lead\'s first message starts by saying so',
      s3.leads[X].lead === A && s3.leads[X].why === 'panel' && introText && /From your new lead supervisor "Alpha": "Beta" did not hand you over\./.test(introText[1])
        && !st.state(dir).leads[X].intro, [s3.leads[X], introText]);

    /* Hand-offs go to the lead only. */
    const order = [];
    const hdeps = Object.assign({}, deps, { records: () => [{ sessionId: A, messagingSocketPath: 'uds:/a' }, { sessionId: B, messagingSocketPath: 'uds:/b' }],
      post: (addr) => { order.push(addr); return Promise.resolve(true); }, transcriptOf: (id) => files[id] || path.join(root, id + '.jsonl') });
    fs.writeFileSync(path.join(root, X + '.jsonl'), '');
    clock += 1000;
    const hid = `cafe9999-0000-4000-8000-000000000000`;
    fs.writeFileSync(path.join(rdir, hid + '.v4.json'), JSON.stringify({ id: hid, at: clock, action: 'handoff', from: X, to: '', text: 'This belongs to the docs work.' }));
    fs.appendFileSync(path.join(root, X + '.jsonl'), JSON.stringify({ type: 'assistant', timestamp: T(clock), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_h', name: 'Bash',
      input: { command: "python3 steward-relay.py --handoff <<'EOF'\nThis belongs to the docs work.\nEOF" } }] } }) + '\n');
    await relay.take(dir, hdeps); await relay.settled();
    expect('a hand-off from the conversation goes to its lead only', JSON.stringify(order) === JSON.stringify(['uds:/a']), [order, result(hid)]);
    /* Another agent's conversation: its hand-over note goes through Agent Plus as a message, and none is kept. */
    {
      const O = 'opencode-plus:ses_Lead01';
      const others = [];
      const odeps = Object.assign({}, deps, { deliverOther: (key, text) => { others.push([key, text]); return Promise.resolve({ outcome: 'submitted', reason: '' }); } });
      clock += 1000;
      st.setManaged(A, [X, O], {}, { dir, now: clock });
      st.setManaged(B, [X, O], {}, { dir, now: clock + 1 });
      const so = st.state(dir);
      const first = sl.leadOf(so.table, so.leads, O);
      const second = first === A ? B : A;
      st.update(dir, ({ leads: L }) => { L[O] = Object.assign({}, L[O], { pending: { to: second, at: clock, by: 'consent' } }); }, { now: clock });
      clock += 1000;
      const oid = request({ steward: first, action: 'hand-over', to: O, text: 'The parser port is half done.', seq: 20 });
      ran(first, `--hand-over ${O}`, 'The parser port is half done.');
      await relay.take(dir, odeps); await relay.settled();
      const s4 = st.state(dir);
      expect('an OpenCode conversation\'s hand-over note is sent through Agent Plus as a message; the lead changes, and no note is kept for the conversation\'s next turn',
        result(oid) && result(oid).outcome === 'submitted' && others.length === 1 && others[0][0] === O && /from now on your lead supervisor is/.test(others[0][1])
          && s4.leads[O].lead === second && !s4.leads[O].tell, [result(oid), others, s4.leads[O]]);
    }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* left in tmp */ }
  return cases;
})().then((cases) => { process.stdout.write(JSON.stringify(cases)); }, (e) => { process.stdout.write(JSON.stringify([['lead checks ran', false, String((e && e.stack) || e)]])); });
