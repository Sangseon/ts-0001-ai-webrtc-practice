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
    <section aria-label="회의방 관리">
      <h2>회의방</h2>
      <p>여러 방에 참여할 수 있습니다. 화면 선택은 입장·퇴장이나 미디어 연결을 변경하지 않습니다.</p>
      <form onSubmit={event => { event.preventDefault(); session.createRoom(name); }}>
        <label htmlFor="room-name">회의방 이름 (1~{roomNameMaxLength}자)</label>
        <input id="room-name" value={name} onChange={event => setName(event.target.value)} disabled={disabled} />
        <button type="submit" disabled={disabled}>회의방 생성</button>
      </form>
      <h3>전체 회의방 ({session.rooms.length}개)</h3>
      <ul data-testid="rooms">
        {session.rooms.map(room => {
          const isJoined = Object.hasOwn(session.joinedRooms, room.roomId);
          return (
            <li key={room.roomId} data-room-id={room.roomId}>
              <label>
                <input type="radio" name="view-room" checked={room.roomId === session.selectedRoomId} onChange={() => session.setSelectedRoomId(room.roomId)} />
                {room.name} · {room.participantCount}명 {isJoined ? '· 참여 중' : ''}
              </label>{' '}
              <button disabled={disabled || isJoined} onClick={() => session.joinRoom(room.roomId)}>입장</button>
              <code>{room.roomId}</code>
            </li>
          );
        })}
      </ul>
      <h3>참여 중인 회의방 ({joined.length}개)</h3>
      <ul data-testid="joined-rooms">
        {joined.map(room => <li key={room.roomId} data-joined-room-id={room.roomId}><button onClick={() => session.setSelectedRoomId(room.roomId)}>{room.name} 보기</button></li>)}
      </ul>
      <div data-testid="selected-room" data-selected-room-id={selected?.roomId ?? ''}>
        <h3>선택한 회의방: {selected?.name ?? '없음'}</h3>
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
