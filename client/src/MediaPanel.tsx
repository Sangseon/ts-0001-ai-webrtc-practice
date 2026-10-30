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
    <section aria-label="SFU 송수신">
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
      <div aria-label="송신 장치 제어">
        <p data-testid="camera-state">카메라: {sender.cameraState}</p>
        <p data-testid="mic-state" data-muted={sender.muted}>마이크: {sender.micState}</p>
        <button id="camera-off" disabled={!sender.canSend || sender.cameraState === '꺼짐' || sender.cameraState === '미획득' || sender.cameraState === '끄는 중'} onClick={() => void sender.cameraOff()}>카메라 OFF / 켜기 취소</button>{' '}
        <button id="camera-on" disabled={!sender.canSend || sender.cameraState === '송신 중' || sender.cameraState === '다시 켜는 중' || sender.cameraState === '끄는 중' || local.cameraPending} onClick={() => void sender.cameraOn()}>카메라 ON</button>{' '}
        <button id="mic-toggle" disabled={!sender.canSend || !sender.hasMicrophone || sender.micState === '음소거 처리 중' || sender.micState === '음소거 해제 중'} onClick={() => void sender.setMicrophoneMuted(sender.micState === '오류' ? true : !sender.muted)}>{sender.micState === '오류' ? '음소거 다시 확인' : sender.muted ? '마이크 음소거 해제' : '마이크 음소거'}</button>
        {!sender.hasMicrophone && <p>마이크 송신을 처음 시작하려면 로컬 미디어 선택·SFU 연결을 명시적으로 진행하세요. 음소거 해제는 장치를 획득하지 않습니다.</p>}
        {sender.controlError && <p role="alert" data-testid="media-control-error">{sender.controlError}</p>}
      </div>
      <p>원격 참가자 {new Set(sender.remoteTracks.map(track => track.participantId)).size}명 · 수신 트랙 {sender.remoteTracks.length}개 (논리 회의방 참가자 수와 별개)</p>
      {sender.error && <p role="alert">{sender.error}</p>}
      <pre data-testid="sfu-stats">{JSON.stringify(sender.stats, null, 2)}</pre>
      <RemoteMedia tracks={sender.remoteTracks} profiles={session.profiles} peers={sender.remotePeers} />
    </section>
  </>;
}
