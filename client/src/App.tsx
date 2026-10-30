import { useEffect, useState } from 'react';
import { avatars, nicknameMaxLength } from '../../server/src/shared/protocol.js';
import type { AvatarId, Participant, Profile } from '../../server/src/shared/protocol.js';
import { useSession } from './useSession';
import { Rooms } from './Rooms';
import { Chat } from './Chat';
import { MediaPanel } from './MediaPanel';

function ProfileForm({ self, saving, onSave }: { self: Participant; saving: boolean; onSave: (profile: Profile) => void }) {
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
    </form>
  );
}

export function App() {
  const session = useSession();
  const self = session.participants.find(participant => participant.participantId === session.selfId);
  const statusText = { connecting: '연결 중', connected: '연결됨', disconnected: '연결 종료' }[session.status];
  return (
    <main>
      <p>Step 10 · 카메라·마이크 제어</p>
      <h1>WebRTC Practice</h1>
      <p>연결 상태: <strong data-testid="connection-status">{statusText}</strong></p>
      <p>내 participantId: <code data-testid="self-id">{session.selfId ?? '없음'}</code></p>
      {session.status === 'disconnected'
        ? <button onClick={session.reconnect}>다시 연결</button>
        : <button onClick={session.disconnect} disabled={session.status === 'connecting'}>연결 종료</button>}
      {session.error && <p role="alert">{session.error}</p>}
      {session.notice && <p role="status">{session.notice}</p>}
      <MediaPanel session={session} />
      {self && <ProfileForm key={self.participantId} self={self} saving={session.saving} onSave={session.updateProfile} />}
      <Rooms session={session} />
      <Chat session={session} />
      <section aria-label="접속 사용자">
        <h2>접속 사용자 ({session.participants.length}명)</h2>
        <ul data-testid="participants">
          {session.participants.map(participant => (
            <li key={participant.participantId} data-participant-id={participant.participantId}>
              <span aria-label={avatars.find(avatar => avatar.id === participant.avatarId)?.label}>{avatars.find(avatar => avatar.id === participant.avatarId)?.emoji}</span>{' '}
              <span>{participant.nickname}</span>{participant.participantId === session.selfId && ' (나)'}
              <code>{participant.participantId}</code>
            </li>
          ))}
        </ul>
      </section>
      <p>
        서버는 별도로 실행한 뒤{' '}
        <a href="http://127.0.0.1:3000/health" target="_blank" rel="noreferrer">
          상태 확인 경로
        </a>
        에서 확인할 수 있습니다.
      </p>
    </main>
  );
}
