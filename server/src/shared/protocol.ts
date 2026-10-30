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
export type ErrorCode = 'INVALID_JSON' | 'INVALID_MESSAGE' | 'UNKNOWN_TYPE' | 'INVALID_PROFILE';
export type ServerMessage =
  | { kind: 'event'; type: 'session.ready'; selfId: string; participants: Participant[] }
  | { kind: 'event'; type: 'participant.joined' | 'participant.updated'; participant: Participant }
  | { kind: 'event'; type: 'participant.left'; participantId: string }
  | { kind: 'response'; type: 'profile.update'; requestId: string; ok: true; participant: Participant }
  | { kind: 'response'; type: 'error'; requestId: string | null; ok: false; code: ErrorCode; message: string };

export const nicknameMaxLength = 20;
const errorCodes: ErrorCode[] = ['INVALID_JSON', 'INVALID_MESSAGE', 'UNKNOWN_TYPE', 'INVALID_PROFILE'];
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

export function parseRequest(text: string): ProfileRequest | Extract<ServerMessage, { type: 'error' }> {
  let value: unknown;
  const fail = (code: ErrorCode, message: string, requestId: string | null = null): Extract<ServerMessage, { type: 'error' }> =>
    ({ kind: 'response', type: 'error', requestId, ok: false, code, message });
  try { value = JSON.parse(text); } catch { return fail('INVALID_JSON', 'JSON 형식이 올바르지 않습니다.'); }
  if (!record(value)) return fail('INVALID_MESSAGE', '요청 객체가 필요합니다.');
  const requestId = validId(value.requestId) ? value.requestId : null;
  if (value.kind !== 'request' || !requestId || typeof value.type !== 'string') return fail('INVALID_MESSAGE', '요청 종류와 requestId를 확인해주세요.', requestId);
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

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!record(value)) return false;
  if (value.kind === 'event') {
    switch (value.type) {
      case 'session.ready': return validId(value.selfId) && Array.isArray(value.participants) && value.participants.every(isParticipant);
      case 'participant.joined':
      case 'participant.updated': return isParticipant(value.participant);
      case 'participant.left': return validId(value.participantId);
      default: return false;
    }
  }
  if (value.kind !== 'response') return false;
  if (value.type === 'profile.update') return value.ok === true && validId(value.requestId) && isParticipant(value.participant);
  return value.type === 'error' && value.ok === false && (value.requestId === null || validId(value.requestId))
    && errorCodes.includes(value.code as ErrorCode) && typeof value.message === 'string';
}
