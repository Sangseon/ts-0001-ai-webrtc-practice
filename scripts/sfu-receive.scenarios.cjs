const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ chrome: a, edge: b, until, click, selectMedia, waitState, ended, killSfu }) => {
  const input = (p, id, value) => p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const select = (p, id, value) => p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const submit = (p, id) => p.evaluate(`document.getElementById(${JSON.stringify(id)}).form.requestSubmit()`);
  const state = p => p.evaluate("({...document.querySelector('[data-testid=sfu-state]').dataset})");
  const stats = p => p.evaluate("JSON.parse(document.querySelector('[data-testid=sfu-stats]').textContent)");
  const idle = p => until(async () => (await state(p)).phase === 'idle', 'closed SFU');
  async function start(p, roomId, receiveOnly = false) {
    await select(p, 'sfu-room', roomId); await click(p, receiveOnly ? 'sfu-receive' : 'sfu-start');
    await until(async () => { const s = await state(p); if (s.phase === 'error') throw Error(await p.evaluate('document.body.innerText')); return s.phase === (receiveOnly ? 'receiving' : 'sending') && s.roomId === roomId; }, 'active SFU');
  }
  const tracks = p => p.evaluate("Array.from(document.querySelectorAll('[data-remote-kind]')).map(e=>e.dataset.remoteKind).sort()");
  async function playRemote(p) {
    const count = await p.evaluate("document.querySelectorAll('[data-remote-kind] button').length");
    for (let i = 0; i < count; i++) {
      const point = await p.evaluate(`(()=>{const e=document.querySelectorAll('[data-remote-kind] button')[${i}];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await p.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await p.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
  }
  async function receive(p, kinds) {
    await until(async () => {
      const s = await stats(p);
      return s.received?.length === kinds.length && s.server?.consumers?.length === kinds.length && kinds.every(kind => s.received.some(c => c.kind === kind && c.packetsReceived > 0 && c.bytesReceived > 0) && s.server.consumers.some(c => c.kind === kind && c.packets > 0 && c.bytes > 0 && !c.paused));
    }, 'browser+SFU receive RTP');
    assert.deepEqual(await tracks(p), [...kinds].sort());
    assert.equal(await p.evaluate("document.querySelectorAll('[data-remote-participant]').length"), 1);
    if (await p.evaluate("Array.from(document.querySelectorAll('[data-playback-state]')).some(e=>e.textContent==='재생 대기')")) await playRemote(p);
    await until(() => p.evaluate("Array.from(document.querySelectorAll('[data-remote-kind] video')).every(v=>v.videoWidth>0 && !v.paused && v.getVideoPlaybackQuality().totalVideoFrames>0)"), 'remote video frames');
    const first = await stats(p); await delay(2200); const second = await stats(p);
    assert.equal(second.server.recvDtlsState, 'connected'); assert.ok(['connected', 'completed'].includes(second.server.recvIceState));
    for (const kind of kinds) {
      const x = first.received.find(c => c.kind === kind), y = second.received.find(c => c.kind === kind);
      const sx = first.server.consumers.find(c => c.kind === kind), sy = second.server.consumers.find(c => c.kind === kind);
      assert.ok(y.packetsReceived > x.packetsReceived && y.bytesReceived > x.bytesReceived, 'browser ' + kind);
      assert.ok(sy.packets > sx.packets && sy.bytes > sx.bytes, 'SFU ' + kind);
      if (kind === 'video') assert.ok(y.framesDecoded > x.framesDecoded);
    }
    console.log('RECEIVE_RTP ' + JSON.stringify({ first, second }));
    // Playback pipeline progress is not evidence of audible sound at a physical speaker.
    if (kinds.includes('audio')) {
      const audio = await p.evaluate("(()=>{const e=document.querySelector('[data-remote-kind=audio] audio');return {paused:e.paused,muted:e.muted,time:e.currentTime,tracks:e.srcObject.getAudioTracks().length};})()");
      console.log('AUDIO_PIPELINE ' + JSON.stringify(audio));
      assert.equal(audio.muted, false); assert.equal(audio.tracks, 1); assert.equal(audio.paused, false); assert.ok(audio.time > 0);
    }
  }
  async function stop(p) {
    await p.evaluate("window.savedRemote=Array.from(document.querySelectorAll('[data-remote-kind] video,[data-remote-kind] audio')).map(e=>({e,stream:e.srcObject}));void 0");
    await click(p, 'sfu-stop'); await idle(p);
    assert.equal(await p.evaluate("savedRemote.every(({e,stream})=>e.srcObject===null && stream.getTracks().every(t=>t.readyState==='ended'))"), true);
    assert.deepEqual(await tracks(p), []);
  }
  async function chat(p, roomId, body) {
    await select(p, 'chat-channel', roomId ? 'room:' + roomId : 'global'); await input(p, 'chat-body', body); await submit(p, 'chat-body');
    await until(() => p.evaluate(`document.querySelector('[data-testid=chat-messages]').textContent.includes(${JSON.stringify(body)})`), 'chat');
  }
  for (const p of [a, b]) {
    await until(() => p.evaluate("!!document.getElementById('nickname') && !document.getElementById('nickname').disabled"), 'session');
    await p.evaluate(`window.rawMediaRPC=(action,roomId,mediaId,payload={})=>new Promise((resolve,reject)=>{const s=mediaProbe.socket,requestId=crypto.randomUUID();const timer=setTimeout(()=>{s.removeEventListener('message',handler);reject(Error('RPC timeout'));},5000);const handler=e=>{const m=JSON.parse(e.data);if(m.kind==='response'&&m.requestId===requestId){clearTimeout(timer);s.removeEventListener('message',handler);resolve(m);}};s.addEventListener('message',handler);s.send(JSON.stringify({kind:'request',type:'media.request',requestId,action,roomId,mediaId,payload}));})`);
  }
  const raw = (p, action, roomId, mediaId, payload = {}) => p.evaluate(`rawMediaRPC(${JSON.stringify(action)},${JSON.stringify(roomId)},${JSON.stringify(mediaId)},${JSON.stringify(payload)})`);
  await input(a, 'room-name', '1111'); await submit(a, 'room-name');
  await until(() => a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===1"), 'first room');
  await input(a, 'room-name', '2222'); await submit(a, 'room-name');
  await until(() => a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===2"), 'second room');
  const [r1, r2] = await a.evaluate("Array.from(document.querySelectorAll('[data-joined-room-id]')).map(e=>e.dataset.joinedRoomId)");
  for (const room of [r1, r2]) {
    await until(() => b.evaluate(`!!document.querySelector('[data-room-id="${room}"] button')`), 'room visible');
    await b.evaluate(`document.querySelector('[data-room-id="${room}"] button').click()`);
    await until(() => b.evaluate(`!!document.querySelector('[data-joined-room-id="${room}"]')`), 'joined');
  }
  for (const p of [a, b]) { await selectMedia(p, true, true); await click(p, 'media-start'); await waitState(p, 'ready'); }
  await start(a, r1); await start(b, r1); // initial list for B, newly announced B producers for A.
  await receive(a, ['audio', 'video']); await receive(b, ['audio', 'video']);
  const connectedA = await state(a), listed = await raw(a, 'producers', r1, connectedA.mediaId);
  await a.evaluate(`(()=>{for(const producer of ${JSON.stringify(listed.data.producers)})for(let i=0;i<3;i++)mediaProbe.socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({kind:'event',type:'media.producer.added',roomId:${JSON.stringify(r1)},mediaId:${JSON.stringify(connectedA.mediaId)},producer})}));})()`);
  await receive(a, ['audio', 'video']); // repeated discovery must not duplicate Consumers.
  await input(a, 'nickname', 'remote-profile-check');
  await a.evaluate("document.querySelector('input[name=avatar][value=fox]').click()"); await submit(a, 'nickname');
  await until(() => b.evaluate("document.querySelector('[data-remote-participant] h4')?.textContent.includes('remote-profile-check') && document.querySelector('[data-remote-participant] h4')?.textContent.includes('🦊')"), 'remote shared profile');
  for (const p of [a, b]) {
    const s = await stats(p), ids = s.server.consumers.map(c => c.id);
    assert.equal(new Set(ids).size, 2);
    const mapping = await p.evaluate(`(async()=>{const result=[];for(const pc of mediaProbe.pcs){if(pc.connectionState==='closed')continue;const report=await pc.getStats();report.forEach(s=>{if(s.type==='transport'&&s.selectedCandidatePairId){const pair=report.get(s.selectedCandidatePairId),remote=report.get(pair.remoteCandidateId);result.push({ip:remote.address,port:remote.port});}});}return result;})()`);
    assert.ok(mapping.length >= 2); assert.ok(mapping.every(c => c.ip === '127.0.0.1' && c.port >= 40000 && c.port <= 40100));
    console.log('SFU_CANDIDATES ' + JSON.stringify(mapping));
  }
  console.log('PASS A-first bidirectional audio/video RTP, ICE/DTLS, decoded+played frames and one tile per participant');
  const active = await state(a);
  await chat(a, r2, 'chat-2222-during-1111-media'); await chat(a, '', 'global-during-media');
  assert.equal((await state(a)).mediaId, active.mediaId);
  await receive(a, ['audio', 'video']);
  await start(a, r2);
  await until(async () => (await tracks(a)).length === 0 && (await tracks(b)).length === 0, 'cross-room receive isolation');
  await until(async () => (await stats(b)).server?.consumers?.length === 0, 'server Consumer stats after switch');
  await start(b, r2); await receive(a, ['audio', 'video']); await receive(b, ['audio', 'video']);
  assert.notEqual((await state(a)).mediaId, active.mediaId);
  assert.equal((await raw(a, 'stats', r1, active.mediaId)).ok, false);
  for (const p of [a, b]) assert.equal(await p.evaluate("mediaProbe.pcs.filter(pc=>pc.connectionState!=='closed').length"), 2);
  console.log('PASS chat/global selection independent; explicit A then B switch isolates and cleans previous room');
  const aState = await state(a), bState = await state(b), aStats = await stats(a);
  assert.equal((await raw(b, 'consumer.resume', r2, bState.mediaId, { consumerId: aStats.server.consumers[0].id })).ok, false);
  assert.equal((await raw(a, 'consume', r2, aState.mediaId, { transportId: aState.transportId, producerId: aStats.received[0].producerId, rtpCapabilities: { codecs: [] } })).ok, false);
  await stop(a); await stop(b);
  assert.equal(await a.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
  // B-first and a microphone-only participant.
  await click(a, 'media-stop'); await waitState(a, 'idle'); await selectMedia(a, false, true); await click(a, 'media-start'); await waitState(a, 'ready');
  await start(b, r1); await start(a, r1);
  await receive(a, ['audio', 'video']); await receive(b, ['audio']);
  console.log('PASS B-first discovery, audio-only participant, no nonexistent video Consumer');
  await stop(a); await click(a, 'media-stop'); await waitState(a, 'idle');
  const calls = await a.evaluate('mediaProbe.calls');
  await start(a, r1, true); await receive(a, ['audio', 'video']);
  assert.equal(await a.evaluate('mediaProbe.calls'), calls); assert.equal((await stats(a)).server.producers.length, 0);
  await until(async () => (await tracks(b)).length === 0, 'remote sender stop');
  // Deterministic simulated autoplay rejection, followed by explicit UI playback.
  await stop(a);
  await a.evaluate("window.savedRemotePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return this.closest('[data-remote-kind]')?Promise.reject(new DOMException('test autoplay','NotAllowedError')):savedRemotePlay.call(this)}");
  await start(a, r1, true);
  await until(() => a.evaluate("Array.from(document.querySelectorAll('[data-playback-state]')).some(e=>e.textContent==='재생 대기')"), 'autoplay blocked UI');
  await a.evaluate("HTMLMediaElement.prototype.play=window.savedRemotePlay;void 0"); await playRemote(a);
  await until(() => a.evaluate("Array.from(document.querySelectorAll('[data-playback-state]')).every(e=>e.textContent==='재생 중')"), 'explicit playback retry');
  await receive(a, ['audio', 'video']);
  console.log('PASS receive-only without local acquisition; simulated autoplay rejection and explicit retry');
  const oldId = await a.evaluate("document.querySelector('[data-testid=self-id]').textContent");
  await a.evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='연결 종료').click()");
  // A WebSocket close cannot acknowledge a later media.close RPC. The UI may report
  // that failed acknowledgement; resource cleanup, not an idle label, is required.
  await until(async () => !(await state(a)).roomId && (await tracks(a)).length === 0, 'disconnected media cleared');
  assert.equal(await a.evaluate("mediaProbe.pcs.every(pc=>pc.connectionState==='closed')"), true);
  await until(() => b.evaluate("document.querySelector('[data-testid=connection-status]').textContent==='연결됨'"), 'other socket preserved');
  assert.equal((await stats(b)).server.producers.length, 2);
  await a.evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='다시 연결').click()");
  await until(() => a.evaluate(`document.querySelector('[data-testid=self-id]').textContent!=='없음' && document.querySelector('[data-testid=self-id]').textContent!==${JSON.stringify(oldId)}`), 'new session ID');
  assert.equal(await a.evaluate("document.querySelectorAll('[data-joined-room-id]').length"), 0);
  await a.evaluate(`document.querySelector('[data-room-id="${r1}"] button').click()`);
  await until(() => a.evaluate(`!!document.querySelector('[data-joined-room-id="${r1}"]')`), 'rejoined logical room');
  await start(a, r1, true); await receive(a, ['audio', 'video']);
  console.log('PASS WebSocket disconnect clears remote tracks; new ID has no automatic room/media restore; explicit retry works');
  // SFU worker interruption: application WebSocket/chat survives; media does not auto-recover.
  await killSfu(); await idle(a); await idle(b);
  assert.deepEqual(await tracks(a), []); assert.deepEqual(await tracks(b), []);
  for (const p of [a, b]) assert.equal(await p.evaluate("mediaProbe.pcs.every(pc=>pc.connectionState==='closed')"), true);
  await chat(a, '', 'chat-after-sfu-worker-stop');
  await click(b, 'media-stop'); await waitState(b, 'idle'); assert.equal(await ended(a), true); assert.equal(await ended(b), true);
  console.log('PASS owned SFU worker interruption ends receive/send and preserves chat; all owned local tracks ended');
};
