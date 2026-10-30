const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { WebSocket } = require('ws');
const { setTimeout: delay } = require('node:timers/promises');

async function setup(t, options) {
  const { createApplication } = await import('../server/dist/application.js');
  const app = createApplication(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = app.server.address().port;
  return { ...app, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}` };
}

async function connect(url, options) {
  const socket = new WebSocket(url, options);
  const queue = [];
  socket.on('error', () => {});
  socket.on('message', data => queue.push(JSON.parse(data.toString())));
  await once(socket, 'open');
  async function next(predicate) {
    for (let i = 0; i < 200; i++) {
      const index = queue.findIndex(predicate);
      if (index !== -1) return queue.splice(index, 1)[0];
      await delay(10);
    }
    throw new Error('Message timeout: ' + JSON.stringify(queue));
  }
  const initial = await next(message => message.type === 'session.ready');
  return { socket, next, initial, queue };
}
const update = (requestId, nickname = '테스터', avatarId = 'cat') =>
  ({ kind: 'request', type: 'profile.update', requestId, profile: { nickname, avatarId } });

test('sessions: unique IDs, initial snapshot, joins, leave, new ID on reconnect, HTTP', { timeout: 10000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const b = await connect(app.url);
  assert.notEqual(a.initial.selfId, b.initial.selfId);
  assert.equal(a.initial.participants.length, 1);
  assert.equal(b.initial.participants.length, 2);
  assert.equal(b.initial.participants.find(p => p.participantId === a.initial.selfId).avatarId, 'bear');
  const joined = await a.next(m => m.type === 'participant.joined');
  assert.equal(joined.participant.participantId, b.initial.selfId);
  const closed = once(b.socket, 'close');
  b.socket.close();
  await closed;
  assert.equal((await a.next(m => m.type === 'participant.left')).participantId, b.initial.selfId);
  const c = await connect(app.url);
  assert.notEqual(c.initial.selfId, b.initial.selfId);
  assert.equal(c.initial.participants.length, 2);
  assert.ok(!c.initial.participants.some(p => p.participantId === b.initial.selfId));
  assert.deepEqual(await (await fetch(app.http + '/health')).json(), { status: 'ok' });
  assert.equal((await fetch(app.http + '/unknown')).status, 404);
});

test('bidirectional profile sync, normalization and authoritative snapshot', { timeout: 10000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const b = await connect(app.url);
  a.socket.send(JSON.stringify(update('a1', '  Alice 한글  ', 'fox')));
  const response = await a.next(m => m.kind === 'response');
  assert.equal(response.requestId, 'a1');
  assert.equal(response.ok, true);
  assert.equal(response.participant.nickname, 'Alice 한글');
  const eventB = await b.next(m => m.type === 'participant.updated');
  assert.deepEqual(eventB.participant, response.participant);
  b.socket.send(JSON.stringify(update('b1', 'Bob', 'owl')));
  const eventA = await a.next(m => m.type === 'participant.updated' && m.participant.participantId === b.initial.selfId);
  assert.equal(eventA.participant.avatarId, 'owl');
  const c = await connect(app.url);
  assert.deepEqual(c.initial.participants.find(p => p.participantId === a.initial.selfId), response.participant);
  assert.deepEqual(c.initial.participants.find(p => p.participantId === b.initial.selfId), eventA.participant);
});

test('runtime validation rejects malformed requests and ID forgery without changing state', { timeout: 15000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const b = await connect(app.url);
  const invalid = [
    ['{', 'INVALID_JSON'],
    [null, 'INVALID_MESSAGE'],
    [[], 'INVALID_MESSAGE'],
    [{ kind: 'request', type: 'unknown', requestId: 'unknown1' }, 'UNKNOWN_TYPE'],
    [{ kind: 'request', type: 'profile.update', profile: { nickname: 'ok', avatarId: 'cat' } }, 'INVALID_MESSAGE'],
    [{ kind: 'request', type: 'profile.update', requestId: 'missing-profile' }, 'INVALID_MESSAGE'],
    [update('empty', ''), 'INVALID_PROFILE'],
    [update('spaces', '   '), 'INVALID_PROFILE'],
    [update('long', '가'.repeat(21)), 'INVALID_PROFILE'],
    [update('control', 'bad\nname'), 'INVALID_PROFILE'],
    [update('avatar', 'ok', 'external-url'), 'INVALID_PROFILE'],
    [{ ...update('forge'), participantId: b.initial.selfId }, 'INVALID_MESSAGE'],
    [{ ...update('nested-forge'), profile: { ...update('x').profile, participantId: b.initial.selfId } }, 'INVALID_PROFILE'],
  ];
  for (const [value, code] of invalid) {
    a.socket.send(typeof value === 'string' ? value : JSON.stringify(value));
    const error = await a.next(m => m.kind === 'response');
    assert.equal(error.ok, false);
    assert.equal(error.code, code);
    if (value && typeof value === 'object' && value.requestId) assert.equal(error.requestId, value.requestId);
  }
  a.socket.send(Buffer.from('binary'));
  assert.equal((await a.next(m => m.kind === 'response')).code, 'INVALID_MESSAGE');
  const c = await connect(app.url);
  assert.deepEqual(c.initial.participants.filter(p => p.participantId !== c.initial.selfId), b.initial.participants);
  a.socket.send(JSON.stringify(update('still-alive', '정상', 'cat')));
  assert.equal((await a.next(m => m.kind === 'response')).ok, true);
  assert.equal((await fetch(app.http + '/health')).status, 200);
});

test('abrupt disconnect and absent pong remove sessions', { timeout: 10000 }, async t => {
  const app = await setup(t, { heartbeatIntervalMs: 60 });
  const a = await connect(app.url);
  const abrupt = await connect(app.url);
  abrupt.socket.terminate();
  assert.equal((await a.next(m => m.type === 'participant.left')).participantId, abrupt.initial.selfId);
  const silent = await connect(app.url, { autoPong: false });
  assert.equal((await a.next(m => m.type === 'participant.left' && m.participantId === silent.initial.selfId)).participantId, silent.initial.selfId);
  const c = await connect(app.url);
  assert.equal(c.initial.participants.length, 2);
  assert.ok(!c.initial.participants.some(p => p.participantId === silent.initial.selfId));
});

test('oversized payload closes only the offending socket and removes its session', { timeout: 10000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const b = await connect(app.url);
  const closed = once(b.socket, 'close');
  b.socket.send('x'.repeat(4097));
  const [code] = await closed;
  assert.equal(code, 1009);
  await a.next(m => m.type === 'participant.left');
  assert.equal((await fetch(app.http + '/health')).status, 200);
});

test('shutdown closes active sockets and HTTP listener', { timeout: 10000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const closed = once(a.socket, 'close');
  await app.close();
  await closed;
  assert.equal(app.server.listening, false);
  await app.close();
});

test('occupied HTTP port reports startup error without an unhandled ws error', { timeout: 10000 }, async t => {
  const first = await setup(t);
  const { createApplication } = await import('../server/dist/application.js');
  const second = createApplication();
  t.after(() => second.close());
  const failed = once(second.server, 'error');
  second.server.listen(first.server.address().port, '127.0.0.1');
  const [error] = await failed;
  assert.equal(error.code, 'EADDRINUSE');
  await second.close();
  assert.equal((await fetch(first.http + '/health')).status, 200);
});
