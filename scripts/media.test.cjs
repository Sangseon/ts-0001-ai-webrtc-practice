const assert = require('node:assert/strict');
const { test } = require('node:test');
const media = import('../client/src/useLocalMedia.ts');

test('media cleanup stops audio and video and returns ended snapshots', async () => {
  const { stopMediaStream } = await media;
  const tracks = ['video', 'audio'].map(kind => ({ id: kind, kind, readyState: 'live', stop() { this.readyState = 'ended'; } }));
  const stream = { getTracks: () => tracks };
  assert.deepEqual(stopMediaStream(stream), { failed: false, tracks: tracks.map(({ id, kind, readyState }) => ({ id, kind, readyState })) });
  assert.equal(stopMediaStream(stream).failed, false);
});

test('one failing stop does not prevent the remaining tracks from stopping', async () => {
  const { stopMediaStream } = await media;
  const tracks = [
    { id: 'video', kind: 'video', readyState: 'live', stop() { throw new Error('source failed'); } },
    { id: 'audio', kind: 'audio', readyState: 'live', stop() { this.readyState = 'ended'; } },
  ];
  const result = stopMediaStream({ getTracks: () => tracks });
  assert.equal(result.failed, true);
  assert.equal(result.tracks[1].readyState, 'ended');
});

test('DOMException categories have distinct guidance without claiming every error is denial', async () => {
  const { mediaErrorMessage } = await media;
  const names = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError', 'SecurityError'];
  const messages = names.map(name => mediaErrorMessage(new DOMException('test', name)));
  assert.equal(new Set(messages).size, names.length);
  assert.match(messages[0], /권한/);
  assert.match(messages[1], /장치/);
  assert.match(mediaErrorMessage(new Error('unknown')), /실패/);
  assert.match(mediaErrorMessage(null), /실패/);
});

test('NotFoundError does not claim both camera and microphone are missing', async () => {
  const { mediaErrorMessage } = await media;
  const message = mediaErrorMessage(new DOMException('Requested device not found', 'NotFoundError'));
  assert.match(message, /카메라 또는 마이크/);
  assert.match(message, /선택한 종류/);
  assert.doesNotMatch(message, /모두 찾을 수 없습니다/);
});

test('media constraints support video, audio, both and skip no selection', async () => {
  const { mediaConstraints } = await media;
  for (const selection of [{ video: true, audio: false }, { video: false, audio: true }, { video: true, audio: true }]) {
    const constraints = mediaConstraints(selection);
    assert.deepEqual(constraints, selection);
    assert.notEqual(constraints, selection);
  }
  assert.equal(mediaConstraints({ video: false, audio: false }), null);
});

test('only selected live kinds are required and unexpected tracks are rejected', async () => {
  const { matchesMediaSelection, stopMediaStream } = await media;
  for (const selection of [{ video: true, audio: false }, { video: false, audio: true }, { video: true, audio: true }]) {
    const tracks = Object.entries(selection).filter(([, selected]) => selected).map(([kind]) => ({ id: kind, kind, readyState: 'live', stop() { this.readyState = 'ended'; } }));
    const stream = { getTracks: () => tracks };
    assert.equal(matchesMediaSelection(stream, selection), true);
    assert.equal(stopMediaStream(stream).failed, false);
    assert.equal(matchesMediaSelection(stream, selection), false);
  }
  const videoOnly = { getTracks: () => [{ kind: 'video', readyState: 'live' }] };
  assert.equal(matchesMediaSelection(videoOnly, { video: true, audio: true }), false);
  assert.equal(matchesMediaSelection(videoOnly, { video: false, audio: true }), false);
});
