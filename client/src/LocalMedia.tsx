import { useLocalMedia } from './useLocalMedia';
import { useState } from 'react';

export function LocalMedia() {
  const media = useLocalMedia();
  const [selection, setSelection] = useState({ video: true, audio: true });
  const locked = media.pending || media.status === 'ready';
  const labels = { idle: '시작 전 / 종료됨', requesting: '선택한 미디어 권한 및 미리보기 준비 중', ready: '선택한 로컬 미디어 사용 중', stopping: '종료 요청됨 · 대기 중인 권한 요청의 결과를 기다립니다', error: '미디어 오류' };
  return <section aria-label="로컬 미디어">
    <h2>로컬 카메라·마이크 미리보기</h2>
    <p>획득할 미디어 종류를 선택한 뒤 시작하세요. 영상은 로컬에만 표시하며 마이크 소리는 재생하지 않습니다. 미디어 없이도 회의방에 참여할 수 있습니다.</p>
    <fieldset disabled={locked}>
      <legend>획득할 미디어 종류</legend>
      <label><input id="media-video" type="checkbox" checked={selection.video} onChange={event => setSelection(current => ({ ...current, video: event.target.checked }))} /> 카메라</label>{' '}
      <label><input id="media-audio" type="checkbox" checked={selection.audio} onChange={event => setSelection(current => ({ ...current, audio: event.target.checked }))} /> 마이크</label>
    </fieldset>
    {!selection.video && !selection.audio && <p>미디어를 요청하지 않습니다. 회의방과 채팅은 그대로 이용할 수 있습니다.</p>}
    <p data-testid="media-status" data-status={media.status}>{labels[media.status]}</p>
    <button id="media-start" disabled={locked || (!selection.video && !selection.audio)} onClick={() => void media.start(selection)}>로컬 미디어 시작</button>{' '}
    <button id="media-stop" disabled={media.status !== 'ready' && media.status !== 'requesting'} onClick={media.stop}>로컬 미디어 종료</button>
    {media.error && <p role="alert" data-testid="media-error">{media.error}</p>}
    <video id="local-preview" ref={media.videoRef} hidden={!selection.video} muted autoPlay playsInline aria-label="내 카메라 미리보기" />
    {!selection.video && selection.audio && <p>마이크만 획득합니다. 영상 미리보기와 로컬 음성 재생은 하지 않습니다.</p>}
    <ul data-testid="media-tracks">
      {['video', 'audio'].map(kind => {
        const tracks = media.tracks.filter(track => track.kind === kind);
        return <li key={kind}>{kind === 'video' ? '카메라' : '마이크'} ({kind}): {tracks.length ? tracks.map(track => `${track.readyState} · ${track.id}`).join(', ') : selection[kind === 'video' ? 'video' : 'audio'] ? '미획득' : '선택하지 않음'}</li>;
      })}
    </ul>
    <p>권한 요청 창을 무시하면 요청이 계속 대기할 수 있습니다. 종료 요청 후에도 브라우저 권한 창에 응답해야 새로 시작할 수 있습니다.</p>
  </section>;
}
