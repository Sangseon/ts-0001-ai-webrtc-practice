import { useEffect, useRef, useState } from 'react';
import type { RemoteTrack } from './useSfuSender';
import { avatars } from '../../server/src/shared/protocol.js';
import type { Participant } from '../../server/src/shared/protocol.js';

function Playback({ track, kind }: { track: MediaStreamTrack; kind: 'audio' | 'video' }) {
  const element = useRef<HTMLMediaElement | null>(null);
  const [state, setState] = useState('준비 중');
  const [error, setError] = useState('');
  const play = () => {
    const target = element.current;
    if (!target) return;
    setState('재생 요청 중'); setError('');
    void target.play().then(() => { if (element.current === target && target.srcObject) setState('재생 중'); }, reason => {
      if (element.current === target && target.srcObject) { setState('재생 대기'); setError(String(reason)); }
    });
  };
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    target.srcObject = new MediaStream([track]); play();
    const ended = () => setState('트랙 종료');
    track.addEventListener('ended', ended);
    return () => { track.removeEventListener('ended', ended); target.pause(); target.srcObject = null; };
  }, [track]);
  const attach = (node: HTMLMediaElement | null) => { element.current = node; };
  return <div data-remote-kind={kind} data-track-state={track.readyState}>
    {kind === 'video' ? <video ref={attach} autoPlay playsInline style={{ maxWidth: '100%', width: 360 }} /> : <audio ref={attach} autoPlay />}
    <p>{kind}: {track.readyState} · <span data-playback-state>{state}</span></p>
    {kind === 'audio' && <p>브라우저 재생 상태이며 실제 청취 확인은 별도입니다.</p>}
    {error && <p role="alert">자동 재생 또는 장치 출력 실패: {error}</p>}
    <button onClick={play}>원격 {kind === 'audio' ? '음성' : '영상'} 재생</button>
  </div>;
}

export function RemoteMedia({ tracks, profiles }: { tracks: RemoteTrack[]; profiles: Record<string, Participant> }) {
  const ids = [...new Set(tracks.map(t => t.participantId))];
  return <section aria-label="원격 미디어">
    <h3>활성 회의방의 원격 미디어</h3>
    {!ids.length && <p>현재 수신 중인 원격 트랙이 없습니다.</p>}
    {ids.map(id => {
      const profile = profiles[id];
      const owned = tracks.filter(t => t.participantId === id);
      return <article key={id} data-remote-participant={id}>
        <h4>{avatars.find(a => a.id === profile?.avatarId)?.emoji} {profile?.nickname ?? id}</h4>
        <p>{id} · Consumer {owned.length}개</p>
        {owned.map(t => <Playback key={t.consumerId} kind={t.kind} track={t.track} />)}
      </article>;
    })}
  </section>;
}
