const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ chrome: a, edge: b, until, click, selectMedia, waitState, ended }) => {
  const setInput = (page, id, value) => page.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const submit = async (page, id) => {
    await page.evaluate(`document.getElementById(${JSON.stringify(id)}).form.requestSubmit()`);
    await until(() => page.evaluate("document.querySelector('[role=status]')?.textContent.length>0 && !document.getElementById('nickname').disabled"), 'request response');
  };
  const select = (page, id, value) => page.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const sfu = page => page.evaluate("({phase:document.querySelector('[data-testid=sfu-state]').dataset.phase,room:document.querySelector('[data-testid=sfu-state]').dataset.roomId,transport:document.querySelector('[data-testid=sfu-state]').dataset.transportId,media:document.querySelector('[data-testid=sfu-state]').dataset.mediaId})");
  const sending = async page => until(async () => {
    const value = await sfu(page);
    if (value.phase === 'error') throw Error(await page.evaluate('document.body.innerText'));
    return value.phase === 'sending';
  }, 'SFU sending');
  const stats = page => page.evaluate("JSON.parse(document.querySelector('[data-testid=sfu-stats]').textContent)");
  async function installRPC(page) {
    await page.evaluate(`window.rawMediaRPC=(action,roomId,mediaId,payload={})=>new Promise((resolve,reject)=>{
      const socket=mediaProbe.socket,requestId=crypto.randomUUID();
      const timer=setTimeout(()=>{socket.removeEventListener('message',handler);reject(Error('test RPC timeout'));},5000);
      const handler=event=>{const message=JSON.parse(event.data);if(message.kind==='response'&&message.requestId===requestId){clearTimeout(timer);socket.removeEventListener('message',handler);resolve(message);}};
      socket.addEventListener('message',handler);socket.send(JSON.stringify({kind:'request',type:'media.request',requestId,action,roomId,mediaId,payload}));
    })`);
  }
  const raw = (page, action, roomId, mediaId, payload = {}) => page.evaluate(`rawMediaRPC(${JSON.stringify(action)},${JSON.stringify(roomId)},${JSON.stringify(mediaId)},${JSON.stringify(payload)})`);
  async function growth(page, kinds) {
    await until(async () => {
      const v = await stats(page);
      return v.browser?.length === kinds.length && v.server?.producers?.length === kinds.length && kinds.every(k => v.browser.some(p => p.kind === k && p.bytesSent > 0 && p.packetsSent > 0) && v.server.producers.some(p => p.kind === k && p.bytes > 0 && p.packets > 0));
    }, 'real RTP counters');
    const first = await stats(page); await delay(2200); const second = await stats(page);
    assert.equal(second.server.dtlsState, 'connected');
    assert.ok(['connected', 'completed'].includes(second.server.iceState));
    for (const kind of kinds) {
      const x = first.browser.find(p => p.kind === kind), y = second.browser.find(p => p.kind === kind);
      const sx = first.server.producers.find(p => p.kind === kind), sy = second.server.producers.find(p => p.kind === kind);
      assert.ok(y.bytesSent > x.bytesSent && y.packetsSent > x.packetsSent, 'browser ' + kind);
      assert.ok(sy.bytes > sx.bytes && sy.packets > sx.packets, 'SFU ' + kind);
    }
    console.log('RTP ' + JSON.stringify({ kinds, first, second }));
  }
  await until(() => a.evaluate("!!document.getElementById('nickname')"), 'session');
  await installRPC(a); await installRPC(b);
  await setInput(a, 'room-name', '1111'); await submit(a, 'room-name');
  await setInput(a, 'room-name', '2222'); await submit(a, 'room-name');
  const [r1, r2] = await a.evaluate("Array.from(document.querySelectorAll('[data-joined-room-id]')).map(e=>e.dataset.joinedRoomId)");
  assert.ok(r1 && r2);
  assert.equal(await a.evaluate("document.getElementById('sfu-start').disabled"), true);
  await until(() => b.evaluate(`!!document.querySelector('[data-room-id="${r1}"] button')`), 'rooms visible');
  await b.evaluate(`document.querySelector('[data-room-id="${r1}"] button').click()`);
  await until(() => b.evaluate(`!!document.querySelector('[data-joined-room-id="${r1}"]')`), 'B joined');
  for (const page of [a, b]) {
    for (const selection of [{ video: false, audio: true }, { video: true, audio: false }, { video: true, audio: true }]) {
      await selectMedia(page, selection.video, selection.audio);
      await click(page, 'media-start'); await waitState(page, 'ready');
      await select(page, 'sfu-room', r1); await click(page, 'sfu-start'); await sending(page);
      await growth(page, Object.keys(selection).filter(k => selection[k]).map(k => k === 'video' ? 'video' : 'audio'));
      await click(page, 'sfu-stop');
      await until(async () => (await sfu(page)).phase === 'idle', 'stop confirmed');
      assert.equal(await page.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
      await click(page, 'media-stop'); await waitState(page, 'idle'); assert.equal(await ended(page), true);
    }
  }
  await selectMedia(a, true, true); await click(a, 'media-start'); await waitState(a, 'ready');
  const calls = await a.evaluate('mediaProbe.calls');
  await select(a, 'sfu-room', r1); await click(a, 'sfu-start'); await sending(a); await growth(a, ['audio', 'video']);
  const old = await sfu(a);
  await selectMedia(b, false, true); await click(b, 'media-start'); await waitState(b, 'ready');
  await select(b, 'sfu-room', r1); await click(b, 'sfu-start'); await sending(b);
  await growth(b, ['audio']);
  const bs = await sfu(b);
  assert.equal((await raw(a, 'create', r2, 'simultaneous')).ok, false);
  assert.equal((await raw(a, 'stats', r2, old.media)).ok, false);
  assert.equal((await raw(a, 'connect', r1, old.media, { transportId: bs.transport, dtlsParameters: { role: 'client', fingerprints: [{ algorithm: 'sha-256', value: Array(32).fill('AA').join(':') }] } })).ok, false);
  const aProducer = (await stats(a)).server.producers[0].id;
  assert.equal((await raw(b, 'producer.close', r1, bs.media, { transportId: bs.transport, producerId: aProducer })).ok, false);
  assert.equal((await raw(a, 'stats', r1, old.media)).ok, true);
  console.log('PASS real send resources: simultaneous second room, wrong-room Transport and foreign Producer requests rejected');
  await select(a, 'chat-channel', r2);
  await setInput(a, 'chat-body', 'other-room-chat'); await submit(a, 'chat-body');
  await select(a, 'chat-channel', 'global');
  assert.equal((await sfu(a)).room, r1);
  await select(a, 'sfu-room', r2); assert.equal((await sfu(a)).room, r1);
  await click(a, 'sfu-start'); await sending(a); await growth(a, ['audio', 'video']);
  const next = await sfu(a); assert.equal(next.room, r2); assert.notEqual(next.transport, old.transport);
  assert.equal((await raw(a, 'stats', r1, old.media)).ok, false);
  assert.equal((await raw(b, 'stats', r1, bs.media)).ok, true);
  // Explicit switching failure must leave the old media closed and local tracks live.
  await a.evaluate(`mediaProbe.originalSend=mediaProbe.socket.send.bind(mediaProbe.socket);mediaProbe.socket.send=text=>{const r=JSON.parse(text);if(r.type==='media.request'&&r.action==='create')r.roomId='missing';mediaProbe.originalSend(JSON.stringify(r));}`);
  await select(a, 'sfu-room', r1); await click(a, 'sfu-start');
  await until(async () => (await sfu(a)).phase === 'error', 'switch failure');
  assert.equal((await sfu(a)).room, '');
  assert.equal((await raw(a, 'stats', r2, next.media)).ok, false);
  assert.equal(await a.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
  await a.evaluate('mediaProbe.socket.send=mediaProbe.originalSend');
  await select(a, 'sfu-room', r2); await click(a, 'sfu-start'); await sending(a);
  // Hold create until after stop: late create must not resurrect the cancelled attempt.
  await click(a, 'sfu-stop'); await until(async () => (await sfu(a)).phase === 'idle', 'stop before delay');
  await a.evaluate(`mediaProbe.socket.send=text=>{const r=JSON.parse(text);if(r.type==='media.request'&&r.action==='create'){mediaProbe.releaseCreate=()=>mediaProbe.originalSend(text);return;}mediaProbe.originalSend(text);}`);
  await click(a, 'sfu-start');
  await until(() => a.evaluate('!!mediaProbe.releaseCreate'), 'held create');
  const held = await sfu(a);
  await click(a, 'sfu-stop'); await until(async () => (await sfu(a)).phase === 'idle', 'cancel held create');
  await a.evaluate('mediaProbe.socket.send=mediaProbe.originalSend;mediaProbe.releaseCreate()');
  await delay(200);
  assert.equal((await sfu(a)).room, '');
  assert.equal((await raw(a, 'stats', r2, held.media)).ok, false);
  await click(a, 'sfu-start'); await sending(a);
  assert.equal(await a.evaluate('mediaProbe.calls'), calls);
  assert.equal(await a.evaluate("document.querySelectorAll('[data-joined-room-id]').length"), 2);
  // Unrelated room leave must preserve media, active room leave must stop it.
  await a.evaluate(`document.querySelector('[data-room-id="${r1}"] input').click()`);
  await a.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='선택한 방 퇴장').click()");
  await until(() => a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===1"), 'partial leave');
  assert.equal((await sfu(a)).room, r2);
  await click(a, 'media-stop'); await waitState(a, 'idle');
  await until(async () => !(await sfu(a)).room, 'local stop cleans SFU');
  assert.equal(await ended(a), true);
  await click(a, 'media-start'); await waitState(a, 'ready');
  await click(a, 'sfu-start'); await sending(a);
  await a.evaluate(`document.querySelector('[data-room-id="${r2}"] input').click()`);
  await a.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='선택한 방 퇴장').click()");
  await until(async () => !(await sfu(a)).room, 'active leave');
  assert.equal(await a.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
  await click(a, 'media-stop');
  // Connection loss ends SFU send while retaining the Step 06 local source.
  await b.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='연결 종료').click()");
  await until(async () => !(await sfu(b)).room, 'disconnect cleans send');
  assert.equal(await b.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
  await click(b, 'media-stop');
  await setInput(a, 'room-name', 'failure-recovery'); await submit(a, 'room-name');
  const recoveryRoom = await a.evaluate("document.querySelector('[data-joined-room-id]').dataset.joinedRoomId");
  await click(a, 'media-start'); await waitState(a, 'ready'); await select(a, 'sfu-room', recoveryRoom);
  await a.evaluate(`mediaProbe.socket.send=text=>{const r=JSON.parse(text);if(r.type==='media.request'&&r.action==='connect')r.payload.dtlsParameters.fingerprints=[{algorithm:'sha-256',value:Array(32).fill('BB').join(':')}];mediaProbe.originalSend(JSON.stringify(r));}`);
  await click(a, 'sfu-start');
  await until(async () => {
    const value = await sfu(a);
    return !value.room && ['error', 'idle'].includes(value.phase);
  }, 'actual DTLS failure cleanup');
  assert.equal(await a.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
  await a.evaluate('mediaProbe.socket.send=mediaProbe.originalSend');
  await click(a, 'sfu-start'); await sending(a);
  await setInput(a, 'room-name', 'close-failure-target'); await submit(a, 'room-name');
  const switchTarget = await a.evaluate(`Array.from(document.querySelectorAll('[data-joined-room-id]')).map(e=>e.dataset.joinedRoomId).find(id=>id!==${JSON.stringify(recoveryRoom)})`);
  await select(a, 'sfu-room', switchTarget);
  await a.evaluate(`mediaProbe.socket.send=text=>{const r=JSON.parse(text);if(r.type==='media.request'&&r.action==='close')r.roomId='missing';mediaProbe.originalSend(JSON.stringify(r));}`);
  await click(a, 'sfu-start');
  await until(() => a.evaluate("document.querySelector('[data-testid=connection-status]').textContent==='연결 종료'"), 'close failure closes session');
  await until(async () => !(await sfu(a)).room, 'no new send after close failure');
  assert.equal(await a.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
  await a.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='다시 연결').click()");
  await until(() => a.evaluate("document.querySelector('[data-testid=connection-status]').textContent==='연결됨'"), 'new session after close failure');
  await a.evaluate('mediaProbe.originalSend=mediaProbe.socket.send.bind(mediaProbe.socket)');
  await setInput(a, 'room-name', 'timeout-target'); await submit(a, 'room-name');
  const timeoutRoom = await a.evaluate("document.querySelector('[data-joined-room-id]').dataset.joinedRoomId");
  await select(a, 'sfu-room', timeoutRoom);
  await a.evaluate(`mediaProbe.socket.send=text=>{const r=JSON.parse(text);if(r.type==='media.request'&&r.action==='capabilities')return;mediaProbe.originalSend(text);}`);
  await click(a, 'sfu-start');
  await until(() => a.evaluate("document.querySelector('[data-testid=connection-status]').textContent==='연결 종료'"), 'signaling timeout closes socket');
  await until(async () => !(await sfu(a)).room, 'timeout cleans send');
  assert.equal(await a.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
  await click(a, 'media-stop');
  console.log('PASS wrong DTLS fingerprint cleanup/retry, failed close blocks switch and closes session, dropped Signaling request timeout; local source retained');
  console.log('PASS Chrome+Edge actual ICE/DTLS+RTP audio/video/both; explicit switch with live track reuse; chat selection independence; partial/active leave and local stop cleanup');
};
