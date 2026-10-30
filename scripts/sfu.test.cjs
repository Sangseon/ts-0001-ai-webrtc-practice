const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'server/dist/sfu-check.js');
const sfuModule = import(pathToFileURL(path.join(root, 'server/dist/sfu.js')).href);

async function assertExited(pid) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(20);
  }
  assert.fail(`Worker ${pid} is still running`);
}

function runCli(args, { env = process.env, onReady } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let ready = false;
    const timer = setTimeout(() => {
      child.kill();
      const pid = Number(stdout.match(/worker created pid=(\d+)/)?.[1]);
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
      reject(new Error(`SFU CLI timed out: ${stdout} ${stderr}`));
    }, 10000);
    child.stdout.on('data', data => {
      stdout += data;
      if (!ready && stdout.includes('SFU ready')) {
        ready = true;
        onReady?.(Number(stdout.match(/worker created pid=(\d+)/)[1]));
      }
    });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test('real worker and Router support Opus/VP8 and close idempotently', { timeout: 10000 }, async () => {
  const { createSfu } = await sfuModule;
  const sfu = await createSfu();
  try {
    const codecs = sfu.router.rtpCapabilities.codecs;
    assert.ok(codecs.some(codec => codec.mimeType === 'audio/opus' && codec.clockRate === 48000 && codec.channels === 2));
    assert.ok(codecs.some(codec => codec.mimeType === 'video/VP8' && codec.clockRate === 90000));
    assert.deepEqual((await sfu.router.dump()).transportIds, []);
    const firstClose = sfu.close();
    assert.equal(sfu.close(), firstClose);
    await firstClose;
    assert.equal(sfu.router.closed, true);
    assert.equal(sfu.worker.closed, true);
    assert.equal(sfu.worker.subprocessClosed, true);
    await assertExited(sfu.worker.pid);
  } finally {
    await sfu.close();
  }
});

test('Router creation failure closes the already-created native worker', { timeout: 10000 }, async () => {
  const { observer } = await import('mediasoup');
  const { createSfu } = await sfuModule;
  const created = once(observer, 'newworker');
  await assert.rejects(createSfu([
    { kind: 'video', mimeType: 'video/not-a-supported-codec', clockRate: 90000 },
  ]));
  const [worker] = await created;
  assert.equal(worker.closed, true);
  assert.equal(worker.subprocessClosed, true);
  await assertExited(worker.pid);
});

test('one-shot CLI creates and releases workers on three consecutive runs', { timeout: 15000 }, async () => {
  for (let cycle = 0; cycle < 3; cycle++) {
    const result = await runCli(['--once']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /router closed .*closed=true/);
    assert.match(result.stdout, /worker closed .*subprocessClosed=true/);
    await assertExited(Number(result.stdout.match(/worker created pid=(\d+)/)[1]));
  }
});

test('unexpected worker death closes the Router and fails the CLI', { timeout: 15000 }, async () => {
  let workerPid;
  const result = await runCli([], {
    onReady(pid) { workerPid = pid; process.kill(pid, 'SIGKILL'); },
  });
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /SFU worker died/);
  assert.match(result.stdout, /router closed .*closed=true/);
  assert.match(result.stdout, /worker closed .*subprocessClosed=true/);
  await assertExited(workerPid);
});

test('missing worker binary reports startup failure and exits', { timeout: 15000 }, async () => {
  const result = await runCli(['--once'], {
    env: { ...process.env, MEDIASOUP_WORKER_BIN: path.join(root, '.chat-history/nonexistent-worker.exe') },
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /SFU check failed:.*ENOENT/);
  assert.doesNotMatch(result.stdout, /SFU ready/);
});
