import { useRef, useState } from 'react';
import { avatars, chatMaxLength } from '../../server/src/shared/protocol.js';
import type { useSession } from './useSession';

export function Chat({ session, channel, setChannel }: { session: ReturnType<typeof useSession>; channel: string; setChannel: (channel: string) => void }) {
  const [body, setBody] = useState('');
  const draftVersion = useRef(0);
  const sending = useRef(false);
  const [view, setView] = useState<'chat' | 'people'>('chat');
  const selected = channel === 'global' || Object.hasOwn(session.joinedRooms, channel) ? channel : 'global';
  const disabled = session.status !== 'connected' || session.saving;
  const rooms = session.rooms.filter(room => Object.hasOwn(session.joinedRooms, room.roomId));
  const selectedRoom = rooms.find(room => room.roomId === selected);
  const messages = session.messages.filter(m => selected === 'global' ? m.scope === 'global' : m.scope === 'room' && m.roomId === selected);
  const choose = (next: string) => { draftVersion.current += 1; setChannel(next); setBody(''); setView('chat'); };
  return <section id="conversation" className="chat-panel panel" aria-label="채팅과 참가자">
    <div className="panel-heading"><div><span className="eyebrow">CONVERSATION</span><h2>대화</h2></div><span className="count-badge">{selected === 'global' ? '전체' : selectedRoom?.name}</span></div>
    <div className="channel-tabs" role="tablist" aria-label="채팅 채널">
      <button type="button" role="tab" aria-selected={selected === 'global'} className={selected === 'global' ? 'selected' : ''} onClick={() => choose('global')}>전체 채팅</button>
      {rooms.map(room => <button type="button" role="tab" key={room.roomId} aria-selected={selected === room.roomId} className={selected === room.roomId ? 'selected' : ''} onClick={() => choose(room.roomId)}>{room.name}</button>)}
    </div>
    <label className="channel-select-label" htmlFor="chat-channel">채팅 화면</label>{' '}
    <select className="channel-select" id="chat-channel" value={selected} onChange={event => choose(event.target.value)}>
      <option value="global">전체 채팅</option>
      {rooms.map(room => <option key={room.roomId} value={room.roomId}>회의방: {room.name}</option>)}
    </select>
    <div className="view-tabs" role="tablist" aria-label="대화 패널 보기">
      <button type="button" role="tab" aria-selected={view === 'chat'} onClick={() => setView('chat')}>채팅</button>
      <button type="button" role="tab" aria-selected={view === 'people'} onClick={() => setView('people')}>참가자</button>
    </div>
    <div className="chat-view" hidden={view !== 'chat'}>
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
      if (sending.current || disabled || !body.trim()) return;
      sending.current = true;
      const submitted = body;
      const version = draftVersion.current;
      const target = selected === 'global' ? { scope: 'global' as const } : { scope: 'room' as const, roomId: selected };
      void session.sendChat(target, submitted).then(success => {
        if (success && draftVersion.current === version) setBody(current => current === submitted ? '' : current);
      }).finally(() => { sending.current = false; });
    }}>
      <label htmlFor="chat-body">메시지 (1~{chatMaxLength}자)</label>
      <textarea id="chat-body" value={body} onChange={event => { draftVersion.current += 1; setBody(event.target.value); }} disabled={disabled} />
      <button disabled={disabled || !body.trim()} type="submit">메시지 전송</button>
    </form>
    {session.status !== 'connected' && <p>연결 후 메시지를 전송할 수 있습니다.</p>}
    <p className="supporting-text">채널별 최근 100개, 전체 500개를 보관합니다. 방 퇴장·연결 종료 시 해당 내역을 지웁니다.</p>
    </div>
    <div className="people-view" hidden={view !== 'people'}>
      {selected === 'global' ? <p>전체 채팅에는 선택된 회의방 참가자 목록이 없습니다. 방 채널을 선택해 확인하세요.</p> : <>
        <h3>{selectedRoom?.name ?? '회의방'} 참가자 ({session.joinedRooms[selected]?.length ?? 0}명)</h3>
        <ul data-testid="chat-participants">{(session.joinedRooms[selected] ?? []).map(person => <li key={person.participantId} data-chat-participant-id={person.participantId}>{avatars.find(avatar => avatar.id === person.avatarId)?.emoji} {person.nickname}</li>)}</ul>
      </>}
    </div>
  </section>;
}
