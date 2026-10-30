import { useEffect, useRef, useState } from 'react';

export type TrackInfo = { id: string; kind: string; readyState: MediaStreamTrackState };
export type MediaSelection = { video: boolean; audio: boolean };
export function mediaConstraints(selection: MediaSelection): MediaSelection | null {
  return selection.video || selection.audio ? { video: selection.video, audio: selection.audio } : null;
}
export function matchesMediaSelection(stream: MediaStream, selection: MediaSelection): boolean {
  return (['video', 'audio'] as const).every(kind => {
    const tracks = stream.getTracks().filter(track => track.kind === kind);
    return selection[kind] ? tracks.some(track => track.readyState === 'live') : tracks.length === 0;
  });
}
type MediaState = { status: 'idle' | 'requesting' | 'ready' | 'stopping' | 'error'; tracks: TrackInfo[]; error: string };
const trackInfo = (stream: MediaStream): TrackInfo[] => stream.getTracks().map(({ id, kind, readyState }) => ({ id, kind, readyState }));
const cleanupWarning = (failed: boolean) => failed ? ' 일부 트랙을 종료하지 못했습니다. 브라우저의 장치 사용 표시를 확인해주세요.' : '';

// Attempt every track even if one source fails to release; callers report failure.
export function stopMediaStream(stream: MediaStream) {
  let failed = false;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { failed = true; }
  }
  return { tracks: trackInfo(stream), failed: failed || stream.getTracks().some(track => track.readyState !== 'ended') };
}

export function mediaErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError': return '카메라·마이크 접근이 허용되지 않았습니다. 브라우저 권한, 운영체제 권한 또는 페이지 접근 정책을 확인한 뒤 다시 시도해주세요.';
    case 'NotFoundError': return '요청한 카메라 또는 마이크를 찾을 수 없습니다. 선택한 종류의 장치 연결 및 사용 가능 여부를 확인해주세요.';
    case 'NotReadableError': return '장치를 읽을 수 없습니다. 다른 프로그램의 장치 사용 여부와 운영체제 상태를 확인해주세요.';
    case 'OverconstrainedError': return '요청한 조건을 만족하는 카메라·마이크가 없습니다.';
    case 'AbortError': return '브라우저가 미디어 획득을 중단했습니다. 다시 시도해주세요.';
    case 'SecurityError': return '브라우저의 보안 정책으로 미디어 접근이 차단되었습니다.';
    default: return '카메라·마이크 획득 또는 영상 재생에 실패했습니다. 장치와 브라우저 상태를 확인한 뒤 다시 시도해주세요.';
  }
}

export function useLocalMedia() {
  const [state, setState] = useState<MediaState>({ status: 'idle', tracks: [], error: '' });
  const [pending, setPending] = useState(false);
  const [cameraPending, setCameraPending] = useState(false);
  const cameraRequest = useRef(false);
  const trackEnded = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // React can clear the DOM ref before passive unmount cleanup runs.
  const attachedVideo = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const request = useRef<number | null>(null);
  const detachListeners = useRef<(() => void) | null>(null);

  function release() {
    detachListeners.current?.();
    detachListeners.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    const video = attachedVideo.current ?? videoRef.current;
    attachedVideo.current = null;
    if (video) {
      try { video.pause(); } catch { /* Still release the stream and tracks. */ }
      video.srcObject = null;
    }
    return stream ? stopMediaStream(stream) : { tracks: [], failed: false };
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      release();
    };
  }, []);

  function stop() {
    generation.current++;
    const result = release();
    if (!mounted.current) return;
    setState({ status: result.failed ? 'error' : request.current !== null ? 'stopping' : 'idle', tracks: result.tracks,
      error: result.failed ? '일부 트랙을 종료하지 못했습니다. 브라우저의 장치 사용 표시를 확인해주세요.' : '' });
  }

  function dropVideo(expected?: MediaStreamTrack) {
    const stream = streamRef.current;
    if (!stream) return;
    for (const track of stream.getVideoTracks()) if (!expected || track === expected) {
      if (trackEnded.current) track.removeEventListener('ended', trackEnded.current);
      track.stop(); stream.removeTrack(track);
    }
    if (!stream.getVideoTracks().length) {
      const video = attachedVideo.current ?? videoRef.current;
      if (video) { video.pause(); video.srcObject = null; }
      attachedVideo.current = null;
    }
    if (mounted.current) setState(s => ({ ...s, tracks: trackInfo(stream) }));
  }

  async function acquireVideo(valid: () => boolean) {
    const stream = streamRef.current, epoch = generation.current;
    if (!stream || cameraRequest.current || stream.getVideoTracks().some(t => t.readyState === 'live')) throw new Error('카메라가 이미 사용 중이거나 획득 중입니다.');
    const current = () => mounted.current && generation.current === epoch && streamRef.current === stream && valid();
    cameraRequest.current = true; setCameraPending(true);
    let acquired: MediaStream | undefined;
    try {
      if (!window.isSecureContext) throw new DOMException('Secure context required', 'SecurityError');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('MediaDevices API 미지원');
      acquired = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (!current()) throw new Error('취소된 카메라 획득');
      if (!matchesMediaSelection(acquired, { video: true, audio: false }) || acquired.getVideoTracks().length !== 1) throw new DOMException('Missing video', 'NotFoundError');
      const track = acquired.getVideoTracks()[0]!;
      stream.addTrack(track);
      if (trackEnded.current) track.addEventListener('ended', trackEnded.current);
      const video = videoRef.current;
      if (!video) throw new Error('미리보기 요소 없음');
      attachedVideo.current = video; video.muted = true; video.srcObject = stream;
      await video.play();
      if (!current()) throw new Error('취소된 카메라 미리보기');
      setState(s => ({ ...s, tracks: trackInfo(stream), error: '' }));
      return track;
    } catch (error) {
      if (acquired) for (const track of acquired.getTracks()) { dropVideo(track); track.stop(); }
      throw error;
    } finally {
      cameraRequest.current = false;
      if (mounted.current) setCameraPending(false);
    }
  }

  async function start(selection: MediaSelection) {
    if (!mounted.current || request.current !== null || streamRef.current) return;
    const constraints = mediaConstraints(selection);
    if (!constraints) return;
    if (!window.isSecureContext) {
      setState({ status: 'error', tracks: [], error: '미디어 접근에는 보안 컨텍스트가 필요합니다. localhost·127.0.0.1 또는 신뢰할 수 있는 HTTPS 주소를 사용해주세요.' });
      return;
    }
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setState({ status: 'error', tracks: [], error: '이 브라우저에서 MediaDevices.getUserMedia API를 사용할 수 없습니다.' });
      return;
    }
    const id = ++generation.current;
    request.current = id;
    setPending(true);
    setState({ status: 'requesting', tracks: [], error: '' });
    const current = () => mounted.current && id === generation.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!current()) {
        const result = stopMediaStream(stream);
        if (mounted.current) setState({ status: result.failed ? 'error' : 'idle', tracks: result.tracks,
          error: result.failed ? '늦게 획득한 미디어의 일부 트랙을 종료하지 못했습니다.' : '' });
        return;
      }
      streamRef.current = stream;
      if (!matchesMediaSelection(stream, constraints)) {
        throw new DOMException('The stream must match the requested media kinds', 'NotFoundError');
      }
      const ended = () => {
        if (!current()) return;
        generation.current++;
        const result = release();
        setState({ status: 'error', tracks: result.tracks, error: '카메라 또는 마이크 트랙이 예기치 않게 종료되었습니다. 장치·권한 상태를 확인한 뒤 다시 시작해주세요.' + cleanupWarning(result.failed) });
      };
      trackEnded.current = ended;
      for (const track of stream.getTracks()) track.addEventListener('ended', ended);
      detachListeners.current = () => { for (const track of stream.getTracks()) track.removeEventListener('ended', ended); };
      if (!constraints.video) {
        setState({ status: 'ready', tracks: trackInfo(stream), error: '' });
        return;
      }
      const video = videoRef.current;
      if (!video) throw new Error('Preview element is unavailable');
      attachedVideo.current = video;
      video.muted = true;
      video.srcObject = stream;
      try { await video.play(); } catch {
        if (!current()) return;
        const result = release();
        setState({ status: 'error', tracks: result.tracks, error: '로컬 영상 미리보기를 재생하지 못했습니다. 트랙 정리를 시도했습니다. 다시 시작해주세요.' + cleanupWarning(result.failed) });
        return;
      }
      if (current()) setState({ status: 'ready', tracks: trackInfo(stream), error: '' });
    } catch (error) {
      if (current()) {
        const result = release();
        setState({ status: 'error', tracks: result.tracks, error: mediaErrorMessage(error) + cleanupWarning(result.failed) });
      } else if (mounted.current) setState({ status: 'idle', tracks: [], error: '' });
    } finally {
      if (request.current === id) {
        request.current = null;
        if (mounted.current) {
          setPending(false);
          // A cancelled preview play may finish after stop() changed the state.
          setState(value => value.status === 'stopping' ? { ...value, status: 'idle' } : value);
        }
      }
    }
  }

  return { ...state, pending, cameraPending, start, stop, dropVideo, acquireVideo, videoRef, streamRef };
}
