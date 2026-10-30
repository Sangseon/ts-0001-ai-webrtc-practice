export const avatars = [
  { id: 'bear', label: '곰', emoji: '🐻' },
  { id: 'cat', label: '고양이', emoji: '🐱' },
  { id: 'fox', label: '여우', emoji: '🦊' },
  { id: 'owl', label: '부엉이', emoji: '🦉' },
] as const;

export type AvatarId = typeof avatars[number]['id'];
export type Profile = { nickname: string; avatarId: AvatarId };
export type Participant = Profile & { participantId: string };
export type ProfileRequest = {
  kind: 'request'; type: 'profile.update'; requestId: string; profile: Profile;
};
export type RoomSummary = { roomId: string; name: string; participantCount: number };
export type RoomState = { roomId: string; name: string; participants: Participant[] };
export type RoomRequest =
  | { kind: 'request'; type: 'room.create'; requestId: string; name: string }
  | { kind: 'request'; type: 'room.join' | 'room.leave'; requestId: string; roomId: string };
export type ChatTarget = { scope: 'global' } | { scope: 'room'; roomId: string };
export type ChatRequest = { kind: 'request'; type: 'chat.send'; requestId: string; body: string } & ChatTarget;
export type ChatMessage = { messageId: string; participantId: string; body: string; sentAt: string } & ChatTarget;
export type ClientRequest = ProfileRequest | RoomRequest | ChatRequest;
export type ErrorCode = 'INVALID_JSON' | 'INVALID_MESSAGE' | 'UNKNOWN_TYPE' | 'INVALID_PROFILE'
  | 'INVALID_ROOM_NAME' | 'ROOM_NOT_FOUND' | 'ALREADY_JOINED' | 'NOT_JOINED' | 'INVALID_CHAT';
export type ServerMessage =
  | ({ kind: 'response'; type: 'chat.send'; requestId: string; ok: true; messageId: string } & ChatTarget)
  | { kind: 'event'; type: 'chat.message'; message: ChatMessage }
  | { kind: 'event'; type: 'session.ready'; selfId: string; participants: Participant[] }
  | { kind: 'event'; type: 'participant.joined' | 'participant.updated'; participant: Participant }
  | { kind: 'event'; type: 'participant.left'; participantId: string }
  | { kind: 'response'; type: 'profile.update'; requestId: string; ok: true; participant: Participant }
  | { kind: 'response'; type: 'room.create' | 'room.join'; requestId: string; ok: true; room: RoomState }
  | { kind: 'response'; type: 'room.leave'; requestId: string; ok: true; roomId: string }
  | { kind: 'event'; type: 'rooms.changed'; rooms: RoomSummary[] }
  | { kind: 'event'; type: 'room.state'; roomId: string; participants: Participant[] }
  | { kind: 'response'; type: 'error'; requestId: string | null; ok: false; code: ErrorCode; message: string };

export const nicknameMaxLength = 20;
export const roomNameMaxLength = 40;
export const chatMaxLength = 500;
export const chatChannelLimit = 100;
export const chatTotalLimit = 500;
const errorCodes: ErrorCode[] = ['INVALID_JSON', 'INVALID_MESSAGE', 'UNKNOWN_TYPE', 'INVALID_PROFILE', 'INVALID_ROOM_NAME', 'ROOM_NOT_FOUND', 'ALREADY_JOINED', 'NOT_JOINED', 'INVALID_CHAT'];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value);
export const isAvatarId = (value: unknown): value is AvatarId => avatars.some(avatar => avatar.id === value);

export function validateProfile(value: unknown): Profile | null {
  if (!record(value) || !keys(value, ['nickname', 'avatarId']) || typeof value.nickname !== 'string' || !isAvatarId(value.avatarId)) return null;
  const nickname = value.nickname.trim();
  if (!nickname || Array.from(nickname).length > nicknameMaxLength || /[\u0000-\u001f\u007f]/u.test(value.nickname)) return null;
  return { nickname, avatarId: value.avatarId };
}

export function validateRoomName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const name = value.trim();
  return name && Array.from(name).length <= roomNameMaxLength ? name : null;
}

export function parseRequest(text: string): ClientRequest | Extract<ServerMessage, { type: 'error' }> {
  let value: unknown;
  const fail = (code: ErrorCode, message: string, requestId: string | null = null): Extract<ServerMessage, { type: 'error' }> =>
    ({ kind: 'response', type: 'error', requestId, ok: false, code, message });
  try { value = JSON.parse(text); } catch { return fail('INVALID_JSON', 'JSON 형식이 올바르지 않습니다.'); }
  if (!record(value)) return fail('INVALID_MESSAGE', '요청 객체가 필요합니다.');
  const requestId = validId(value.requestId) ? value.requestId : null;
  if (value.kind !== 'request' || !requestId || typeof value.type !== 'string') return fail('INVALID_MESSAGE', '요청 종류와 requestId를 확인해주세요.', requestId);
  if (value.type === 'chat.send') {
    const fields = value.scope === 'global' ? ['kind', 'type', 'requestId', 'scope', 'body'] : ['kind', 'type', 'requestId', 'scope', 'roomId', 'body'];
    if (!keys(value, fields) || (value.scope !== 'global' && value.scope !== 'room') || (value.scope === 'room' && !validId(value.roomId))) return fail('INVALID_MESSAGE', '채팅 범위와 대상 방, 요청 필드를 확인해주세요.', requestId);
    if (typeof value.body !== 'string' || !value.body.trim() || Array.from(value.body.trim()).length > chatMaxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.body)) return fail('INVALID_CHAT', '메시지는 앞뒤 공백을 제거한 1~500자이며 제어 문자를 사용할 수 없습니다.', requestId);
    const target: ChatTarget = value.scope === 'global' ? { scope: 'global' } : { scope: 'room', roomId: value.roomId as string };
    return { kind: 'request', type: 'chat.send', requestId, body: value.body.trim(), ...target };
  }
  if (value.type === 'room.create') {
    if (!keys(value, ['kind', 'type', 'requestId', 'name'])) return fail('INVALID_MESSAGE', '회의방 생성 필드를 확인해주세요.', requestId);
    const name = validateRoomName(value.name);
    if (!name) return fail('INVALID_ROOM_NAME', '회의방 이름은 앞뒤 공백을 제거한 1~40자이며 제어 문자를 사용할 수 없습니다.', requestId);
    return { kind: 'request', type: 'room.create', requestId, name };
  }
  if (value.type === 'room.join' || value.type === 'room.leave') {
    if (!keys(value, ['kind', 'type', 'requestId', 'roomId']) || !validId(value.roomId)) return fail('INVALID_MESSAGE', '대상 roomId와 요청 필드를 확인해주세요.', requestId);
    return { kind: 'request', type: value.type, requestId, roomId: value.roomId };
  }
  if (value.type !== 'profile.update') return fail('UNKNOWN_TYPE', '지원하지 않는 요청입니다.', requestId);
  if (!keys(value, ['kind', 'type', 'requestId', 'profile'])) return fail('INVALID_MESSAGE', '요청 필드를 확인해주세요. 대상 사용자 ID는 받지 않습니다.', requestId);
  const profile = validateProfile(value.profile);
  if (!profile) return fail('INVALID_PROFILE', '닉네임은 앞뒤 공백을 제거한 1~20자이며 제어 문자를 사용할 수 없습니다. 고정 아바타를 선택해주세요.', requestId);
  return { kind: 'request', type: 'profile.update', requestId, profile };
}

function isParticipant(value: unknown): value is Participant {
  return record(value) && keys(value, ['participantId', 'nickname', 'avatarId']) && validId(value.participantId)
    && validateProfile({ nickname: value.nickname, avatarId: value.avatarId }) !== null;
}

function isRoomState(value: unknown): value is RoomState {
  return record(value) && validId(value.roomId) && validateRoomName(value.name) !== null
    && Array.isArray(value.participants) && value.participants.every(isParticipant);
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!record(value)) return false;
  if (value.kind === 'event') {
    switch (value.type) {
      case 'session.ready': return validId(value.selfId) && Array.isArray(value.participants) && value.participants.every(isParticipant);
      case 'chat.message': {
        const m = value.message;
        return record(m) && validId(m.messageId) && validId(m.participantId) && typeof m.body === 'string' && m.body.trim().length > 0 && Array.from(m.body).length <= chatMaxLength
          && typeof m.sentAt === 'string' && Number.isFinite(Date.parse(m.sentAt))
          && ((m.scope === 'global' && keys(m, ['messageId', 'participantId', 'body', 'sentAt', 'scope'])) || (m.scope === 'room' && validId(m.roomId) && keys(m, ['messageId', 'participantId', 'body', 'sentAt', 'scope', 'roomId'])));
      }
      case 'participant.joined':
      case 'participant.updated': return isParticipant(value.participant);
      case 'participant.left': return validId(value.participantId);
      case 'rooms.changed': return Array.isArray(value.rooms) && value.rooms.every(room => record(room) && validId(room.roomId) && validateRoomName(room.name) !== null && Number.isInteger(room.participantCount) && (room.participantCount as number) > 0);
      case 'room.state': return validId(value.roomId) && Array.isArray(value.participants) && value.participants.every(isParticipant);
      default: return false;
    }
  }
  if (value.kind !== 'response') return false;
  if (value.type === 'chat.send') return value.ok === true && validId(value.requestId) && validId(value.messageId)
    && ((value.scope === 'global' && keys(value, ['kind', 'type', 'requestId', 'ok', 'messageId', 'scope']))
      || (value.scope === 'room' && validId(value.roomId) && keys(value, ['kind', 'type', 'requestId', 'ok', 'messageId', 'scope', 'roomId'])));
  if (value.type === 'profile.update') return value.ok === true && validId(value.requestId) && isParticipant(value.participant);
  if (value.type === 'room.create' || value.type === 'room.join') return value.ok === true && validId(value.requestId) && isRoomState(value.room);
  if (value.type === 'room.leave') return value.ok === true && validId(value.requestId) && validId(value.roomId);
  return value.type === 'error' && value.ok === false && (value.requestId === null || validId(value.requestId))
    && errorCodes.includes(value.code as ErrorCode) && typeof value.message === 'string';
}
