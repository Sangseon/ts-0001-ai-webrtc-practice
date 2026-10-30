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

let requestSequence = 0;
async function roomRequest(client, type, payload) {
  const requestId = 'room-test-' + ++requestSequence;
  client.socket.send(JSON.stringify({ kind: 'request', type, requestId, ...payload }));
  return client.next(m => m.kind === 'response' && m.requestId === requestId);
}
async function roomList(client, check) {
  return (await client.next(m => m.type === 'rooms.changed' && check(m.rooms))).rooms;
}

test('rooms: create auto-joins, initial summaries, scoped events, M:N membership and shared profiles', { timeout: 15000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const b = await connect(app.url);
  const c = await connect(app.url);
  const order = [];
  a.socket.on('message', data => order.push(JSON.parse(data).type));
  const first = await roomRequest(a, 'room.create', { name: '  방 1  ' });
  assert.equal(first.ok, true);
  assert.equal(first.room.name, '방 1');
  assert.deepEqual(first.room.participants.map(p => p.participantId), [a.initial.selfId]);
  await roomList(a, rooms => rooms.length === 1);
  assert.deepEqual(order.filter(type => type.startsWith('room')).slice(0, 3), ['room.create', 'room.state', 'rooms.changed']);
  await roomList(c, rooms => rooms.length === 1);
  assert.ok(!c.queue.some(m => m.type === 'room.state'));
  const r1 = first.room.roomId;
  const second = await roomRequest(a, 'room.create', { name: '방 2' });
  const r2 = second.room.roomId;
  assert.notEqual(r1, r2);
  assert.equal((await roomRequest(b, 'room.join', { roomId: r1 })).room.participants.length, 2);
  assert.equal((await roomRequest(c, 'room.join', { roomId: r2 })).room.participants.length, 2);
  await a.next(m => m.type === 'room.state' && m.roomId === r1 && m.participants.length === 2);
  await a.next(m => m.type === 'room.state' && m.roomId === r2 && m.participants.length === 2);
  const latest = await roomList(a, rooms => rooms.length === 2 && rooms.every(room => room.participantCount === 2));
  assert.equal(latest.length, 2);
  assert.ok(!b.queue.some(m => m.type === 'room.state' && m.roomId === r2));
  assert.ok(!c.queue.some(m => m.type === 'room.state' && m.roomId === r1));
  a.socket.send(JSON.stringify(update('multi-profile', '공통 프로필', 'owl')));
  await a.next(m => m.kind === 'response' && m.requestId === 'multi-profile');
  for (const [client, roomId] of [[b, r1], [c, r2]]) {
    const state = await client.next(m => m.type === 'room.state' && m.roomId === roomId && m.participants.some(p => p.nickname === '공통 프로필'));
    assert.equal(state.participants.find(p => p.participantId === a.initial.selfId).avatarId, 'owl');
    assert.equal((await client.next(m => m.type === 'participant.updated')).participant.nickname, '공통 프로필');
  }
  assert.equal((await roomRequest(a, 'room.leave', { roomId: r1 })).ok, true);
  await b.next(m => m.type === 'room.state' && m.roomId === r1 && m.participants.length === 1);
  const lists = await roomList(c, rooms => rooms.find(room => room.roomId === r1)?.participantCount === 1 && rooms.find(room => room.roomId === r2)?.participantCount === 2);
  assert.equal(lists.length, 2);
  assert.equal((await roomRequest(a, 'room.join', { roomId: r2 })).code, 'ALREADY_JOINED');
  const d = await connect(app.url);
  const initialRooms = await roomList(d, rooms => rooms.length === 2);
  assert.deepEqual(initialRooms, lists);
  assert.ok(!d.queue.some(m => m.type === 'room.state'));
  assert.equal((await roomRequest(b, 'room.leave', { roomId: r1 })).ok, true);
  await roomList(d, rooms => rooms.length === 1 && rooms[0].roomId === r2);
});

test('room validation and membership errors never mutate state or impersonate another participant', { timeout: 15000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const b = await connect(app.url);
  const room = (await roomRequest(a, 'room.create', { name: 'valid' })).room;
  for (const name of ['', '   ', 'x'.repeat(41), 'bad\nname', 12, null]) {
    assert.equal((await roomRequest(a, 'room.create', { name })).code, 'INVALID_ROOM_NAME');
  }
  for (const [type, payload, code] of [
    ['room.create', {}, 'INVALID_MESSAGE'],
    ['room.create', { name: 'forged', participantId: b.initial.selfId }, 'INVALID_MESSAGE'],
    ['room.join', {}, 'INVALID_MESSAGE'],
    ['room.join', { roomId: 'missing' }, 'ROOM_NOT_FOUND'],
    ['room.leave', { roomId: 'missing' }, 'ROOM_NOT_FOUND'],
    ['room.join', { roomId: room.roomId, participantId: a.initial.selfId }, 'INVALID_MESSAGE'],
    ['room.leave', { roomId: room.roomId, participantId: a.initial.selfId }, 'INVALID_MESSAGE'],
    ['room.join', { roomId: { participantId: a.initial.selfId } }, 'INVALID_MESSAGE'],
    ['room.leave', { roomId: room.roomId }, 'NOT_JOINED'],
  ]) assert.equal((await roomRequest(b, type, payload)).code, code);
  assert.equal((await roomRequest(a, 'room.join', { roomId: room.roomId })).code, 'ALREADY_JOINED');
  const c = await connect(app.url);
  const snapshot = await roomList(c, rooms => rooms.length === 1);
  assert.equal(snapshot[0].participantCount, 1);
  assert.equal((await roomRequest(b, 'room.join', { roomId: room.roomId })).room.participants.length, 2);
  assert.equal((await roomRequest(b, 'room.leave', { roomId: room.roomId })).ok, true);
  assert.equal((await roomRequest(b, 'room.leave', { roomId: room.roomId })).code, 'NOT_JOINED');
  assert.equal((await roomRequest(a, 'room.create', { name: '😀'.repeat(40) })).ok, true);
});

test('rapid ordered join/leave requests have matched responses and consistent member snapshots', { timeout: 15000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  const b = await connect(app.url);
  const { roomId } = (await roomRequest(a, 'room.create', { name: 'rapid' })).room;
  await a.next(m => m.type === 'room.state');
  for (let cycle = 0; cycle < 10; cycle++) {
    b.socket.send(JSON.stringify({ kind: 'request', type: 'room.join', requestId: 'join-' + cycle, roomId }));
    b.socket.send(JSON.stringify({ kind: 'request', type: 'room.leave', requestId: 'leave-' + cycle, roomId }));
  }
  for (let cycle = 0; cycle < 10; cycle++) {
    assert.equal((await b.next(m => m.kind === 'response' && m.requestId === 'join-' + cycle)).ok, true);
    assert.equal((await b.next(m => m.kind === 'response' && m.requestId === 'leave-' + cycle)).ok, true);
    assert.equal((await a.next(m => m.type === 'room.state')).participants.length, 2);
    assert.equal((await a.next(m => m.type === 'room.state')).participants.length, 1);
  }
  const c = await connect(app.url);
  assert.equal((await roomList(c, rooms => rooms.length === 1))[0].participantCount, 1);
});

for (const mode of ['normal', 'terminate', 'heartbeat']) {
  test(`all memberships cleaned on ${mode}; empty rooms deleted, occupied rooms and new sessions preserved`, { timeout: 15000 }, async t => {
    const app = await setup(t, { heartbeatIntervalMs: 250 });
    const a = await connect(app.url, { autoPong: mode !== 'heartbeat' });
    const b = await connect(app.url);
    const r1 = (await roomRequest(a, 'room.create', { name: 'shared' })).room.roomId;
    const r2 = (await roomRequest(a, 'room.create', { name: 'solo' })).room.roomId;
    assert.equal((await roomRequest(b, 'room.join', { roomId: r1 })).ok, true);
    const closed = once(a.socket, 'close');
    if (mode === 'normal') a.socket.close();
    if (mode === 'terminate') a.socket.terminate();
    await closed;
    await b.next(m => m.type === 'room.state' && m.roomId === r1 && m.participants.length === 1);
    await roomList(b, rooms => rooms.length === 1 && rooms[0].participantCount === 1);
    const reconnected = await connect(app.url);
    assert.notEqual(reconnected.initial.selfId, a.initial.selfId);
    const list = await roomList(reconnected, rooms => rooms.length === 1);
    assert.equal(list[0].roomId, r1);
    assert.ok(!list.some(room => room.roomId === r2));
    assert.equal((await roomRequest(reconnected, 'room.leave', { roomId: r1 })).code, 'NOT_JOINED');
    assert.equal((await roomRequest(b, 'room.leave', { roomId: r1 })).ok, true);
    await roomList(reconnected, rooms => rooms.length === 0);
  });
}

test('server shutdown and a fresh application do not retain rooms or memberships', { timeout: 10000 }, async t => {
  const app = await setup(t);
  const a = await connect(app.url);
  await roomRequest(a, 'room.create', { name: 'temporary' });
  const closed = once(a.socket, 'close');
  await app.close();
  await closed;
  assert.equal(app.server.listening, false);
  const fresh = await setup(t);
  const b = await connect(fresh.url);
  assert.equal((await roomList(b, rooms => rooms.length === 0)).length, 0);
});
