module.exports = `(() => {
  const NativeContext = window.AudioContext;
  window.meterProbe = { contexts: [], mode: 'native', resumeMode: 'native', destinationConnections: 0, meterFrames: new Set() };
  window.AudioContext = class extends NativeContext {
    constructor(...args) { if (meterProbe.resumeMode === 'constructorError') throw Error('fixture context failure'); super(...args); meterProbe.contexts.push(this); }
    resume() { return meterProbe.resumeMode === 'resumeError' ? Promise.reject(Error('fixture resume failure')) : super.resume(); }
  };
  const data = AnalyserNode.prototype.getFloatTimeDomainData;
  AnalyserNode.prototype.getFloatTimeDomainData = function(samples) {
    if (meterProbe.mode === 'silence') { samples.fill(0); return; }
    if (meterProbe.mode === 'signal') { for (let i=0;i<samples.length;i++) samples[i]=i%2?0.25:-0.25; return; }
    return data.call(this,samples);
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(target,...args) {
    if (target === this.context.destination) meterProbe.destinationConnections++;
    return connect.call(this,target,...args);
  };
  const frame = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    const meter = callback.name === 'tick';
    const id = frame(now => { if (meter) meterProbe.meterFrames.delete(id); callback(now); });
    if (meter) meterProbe.meterFrames.add(id); return id;
  };
  window.cancelAnimationFrame = id => { meterProbe.meterFrames.delete(id); cancel(id); };
})();`;
