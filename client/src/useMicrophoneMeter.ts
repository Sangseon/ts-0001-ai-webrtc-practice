import { useEffect, useRef, useState } from 'react';
import { deviceConstraint } from './useMediaDevices';
import { mediaErrorMessage, stopMediaStream } from './useLocalMedia';
import type { useLocalMedia } from './useLocalMedia';
import { microphoneLevel, microphoneRms } from './microphoneLevel';

type LocalMedia = ReturnType<typeof useLocalMedia>;
type MeterStatus = 'idle' | 'starting' | 'running' | 'suspended' | 'stopping' | 'error';
type MeterState = { status: MeterStatus; rms: number; level: number; deviceId: string; trackId: string; requestedId: string; owned: boolean; error: string };
type Session = {
  track: MediaStreamTrack; stream: MediaStream; owned: boolean; selectedId: string;
  context: AudioContext; source: MediaStreamAudioSourceNode; analyser: AnalyserNode;
  raf: number | null; ended: () => void; visibility: () => void; stateChange: () => void;
};
const initial: MeterState = { status: 'idle', rms: 0, level: 0, deviceId: '', trackId: '', requestedId: '', owned: false, error: '' };

export function useMicrophoneMeter(local: LocalMedia, callMuted: boolean) {
  const [state, setState] = useState<MeterState>(initial);
  const session = useRef<Session | null>(null);
  const generation = useRef(0);
  const pending = useRef<number | null>(null);
  const mounted = useRef(false);
  const selectedRef = useRef(local.devices.selected.audio);
  selectedRef.current = local.devices.selected.audio;

  function dispose(value: Session) {
    if (value.raf !== null) cancelAnimationFrame(value.raf);
    value.track.removeEventListener('ended', value.ended);
    document.removeEventListener('visibilitychange', value.visibility);
    value.context.removeEventListener('statechange', value.stateChange);
    value.source.disconnect(); value.analyser.disconnect();
    if (value.owned) stopMediaStream(value.stream);
    return value.context.close().catch(() => {});
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; generation.current++;
      const active = session.current; session.current = null;
      if (active) void dispose(active);
    };
  }, []);

  async function stop(message = '') {
    const epoch = ++generation.current;
    const active = session.current; session.current = null;
    if (mounted.current) setState({ ...initial, status: pending.current !== null || active ? 'stopping' : message ? 'error' : 'idle', error: message });
    if (active) await dispose(active);
    if (mounted.current && generation.current === epoch && pending.current === null) setState({ ...initial, status: message ? 'error' : 'idle', error: message });
  }

  function begin(value: Session, epoch: number) {
    const samples = new Float32Array(value.analyser.fftSize);
    let last = 0;
    const tick = (now: number) => {
      if (session.current !== value || generation.current !== epoch) return;
      if (value.track.readyState !== 'live') { void stop('분석 중인 마이크 트랙이 종료됐습니다. 다시 시작해주세요.'); return; }
      if (value.context.state !== 'running') { setState(s => ({ ...s, status: 'suspended', rms: 0, level: 0 })); value.raf = null; return; }
      if (now - last >= 100) {
        value.analyser.getFloatTimeDomainData(samples);
        const rms = microphoneRms(samples);
        if (mounted.current) setState(s => ({ ...s, status: 'running', rms, level: microphoneLevel(rms) }));
        last = now;
      }
      value.raf = requestAnimationFrame(tick);
    };
    if (value.raf === null) value.raf = requestAnimationFrame(tick);
  }

  async function start() {
    if (!mounted.current || pending.current !== null || session.current) return;
    const epoch = ++generation.current;
    pending.current = epoch;
    setState({ ...initial, status: 'starting' });
    const selectedId = local.devices.selected.audio;
    const currentTrack = local.streamRef.current?.getAudioTracks().find(track => track.readyState === 'live' && track.enabled);
    // A changed explicit selection needs its own track until the call's Apply is used.
    const shared = !callMuted && currentTrack && (!selectedId || currentTrack.getSettings().deviceId === selectedId) ? currentTrack : undefined;
    let ownedStream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let handedOff = false;
    const valid = () => mounted.current && generation.current === epoch && selectedRef.current === selectedId;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error('보안 컨텍스트와 MediaDevices·Web Audio API가 필요합니다.');
      if (local.devices.status === 'ready' && selectedId && !local.devices.devices.some(d => d.kind === 'audio' && d.deviceId === selectedId)) throw new DOMException('Selected microphone is missing', 'NotFoundError');
      if (!shared) ownedStream = await navigator.mediaDevices.getUserMedia({ audio: deviceConstraint(selectedId), video: false });
      if (!valid()) return;
      const track = shared ?? ownedStream?.getAudioTracks()[0];
      if (!track || track.readyState !== 'live' || (!shared && (ownedStream?.getTracks().length !== 1 || track.kind !== 'audio'))) throw new DOMException('No live microphone track', 'NotFoundError');
      const stream = shared ? new MediaStream([shared]) : ownedStream!;
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser(); analyser.fftSize = 2048;
      source.connect(analyser); // Never connect to context.destination.
      const value: Session = { track, stream, owned: !shared, selectedId, context, source, analyser, raf: null,
        ended: () => { void stop('분석 중인 마이크 트랙이 종료됐습니다. 다시 시작해주세요.'); },
        visibility: () => { if (document.hidden && session.current === value) setState(s => ({ ...s, rms: 0, level: 0 })); },
        stateChange: () => {
          if (session.current !== value) return;
          if (context!.state === 'running') begin(value, epoch);
          else { if (value.raf !== null) cancelAnimationFrame(value.raf); value.raf = null; setState(s => ({ ...s, status: 'suspended', rms: 0, level: 0 })); }
        } };
      if (!valid()) return;
      session.current = value;
      handedOff = true;
      track.addEventListener('ended', value.ended);
      document.addEventListener('visibilitychange', value.visibility);
      context.addEventListener('statechange', value.stateChange);
      setState({ status: 'starting', rms: 0, level: 0, deviceId: track.getSettings().deviceId ?? '', trackId: track.id, requestedId: selectedId, owned: !shared, error: '' });
      await context.resume();
      if (!valid()) return;
      if (context.state === 'running') begin(value, epoch);
      else setState(s => ({ ...s, status: 'suspended', rms: 0, level: 0 }));
    } catch (error) {
      if (session.current?.context === context) { const active = session.current; session.current = null; if (active) await dispose(active); }
      if (valid()) setState({ ...initial, status: 'error', error: error instanceof DOMException ? mediaErrorMessage(error) : '마이크 입력 분석을 시작하지 못했습니다: ' + String(error) });
    } finally {
      if (!handedOff) {
        source?.disconnect(); analyser?.disconnect();
        if (context) void context.close().catch(() => {});
        if (ownedStream) stopMediaStream(ownedStream);
      } else if (!valid() && session.current?.context === context) { const active = session.current; session.current = null; if (active) void dispose(active); }
      if (pending.current === epoch) pending.current = null;
      if (mounted.current && !valid() && !session.current) setState(initial);
    }
  }

  async function resume() {
    const active = session.current;
    if (!active || state.status !== 'suspended') return;
    try { await active.context.resume(); if (session.current === active && active.context.state === 'running') begin(active, generation.current); }
    catch (error) { if (session.current === active) await stop('오디오 분석을 재개하지 못했습니다: ' + String(error)); }
  }
  // A shared call track can be replaced or released by Step 11/06. The user
  // explicitly restarts the meter for the new source; no old node survives.
  const callAudioId = local.tracks.find(track => track.kind === 'audio' && track.readyState === 'live')?.id;
  useEffect(() => {
    const active = session.current;
    if (active && !active.owned && active.track.id !== callAudioId) void stop('통화 마이크가 변경됐습니다. 새 장치로 테스트를 다시 시작해주세요.');
  }, [callAudioId]);
  useEffect(() => {
    if (callMuted && session.current && !session.current.owned) void stop('통화 마이크가 음소거됐습니다. 입력을 보려면 테스트를 다시 시작해주세요.');
  }, [callMuted]);
  return { ...state, start, stop, resume, selectedId: local.devices.selected.audio };
}
