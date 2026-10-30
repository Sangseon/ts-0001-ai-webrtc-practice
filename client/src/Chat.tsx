import { useState } from 'react';
import { avatars, chatMaxLength } from '../../server/src/shared/protocol.js';
import type { useSession } from './useSession';

export function Chat({ session }: { session: ReturnType<typeof useSession> }) {
  const [channel, setChannel] = useState('global');
  const [body, setBody] = useState('');
  const selected = channel === 'global' || Object.hasOwn(session.joinedRooms, channel) ? channel : 'global';
  const disabled = session.status !== 'connected' || session.saving;
  const messages = session.messages.filter(m => selected === 'global' ? m.scope === 'global' : m.scope === 'room' && m.roomId === selected);
  return <section aria-label="채팅">
    <h2>채팅</h2>
    <label htmlFor="chat-channel">채팅 화면</label>{' '}
    <select id="chat-channel" value={selected} onChange={event => { setChannel(event.target.value); setBody(''); }}>
      <option value="global">전체 채팅</option>
      {session.rooms.filter(room => Object.hasOwn(session.joinedRooms, room.roomId)).map(room => <option key={room.roomId} value={room.roomId}>회의방: {room.name}</option>)}
    </select>
    <p>{selected === 'global' ? '모든 접속자에게 전달합니다.' : '선택한 회의방의 현재 참가자에게만 전달합니다.'}</p>
    <ol data-testid="chat-messages" aria-live="polite">
      {messages.map(message => {
        const profile = session.profiles[message.participantId];
        return <li key={message.messageId} data-message-id={message.messageId}>
          <span>{avatars.find(a => a.id === profile?.avatarId)?.emoji} {profile?.nickname ?? '참가자'}</span>
          {message.participantId === session.selfId && ' (나)'}{' '}
          <time dateTime={message.sentAt}>{new Date(message.sentAt).toLocaleTimeString()}</time>
          <p className="chat-body">{message.body}</p>
        </li>;
      })}
    </ol>
    <form onSubmit={event => {
      event.preventDefault();
      session.sendChat(selected === 'global' ? { scope: 'global' } : { scope: 'room', roomId: selected }, body);
    }}>
      <label htmlFor="chat-body">메시지 (1~{chatMaxLength}자)</label>
      <textarea id="chat-body" value={body} onChange={event => setBody(event.target.value)} disabled={disabled} />
      <button disabled={disabled || !body.trim()} type="submit">메시지 전송</button>
    </form>
    {session.status !== 'connected' && <p>연결 후 메시지를 전송할 수 있습니다.</p>}
    <p>채널별 최근 100개, 전체 500개를 보관합니다. 방 퇴장·연결 종료 시 해당 내역을 지웁니다.</p>
  </section>;
}
