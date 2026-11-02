const assert = require('node:assert/strict');
const { test } = require('node:test');
const level = import('../client/src/microphoneLevel.ts');

test('silence and empty input have zero RMS and display level', async () => {
  const { microphoneRms, microphoneLevel } = await level;
  assert.equal(microphoneRms(new Float32Array(2048)), 0);
  assert.equal(microphoneRms([]), 0);
  assert.equal(microphoneLevel(0), 0);
});
test('PCM polarity is symmetric and greater amplitude raises RMS', async () => {
  const { microphoneRms, microphoneLevel } = await level;
  assert.equal(microphoneRms([0.25, -0.25]), 0.25);
  assert.equal(microphoneRms([-0.5, 0.5]), 0.5);
  assert.equal(microphoneLevel(microphoneRms([0.25, -0.25])), 50);
  assert.equal(microphoneLevel(microphoneRms([0.5, -0.5])), 100);
});
test('non-finite PCM and display inputs cannot overflow the meter', async () => {
  const { microphoneRms, microphoneLevel } = await level;
  assert.equal(microphoneRms([0.1, NaN]), 0);
  assert.equal(microphoneRms([Infinity]), 0);
  assert.equal(microphoneRms([2, -2]), 1);
  assert.equal(microphoneLevel(-1), 0);
  assert.equal(microphoneLevel(999), 100);
  assert.equal(microphoneLevel(NaN), 0);
});
