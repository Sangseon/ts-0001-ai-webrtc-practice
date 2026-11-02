const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ pages, until, click, selectMedia, waitState, ended, control }) => {
  const [a,b,c] = pages;
  const select = (p,id,value) => p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const input = (p,id,value) => p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.form.requestSubmit();})()`);
  const stats = p => p.evaluate("JSON.parse(document.querySelector('[data-testid=sfu-stats]').textContent)");
  const state = p => p.evaluate("({...document.querySelector('[data-testid=sfu-state]').dataset})");
  const actual = (p,kind) => p.evaluate(`({...document.querySelector('[data-testid=device-actual-${kind}]').dataset})`);
  const tracks = p => p.evaluate("mediaProbe.tracks.filter(t=>t.readyState==='live').map(t=>({id:t.id,kind:t.kind,enabled:t.enabled,deviceId:t.getSettings().deviceId}))");
  const change = p => p.evaluate("navigator.mediaDevices.dispatchEvent(new Event('devicechange'))");
  async function start(p,room,receive=false) { await select(p,'sfu-room',room); await click(p,receive?'sfu-receive':'sfu-start'); await until(async()=>{const s=await state(p);if(s.phase==='error')throw Error(await p.evaluate('document.body.innerText'));return s.roomId===room&&['sending','ready','receiving'].includes(s.phase);},'active SFU'); }
  async function counts(producers,consumers,slots=3) {
    let snap;
    await until(async()=>{snap=await control('snapshot');const m=snap.media;if(m.pending||m.draining||m.slots.length!==slots)return false;
      const ps=m.slots.reduce((n,s)=>n+s.producers.length,0),cs=m.slots.reduce((n,s)=>n+s.consumers.length,0);
      if(ps!==producers||cs!==consumers)return false;
      assert.equal(m.roomResources.reduce((n,r)=>n+r.dump.mapProducerIdConsumerIds.length,0),ps);
      assert.equal(m.roomResources.reduce((n,r)=>n+r.dump.mapConsumerIdProducerId.length,0),cs);
      assert.equal(m.roomResources.reduce((n,r)=>n+r.dump.transportIds.length,0),m.slots.reduce((n,s)=>n+!!s.sendTransportId+!!s.recvTransportId,0));return true;},'native resource counts');return snap;
  }
  const map = snap => snap.media.slots.map(s=>({id:s.participantId,send:s.sendTransportId,recv:s.recvTransportId,producers:s.producers.map(p=>p.id).sort(),consumers:s.consumers.map(c=>c.id).sort()})).sort((x,y)=>x.id.localeCompare(y.id));
  async function growth(p,id) {
    await until(async()=> (await stats(p)).received?.some(x=>x.producerId===id&&x.packetsReceived>0&&(x.kind!=='video'||x.framesDecoded>0)),'first RTP');
    const x=(await stats(p)).received.find(x=>x.producerId===id);let y;
    // Stats are sampled asynchronously by the UI. Require observed growth within
    // the shared bounded wait rather than assuming one fixed sampling interval.
    await until(async()=>{y=(await stats(p)).received.find(x=>x.producerId===id);return y&&y.packetsReceived>x.packetsReceived&&(y.kind!=='video'||y.framesDecoded>x.framesDecoded);},'RTP/decoded frame growth after replacement');
    assert.equal(y.id,x.id);console.log('DEVICE_RTP '+JSON.stringify({producer:id,before:x,after:y}));
  }
  async function apply(p,kind,id) {
    const old = await actual(p,kind);
    await select(p,'device-'+kind,id);await click(p,'device-apply-'+kind);
    await until(async()=>{const next=await actual(p,kind);return next.trackId&&next.trackId!==old.trackId;},'track replaced '+kind);
    assert.equal(await p.evaluate(`mediaProbe.tracks.find(t=>t.id===${JSON.stringify(old.trackId)}).readyState`),'ended');
    assert.equal((await actual(p,kind)).deviceId,id);
    const now=(await actual(p,kind)).trackId;
    assert.equal(await p.evaluate(`mediaProbe.pcs.flatMap(pc=>pc.getSenders()).some(s=>s.track?.id===${JSON.stringify(now)})`),true);
    await until(()=>p.evaluate(`!document.getElementById('device-apply-${kind}').disabled`),'apply unlocked');
  }
  for(const p of pages) {
    await until(()=>p.evaluate("document.querySelector('[data-testid=devices-status]').textContent.includes('ready')"),'enumeration');
    assert.equal(await p.evaluate('mediaProbe.calls'),0);
    await until(()=>p.evaluate("!!document.getElementById('nickname')&&!document.getElementById('nickname').disabled"),'session');
  }
  // Catalogue-only mocks never acquire media and do not claim physical permission UI coverage.
  await a.evaluate("mediaProbe.listMode='private'");await change(a);
  await until(()=>a.evaluate("Array.from(document.querySelectorAll('#device-video option')).some(o=>o.textContent.includes('권한'))"),'private labels');
  await a.evaluate("mediaProbe.listMode='error'");await change(a);
  await until(()=>a.evaluate("document.querySelector('[data-testid=devices-status]').textContent.includes('error')"),'enumerate error');
  await a.evaluate("mediaProbe.listMode='empty'");await change(a);await until(()=>a.evaluate("document.querySelectorAll('#device-video option').length===1"),'empty list');
  await a.evaluate("mediaProbe.listMode='hold';mediaProbe.heldList=null");await change(a);await until(()=>a.evaluate('!!mediaProbe.heldList'),'held list');
  await a.evaluate("mediaProbe.listMode='native'");await change(a);await until(()=>a.evaluate("document.querySelectorAll('#device-video option').length>=3"),'new list');await a.evaluate('mediaProbe.heldList()');
  assert.equal(await a.evaluate('mediaProbe.calls'),0);
  const cameraIds=await a.evaluate("Array.from(document.querySelectorAll('#device-video option')).map(o=>o.value).filter(Boolean)");
  assert.ok(cameraIds.length>=2,'two distinct native Chromium virtual camera IDs');assert.notEqual(cameraIds[0],cameraIds[1]);
  console.log('NATIVE_VIRTUAL_CAMERAS '+JSON.stringify(cameraIds));
  await input(a,'room-name','1111');await until(()=>a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===1"),'room one');await input(a,'room-name','2222');await until(()=>a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===2"),'room two');
  const [r1,r2]=await a.evaluate("Array.from(document.querySelectorAll('[data-joined-room-id]')).map(e=>e.dataset.joinedRoomId)");
  for(const p of[b,c])for(const r of[r1,r2]){await until(()=>p.evaluate(`!!document.querySelector('[data-room-id="${r}"] button')`),'room visible');await p.evaluate(`document.querySelector('[data-room-id="${r}"] button').click()`);await until(()=>p.evaluate(`!!document.querySelector('[data-joined-room-id="${r}"]')`),'room joined');}
  for(const p of pages){await select(p,'device-audio','mock-mic-a');await selectMedia(p,true,true);await click(p,'media-start');await waitState(p,'ready');await start(p,r1);}
  let snap=await counts(6,12), baseline=map(snap);const aid=await a.evaluate("document.querySelector('[data-testid=self-id]').textContent");
  const own=snap.media.slots.find(s=>s.participantId===aid), video=own.producers.find(p=>p.kind==='video').id,audio=own.producers.find(p=>p.kind==='audio').id;
  for(let i=0;i<5;i++){
    await apply(a,'video',cameraIds[(i+1)%2]);await apply(a,'audio',i%2?'mock-mic-a':'mock-mic-b');
    snap=await counts(6,12);assert.deepEqual(map(snap),baseline);assert.equal((await tracks(a)).length,2);
    if(i===0||i===4){await growth(b,video);await growth(c,audio);}
    console.log('PASS device camera/microphone cycle '+i+' IDs and transports retained; microphone identity MOCK');
  }
  const edgeCameras=await b.evaluate("Array.from(document.querySelectorAll('#device-video option')).map(o=>o.value).filter(Boolean)");
  assert.ok(edgeCameras.length>=2);await apply(b,'video',edgeCameras[1]);await apply(b,'audio','mock-mic-b');assert.deepEqual(map(await counts(6,12)),baseline);
  for(const id of[cameraIds[1],cameraIds[0],cameraIds[1]])await select(a,'device-video',id);
  await apply(a,'video',cameraIds[1]);assert.deepEqual(map(await counts(6,12)),baseline);
  // The output-mute browser flag does not mute capture, Producer, or inbound RTP.
  await until(()=>b.evaluate("Array.from(document.querySelectorAll('[data-remote-kind=video] video')).every(v=>v.videoWidth>0&&!v.paused&&v.getVideoPlaybackQuality().totalVideoFrames>0)"),'rendered frames');
  await click(a,'mic-toggle');await until(()=>a.evaluate("document.querySelector('[data-testid=mic-state]').dataset.muted==='true'"),'muted');
  await until(async()=> (await stats(b)).server?.consumers.find(x=>x.producerId===audio)?.producerPaused,'server mute');
  await delay(1600);const mutedBefore=await Promise.all([b,c].map(stats));
  for(let i=0;i<5;i++) {await apply(a,'audio',i%2?'mock-mic-a':'mock-mic-b');assert.equal((await tracks(a)).find(t=>t.kind==='audio').enabled,false);assert.deepEqual(map(await counts(6,12)),baseline);}
  const mutedAfter=await Promise.all([b,c].map(stats));
  for(let i=0;i<2;i++) {const x=mutedBefore[i].server.consumers.find(x=>x.producerId===audio),y=mutedAfter[i].server.consumers.find(x=>x.producerId===audio);assert.equal(y.producerPaused,true);assert.equal(x.packets,y.packets);assert.equal(x.bytes,y.bytes);console.log('MUTED_DEVICE_WINDOW '+JSON.stringify({consumer:y.id,packets:[x.packets,y.packets],bytes:[x.bytes,y.bytes]}));}
  await click(a,'mic-toggle');await until(()=>a.evaluate("document.querySelector('[data-testid=mic-state]').dataset.muted==='false'"),'unmuted');await growth(b,audio);
  // Failed capture and failed native replace leave the original owned track live.
  for(const mode of['NotFoundError','NotAllowedError','NotReadableError','OverconstrainedError']){
    const before=await actual(a,'video');await a.evaluate(`mediaProbe.mode=${JSON.stringify(mode)}`);await click(a,'device-apply-video');await until(()=>a.evaluate("!!document.querySelector('[data-testid=device-error]')"),'capture rejected');await until(()=>a.evaluate("!document.getElementById('device-apply-video').disabled"),'failure unlocked');assert.deepEqual(await actual(a,'video'),before);
  }
  await a.evaluate("mediaProbe.mode='native';mediaProbe.replaceMode='error'");let before=await actual(a,'video');await click(a,'device-apply-video');await until(()=>a.evaluate("!!document.querySelector('[data-testid=device-error]')"),'replace failed');await until(()=>a.evaluate("!document.getElementById('device-apply-video').disabled"),'replace unlocked');assert.deepEqual(await actual(a,'video'),before);assert.equal((await tracks(a)).length,2);await a.evaluate("mediaProbe.replaceMode='native'");await apply(a,'video',cameraIds[1]);
  // Duplicate apply is blocked immediately; OFF cancels an outstanding capture.
  before=await actual(a,'video');await a.evaluate("mediaProbe.mode='hold';mediaProbe.held=null");const calls=await a.evaluate('mediaProbe.calls');await a.evaluate("document.getElementById('device-apply-video').click();document.getElementById('device-apply-video').click()");await until(()=>a.evaluate('!!mediaProbe.held'),'held capture');assert.equal(await a.evaluate('mediaProbe.calls'),calls+1);await click(a,'camera-off');await a.evaluate("mediaProbe.mode='native';mediaProbe.held()");await until(async()=> (await tracks(a)).every(t=>t.kind!=='video'),'late camera cleaned');await counts(5,10);
  const offCalls=await a.evaluate('mediaProbe.calls');await select(a,'device-video',cameraIds[0]);assert.equal(await a.evaluate('mediaProbe.calls'),offCalls);await click(a,'camera-on');await until(async()=> (await actual(a,'video')).deviceId===cameraIds[0],'selected camera ON');await counts(6,12);
  // Device removal changes the catalogue, never selects a replacement or restarts capture.
  const selected=await a.evaluate("document.getElementById('device-audio').value");await a.evaluate(`mediaProbe.removedDevice=${JSON.stringify(selected)}`);await change(a);await until(()=>a.evaluate("document.getElementById('device-apply-audio').disabled"),'removed selection');assert.equal(await a.evaluate("document.getElementById('device-audio').value"),selected);await a.evaluate("mediaProbe.removedDevice=''");await change(a);await until(()=>a.evaluate("!document.getElementById('device-apply-audio').disabled"),'device reappeared');
  const mediaId=(await state(a)).mediaId;await select(a,'chat-channel','room:'+r2);await select(b,'chat-channel','room:'+r2);await input(a,'chat-body','devices-other-room-chat');await until(()=>b.evaluate("document.querySelector('[data-testid=chat-messages]').textContent.includes('devices-other-room-chat')"),'other room chat');assert.equal((await state(a)).mediaId,mediaId);
  // Late microphone capture cannot modify the new room; mute survives room switch.
  await click(a,'mic-toggle');await until(()=>a.evaluate("document.querySelector('[data-testid=mic-state]').dataset.muted==='true'"),'mute before switch');
  await a.evaluate("mediaProbe.mode='hold';mediaProbe.held=null");await click(a,'device-apply-audio');await until(()=>a.evaluate('!!mediaProbe.held'),'held microphone');await start(a,r2);await a.evaluate("mediaProbe.mode='native';mediaProbe.held()");await until(()=>a.evaluate("!document.getElementById('device-apply-audio').disabled"),'cancelled switch unlocked');snap=await counts(6,4);assert.equal(snap.media.slots.find(s=>s.participantId===aid).producers.find(p=>p.kind==='audio').paused,true);assert.equal((await tracks(a)).length,2);
  await start(b,r2);await start(c,r2);await counts(6,12);
  // Receive-only selection does not acquire a track or create a Producer.
  await click(c,'sfu-stop');await click(c,'media-stop');await waitState(c,'idle');await start(c,r2,true);await counts(4,8);const receiveCalls=await c.evaluate('mediaProbe.calls');await select(c,'device-audio','mock-mic-b');await select(c,'device-video',(await c.evaluate("Array.from(document.querySelectorAll('#device-video option')).map(o=>o.value).filter(Boolean)"))[1]);await click(c,'device-apply-audio');assert.equal(await c.evaluate('mediaProbe.calls'),receiveCalls);
  // Whole connection close during replace cleans the candidate; old owned local track survives.
  await a.evaluate("mediaProbe.replaceMode='hold';mediaProbe.heldReplace=null");await click(a,'device-apply-video');await until(()=>a.evaluate('!!mediaProbe.heldReplace'),'held replace');await click(a,'sfu-stop');await a.evaluate("mediaProbe.replaceMode='native';mediaProbe.heldReplace()");await until(()=>a.evaluate("!document.getElementById('device-apply-video').disabled"),'replace cancellation');await counts(2,2,2);assert.equal((await tracks(a)).length,2);
  // A physically ended track is injected; this is not a real USB unplug test.
  await b.evaluate("(()=>{const t=mediaProbe.tracks.find(t=>t.kind==='audio'&&t.readyState==='live');t.stop();t.dispatchEvent(new Event('ended'));})()");await waitState(b,'error');await counts(0,0,1);
  for(const p of pages){await click(p,'sfu-stop');if(await p.evaluate("document.querySelector('[data-testid=media-status]').dataset.status")!=='error'){await click(p,'media-stop');await waitState(p,'idle');}assert.equal(await ended(p),true);assert.equal(await p.evaluate("mediaProbe.pcs.every(pc=>pc.connectionState==='closed')"),true);}
  await counts(0,0,0);
  // Real StrictMode hook ownership and listeners, with injected late acquisition.
  const listeners=await a.evaluate('mediaProbe.deviceListeners.size');
  await a.evaluate(`(async()=>{
    const source=await(await fetch('/src/main.tsx')).text();
    const reactUrl=source.split('"').find(p=>p.includes('/react.js?')),domUrl=source.split('"').find(p=>p.includes('/react-dom_client.js?'));
    const [react,dom,{useLocalMedia}]=await Promise.all([import(reactUrl),import(domUrl),import('/src/useLocalMedia.ts')]);
    const {createElement,StrictMode}=react.default??react,{createRoot}=dom.default??dom;
    const node=document.createElement('div');document.body.append(node);window.deviceHarnessNode=node;
    function Harness(){const m=useLocalMedia();window.deviceHarness=m;return createElement('video',{ref:m.videoRef,muted:true,autoPlay:true});}
    window.deviceHarnessRoot=createRoot(node);deviceHarnessRoot.render(createElement(StrictMode,null,createElement(Harness)));
  })()`);
  await until(()=>a.evaluate('!!window.deviceHarness'),'mounted hook');
  await a.evaluate("deviceHarness.devices.select('video','missing-camera-fixture')");await until(()=>a.evaluate("deviceHarness.devices.selected.video==='missing-camera-fixture'"),'invalid exact selection');
  await a.evaluate('void deviceHarness.start({video:true,audio:false})');await until(()=>a.evaluate("deviceHarness.status==='error'"),'real invalid camera constraint rejected');assert.equal(await ended(a),true);
  await a.evaluate(`deviceHarness.devices.select('video',${JSON.stringify(cameraIds[1])})`);await until(()=>a.evaluate(`deviceHarness.devices.selected.video===${JSON.stringify(cameraIds[1])}`),'explicit initial selection');
  await a.evaluate('void deviceHarness.start({video:true,audio:false})');await until(()=>a.evaluate("deviceHarness.status==='ready'"),'hook acquired');
  assert.equal(await a.evaluate('deviceHarness.streamRef.current.getVideoTracks()[0].getSettings().deviceId'),cameraIds[1]);
  await a.evaluate("mediaProbe.mode='hold';mediaProbe.held=null;void deviceHarness.switchDevice('video',async()=>{},()=>true)");await until(()=>a.evaluate('!!mediaProbe.held'),'held hook switch');
  await a.evaluate("deviceHarnessRoot.unmount();mediaProbe.mode='native';mediaProbe.held()");await until(()=>ended(a),'unmounted late candidate stopped');
  assert.equal(await a.evaluate('mediaProbe.deviceListeners.size'),listeners);assert.equal(await a.evaluate('deviceHarnessNode.querySelector("video")===null'),true);await a.evaluate('deviceHarnessNode.remove()');
  const final=await control('shutdown');assert.equal(final.media.native,null);
  console.log('PASS Step11: native virtual camera A/B, MOCK microphone A/B over real RTP, 5+5 replacements, 5 muted replacements, failures/cancel/room switch/receive-only; physical devices NOT tested');
};
