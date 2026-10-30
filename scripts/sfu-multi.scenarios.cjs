const assert = require('node:assert/strict');
const {setTimeout:delay} = require('node:timers/promises');

module.exports = async ({pages,until,click,selectMedia,waitState,ended,control}) => {
  const [a,b,c,d]=pages;
  const input=(p,id,value)=>p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const select=(p,id,value)=>p.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const submit=(p,id)=>p.evaluate(`document.getElementById(${JSON.stringify(id)}).form.requestSubmit()`);
  const state=p=>p.evaluate("({...document.querySelector('[data-testid=sfu-state]').dataset})");
  const stats=p=>p.evaluate("JSON.parse(document.querySelector('[data-testid=sfu-stats]').textContent)");
  const self=p=>p.evaluate("document.querySelector('[data-testid=self-id]').textContent");
  const tiles=p=>p.evaluate("Array.from(document.querySelectorAll('[data-remote-participant][data-has-tracks=true]')).map(e=>e.dataset.remoteParticipant).sort()");
  async function joined(p,r) {return p.evaluate(`!!document.querySelector('[data-joined-room-id="${r}"]')`);}
  async function join(p,r) {await until(()=>p.evaluate(`!!document.querySelector('[data-room-id="${r}"] button')`),'room visible');await p.evaluate(`document.querySelector('[data-room-id="${r}"] button').click()`);await until(()=>joined(p,r),'room joined');}
  async function leave(p,r) {await p.evaluate(`document.querySelector('[data-joined-room-id="${r}"] button').click()`);await p.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='선택한 방 퇴장').click()");await until(async()=>!(await joined(p,r)),'room left');}
  async function local(p,video=true,audio=true) {await selectMedia(p,video,audio);await click(p,'media-start');await waitState(p,'ready');}
  async function start(p,r,only=false) {await select(p,'sfu-room',r);await click(p,only?'sfu-receive':'sfu-start');await until(async()=>{const s=await state(p);if(s.phase==='error')throw Error(await p.evaluate('document.body.innerText'));return s.roomId===r&&s.phase===(only?'receiving':'sending');},'SFU active');}
  async function stop(p) {await p.evaluate("mediaProbe.savedRemote=Array.from(document.querySelectorAll('[data-remote-kind] video,[data-remote-kind] audio')).map(e=>({e,stream:e.srcObject}));void 0");await click(p,'sfu-stop');await until(async()=>!(await state(p)).roomId,'SFU stopped');assert.equal(await p.evaluate("mediaProbe.savedRemote.every(({e,stream})=>e.srcObject===null&&stream.getTracks().every(t=>t.readyState==='ended'))"),true);}
  async function chat(p,r,text) {await select(p,'chat-channel',r?'room:'+r:'global');await input(p,'chat-body',text);await submit(p,'chat-body');await until(()=>p.evaluate(`document.querySelector('[data-testid=chat-messages]').textContent.includes(${JSON.stringify(text)})`),'chat delivered');}
  async function install(p) {await p.evaluate(`window.rawMediaRPC=(action,roomId,mediaId,payload={})=>new Promise((resolve,reject)=>{const s=mediaProbe.socket,requestId=crypto.randomUUID();const timer=setTimeout(()=>{s.removeEventListener('message',handler);reject(Error('test RPC timeout'));},5000);const handler=e=>{const m=JSON.parse(e.data);if(m.kind==='response'&&m.requestId===requestId){clearTimeout(timer);s.removeEventListener('message',handler);resolve(m);}};s.addEventListener('message',handler);s.send(JSON.stringify({kind:'request',type:'media.request',requestId,action,roomId,mediaId,payload}));})`);}
  const raw=(p,action,r,mid,payload={})=>p.evaluate(`rawMediaRPC(${JSON.stringify(action)},${JSON.stringify(r)},${JSON.stringify(mid)},${JSON.stringify(payload)})`);
  async function counts(expected,label) {
    let snapshot;
    await until(async()=>{
      try {
        snapshot=await control('snapshot');const m=snapshot.media,s=m.slots;
        const actual={slots:s.length,routers:m.roomResources.length,send:s.filter(s=>s.sendTransportId).length,recv:s.filter(s=>s.recvTransportId).length,producers:s.reduce((n,s)=>n+s.producers.length,0),consumers:s.reduce((n,s)=>n+s.consumers.length,0)};
        if(JSON.stringify(actual)!==JSON.stringify(expected)||m.pending||m.draining)return false;
        assert.equal(m.native?.routerIds.length??0,expected.routers);
        assert.equal(m.roomResources.reduce((n,r)=>n+r.dump.transportIds.length,0),expected.send+expected.recv);
        assert.equal(m.roomResources.reduce((n,r)=>n+r.dump.mapProducerIdConsumerIds.length,0),expected.producers);
        assert.equal(m.roomResources.reduce((n,r)=>n+r.dump.mapConsumerIdProducerId.length,0),expected.consumers);
        for(const r of m.roomResources) for(const pair of r.dump.mapConsumerIdProducerId) {
          const consumerSlot=s.find(s=>s.consumers.some(c=>c.id===pair.key));const owner=s.find(s=>s.producers.some(p=>p.id===pair.value));
          assert.ok(owner&&consumerSlot&&owner.participantId!==consumerSlot.participantId&&owner.roomId===r.roomId&&consumerSlot.roomId===r.roomId);
        }
        return true;
      }catch{return false;}
    },'native resource counts '+label);
    console.log('RESOURCES '+label+' '+JSON.stringify({expected,rooms:snapshot.rooms,sessions:snapshot.sessions}));return snapshot;
  }
  async function play(p) {
    const n=await p.evaluate("document.querySelectorAll('[data-remote-kind] button').length");
    for(let i=0;i<n;i++) {const pt=await p.evaluate(`(()=>{const e=document.querySelectorAll('[data-remote-kind] button')[${i}];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await p.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pt});await p.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pt});}
  }
  async function receive(p,descriptors,growth=false) {
    const expected=descriptors.map(e=>e.id).sort();
    await until(async()=>{const s=await stats(p);return Array.isArray(s.received)&&JSON.stringify(s.received.map(c=>c.producerId).sort())===JSON.stringify(expected)&&s.received.every(c=>c.packetsReceived>0&&c.bytesReceived>0)&&s.server.consumers.length===expected.length;},'exact remote RTP sources');
    assert.deepEqual(await tiles(p),[...new Set(descriptors.map(e=>e.owner))].sort());
    if(await p.evaluate("Array.from(document.querySelectorAll('[data-playback-state]')).some(e=>e.textContent==='재생 대기')"))await play(p);
    await until(()=>p.evaluate("Array.from(document.querySelectorAll('[data-remote-kind=video] video')).every(v=>!v.paused&&v.videoWidth>0&&v.getVideoPlaybackQuality().totalVideoFrames>0)"),'decoded+played remote video');
    if(growth){const x=await stats(p);await delay(2200);const y=await stats(p);for(const prev of x.received){const next=y.received.find(c=>c.id===prev.id);assert.ok(next&&next.bytesReceived>prev.bytesReceived&&next.packetsReceived>prev.packetsReceived);if(next.kind==='video')assert.ok(next.framesDecoded>prev.framesDecoded);const before=x.server.consumers.find(c=>c.id===prev.id),after=y.server.consumers.find(c=>c.id===prev.id);assert.ok(after.packets>before.packets&&after.bytes>before.bytes);}console.log('MULTI_RTP '+JSON.stringify({participant:await self(p),first:x.received,second:y.received,server:y.server}));}
  }
  const resourceCount=(slots,routers,send,recv,producers,consumers)=>({slots,routers,send,recv,producers,consumers});
  async function verify(group,growth=false) {
    const snap=await control('snapshot');
    for(const p of group){const id=await self(p),slot=snap.media.slots.find(s=>s.participantId===id);const descriptors=snap.media.slots.filter(s=>s.roomId===slot.roomId&&s.participantId!==id).flatMap(s=>s.producers.map(prod=>({...prod,owner:s.participantId})));await receive(p,descriptors,growth);assert.equal(await p.evaluate("mediaProbe.pcs.filter(pc=>pc.connectionState!=='closed').length"),slot.sendTransportId?2:1);}
  }
  for(const p of pages){await until(()=>p.evaluate("!!document.getElementById('nickname')&&!document.getElementById('nickname').disabled"),'session');await install(p);}
  await input(a,'room-name','1111');await submit(a,'room-name');await until(()=>a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===1"),'room1');
  await input(a,'room-name','2222');await submit(a,'room-name');await until(()=>a.evaluate("document.querySelectorAll('[data-joined-room-id]').length===2"),'room2');
  const [r1,r2]=await a.evaluate("Array.from(document.querySelectorAll('[data-joined-room-id]')).map(e=>e.dataset.joinedRoomId)");
  for(const p of [b,c])await join(p,r1);await join(b,r2);await join(d,r2);
  await counts(resourceCount(0,0,0,0,0,0),'logical-only');assert.equal(await d.evaluate('mediaProbe.calls'),0);
  for(const p of [a,b,c])await local(p);await local(d,true,false);
  await start(a,r1);await start(b,r1);await start(c,r1);await start(d,r2);
  await counts(resourceCount(4,2,4,4,7,12),'A-B-C plus isolated D');await verify(pages,true);
  console.log('PASS A-B-C: each 4 remote consumers, source ownership, SFU+browser RTP growth and decoded video; D isolated');
  const aState=await state(a),bState=await state(b),snapshot=await control('snapshot'),bId=await self(b);
  const bSlot=snapshot.media.slots.find(s=>s.participantId===bId);
  assert.equal((await raw(a,'consumer.resume',r1,aState.mediaId,{consumerId:bSlot.consumers[0].id})).ok,false);
  assert.equal((await raw(a,'receive',r2,'second-room')).ok,false);
  assert.equal((await raw(d,'producers',r1,(await state(d)).mediaId)).ok,false);
  // Ending one source is not a camera ON/OFF UI. Exercise the existing control request directly.
  for(const kind of ['video','audio']) {
    const producer=bSlot.producers.find(p=>p.kind===kind);
    assert.equal((await raw(b,'producer.close',r1,bState.mediaId,{transportId:bSlot.sendTransportId,producerId:producer.id})).ok,true);
    await counts(resourceCount(4,2,4,4,kind==='video'?6:5,kind==='video'?10:8),'single '+kind+' source end');await verify([a,b,c]);
  }
  assert.equal(await joined(b,r1),true);await chat(b,r1,'chat-without-producers');
  await stop(b);await start(b,r1);await counts(resourceCount(4,2,4,4,7,12),'B restored');await verify([a,b,c]);
  await input(c,'nickname','dynamic-C');await c.evaluate("document.querySelector('input[name=avatar][value=fox]').click()");await submit(c,'nickname');
  await until(()=>a.evaluate("Array.from(document.querySelectorAll('[data-remote-participant] h4')).some(e=>e.textContent.includes('dynamic-C')&&e.textContent.includes('🦊'))"),'shared remote profile');
  await chat(a,r2,'2222-chat-during-1111-media');await chat(a,'','global-during-media');assert.equal((await state(a)).mediaId,aState.mediaId);
  // Old generation events are harmless to a current connection.
  await a.evaluate(`mediaProbe.socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({kind:'event',type:'media.producer.added',roomId:${JSON.stringify(r1)},mediaId:'old-generation',producer:{producerId:'old-source',participantId:'old-owner',kind:'video'}})}))`);
  const listed=await raw(a,'producers',r1,aState.mediaId);
  await a.evaluate(`(()=>{for(const producer of ${JSON.stringify(listed.data.producers)})for(let i=0;i<3;i++)mediaProbe.socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({kind:'event',type:'media.producer.added',roomId:${JSON.stringify(r1)},mediaId:${JSON.stringify(aState.mediaId)},producer})}));})()`);
  await counts(resourceCount(4,2,4,4,7,12),'stale event rejected');
  for(let round=0;round<5;round++) {
    const previous=await state(c);await stop(c);await counts(resourceCount(3,2,3,3,5,4),'C stop '+round);await verify([a,b]);
    assert.equal(await c.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'),true);
    await start(c,r1);await counts(resourceCount(4,2,4,4,7,12),'C restart '+round);await verify([a,b,c]);
    assert.equal((await raw(c,'stats',r1,previous.mediaId)).ok,false);
  }
  console.log('PASS five C stop/restart cycles; baseline native counts restored, unaffected A-B RTP preserved');
  // Opposite entry order, then nearly simultaneous creation.
  for(const p of [a,b,c])await stop(p);
  for(const p of [c,a,b])await start(p,r1);
  await counts(resourceCount(4,2,4,4,7,12),'C-A-B order');await verify([a,b,c],true);
  for(const p of [a,b,c])await stop(p);
  await Promise.all([a,b,c].map(p=>start(p,r1)));await counts(resourceCount(4,2,4,4,7,12),'simultaneous start');await verify([a,b,c]);
  // Media kinds and receive-only ownership.
  await stop(c);await click(c,'media-stop');await waitState(c,'idle');await local(c,true,false);await start(c,r1);
  await stop(b);await click(b,'media-stop');await waitState(b,'idle');await local(b,false,true);await start(b,r1);
  await counts(resourceCount(4,2,4,4,5,8),'audio-only B video-only C');await verify([a,b,c],true);
  await stop(c);await click(c,'media-stop');await waitState(c,'idle');const calls=await c.evaluate('mediaProbe.calls');await start(c,r1,true);
  await counts(resourceCount(4,2,3,4,4,6),'receive-only C');await verify([a,b,c]);assert.equal(await c.evaluate('mediaProbe.calls'),calls);
  console.log('PASS mic-only, camera-only and receive-only participant source/consumer counts');
  // Consumer creation after cancellation: hold a real response until after the receiver stopped.
  await stop(c);
  await c.evaluate(`window.savedSocketSend=mediaProbe.socket.send;mediaProbe.socket.send=function(text){const m=JSON.parse(text);if(m.type==='media.request'&&m.action==='consume'&&!mediaProbe.heldConsume){mediaProbe.heldConsume={message:m,text};return;}return savedSocketSend.call(this,text);};void 0`);
  await start(c,r1,true);await until(()=>c.evaluate('!!mediaProbe.heldConsume'),'held consume');await stop(c);
  await c.evaluate('mediaProbe.socket.send=window.savedSocketSend;mediaProbe.socket.send(mediaProbe.heldConsume.text)');
  await counts(resourceCount(3,2,3,3,4,3),'cancelled late consume');
  await start(c,r1,true);await counts(resourceCount(4,2,3,4,4,6),'receiver retry');await verify([a,b,c]);
  // Leaving an inactive logical room preserves the current connection.
  const beforeLeave=await state(a);await leave(a,r2);assert.equal((await state(a)).mediaId,beforeLeave.mediaId);await join(a,r2);
  await leave(a,r1);await counts(resourceCount(3,2,2,3,2,1),'A active room left');await verify([b,c]);assert.equal(await joined(a,r2),true);await chat(a,r2,'still-in-2222');
  await start(a,r2);await counts(resourceCount(4,2,3,4,4,4),'A explicitly switched to D');await verify([a,d],true);
  await control('closeRouter',{roomId:r2});await counts(resourceCount(2,1,1,2,1,1),'2222 Router failure preserves 1111');await verify([b,c],true);
  assert.equal(await joined(a,r2),true);await chat(a,r2,'chat-after-router-failure');
  await start(d,r2);await start(a,r2);await counts(resourceCount(4,2,3,4,4,4),'Router recreation');await verify([a,d]);
  // Empty logical room must release its Router while the other room remains live.
  // The last sender leaves while a receive-only participant remains.
  await leave(b,r1);await counts(resourceCount(3,2,2,3,3,3),'receive-only C remains in 1111');await verify([c]);
  await leave(c,r1);await counts(resourceCount(2,1,2,2,3,3),'1111 deleted');await verify([a,d]);
  // Refresh: fresh participant ID, no auto media restoration.
  const oldId=await self(d),refreshStart=Date.now();await d.call('Page.reload');
  await until(async()=>{try{return(await self(d))!==oldId&&(await self(d))!=='없음';}catch{return false;}},'refreshed session');await install(d);
  await counts(resourceCount(1,1,1,1,2,0),'refresh cleanup');assert.equal(await d.evaluate('mediaProbe.calls'),0);assert.equal(await d.evaluate("document.querySelectorAll('[data-joined-room-id]').length"),0);
  console.log('DETECTION refresh_ms='+(Date.now()-refreshStart));
  await join(d,r2);await local(d,true,false);await start(d,r2);await verify([a,d]);
  // Abrupt actual target close (not a request to our signaling server).
  const closeStart=Date.now();await d.call('Page.close');await counts(resourceCount(1,1,1,1,2,0),'tab close cleanup');console.log('DETECTION tab_close_ms='+(Date.now()-closeStart));
  assert.deepEqual(await tiles(a),[]);
  // Close the test-owned server and inspect native resources after shutdown.
  await stop(a);await click(a,'media-stop');await waitState(a,'idle');
  await leave(a,r2);await leave(b,r2);await counts(resourceCount(0,0,0,0,0,0),'all logical rooms gone');
  const final=await control('shutdown');assert.equal(final.sessions,0);assert.equal(final.rooms.length,0);assert.equal(final.media.slots.length,0);assert.equal(final.media.native,null);
  for(const p of [a,b,c]){assert.equal(await p.evaluate("mediaProbe.pcs.every(pc=>pc.connectionState==='closed')"),true);if(await p.evaluate("document.querySelector('[data-testid=media-status]').dataset.status==='ready'"))await click(p,'media-stop');assert.equal(await ended(p),true);}
  console.log('PASS final server shutdown, zero native resources, closed PeerConnections and ended local tracks; physical hearing NOT tested');
};
