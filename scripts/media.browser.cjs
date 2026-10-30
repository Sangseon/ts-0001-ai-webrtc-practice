// Windows Chrome/Edge integration check; only temporary browser profiles use fake devices.
const assert = require('node:assert/strict');
const { spawn, fork } = require('node:child_process');
const { mkdtemp, readFile, rm, realpath } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocket } = require('ws');
const children = [], profiles = [], browsers = [];
const workspace = resolve(__dirname, '..');
async function until(fn, label) { for (let i = 0; i < 150; i++) { if (await fn()) return; await delay(100); } throw Error('timeout: ' + label); }
function child(exe, args) {
  const p = spawn(exe, args, { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(p); p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  p.on('error', error => console.error(error.message));
  return p;
}
const instrumentation = `(() => {
  window.mediaProbe = { calls: 0, streams: [], tracks: [], requests: [], mode: 'native', held: null, options: [] };
  if (${process.env.CHECK_SFU === '1' || process.env.CHECK_SFU_RECEIVE === '1' || process.env.CHECK_SFU_MULTI === '1' || process.env.CHECK_SFU_CONTROL === '1'}) {
    const NativeWebSocket=window.WebSocket;
    window.WebSocket=class extends NativeWebSocket {
      constructor(...args){super(...args);if(String(args[0]).endsWith('/ws'))window.mediaProbe.socket=this;}
      send(data){try{const m=JSON.parse(data);if(m.type==='media.request')mediaProbe.requests.push(m.action);}catch{}return super.send(data);}
    };
    mediaProbe.pcs=[];const NativePeerConnection=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends NativePeerConnection {constructor(...args){super(...args);mediaProbe.pcs.push(this);}};
  }
  const original = navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
  if (!original) return;
  navigator.mediaDevices.getUserMedia = async options => {
    const probe = window.mediaProbe; probe.calls++; probe.options.push(options);
    if (probe.mode.endsWith('Error')) throw new DOMException('simulated', probe.mode);
    if ((probe.mode === 'missingVideo' && options.video) || (probe.mode === 'missingAudio' && options.audio)) throw new DOMException('simulated missing kind', 'NotFoundError');
    if (probe.mode === 'hold') await new Promise(resolve => { probe.held = resolve; });
    const stream = await original(options); probe.streams.push(stream); probe.tracks.push(...stream.getTracks());
    if (probe.mode === 'partial') for (const track of stream.getAudioTracks()) { track.stop(); stream.removeTrack(track); }
    return stream;
  };
})();`;
async function browser(exe) {
  const dir = await mkdtemp(join(tmpdir(), 'webrtc-step06-')); profiles.push(dir);
  child(exe, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + dir,
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank']);
  let port;
  await until(async () => { try { port = Number((await readFile(join(dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return !!port; } catch { return false; } }, 'browser launch');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let seq = 0; const pending = new Map(), exceptions = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 10000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const b = { call, evaluate, ws, exceptions }; browsers.push(b);
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
  await call('Page.navigate', { url: 'http://127.0.0.1:5173' });
  await until(() => evaluate("!!document.getElementById('media-start')"), 'React loaded');
  return b;
}
const state = b => b.evaluate("document.querySelector('[data-testid=media-status]').dataset.status");
const waitState = (b, value) => until(async () => (await state(b)) === value, value);
const click = (b, id) => b.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
const ended = b => b.evaluate('mediaProbe.tracks.every(t => t.readyState === "ended")');
async function selectMedia(b, video, audio) {
  for (const [id, checked] of [['media-video', video], ['media-audio', audio]]) {
    await b.evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});if(input.checked!==${checked})input.click();})()`);
  }
}
async function virtual(b, name) {
  assert.deepEqual(await b.evaluate("({secure:window.isSecureContext,api:typeof navigator.mediaDevices?.getUserMedia,calls:mediaProbe.calls})"), { secure: true, api: 'function', calls: 0 });
  await selectMedia(b, false, false);
  await click(b, 'media-start');
  assert.equal(await b.evaluate('mediaProbe.calls'), 0);
  assert.equal(await b.evaluate("document.getElementById('media-start').disabled"), true);
  await until(() => b.evaluate("!!document.getElementById('room-name') && !document.getElementById('room-name').disabled"), 'session available');
  await b.evaluate(`(()=>{const input=document.getElementById('room-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no-media-room');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await b.evaluate("document.getElementById('room-name').form.requestSubmit()");
  await until(() => b.evaluate("document.querySelectorAll('[data-joined-room-id]').length===1"), 'room without media');
  assert.equal(await b.evaluate('mediaProbe.calls'), 0);
  for (const selection of [{ video: true, audio: false }, { video: false, audio: true }, { video: true, audio: true }]) {
    await selectMedia(b, selection.video, selection.audio);
    // Simulated absence rejects only requests that actually include that kind.
    await b.evaluate(`mediaProbe.mode=${JSON.stringify(selection.video && !selection.audio ? 'missingAudio' : selection.audio && !selection.video ? 'missingVideo' : 'native')}`);
    for (let i = 0; i < 3; i++) {
      await click(b, 'media-start'); await waitState(b, 'ready');
      assert.deepEqual(await b.evaluate('mediaProbe.options.at(-1)'), selection);
      assert.deepEqual(await b.evaluate('mediaProbe.streams.at(-1).getTracks().map(t=>t.kind).sort()'), Object.keys(selection).filter(kind => selection[kind]).sort());
      assert.equal(await b.evaluate('mediaProbe.streams.at(-1).getTracks().every(t=>t.readyState==="live")'), true);
      assert.equal(await b.evaluate("document.getElementById('media-video').matches(':disabled') && document.getElementById('media-audio').matches(':disabled')"), true);
      if (selection.video) {
        const preview = await b.evaluate("(()=>{const v=document.getElementById('local-preview');return {video:v.videoWidth>0,playing:!v.paused,muted:v.muted,autoPlay:v.autoplay,inline:v.playsInline};})()");
        assert.deepEqual(preview, { video: true, playing: true, muted: true, autoPlay: true, inline: true });
      } else {
        assert.equal(await b.evaluate("document.getElementById('local-preview').srcObject===null && document.getElementById('local-preview').hidden && !document.querySelector('audio')"), true);
      }
      await click(b, 'media-stop'); await waitState(b, 'idle');
      assert.equal(await ended(b), true);
      assert.equal(await b.evaluate("document.getElementById('local-preview').srcObject===null"), true);
    }
  }
  assert.equal(await b.evaluate('mediaProbe.calls'), 9);
  assert.equal(await b.evaluate('new Set(mediaProbe.streams.map(s=>s.id)).size'), 9);
  // localhost is a separate origin; verify native API exposure there as well.
  await b.call('Page.navigate', { url: 'http://localhost:5173' });
  await until(() => b.evaluate("!!document.getElementById('media-start')"), 'localhost');
  assert.equal(await b.evaluate('window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function"'), true);
  await click(b, 'media-start'); await waitState(b, 'ready'); await click(b, 'media-stop'); await waitState(b, 'idle');
  assert.equal(await ended(b), true);
  console.log(`PASS ${name}: camera-only/mic-only/both x3, no selection=no request, room without media, unselected kind=false, simulated missing other kind, audio-only no playback, all tracks ended; localhost+127.0.0.1`);
}
async function mockScenarios(b) {
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError', 'SecurityError']) {
    await b.evaluate(`mediaProbe.mode=${JSON.stringify(name)}`);
    await click(b, 'media-start'); await waitState(b, 'error');
    assert.ok(await b.evaluate("document.querySelector('[data-testid=media-error]').textContent.length>10"));
  }
  await b.evaluate("mediaProbe.mode='native';Object.defineProperty(navigator,'mediaDevices',{value:undefined,configurable:true});void 0");
  const apiCalls = await b.evaluate('mediaProbe.calls');
  await click(b, 'media-start'); await waitState(b, 'error');
  assert.match(await b.evaluate("document.querySelector('[data-testid=media-error]').textContent"), /API/);
  assert.equal(await b.evaluate('mediaProbe.calls'), apiCalls);
  await b.evaluate("delete navigator.mediaDevices;Object.defineProperty(window,'isSecureContext',{value:false,configurable:true});void 0");
  await click(b, 'media-start');
  assert.match(await b.evaluate("document.querySelector('[data-testid=media-error]').textContent"), /보안/);
  assert.equal(await b.evaluate('mediaProbe.calls'), apiCalls);
  await b.evaluate('Object.defineProperty(window,"isSecureContext",{value:true,configurable:true});void 0');
  await b.evaluate("mediaProbe.mode='hold'");
  const before = await b.evaluate('mediaProbe.calls');
  await click(b, 'media-start'); await waitState(b, 'requesting');
  await click(b, 'media-start'); assert.equal(await b.evaluate('mediaProbe.calls'), before + 1);
  await click(b, 'media-stop'); await waitState(b, 'stopping');
  await click(b, 'media-start'); assert.equal(await b.evaluate('mediaProbe.calls'), before + 1);
  await b.evaluate('mediaProbe.held()'); await waitState(b, 'idle'); assert.equal(await ended(b), true);
  await b.evaluate("mediaProbe.mode='partial'");
  await click(b, 'media-start'); await waitState(b, 'error'); assert.equal(await ended(b), true);
  await b.evaluate("mediaProbe.mode='native';window.savedPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>Promise.reject(new DOMException('simulated','NotAllowedError'))");
  await click(b, 'media-start'); await waitState(b, 'error'); assert.equal(await ended(b), true);
  assert.equal(await b.evaluate("document.getElementById('local-preview').srcObject===null"), true);
  await b.evaluate('HTMLMediaElement.prototype.play=window.savedPlay');
  await b.evaluate("HTMLMediaElement.prototype.play=()=>new Promise(resolve=>{mediaProbe.playHeld=resolve})");
  const playCount = await b.evaluate('mediaProbe.streams.length');
  await click(b, 'media-start');
  await until(() => b.evaluate(`mediaProbe.streams.length===${playCount + 1} && !!mediaProbe.playHeld`), 'pending playback');
  await click(b, 'media-stop'); assert.equal(await ended(b), true);
  await b.evaluate('mediaProbe.playHeld();HTMLMediaElement.prototype.play=window.savedPlay'); await waitState(b, 'idle');
  await click(b, 'media-start'); await waitState(b, 'ready');
  await b.evaluate("(()=>{const t=mediaProbe.streams.at(-1).getVideoTracks()[0];t.stop();t.dispatchEvent(new Event('ended'));})()");
  await waitState(b, 'error'); assert.equal(await ended(b), true);
  await b.evaluate(`(()=>{const input=document.getElementById('chat-body');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'chat-after-media-error');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await b.evaluate("document.getElementById('chat-body').form.requestSubmit()");
  await until(() => b.evaluate("document.querySelector('[data-testid=chat-messages]').textContent.includes('chat-after-media-error')"), 'chat after media error');
  await click(b, 'media-start'); await waitState(b, 'ready');
  // Media ownership must be independent of the existing socket lifecycle.
  await b.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='연결 종료').click()");
  assert.equal(await state(b), 'ready');
  await click(b, 'media-stop'); assert.equal(await ended(b), true);
  console.log('PASS simulated errors: denial/missing/busy/constraints/abort/security, unsupported/insecure, pending cancellation, duplicate starts, partial stream, playback failure, ended event, retry, WebSocket independence');
}
async function unmountScenarios(b) {
  // Mount the real component under React StrictMode with an explicit test-owned root.
  const before = await b.evaluate('mediaProbe.calls');
  await b.evaluate(`(async()=>{
    const source=await(await fetch('/src/main.tsx')).text();
    const reactUrl=source.split('"').find(p=>p.includes('/react.js?'));
    const domUrl=source.split('"').find(p=>p.includes('/react-dom_client.js?'));
    const [react,dom,{LocalMedia}]=await Promise.all([import(reactUrl),import(domUrl),import('/src/LocalMedia.tsx')]);
    const {createElement,StrictMode}=react.default??react;const {createRoot}=dom.default??dom;
    document.getElementById('root').style.display='none';
    window.testContainer=document.createElement('div');document.body.append(testContainer);
    window.mountMedia=()=>{window.mediaRoot=createRoot(testContainer);mediaRoot.render(createElement(StrictMode,null,createElement(LocalMedia)));};
    mountMedia();
  })()`);
  const start = () => b.evaluate("testContainer.querySelector('#media-start').click()");
  const ready = () => until(() => b.evaluate("testContainer.querySelector('[data-testid=media-status]')?.dataset.status==='ready'"), 'harness ready');
  await until(() => b.evaluate("!!testContainer.querySelector('#media-start')"), 'harness');
  await delay(100);
  assert.equal(await b.evaluate('mediaProbe.calls'), before);
  await start(); await ready();
  await b.evaluate("window.removedVideo=testContainer.querySelector('#local-preview');mediaRoot.unmount()"); assert.equal(await ended(b), true);
  assert.equal(await b.evaluate('removedVideo.srcObject===null'), true);
  await b.evaluate("mountMedia();mediaProbe.mode='hold'");
  await until(() => b.evaluate("!!testContainer.querySelector('#media-start')"), 'remount');
  await start();
  await until(() => b.evaluate("testContainer.querySelector('[data-testid=media-status]').dataset.status==='requesting'"), 'held unmount');
  const count = await b.evaluate('mediaProbe.streams.length');
  await b.evaluate('mediaRoot.unmount();mediaProbe.held()');
  await until(() => b.evaluate(`mediaProbe.streams.length===${count + 1} && mediaProbe.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))`), 'late unmount release');
  console.log('PASS real React StrictMode component unmount and late getUserMedia completion cleanup');
}
(async () => {
  for (const port of [3000, 5173]) {
    try { await fetch(`http://127.0.0.1:${port}`); throw Error(`Port ${port} is already in use; stop the existing dev server first.`); }
    catch (error) { if (!error.cause) throw error; }
  }
  let control;
  if (process.env.CHECK_SFU_MULTI === '1' || process.env.CHECK_SFU_CONTROL === '1') {
    const server = fork(join(__dirname, 'sfu-multi-server.cjs'), [], { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    children.push(server); server.stdout.on('data', () => {}); server.stderr.on('data', data => process.stderr.write(data));
    let seq=0; const pending=new Map();
    server.on('message', message => { const p=pending.get(message.id); if(p){pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message.result);} });
    control = (action, fields={}) => new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('test IPC timeout'));},10000);pending.set(id,{resolve,reject,timer});server.send({id,action,...fields});});
  } else child(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'server/src/index.ts']);
  child(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'client/vite.config.ts']);
  await until(async () => { try { return (await fetch('http://127.0.0.1:5173')).ok; } catch { return false; } }, 'Vite');
  await until(async () => { try { return (await fetch('http://127.0.0.1:3000/health')).ok; } catch { return false; } }, 'HTTP');
  const chrome = await browser(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  const edge = await browser(process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
  if (process.env.CHECK_SFU_CONTROL === '1') {
    const c = await browser(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
    await require('./sfu-controls.scenarios.cjs')({ pages: [chrome,edge,c], until, click, selectMedia, waitState, ended, control });
  } else if (process.env.CHECK_SFU_MULTI === '1') {
    const c = await browser(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
    const d = await browser(process.env.EDGE_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
    await require('./sfu-multi.scenarios.cjs')({ pages: [chrome,edge,c,d], until, click, selectMedia, waitState, ended, control });
  } else if (process.env.CHECK_SFU_RECEIVE === '1') {
    const killSfu = async () => {
      const { execFileSync } = require('node:child_process');
      const rows = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { windowsHide: true, encoding: 'utf8' }));
      const owned = new Set(children.map(p => p.pid));
      for (let i = 0; i < rows.length; i++) for (const row of rows) if (owned.has(row.ParentProcessId)) owned.add(row.ProcessId);
      const workers = rows.filter(row => row.Name === 'mediasoup-worker.exe' && owned.has(row.ProcessId));
      assert.equal(workers.length, 1, 'exactly one test-owned SFU worker');
      for (const row of workers) { process.kill(row.ProcessId); console.log('TEST_SFU_STOP pid=' + row.ProcessId); }
    };
    await require('./sfu-receive.scenarios.cjs')({ chrome, edge, until, click, selectMedia, waitState, ended, killSfu });
  } else if (process.env.CHECK_SFU === '1') {
    await require('./sfu-browser.scenarios.cjs')({ chrome, edge, until, click, selectMedia, waitState, ended });
  } else {
    await virtual(chrome, 'Chrome'); await virtual(edge, 'Edge');
    await mockScenarios(chrome); await unmountScenarios(chrome);
  }
  assert.equal(browsers.reduce((n,b)=>n+b.exceptions.length,0), 0);
  console.log('PASS browser runtime exceptions=0; physical devices and manual permission UI NOT tested');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const b of browsers) { try { await b.call('Browser.close'); } catch {} b.ws.terminate(); }
  for (const p of children) {
    if (p.exitCode === null) await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.once('exit', resolve); killer.once('error', resolve);
    });
  }
  // Chrome/Edge may hand the profile to a subprocess after the launcher exits.
  // A closed page also loses its CDP Browser.close channel. Match only our exact
  // temporary profile paths so that those handed-off processes cannot retain locks.
  const {execFileSync}=require('node:child_process');
  const ownedBrowsers=()=>JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',
    '$profiles=ConvertFrom-Json $env:CODEX_TEST_BROWSER_PROFILES; @(Get-CimInstance Win32_Process | Where-Object { $row=$_; ($row.Name -eq "chrome.exe" -or $row.Name -eq "msedge.exe") -and @($profiles | Where-Object { $row.CommandLine -and $row.CommandLine.Contains($_) }).Count -gt 0 } | Select-Object ProcessId) | ConvertTo-Json -Compress'],
    {windowsHide:true,encoding:'utf8',env:{...process.env,CODEX_TEST_BROWSER_PROFILES:JSON.stringify(profiles)}}) || '[]');
  const ownerList=()=>{const rows=ownedBrowsers();return Array.isArray(rows)?rows:rows?[rows]:[];};
  for(const row of ownerList()) {try{execFileSync('taskkill',['/PID',String(row.ProcessId),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
  await until(()=>ownerList().length===0,'owned browser subprocesses exit');
  const base = await realpath(tmpdir());
  for (const dir of profiles) {
    const target = await realpath(dir);
    if (dirname(target).toLowerCase() !== base.toLowerCase() || !target.toLowerCase().includes('webrtc-step06-')) throw Error('Unexpected temporary profile path');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
