// Camera IDs remain native Chromium virtual devices. Two microphone IDs are
// deliberately MOCK identities backed by the same native fake audio source.
module.exports = `(() => {
  const md = navigator.mediaDevices;
  const enumerate = md.enumerateDevices.bind(md), capture = md.getUserMedia.bind(md);
  Object.assign(mediaProbe, { enumerateCalls: 0, listMode: 'native', removedDevice: '', replaceMode: 'native', deviceListeners: new Set() });
  const add = md.addEventListener.bind(md), remove = md.removeEventListener.bind(md);
  md.addEventListener = (name, fn, ...rest) => { if (name === 'devicechange') mediaProbe.deviceListeners.add(fn); return add(name, fn, ...rest); };
  md.removeEventListener = (name, fn, ...rest) => { if (name === 'devicechange') mediaProbe.deviceListeners.delete(fn); return remove(name, fn, ...rest); };
  md.enumerateDevices = async () => {
    mediaProbe.enumerateCalls++;
    const mode = mediaProbe.listMode;
    if (mode === 'error') throw new DOMException('fixture enumeration failed', 'NotReadableError');
    const list = await enumerate();
    const result = list.filter(d => d.kind !== 'audioinput').map(d => ({kind:d.kind,deviceId:d.deviceId,label:d.label,groupId:d.groupId}));
    const microphone = list.find(d => d.kind === 'audioinput');
    if (microphone) for (const id of ['mock-mic-a','mock-mic-b']) result.push({kind:'audioinput',deviceId:id,label: id,groupId:'mock'});
    if (mode === 'hold') await new Promise(resolve => mediaProbe.heldList = resolve);
    if (mode === 'empty') return [];
    return result.filter(d => d.deviceId !== mediaProbe.removedDevice).map(d => mode === 'private' ? {...d,label:''} : d);
  };
  md.getUserMedia = async options => {
    const id = options.audio?.deviceId?.exact;
    if (typeof id !== 'string' || !id.startsWith('mock-mic-')) return capture(options);
    if (id === mediaProbe.removedDevice) throw new DOMException('fixture removed', 'NotFoundError');
    const stream = await capture({...options,audio:true});
    mediaProbe.options[mediaProbe.options.length-1] = options;
    for (const track of stream.getAudioTracks()) {
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({...settings(),deviceId:id});
    }
    return stream;
  };
  const replace = RTCRtpSender.prototype.replaceTrack;
  RTCRtpSender.prototype.replaceTrack = async function(track) {
    if (mediaProbe.replaceMode === 'error') throw new DOMException('fixture replace failed', 'InvalidModificationError');
    if (mediaProbe.replaceMode === 'hold') await new Promise(resolve => mediaProbe.heldReplace = resolve);
    return replace.call(this,track);
  };
})();`;
