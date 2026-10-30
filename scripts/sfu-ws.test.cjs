const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { WebSocket } = require('ws');
let sequence = 0;
async function setup(t, options) {
  const { createApplication } = await import('../server/dist/application.js');
  const app = createApplication(options);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const clients = new Set();
  t.after(async () => {
    await app.close();
    await Promise.all([...clients].map(async socket => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = once(socket, 'close'); socket.terminate(); await closed;
    }));
    assert.equal(app.server.listening, false);
  });
  return { ...app, clients, url: `ws://127.0.0.1:${app.server.address().port}/ws` };
}
async function client(app, options) {
  const socket = new WebSocket(app.url, options);
  app.clients.add(socket);
  const queue = [], waiters = [];
  socket.on('error', () => {});
  socket.on('message', raw => { queue.push(JSON.parse(raw)); for (const wake of waiters.splice(0)) wake(); });
  await once(socket, 'open');
  async function next(predicate) {
    const timeout = AbortSignal.timeout(5000);
    while (true) {
      const i = queue.findIndex(predicate); if (i >= 0) return queue.splice(i, 1)[0];
      await new Promise((resolve, reject) => {
        if (timeout.aborted) { reject(Error('message timeout')); return; }
        const aborted = () => reject(Error('message timeout'));
        timeout.addEventListener('abort', aborted, { once: true });
        waiters.push(() => { timeout.removeEventListener('abort', aborted); resolve(); });
      });
    }
  }
  const initial = await next(m => m.type === 'session.ready');
  function request(type, payload) {
    const requestId = 'sfu-' + ++sequence;
    socket.send(JSON.stringify({ kind: 'request', type, requestId, ...payload }));
    return next(m => m.kind === 'response' && m.requestId === requestId);
  }
  return { socket, next, queue, initial, request, media: (action, roomId, mediaId, payload = {}) => request('media.request', { action, roomId, mediaId, payload }) };
}
const room = async (c, name) => (await c.request('room.create', { name })).room.roomId;
const dtlsParameters = { role: 'client', fingerprints: [{ algorithm: 'sha-256', value: Array(32).fill('AA').join(':') }] };
const rtpParameters = { codecs: [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2, parameters: {} }], encodings: [{ ssrc: 12345 }], rtcp: { cname: 'test' } };

test('Receive-only slot, paused Consumer handshake, scoped discovery and ownership', { timeout: 20000 }, async t => {
  const app = await setup(t), a = await client(app), b = await client(app), c = await client(app);
  const r1 = await room(a, 'receive-one'), r2 = await room(c, 'receive-two');
  await b.request('room.join', { roomId: r1 }); await b.request('room.join', { roomId: r2 });
  const at = await a.media('create', r1, 'send');
  await a.media('connect', r1, 'send', { transportId: at.data.id, dtlsParameters });
  const bt = await b.media('receive', r1, 'receive'); assert.equal(bt.ok, true);
  const ct = await c.media('receive', r2, 'other'); assert.equal(ct.ok, true);
  assert.equal((await b.media('create', r2, 'second')).ok, false);
  assert.equal((await b.media('receive', r1, 'receive')).ok, false);
  const p = await a.media('produce', r1, 'send', { transportId: at.data.id, kind: 'audio', rtpParameters });
  const event = await b.next(m => m.type === 'media.producer.added');
  assert.equal(event.mediaId, 'receive'); assert.equal(event.producer.producerId, p.data.producerId);
  assert.deepEqual((await b.media('producers', r1, 'receive')).data.producers, [event.producer]);
  assert.deepEqual((await a.media('producers', r1, 'send')).data.producers, []);
  assert.deepEqual((await c.media('producers', r2, 'other')).data.producers, []);
  assert.equal(c.queue.some(m => m.type === 'media.producer.added'), false);
  const caps = (await b.media('capabilities', r1, 'receive')).data.capabilities;
  const payload = { transportId: bt.data.id, producerId: p.data.producerId, rtpCapabilities: caps };
  assert.equal((await b.media('consume', r2, 'receive', payload)).ok, false);
  assert.equal((await c.media('consume', r2, 'other', { ...payload, transportId: ct.data.id })).ok, false);
  assert.equal((await b.media('consume', r1, 'receive', { ...payload, transportId: ct.data.id })).ok, false);
  assert.equal((await b.media('recv.connect', r1, 'receive', { transportId: ct.data.id, dtlsParameters })).ok, false);
  assert.equal((await b.media('consume', r1, 'receive', { ...payload, rtpCapabilities: { codecs: [] } })).ok, false);
  assert.equal((await b.media('consume', r1, 'receive', { ...payload, rtpCapabilities: { codecs: [{ mimeType: 'video/VP8', clockRate: 90000, preferredPayloadType: 96 }] } })).ok, false);
  const consumer = await b.media('consume', r1, 'receive', payload); assert.equal(consumer.ok, true);
  assert.equal((await b.media('stats', r1, 'receive')).data.consumers[0].paused, true);
  assert.equal((await b.media('consume', r1, 'receive', payload)).ok, false);
  assert.equal((await c.media('consumer.resume', r2, 'other', { consumerId: consumer.data.id })).ok, false);
  assert.equal((await c.media('consumer.close', r2, 'other', { consumerId: consumer.data.id })).ok, false);
  assert.equal((await b.media('consumer.resume', r1, 'receive', { consumerId: consumer.data.id })).ok, true);
  assert.equal((await b.media('stats', r1, 'receive')).data.consumers[0].paused, false);
  await a.media('close', r1, 'send');
  await b.next(m => m.type === 'media.consumer.closed' && m.consumerId === consumer.data.id);
  await b.next(m => m.type === 'media.producer.removed' && m.producer.producerId === p.data.producerId);
  assert.equal((await b.media('stats', r1, 'receive')).data.consumers.length, 0);
  assert.equal((await b.media('consume', r1, 'receive', payload)).ok, false);
  assert.equal((await b.media('recv.close', r1, 'receive')).ok, true);
  assert.equal((await b.media('close', r1, 'receive')).ok, true);
  assert.equal((await b.media('receive', r2, 'fresh')).ok, true);
});

test('Receive cleanup preserves sender; in-flight consume cancellation cannot resurrect consumers', { timeout: 20000 }, async t => {
  const app = await setup(t), a = await client(app), b = await client(app);
  const r = await room(a, 'send-receive-separation'); await b.request('room.join', { roomId: r });
  const at = await a.media('create', r, 'a'), bt = await b.media('create', r, 'b');
  for (const [c, mid, transport] of [[a, 'a', at], [b, 'b', bt]]) {
    await c.media('connect', r, mid, { transportId: transport.data.id, dtlsParameters });
    assert.equal((await c.media('produce', r, mid, { transportId: transport.data.id, kind: 'audio', rtpParameters })).ok, true);
  }
  const recv = await b.media('receive', r, 'b');
  const producerId = (await b.media('producers', r, 'b')).data.producers[0].producerId;
  const rtpCapabilities = (await b.media('capabilities', r, 'b')).data.capabilities;
  const payload = { transportId: recv.data.id, producerId, rtpCapabilities };
  const consumer = await b.media('consume', r, 'b', payload); assert.equal(consumer.ok, true);
  await b.media('consumer.close', r, 'b', { consumerId: consumer.data.id });
  assert.equal((await b.media('stats', r, 'b')).data.producers.length, 1);
  assert.equal((await b.media('stats', r, 'b')).data.consumers.length, 0);
  await b.media('recv.close', r, 'b');
  assert.equal((await b.media('stats', r, 'b')).data.producers.length, 1);
  const replacement = await b.media('receive', r, 'b');
  const consuming = b.media('consume', r, 'b', { ...payload, transportId: replacement.data.id });
  const closing = b.media('close', r, 'b');
  assert.equal((await consuming).ok, false); assert.equal((await closing).ok, true);
  assert.equal((await b.media('consumer.resume', r, 'b', { consumerId: consumer.data.id })).ok, false);
  assert.equal((await a.media('stats', r, 'a')).data.producers.length, 1);
  assert.equal((await b.media('receive', r, 'new-b')).ok, true);
});

test('Receive cancellation, room leave and heartbeat retire every receive resource', { timeout: 20000 }, async t => {
  const app = await setup(t, { heartbeatIntervalMs: 100 }), a = await client(app), b = await client(app, { autoPong: false });
  const r = await room(a, 'receive-cleanup'); await b.request('room.join', { roomId: r });
  const creating = a.media('receive', r, 'cancel');
  const closing = a.media('close', r, 'cancel');
  assert.equal((await closing).ok, true); assert.equal((await creating).ok, false);
  assert.equal((await a.media('receive', r, 'cancel')).ok, false);
  await a.media('receive', r, 'leave'); await b.media('receive', r, 'heartbeat');
  await a.request('room.leave', { roomId: r });
  assert.equal((await a.media('producers', r, 'leave')).ok, false);
  await b.next(m => m.type === 'media.closed');
  assert.equal(app.server.listening, true);
});

test('SFU signaling validates membership, ownership and one slot including concurrent creation', { timeout: 20000 }, async t => {
  const app = await setup(t), a = await client(app), b = await client(app);
  const r1 = await room(a, '1111'), r2 = await room(a, '2222');
  assert.equal((await b.media('capabilities', r1, 'b')).ok, false);
  assert.equal((await a.media('create', 'missing', 'a')).ok, false);
  const caps1 = await a.media('capabilities', r1, 'cap');
  assert.equal((await a.media('capabilities', r1, 'cap2')).data.routerId, caps1.data.routerId);
  assert.notEqual((await a.media('capabilities', r2, 'cap3')).data.routerId, caps1.data.routerId);
  const [first, second] = await Promise.all([a.media('create', r1, 'a1'), a.media('create', r2, 'a2')]);
  assert.equal(first.ok, true); assert.equal(second.ok, false);
  assert.equal((await a.media('stats', r2, 'a1')).ok, false);
  assert.equal((await a.request('media.request', { action: 'create', roomId: r1, mediaId: 'forged', payload: {}, participantId: b.initial.selfId })).ok, false);
  assert.equal((await a.media('connect', r1, 'a1', { transportId: first.data.id, dtlsParameters: {} })).code, 'INVALID_MESSAGE');
  assert.equal((await a.media('connect', r1, 'a1', { transportId: first.data.id, dtlsParameters })).ok, true);
  const producer = await a.media('produce', r1, 'a1', { transportId: first.data.id, kind: 'audio', rtpParameters });
  assert.equal(producer.ok, true);
  await b.request('room.join', { roomId: r1 });
  const bt = await b.media('create', r1, 'b1');
  assert.equal((await b.media('connect', r1, 'b1', { transportId: first.data.id, dtlsParameters })).ok, false);
  assert.equal((await b.media('producer.close', r1, 'b1', { transportId: bt.data.id, producerId: producer.data.producerId })).ok, false);
  assert.equal((await a.media('stats', r1, 'a1')).data.producers.length, 1);
  assert.equal((await a.media('close', r1, 'a1')).ok, true);
  assert.equal((await a.media('close', r1, 'a1')).ok, true);
  assert.equal((await a.media('create', r1, 'a1')).ok, false);
  assert.equal((await a.media('create', r2, 'a3')).ok, true);
  await a.media('close', r1, 'a1'); // stale close cannot stop a3
  assert.equal((await a.media('stats', r2, 'a3')).ok, true);
  assert.equal((await b.media('stats', r1, 'b1')).ok, true);
});

test('SFU cancellation drains in-flight work and late requests cannot resurrect retired attempts', { timeout: 20000 }, async t => {
  const app = await setup(t), a = await client(app);
  const r1 = await room(a, 'one'), r2 = await room(a, 'two');
  const creating = a.media('create', r1, 'cancelled');
  const closing = a.media('close', r1, 'cancelled');
  assert.equal((await closing).ok, true);
  assert.equal((await creating).ok, false);
  assert.equal((await a.media('create', r1, 'cancelled')).ok, false);
  const newTransport = await a.media('create', r2, 'fresh'); assert.equal(newTransport.ok, true);
  await a.media('close', r1, 'cancelled');
  assert.equal((await a.media('stats', r2, 'fresh')).ok, true);
  await app.close(); // Fixture separately releases test-owned client handles and awaits their close.
  assert.equal(app.server.listening, false);
});

for (const mode of ['normal', 'terminate', 'heartbeat']) test(`SFU ${mode} cleanup preserves another participant and unrelated rooms`, { timeout: 20000 }, async t => {
  const app = await setup(t, { heartbeatIntervalMs: 700 }), a = await client(app, { autoPong: mode !== 'heartbeat' }), b = await client(app);
  const r1 = await room(a, 'active'), r2 = await room(a, 'other');
  await b.request('room.join', { roomId: r1 });
  await a.media('create', r1, 'a');
  await b.media('create', r1, 'b');
  if (mode !== 'heartbeat') {
    await a.request('room.leave', { roomId: r2 });
    assert.equal((await a.media('stats', r1, 'a')).ok, true);
  }
  const closed = once(a.socket, 'close');
  if (mode === 'normal') a.socket.close(); if (mode === 'terminate') a.socket.terminate();
  await closed;
  await b.next(m => m.type === 'participant.left' && m.participantId === a.initial.selfId);
  assert.equal((await b.media('stats', r1, 'b')).ok, true);
  await b.request('room.leave', { roomId: r1 });
  assert.equal((await b.media('stats', r1, 'b')).ok, false);
});

test('malformed RTP cannot corrupt another slot; worker death clears media without dropping chat', { timeout: 20000 }, async t => {
  const app = await setup(t), a = await client(app), b = await client(app);
  const r1 = await room(a, 'room'); await b.request('room.join', { roomId: r1 });
  const { observer } = require('mediasoup'); const created = once(observer, 'newworker');
  const at = await a.media('create', r1, 'a'); const [worker] = await created;
  const bt = await b.media('create', r1, 'b');
  await a.media('connect', r1, 'a', { transportId: at.data.id, dtlsParameters });
  assert.equal((await a.media('produce', r1, 'a', { transportId: at.data.id, kind: 'audio', rtpParameters: { ...rtpParameters, codecs: [{ ...rtpParameters.codecs[0], clockRate: 16000 }] } })).ok, false);
  assert.equal((await b.media('stats', r1, 'b')).ok, true);
  process.kill(worker.pid, 'SIGKILL');
  await b.next(m => m.type === 'media.closed' && m.mediaId === 'b');
  assert.equal((await b.media('stats', r1, 'b')).ok, false);
  assert.equal((await b.request('chat.send', { scope: 'global', body: 'chat remains' })).ok, true);
  assert.ok(bt.data.id);
});

test('retired-attempt quota never blocks cleanup of an existing slot', { timeout: 20000 }, async t => {
  const app = await setup(t), a = await client(app);
  const r1 = await room(a, 'active'), r2 = await room(a, 'other');
  assert.equal((await a.media('create', r1, 'active')).ok, true);
  for (let i = 0; i < 128; i++) assert.equal((await a.media('close', r1, 'retired-' + i)).ok, true);
  assert.equal((await a.request('room.leave', { roomId: r1 })).ok, true);
  await a.next(m => m.type === 'media.closed' && m.mediaId === 'active');
  assert.equal((await a.media('create', r2, 'over-quota')).ok, false);
  assert.equal((await a.request('chat.send', { scope: 'room', roomId: r2, body: 'still alive' })).ok, true);
});
