import { useLocalMedia } from './useLocalMedia';
import { useMicrophoneMeter } from './useMicrophoneMeter';
import { useState } from 'react';

export function LocalMedia() {
  const media = useLocalMedia();
  return <LocalMediaControls media={media} />;
}

export function LocalMediaControls({ media, onStop, onSwitch, microphoneBusy = false, callMuted = false }: { media: ReturnType<typeof useLocalMedia>; onStop?: () => void; onSwitch?: (kind: 'video' | 'audio') => Promise<void>; microphoneBusy?: boolean; callMuted?: boolean }) {
  const meter = useMicrophoneMeter(media, callMuted);
  const [selection, setSelection] = useState({ video: true, audio: true });
  const locked = media.pending || media.cameraPending || media.status === 'ready';
  const labels = { idle: '시작 전 / 종료됨', requesting: '선택한 미디어 권한 및 미리보기 준비 중', ready: '선택한 로컬 미디어 사용 중', stopping: '종료 요청됨 · 대기 중인 권한 요청의 결과를 기다립니다', error: '미디어 오류' };
  return <section aria-label="로컬 미디어">
    <h2>로컬 카메라·마이크 미리보기</h2>
    <p>획득할 미디어 종류를 선택한 뒤 시작하세요. 영상은 로컬에만 표시하며 마이크 소리는 재생하지 않습니다. 미디어 없이도 회의방에 참여할 수 있습니다.</p>
    <fieldset disabled={locked}>
      <legend>획득할 미디어 종류</legend>
      <label><input id="media-video" type="checkbox" checked={selection.video} onChange={event => setSelection(current => ({ ...current, video: event.target.checked }))} /> 카메라</label>{' '}
      <label><input id="media-audio" type="checkbox" checked={selection.audio} onChange={event => setSelection(current => ({ ...current, audio: event.target.checked }))} /> 마이크</label>
    </fieldset>
    <fieldset>
      <legend>카메라·마이크 장치</legend>
      <p>선택 후 적용을 눌러 사용 중인 트랙만 교체합니다. 미획득·카메라 OFF 상태에서는 다음 명시적 시작에 선택을 사용합니다.</p>
      {(['video', 'audio'] as const).map(kind => {
        const list = media.devices.devices.filter(d => d.kind === kind);
        const chosen = media.devices.selected[kind];
        const missing = !!chosen && !list.some(d => d.deviceId === chosen);
        const busy = media.switching[kind] || media.pending || media.cameraPending || (kind === 'audio' && microphoneBusy);
        const track = media.tracks.find(t => t.kind === kind && t.readyState === 'live');
        return <div key={kind}>
          <label htmlFor={`device-${kind}`}>{kind === 'video' ? '카메라' : '마이크'} 장치</label>{' '}
          <select id={`device-${kind}`} value={chosen} disabled={busy} onChange={e => media.devices.select(kind, e.target.value)}>
            <option value="">브라우저 기본 장치</option>
            {missing && <option value={chosen}>선택한 장치 없음 / 목록에서 사라짐</option>}
            {list.filter(d => d.deviceId).map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          </select>{' '}
          <button id={`device-apply-${kind}`} disabled={busy || !track || missing} onClick={() => void (onSwitch ? onSwitch(kind) : media.switchDevice(kind, async () => {}, () => true))}>{media.switching[kind] ? '장치 전환 중' : '선택 장치 적용'}</button>
          <p data-testid={`device-actual-${kind}`} data-device-id={track?.deviceId ?? ''} data-track-id={track?.id ?? ''}>실제 사용: {track ? `${track.label || '이름 비공개'} · ${track.deviceId || 'ID 비공개'} · ${track.readyState}` : '미획득 / 꺼짐'}</p>
          {missing && <p role="alert">선택한 장치가 목록에 없습니다. 자동으로 다른 장치를 사용하지 않습니다.</p>}
          {!list.length && <p>조회된 입력 장치 없음. 권한·브라우저 정책에 따라 목록이 제한될 수 있습니다.</p>}
          {track?.deviceId && media.devices.status === 'ready' && list.every(d => !d.deviceId || d.deviceId !== track.deviceId) && <p>사용 트랙의 장치가 목록에서 확인되지 않습니다. 실제 트랙 상태와 권한을 확인해주세요.</p>}
        </div>;
      })}
      <button id="devices-refresh" onClick={() => void media.devices.refresh()}>장치 목록 새로고침</button>
      <p data-testid="devices-status">목록 상태: {media.devices.status}. 권한 전에는 장치 이름·ID·목록이 제한될 수 있습니다. 목록 조회는 권한을 요청하지 않습니다.</p>
      {media.devices.error && <p role="alert">{media.devices.error}</p>}
      {media.switchError && <p role="alert" data-testid="device-error">{media.switchError}</p>}
      {media.switchResult && <p role="status" data-testid="device-result">{media.switchResult}</p>}
    </fieldset>
    <section aria-label="마이크 입력 테스트">
      <h3>마이크 입력 테스트</h3>
      <p>선택한 마이크의 상대 입력 크기를 확인합니다. 수치는 보정된 dB가 아니며, 상대방에게 송신되는지 나타내지 않습니다. 테스트는 회의 음소거를 해제하지 않습니다.</p>
      <button id="meter-start" disabled={meter.status === 'starting' || meter.status === 'stopping' || meter.status === 'running' || meter.status === 'suspended'} onClick={() => void meter.start()}>마이크 테스트 시작</button>{' '}
      <button id="meter-stop" disabled={meter.status === 'idle' || meter.status === 'error'} onClick={() => void meter.stop()}>마이크 테스트 종료</button>{' '}
      {meter.status === 'suspended' && <button id="meter-resume" onClick={() => void meter.resume()}>분석 재개</button>}
      <p data-testid="meter-status" data-status={meter.status} data-source={meter.owned ? 'test' : 'shared'} data-device-id={meter.deviceId} data-track-id={meter.trackId}>상태: {meter.status} · 분석 장치: {meter.trackId ? `${meter.deviceId || 'ID 비공개'} (${meter.owned ? '테스트 전용' : '공유 로컬 트랙'})` : '없음'}</p>
      <progress data-testid="meter-level" max="100" value={meter.level} aria-label="상대 마이크 입력 레벨" /> <span data-testid="meter-value">{meter.level}/100 · RMS {meter.rms.toFixed(3)}</span>
      {meter.trackId && meter.selectedId !== meter.requestedId && <p>선택값이 변경됐지만 분석 대상은 이전 장치입니다. 새 선택으로 테스트하려면 종료 후 다시 시작하세요.</p>}
      {meter.error && <p role="alert" data-testid="meter-error">{meter.error}</p>}
    </section>
    {!selection.video && !selection.audio && <p>미디어를 요청하지 않습니다. 회의방과 채팅은 그대로 이용할 수 있습니다.</p>}
    <p data-testid="media-status" data-status={media.status}>{labels[media.status]}</p>
    <button id="media-start" disabled={locked || (!selection.video && !selection.audio)} onClick={() => void media.start(selection)}>로컬 미디어 시작</button>{' '}
    <button id="media-stop" disabled={media.status !== 'ready' && media.status !== 'requesting'} onClick={onStop ?? media.stop}>로컬 미디어 종료</button>
    {media.error && <p role="alert" data-testid="media-error">{media.error}</p>}
    <video id="local-preview" ref={media.videoRef} hidden={!media.tracks.some(t => t.kind === 'video' && t.readyState === 'live')} muted autoPlay playsInline aria-label="내 카메라 미리보기" />
    {!media.tracks.some(t => t.kind === 'video' && t.readyState === 'live') && selection.audio && <p>현재 영상 미리보기는 없으며 로컬 음성은 재생하지 않습니다.</p>}
    <ul data-testid="media-tracks">
      {['video', 'audio'].map(kind => {
        const tracks = media.tracks.filter(track => track.kind === kind);
        return <li key={kind}>{kind === 'video' ? '카메라' : '마이크'} ({kind}): {tracks.length ? tracks.map(track => `${track.readyState} · ${track.id}`).join(', ') : selection[kind === 'video' ? 'video' : 'audio'] ? '미획득' : '선택하지 않음'}</li>;
      })}
    </ul>
    <p>권한 요청 창을 무시하면 요청이 계속 대기할 수 있습니다. 종료 요청 후에도 브라우저 권한 창에 응답해야 새로 시작할 수 있습니다.</p>
  </section>;
}
