const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ pages, until, click, selectMedia, waitState, control }) => {
  const [a, b, c] = pages;
  const status = p => p.evaluate("({...document.querySelector('[data-testid=meter-status]').dataset})");
  const level = p => p.evaluate("Number(document.querySelector('[data-testid=meter-level]').value)");
  const select = (p, id, value) => p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const roomInput = (p, value) => p.evaluate(`(()=>{const e=document.getElementById('room-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.form.requestSubmit();})()`);
  const meterState = async (p, expected) => until(async () => (await status(p)).status === expected, 'meter ' + expected);
  const server = async () => (await control('snapshot')).media;
  const mapping = snap => snap.slots.map(s => ({ id: s.participantId, send: s.sendTransportId, recv: s.recvTransportId,
    producers: s.producers.map(p => p.id).sort(), consumers: s.consumers.map(c => c.id).sort() })).sort((x,y) => x.id.localeCompare(y.id));
  const stats = p => p.evaluate("JSON.parse(document.querySelector('[data-testid=sfu-stats]').textContent)");
  for (const p of pages) {
    await until(() => p.evaluate("document.querySelector('[data-testid=devices-status]').textContent.includes('ready')"), 'devices ready');
    await until(() => p.evaluate("document.querySelector('[data-testid=connection-status]').textContent==='연결됨'"), 'WebSocket');
    assert.equal(await p.evaluate('mediaProbe.calls'), 0);
    assert.equal(await p.evaluate('meterProbe.contexts.length'), 0);
  }
  // Native Chromium fake microphone: real AudioContext/Analyser samples.
  await select(a, 'device-audio', 'mock-mic-a');
  await click(a, 'meter-start'); await meterState(a, 'running');
  await until(async () => (await level(a)) > 0, 'native virtual microphone RMS');
  assert.equal((await status(a)).source, 'test');
  assert.equal((await status(a)).deviceId, 'mock-mic-a');
  assert.deepEqual(await a.evaluate('mediaProbe.options.at(-1)'), { audio: { deviceId: { exact: 'mock-mic-a' } }, video: false });
  assert.equal(await a.evaluate('meterProbe.destinationConnections'), 0);
  console.log('METER_NATIVE_LEVEL ' + await level(a));
  await click(a, 'meter-stop'); await meterState(a, 'idle');
  // Controlled analyser samples separately verify silence and a known signal.
  await a.evaluate("meterProbe.mode='silence'"); await click(a, 'meter-start'); await meterState(a, 'running');
  await until(async () => (await level(a)) === 0, 'controlled silence');
  await a.evaluate("meterProbe.mode='signal'"); await until(async () => (await level(a)) === 50, 'controlled 0.25 RMS');
  await a.evaluate("meterProbe.mode='native'"); await click(a, 'meter-stop'); await meterState(a, 'idle');
  for (let i=0;i<5;i++) { await click(a,'meter-start'); await meterState(a,'running'); await click(a,'meter-stop'); await meterState(a,'idle'); }
  const earlyCleanup=await a.evaluate("({contexts:meterProbe.contexts.map(c=>c.state),frames:meterProbe.meterFrames.size,live:mediaProbe.tracks.filter(t=>t.readyState!=='ended').map(t=>t.id)})");
  assert.deepEqual(earlyCleanup,{contexts:Array(earlyCleanup.contexts.length).fill('closed'),frames:0,live:[]});
  await select(b,'device-audio','mock-mic-b'); await click(b,'meter-start'); await meterState(b,'running');
  await until(async()=> (await level(b))>0,'Edge native virtual input');assert.equal((await status(b)).deviceId,'mock-mic-b');
  await click(b,'meter-stop');await meterState(b,'idle');
  // A cancelled permission request cannot attach a late track or start an analyser.
  await a.evaluate("mediaProbe.mode='hold';mediaProbe.held=null");await click(a,'meter-start');await until(()=>a.evaluate('!!mediaProbe.held'),'held permission');
  await click(a,'meter-stop');await meterState(a,'stopping');
  await a.evaluate("mediaProbe.mode='native';mediaProbe.held()");await meterState(a,'idle');
  assert.equal(await a.evaluate("mediaProbe.tracks.every(t=>t.readyState==='ended')"),true);
  await a.evaluate("mediaProbe.mode='hold';mediaProbe.held=null");await click(a,'meter-start');await until(()=>a.evaluate('!!mediaProbe.held'),'held selected device');
  await select(a,'device-audio','mock-mic-b');await a.evaluate("mediaProbe.mode='native';mediaProbe.held()");await meterState(a,'idle');
  assert.equal(await a.evaluate("mediaProbe.tracks.every(t=>t.readyState==='ended')"),true);
  await click(a,'meter-start');await meterState(a,'running');assert.equal((await status(a)).deviceId,'mock-mic-b');
  await select(a,'device-audio','mock-mic-a');assert.equal((await status(a)).deviceId,'mock-mic-b');
  await until(()=>a.evaluate("document.querySelector('#devices').textContent.includes('선택값이 변경됐지만 분석 대상은 이전 장치')"),'selection is not automatic analysis switch');
  await click(a,'meter-stop');await meterState(a,'idle');await click(a,'meter-start');await meterState(a,'running');assert.equal((await status(a)).deviceId,'mock-mic-a');
  await a.evaluate("mediaProbe.removedDevice='mock-mic-a';navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");
  await until(()=>a.evaluate("document.querySelector('#devices').textContent.includes('선택한 장치가 목록에 없습니다')"),'removed selected microphone warning');
  assert.equal((await status(a)).deviceId,'mock-mic-a');
  await a.evaluate("mediaProbe.removedDevice='';navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");
  await a.evaluate("(()=>{const t=mediaProbe.streams.at(-1).getAudioTracks()[0];t.stop();t.dispatchEvent(new Event('ended'));})()");await meterState(a,'error');
  assert.equal(await level(a),0);
  await a.evaluate("meterProbe.resumeMode='constructorError'");await click(a,'meter-start');await meterState(a,'error');
  await a.evaluate("meterProbe.resumeMode='resumeError'");await click(a,'meter-start');await meterState(a,'error');
  await a.evaluate("meterProbe.resumeMode='native'");
  // The active call shares one live audio source; the meter never touches SFU ownership.
  await roomInput(a,'meter-room');await until(()=>a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===1"),'room');
  const room=await a.evaluate("document.querySelector('[data-joined-room-id]').dataset.joinedRoomId");
  for(const p of [b,c]) {await until(()=>p.evaluate(`!!document.querySelector('[data-room-id=${JSON.stringify(room)}] button')`),'room visible');await p.evaluate(`document.querySelector('[data-room-id=${JSON.stringify(room)}] button').click()`);await until(()=>p.evaluate(`!!document.querySelector('[data-joined-room-id=${JSON.stringify(room)}]')`),'room joined');}
  for(const p of pages){await select(p,'device-audio','mock-mic-a');await selectMedia(p,false,true);await click(p,'media-start');await waitState(p,'ready');await select(p,'sfu-room',room);await click(p,'sfu-start');await until(()=>p.evaluate("['sending','ready'].includes(document.querySelector('[data-testid=sfu-state]').dataset.phase)"),'SFU sending');}
  let snap=await server();await until(async()=>{snap=await server();return snap.slots.length===3&&snap.slots.every(s=>s.producers.length===1&&s.consumers.length===2);},'3 peers and 6 consumers');
  const baseline=mapping(snap), aid=await a.evaluate("document.querySelector('[data-testid=self-id]').textContent"), audio=snap.slots.find(s=>s.participantId===aid).producers[0].id;
  const calls=await a.evaluate('mediaProbe.calls');await click(a,'meter-start');await meterState(a,'running');
  assert.equal((await status(a)).source,'shared');assert.equal(await a.evaluate('mediaProbe.calls'),calls);
  assert.deepEqual(mapping(await server()),baseline);
  const sharedPackets=(await stats(b)).received.find(r=>r.producerId===audio)?.packetsReceived ?? 0;
  await until(async()=>(await stats(b)).received.some(r=>r.producerId===audio&&r.packetsReceived>sharedPackets),'shared meter leaves RTP flowing');
  await click(a,'meter-stop');await meterState(a,'idle');
  assert.equal(await a.evaluate("mediaProbe.tracks.find(t=>t.id===document.querySelector('[data-testid=device-actual-audio]').dataset.trackId).readyState"),'live');
  // Muting an active shared meter stops that analysis. Restart uses an isolated track.
  await click(a,'meter-start');await meterState(a,'running');await click(a,'mic-toggle');
  await until(()=>a.evaluate("document.querySelector('[data-testid=mic-state]').dataset.muted==='true'"),'muted');await meterState(a,'error');
  await click(a,'meter-start');await meterState(a,'running');assert.equal((await status(a)).source,'test');
  await until(async()=> (await level(a))>0,'muted dedicated microphone still has input');
  assert.equal(await a.evaluate("mediaProbe.tracks.find(t=>t.id===document.querySelector('[data-testid=device-actual-audio]').dataset.trackId).enabled"),false);
  snap=await server();assert.equal(snap.slots.find(s=>s.participantId===aid).producers[0].paused,true);assert.deepEqual(mapping(snap),baseline);
  await delay(1500);const before=await Promise.all([b,c].map(stats));await delay(1600);const after=await Promise.all([b,c].map(stats));
  for(let i=0;i<2;i++){const x=before[i].server.consumers.find(x=>x.producerId===audio),y=after[i].server.consumers.find(x=>x.producerId===audio);assert.equal(y.producerPaused,true);assert.equal(y.packets,x.packets);assert.equal(y.bytes,x.bytes);}
  await click(a,'meter-stop');await meterState(a,'idle');assert.equal((await server()).slots.find(s=>s.participantId===aid).producers[0].paused,true);
  const mutedPackets=(await stats(b)).received.find(r=>r.producerId===audio)?.packetsReceived ?? 0;
  await click(a,'mic-toggle');await until(()=>a.evaluate("document.querySelector('[data-testid=mic-state]').dataset.muted==='false'"),'explicit unmute');
  await until(async()=> (await stats(b)).received.some(r=>r.producerId===audio&&r.packetsReceived>mutedPackets),'RTP resumed');
  // Applying Step 11's microphone change retires a shared meter; restart binds new track.
  await click(a,'meter-start');await meterState(a,'running');assert.equal((await status(a)).source,'shared');
  const oldTrack=(await status(a)).trackId;
  await select(a,'device-audio','mock-mic-b');await click(a,'device-apply-audio');
  await meterState(a,'error');await until(()=>a.evaluate("document.querySelector('[data-testid=device-actual-audio]').dataset.deviceId==='mock-mic-b'"),'new call microphone');
  assert.equal(await a.evaluate(`mediaProbe.tracks.find(t=>t.id===${JSON.stringify(oldTrack)}).readyState`),'ended');
  await click(a,'meter-start');await meterState(a,'running');assert.equal((await status(a)).deviceId,'mock-mic-b');assert.equal((await status(a)).source,'shared');
  assert.deepEqual(mapping(await server()),baseline);await click(a,'meter-stop');await meterState(a,'idle');
  // Suspended contexts show zero and require explicit user resume.
  await click(a,'meter-start');await meterState(a,'running');await a.evaluate('meterProbe.contexts.at(-1).suspend()');await meterState(a,'suspended');
  assert.equal(await level(a),0);await click(a,'meter-resume');await meterState(a,'running');await click(a,'meter-stop');await meterState(a,'idle');
  // Stop SFU and local tracks; the meter leaves both independent resources alone.
  for(const p of pages){await click(p,'sfu-stop');await until(()=>p.evaluate("document.querySelector('[data-testid=sfu-state]').dataset.phase==='idle'"),'SFU stopped');await click(p,'media-stop');await waitState(p,'idle');}
  await until(async()=>{const m=await server();return !m.slots.length&&m.roomResources.every(r=>!r.dump.transportIds.length&&!r.dump.mapProducerIdConsumerIds.length&&!r.dump.mapConsumerIdProducerId.length);},'native media resources zero');
  for(const p of pages) assert.equal(await p.evaluate("meterProbe.contexts.every(c=>c.state==='closed')&&meterProbe.meterFrames.size===0&&meterProbe.destinationConnections===0&&mediaProbe.tracks.every(t=>t.readyState==='ended')"),true);
  const shutdown=await control('shutdown');assert.equal(shutdown.media.native,null);
  await a.evaluate(`(async()=>{
    const source=await(await fetch('/src/main.tsx')).text();
    const reactUrl=source.split('"').find(p=>p.includes('/react.js?')),domUrl=source.split('"').find(p=>p.includes('/react-dom_client.js?'));
    const [react,dom,{LocalMedia}]=await Promise.all([import(reactUrl),import(domUrl),import('/src/LocalMedia.tsx')]);
    const {createElement,StrictMode}=react.default??react,{createRoot}=dom.default??dom;
    const node=document.createElement('div');document.body.append(node);window.meterHarnessNode=node;
    window.meterHarnessRoot=createRoot(node);meterHarnessRoot.render(createElement(StrictMode,null,createElement(LocalMedia)));
  })()`);
  await until(()=>a.evaluate("!!meterHarnessNode.querySelector('#meter-start')"),'StrictMode meter mounted');
  await a.evaluate("meterHarnessNode.querySelector('#meter-start').click()");
  await until(()=>a.evaluate("meterHarnessNode.querySelector('[data-testid=meter-status]').dataset.status==='running'"),'mounted meter running');
  await a.evaluate('meterHarnessRoot.unmount()');
  await until(()=>a.evaluate("meterProbe.contexts.every(c=>c.state==='closed')&&meterProbe.meterFrames.size===0&&mediaProbe.tracks.every(t=>t.readyState==='ended')"),'StrictMode unmount cleanup');
  await a.evaluate('meterHarnessNode.remove()');
  console.log('PASS Step12: Chrome/Edge real virtual mic samples, controlled silence/signal, 5 meter cycles, shared/dedicated ownership, muted SFU isolation, Step11 switch, suspended resume, zero resources; physical speech NOT tested');
};
