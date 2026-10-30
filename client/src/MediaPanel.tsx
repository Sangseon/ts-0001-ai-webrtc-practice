import { useState } from 'react';
import { useLocalMedia } from './useLocalMedia';
import { LocalMediaControls } from './LocalMedia';
import { useSfuSender } from './useSfuSender';
import { RemoteMedia } from './RemoteMedia';
import type { useSession } from './useSession';

export function MediaPanel({ session }: { session: ReturnType<typeof useSession> }) {
  const local = useLocalMedia();
  const sender = useSfuSender(session, local);
  const [target, setTarget] = useState('');
  const joined = session.rooms.filter(room => Object.hasOwn(session.joinedRooms, room.roomId));
  const selected = joined.some(r => r.roomId === target) ? target : '';
  return <>
    <LocalMediaControls media={local} onStop={() => { void sender.stop().catch(() => {}); local.stop(); }} />
    <section aria-label="SFU 송신">
      <h2>SFU 미디어 송수신</h2>
      <p>방 목록·채팅 화면 선택과 독립적입니다. 한 번에 한 방으로만 송수신합니다.</p>
      <label htmlFor="sfu-room">미디어 대상 회의방</label>{' '}
      <select id="sfu-room" value={selected} onChange={event => setTarget(event.target.value)}>
        <option value="">선택하세요</option>
        {joined.map(room => <option key={room.roomId} value={room.roomId}>{room.name} ({room.roomId})</option>)}
      </select>{' '}
      <button id="sfu-start" disabled={!selected || local.status !== 'ready' || session.status !== 'connected' || sender.phase === 'connecting' || sender.phase === 'stopping'} onClick={() => void sender.start(selected)}>{sender.activeMediaRoomId ? '선택한 방으로 미디어 전환' : 'SFU 송신 시작'}</button>{' '}
      <button id="sfu-receive" disabled={!selected || session.status !== 'connected' || sender.phase === 'connecting' || sender.phase === 'stopping'} onClick={() => void sender.start(selected, true)}>선택한 방 수신만 연결</button>{' '}
      <button id="sfu-stop" disabled={!sender.activeMediaRoomId} onClick={() => void sender.stop().catch(() => {})}>SFU 송수신 종료</button>
      <p data-testid="sfu-state" data-phase={sender.phase} data-room-id={sender.activeMediaRoomId} data-transport-id={sender.transportId} data-media-id={sender.mediaId}>상태: {sender.phase} · Transport: {sender.connection}</p>
      <p>활성 미디어 회의방: {sender.activeMediaRoomId || '없음'}</p>
      <p>Producer: {sender.producers.map(p => `${p.kind} (${p.id})`).join(', ') || '없음'}</p>
      <p data-testid="recv-state">Recv Transport: {sender.recvConnection}</p>
      {sender.error && <p role="alert">{sender.error}</p>}
      <pre data-testid="sfu-stats">{JSON.stringify(sender.stats, null, 2)}</pre>
      <RemoteMedia tracks={sender.remoteTracks} profiles={session.profiles} />
    </section>
  </>;
}
