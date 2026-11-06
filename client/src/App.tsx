import { useCallback, useEffect, useRef, useState } from 'react';
import { avatars, nicknameMaxLength } from '../../server/src/shared/protocol.js';
import type { AvatarId, Participant, Profile } from '../../server/src/shared/protocol.js';
import { useSession } from './useSession';
import { Rooms } from './Rooms';
import { Chat } from './Chat';
import { MediaPanel } from './MediaPanel';

function ProfileForm({ self, saving, onSave, onCancel }: { self: Participant; saving: boolean; onSave: (profile: Profile) => void; onCancel: () => void }) {
  const [nickname, setNickname] = useState(self.nickname);
  const [avatarId, setAvatarId] = useState<AvatarId>(self.avatarId);
  useEffect(() => { setNickname(self.nickname); setAvatarId(self.avatarId); }, [self.nickname, self.avatarId]);
  return (
    <form onSubmit={event => { event.preventDefault(); onSave({ nickname, avatarId }); }}>
      <h2>내 프로필</h2>
      <label htmlFor="nickname">닉네임 (1~{nicknameMaxLength}자)</label>
      <input id="nickname" value={nickname} onChange={event => setNickname(event.target.value)} disabled={saving} />
      <fieldset disabled={saving}>
        <legend>아바타</legend>
        {avatars.map(avatar => (
          <label key={avatar.id} className="avatar-option">
            <input type="radio" name="avatar" value={avatar.id} checked={avatarId === avatar.id} onChange={() => setAvatarId(avatar.id)} />
            {avatar.emoji} {avatar.label}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={saving}>{saving ? '변경 중…' : '프로필 변경'}</button>
      <button type="button" onClick={onCancel}>닫기</button>
    </form>
  );
}

function ProfileMenu({ self, saving, onSave }: { self: Participant; saving: boolean; onSave: (profile: Profile) => Promise<boolean> }) {
  const details = useRef<HTMLDetailsElement>(null);
  const requestGeneration = useRef(0);
  const [formGeneration, setFormGeneration] = useState(0);
  const close = () => { requestGeneration.current += 1; if (details.current) details.current.open = false; };
  const save = (profile: Profile) => {
    const generation = requestGeneration.current;
    void onSave(profile).then(success => {
      if (success && generation === requestGeneration.current && details.current?.open) close();
    });
  };
  return <details ref={details} className="profile-menu" onToggle={event => {
    if (event.currentTarget.open) setFormGeneration(value => value + 1);
    else requestGeneration.current += 1;
  }}>
    <summary onClick={() => { if (details.current?.open) requestGeneration.current += 1; }}>{avatars.find(avatar => avatar.id === self.avatarId)?.emoji} {self.nickname} · 내 프로필</summary>
    <ProfileForm key={`${self.participantId}:${formGeneration}`} self={self} saving={saving} onSave={save} onCancel={close} />
  </details>;
}

export function App() {
  const session = useSession();
  const self = session.participants.find(participant => participant.participantId === session.selfId);
  const statusText = { connecting: '연결 중', connected: '연결됨', disconnected: '연결 종료' }[session.status];
  const [channel, setChannel] = useState('global');
  const [mediaTarget, setMediaTarget] = useState('');
  const [activeMedia, setActiveMedia] = useState({ roomId: '', phase: 'idle' });
  const reportActive = useCallback((roomId: string, phase: string) => setActiveMedia(current => current.roomId === roomId && current.phase === phase ? current : { roomId, phase }), []);
  const roomName = (id: string) => session.rooms.find(room => room.roomId === id)?.name ?? id;
  const selectedChannel = channel === 'global' || Object.hasOwn(session.joinedRooms, channel) ? channel : 'global';
  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div className="brand"><span className="brand-mark">W</span><div><h1>WebRTC Practice</h1><p>SFU 기반 다자간 회의</p></div></div>
        <div className="header-status" aria-label="현재 연결과 선택 상태">
          <span className={`status-pill ${session.status}`} >연결: <strong data-testid="connection-status">{statusText}</strong></span>
          <span>미디어 대상: <strong>{mediaTarget ? roomName(mediaTarget) : '미선택'}</strong></span>
          <span>활성 미디어: <strong>{activeMedia.roomId ? `${roomName(activeMedia.roomId)} · ${activeMedia.phase === 'connecting' ? '연결 중' : activeMedia.phase === 'stopping' ? '종료 중' : '연결됨'}` : '미연결'}</strong></span>
          <span>채팅: <strong>{selectedChannel === 'global' ? '전체 채팅' : roomName(selectedChannel)}</strong></span>
        </div>
        <div className="header-actions">
          {self && <ProfileMenu key={self.participantId} self={self} saving={session.saving} onSave={session.updateProfile} />}
          {session.status === 'disconnected' ? <button onClick={session.reconnect}>다시 연결</button> : <button onClick={session.disconnect} disabled={session.status === 'connecting'}>연결 종료</button>}
        </div>
        {session.error && <p className="header-message" role="alert">{session.error}</p>}
        {session.notice && <p className="header-message" role="status">{session.notice}</p>}
      </header>
      <nav className="mobile-navigation" aria-label="화면 영역 이동"><a href="#meeting">미디어</a><a href="#rooms">회의방</a><a href="#conversation">채팅·참가자</a><button type="button" onClick={() => document.getElementById('devices-trigger')?.click()}>장치 설정</button></nav>
      <div className="dashboard-grid">
        <Rooms session={session} />
        <MediaPanel session={session} target={mediaTarget} setTarget={setMediaTarget} reportActive={reportActive} />
        <Chat session={session} channel={channel} setChannel={setChannel} />
      </div>
      <footer className="dashboard-footer">서버 상태: <a href="http://127.0.0.1:3000/health" target="_blank" rel="noreferrer">/health 확인</a></footer>
    </main>
  );
}
