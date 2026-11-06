import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocalMedia } from './useLocalMedia';
import { LocalMediaControls } from './LocalMedia';
import { useSfuSender } from './useSfuSender';
import { RemoteMedia } from './RemoteMedia';
import type { useSession } from './useSession';

function LocalStagePreview({ track }: { track?: MediaStreamTrack }) {
  const video = useRef<HTMLVideoElement>(null);
  const camera = track?.readyState === 'live' ? track : undefined;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = camera ? new MediaStream([camera]) : null;
    return () => { element.srcObject = null; };
  }, [camera]);
  return <div className="local-stage-tile"><video ref={video} hidden={!camera} muted autoPlay playsInline aria-label="내 영상" />{!camera && <div className="tile-placeholder">카메라 꺼짐 · 내 화면</div>}<span className="tile-caption">내 화면</span></div>;
}

function PersistentDialog({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} id={`${id}-trigger`} type="button" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>{title}</button>
    <dialog ref={dialog} id={id} className="dashboard-dialog" aria-labelledby={`${id}-title`} onClose={() => trigger.current?.focus()}>
      <div className="dialog-heading"><h2 id={`${id}-title`}>{title}</h2><button type="button" onClick={() => dialog.current?.close()}>닫기</button></div>
      <div className="dialog-content">{children}</div>
    </dialog>
  </>;
}

export function MediaPanel({ session, target, setTarget, reportActive }: { session: ReturnType<typeof useSession>; target: string; setTarget: (roomId: string) => void; reportActive: (roomId: string, phase: string) => void }) {
  const local = useLocalMedia();
  const sender = useSfuSender(session, local);
  const joined = session.rooms.filter(room => Object.hasOwn(session.joinedRooms, room.roomId));
  const selected = joined.some(r => r.roomId === target) ? target : '';
  const activeRoom = session.rooms.find(room => room.roomId === sender.activeMediaRoomId);
  useEffect(() => { reportActive(sender.activeMediaRoomId, sender.phase); }, [sender.activeMediaRoomId, sender.phase, reportActive]);
  return <>
    <section className="media-connect-panel panel" aria-label="미디어 연결 대상">
      <div className="panel-heading"><div><span className="eyebrow">MEDIA DESTINATION</span><h2>미디어 연결</h2></div></div>
      <p className="supporting-text">왼쪽에서 대상을 고른 뒤 연결하세요. 채팅 채널과 실제 활성 미디어는 선택만으로 바뀌지 않습니다.</p>
      <label htmlFor="sfu-room">미디어 대상 회의방</label>{' '}
      <select id="sfu-room" value={selected} onChange={event => setTarget(event.target.value)}>
        <option value="">선택하세요</option>
        {joined.map(room => <option key={room.roomId} value={room.roomId}>{room.name} ({room.roomId})</option>)}
      </select>{' '}
      {!selected && <p className="supporting-text">먼저 회의방에 입장한 뒤 미디어 대상을 선택하세요.</p>}
      <button id="sfu-start" disabled={!selected || local.status !== 'ready' || session.status !== 'connected' || sender.phase === 'connecting' || sender.phase === 'stopping'} onClick={() => void sender.start(selected)}>{sender.activeMediaRoomId && selected !== sender.activeMediaRoomId ? `${session.rooms.find(room => room.roomId === selected)?.name ?? '선택한 방'}으로 미디어 전환` : sender.activeMediaRoomId ? '선택한 방에 다시 연결' : 'SFU 송신 시작'}</button>{' '}
      <button id="sfu-receive" disabled={!selected || session.status !== 'connected' || sender.phase === 'connecting' || sender.phase === 'stopping'} onClick={() => void sender.start(selected, true)}>선택한 방 수신만 연결</button>{' '}
      {sender.activeMediaRoomId && selected && selected !== sender.activeMediaRoomId && <p className="supporting-text">전환을 누르면 기존 방의 송수신을 종료한 뒤 새 방에 연결합니다. 실패하면 기존 연결이 이미 닫혔을 수 있습니다.</p>}
    </section>
    <section id="meeting" className="conference-panel panel" aria-label="SFU 송수신">
      <div className="panel-heading"><div><span className="eyebrow">LIVE MEETING</span><h2>미디어 연결 중: {activeRoom?.name ?? (sender.activeMediaRoomId ? '연결 확인 중' : '미연결')}</h2></div><span className="status-pill">{sender.phase === 'connecting' ? '연결 중' : sender.phase === 'stopping' ? '종료 중' : sender.activeMediaRoomId ? '연결됨' : '미연결'}</span></div>
      <p className="supporting-text">왼쪽 미디어 대상이나 오른쪽 채팅을 바꿔도 이 회의는 유지됩니다.</p>
      <LocalStagePreview track={local.streamRef.current?.getVideoTracks()[0]} />
      <RemoteMedia tracks={sender.remoteTracks} profiles={session.profiles} peers={sender.remotePeers} />
      <div className="call-controls" aria-label="송신 장치 제어">
      <button id="sfu-stop" disabled={!sender.activeMediaRoomId} onClick={() => void sender.stop().catch(() => {})}>SFU 송수신 종료</button>
        <p data-testid="camera-state">카메라: {sender.cameraState}</p>
        <p data-testid="mic-state" data-muted={sender.muted}>마이크: {sender.micState}</p>
        <button id="camera-off" disabled={!sender.canSend || sender.cameraState === '꺼짐' || sender.cameraState === '미획득' || sender.cameraState === '끄는 중'} onClick={() => void sender.cameraOff()}>카메라 OFF / 켜기 취소</button>{' '}
        <button id="camera-on" disabled={!sender.canSend || sender.cameraState === '송신 중' || sender.cameraState === '다시 켜는 중' || sender.cameraState === '끄는 중' || local.cameraPending} onClick={() => void sender.cameraOn()}>카메라 ON</button>{' '}
        <button id="mic-toggle" disabled={!sender.canSend || !sender.hasMicrophone || local.switching.audio || sender.micState === '음소거 처리 중' || sender.micState === '음소거 해제 중'} onClick={() => void sender.setMicrophoneMuted(sender.micState === '오류' ? true : !sender.muted)}>{sender.micState === '오류' ? '음소거 다시 확인' : sender.muted ? '마이크 음소거 해제' : '마이크 음소거'}</button>
        <PersistentDialog id="devices" title="장치 설정"><LocalMediaControls media={local} onSwitch={sender.switchDevice} callMuted={sender.muted} microphoneBusy={sender.micState === '음소거 처리 중' || sender.micState === '음소거 해제 중'} onStop={() => { void sender.stop().catch(() => {}); local.stop(); }} /></PersistentDialog>
        <PersistentDialog id="diagnostics" title="연결 진단">
          <p>내 participantId: <code data-testid="self-id">{session.selfId ?? '없음'}</code></p>
          <p>WebSocket: {session.status} · 활성 미디어 회의방: {sender.activeMediaRoomId || '없음'}</p>
          <p data-testid="sfu-state" data-phase={sender.phase} data-room-id={sender.activeMediaRoomId} data-transport-id={sender.transportId} data-media-id={sender.mediaId}>상태: {sender.phase} · Transport: {sender.connection}</p>
          <p>Producer: {sender.producers.map(p => `${p.kind} (${p.id})`).join(', ') || '없음'}</p>
          <p data-testid="recv-state">Recv Transport: {sender.recvConnection}</p>
          <p>원격 참가자 {new Set(sender.remoteTracks.map(track => track.participantId)).size}명 · 수신 트랙 {sender.remoteTracks.length}개</p>
          <pre data-testid="sfu-stats">{JSON.stringify(sender.stats, null, 2)}</pre>
          <section aria-label="접속 사용자"><h3>전체 접속 사용자 ({session.participants.length}명)</h3><ul data-testid="participants">{session.participants.map(participant => <li key={participant.participantId} data-participant-id={participant.participantId}>{participant.nickname}<code>{participant.participantId}</code></li>)}</ul></section>
        </PersistentDialog>
        {!sender.hasMicrophone && <p>마이크 송신을 처음 시작하려면 로컬 미디어 선택·SFU 연결을 명시적으로 진행하세요. 음소거 해제는 장치를 획득하지 않습니다.</p>}
        {sender.controlError && <p role="alert" data-testid="media-control-error">{sender.controlError}</p>}
      </div>
      {sender.error && <p role="alert">{sender.error}</p>}
    </section>
  </>;
}
