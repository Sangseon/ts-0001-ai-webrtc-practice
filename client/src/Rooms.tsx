import { useState } from 'react';
import { avatars, roomNameMaxLength } from '../../server/src/shared/protocol.js';
import type { useSession } from './useSession';

export function Rooms({ session }: { session: ReturnType<typeof useSession> }) {
  const [name, setName] = useState('');
  const disabled = session.status !== 'connected' || session.saving;
  const selected = session.rooms.find(room => room.roomId === session.selectedRoomId);
  const members = session.joinedRooms[session.selectedRoomId];
  const joined = session.rooms.filter(room => Object.hasOwn(session.joinedRooms, room.roomId));
  return (
    <section id="rooms" className="rooms-panel panel" aria-label="회의방 관리">
      <div className="panel-heading"><div><span className="eyebrow">WORKSPACES</span><h2>회의방</h2></div><span className="count-badge">{session.rooms.length}개</span></div>
      <p className="supporting-text">여러 방에 참여할 수 있습니다. 방 정보 선택은 채팅과 미디어 연결을 바꾸지 않습니다.</p>
      <form onSubmit={event => { event.preventDefault(); session.createRoom(name); }}>
        <label htmlFor="room-name">회의방 이름 (1~{roomNameMaxLength}자)</label>
        <input id="room-name" value={name} onChange={event => setName(event.target.value)} disabled={disabled} />
        <button type="submit" disabled={disabled}>회의방 생성</button>
      </form>
      <h3>전체 회의방</h3>
      <ul className="room-list" data-testid="rooms">
        {session.rooms.map(room => {
          const isJoined = Object.hasOwn(session.joinedRooms, room.roomId);
          return (
            <li key={room.roomId} data-room-id={room.roomId}>
              <label className="room-choice">
                <input type="radio" name="view-room" checked={room.roomId === session.selectedRoomId} onChange={() => session.setSelectedRoomId(room.roomId)} />
                <span><strong>{room.name}</strong><small>{room.participantCount}명 · {isJoined ? '참여 중' : '미참여'}</small></span>
              </label>{' '}
              <button disabled={disabled || isJoined} onClick={() => session.joinRoom(room.roomId)}>입장</button>
              <code>{room.roomId}</code>
            </li>
          );
        })}
      </ul>
      <details className="room-shortcuts"><summary>참여 중인 방 ({joined.length}개)</summary><ul data-testid="joined-rooms">
        {joined.map(room => <li key={room.roomId} data-joined-room-id={room.roomId}><button onClick={() => session.setSelectedRoomId(room.roomId)}>{room.name} 정보</button></li>)}
      </ul></details>
      <div data-testid="selected-room" data-selected-room-id={selected?.roomId ?? ''}>
        <h3>방 정보: {selected?.name ?? '선택 전'}</h3>
        {selected && !members && <p>이 방에 참여하지 않았습니다. 입장하면 참가자 목록을 볼 수 있습니다.</p>}
        {selected && members && <>
          <button disabled={disabled} onClick={() => session.leaveRoom(selected.roomId)}>선택한 방 퇴장</button>
          <ul data-testid="room-participants">
            {members.map(participant => <li key={participant.participantId} data-room-participant-id={participant.participantId}>
              {avatars.find(avatar => avatar.id === participant.avatarId)?.emoji} {participant.nickname}
              <code>{participant.participantId}</code>
            </li>)}
          </ul>
        </>}
      </div>
    </section>
  );
}
