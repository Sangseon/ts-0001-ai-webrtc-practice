import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaAction, MediaClosed, MediaResponse, MediaEvent } from '../../server/src/shared/mediaProtocol.js';
import { chatChannelLimit, chatTotalLimit, isServerMessage } from '../../server/src/shared/protocol.js';
import type { ChatMessage, ChatTarget, Participant, Profile, ClientRequest, RoomSummary } from '../../server/src/shared/protocol.js';

type Command = { type: 'profile.update'; profile: Profile } | { type: 'room.create'; name: string } | { type: 'room.join' | 'room.leave'; roomId: string } | ({ type: 'chat.send'; body: string } & ChatTarget);

export function useSession() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [selfId, setSelfId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [joinedRooms, setJoinedRooms] = useState<Record<string, Participant[]>>({});
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Participant>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaPending = useRef(new Map<string, { action: MediaAction; roomId: string; mediaId: string; resolve: (value: MediaResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const mediaListeners = useRef(new Set<(event: MediaClosed) => void>());
  const remoteListeners = useRef(new Set<(event: MediaEvent) => void>());
  const onMediaEvent = useCallback((listener: (event: MediaEvent) => void) => {
    remoteListeners.current.add(listener); return () => { remoteListeners.current.delete(listener); };
  }, []);
  function rejectMedia() {
    for (const p of mediaPending.current.values()) { clearTimeout(p.timer); p.reject(new Error('WebSocket 연결이 종료됐습니다.')); }
    mediaPending.current.clear();
  }
  const mediaRequest = useCallback((action: MediaAction, roomId: string, mediaId: string, payload: Record<string, unknown> = {}) => new Promise<MediaResponse>((resolve, reject) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) { reject(new Error('WebSocket 연결이 필요합니다.')); return; }
    const requestId = crypto.randomUUID();
    const text = JSON.stringify({ kind: 'request', type: 'media.request', requestId, action, roomId, mediaId, payload });
    if (new TextEncoder().encode(text).length > 4096) { reject(new Error('Signaling 요청이 4096 bytes를 초과합니다.')); return; }
    const timer = setTimeout(() => { mediaPending.current.delete(requestId); reject(new Error('SFU 요청 시간이 초과됐습니다. 연결을 종료합니다.')); socket.close(); }, 8000);
    mediaPending.current.set(requestId, { action, roomId, mediaId, resolve, reject, timer });
    try { socket.send(text); } catch { clearTimeout(timer); mediaPending.current.delete(requestId); reject(new Error('SFU 요청 전송 실패')); socket.close(); }
  }), []);
  const onMediaClosed = useCallback((listener: (event: MediaClosed) => void) => {
    mediaListeners.current.add(listener);
    return () => { mediaListeners.current.delete(listener); };
  }, []);
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    const retained = new Set([...participants.map(p => p.participantId), ...messages.map(m => m.participantId)]);
    setProfiles(current => Object.fromEntries(Object.entries({ ...current, ...Object.fromEntries(participants.map(p => [p.participantId, p])) }).filter(([id]) => retained.has(id))));
  }, [participants, messages]);

  function clearPending() {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
    setSaving(false);
  }

  useEffect(() => {
    let active = true;
    let socket: WebSocket | undefined;
    setStatus('connecting');
    setSelfId(null);
    setParticipants([]);
    setRooms([]);
    setJoinedRooms({});
    setSelectedRoomId('');
    setMessages([]);
    setProfiles({});
    setError('');
    setNotice('');
    // StrictMode's first setup is cleaned up before starting a network connection.
    const start = setTimeout(() => {
      const url = new URL('/ws', window.location.href);
      url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.port = '3000';
      socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onmessage = event => {
        if (!active) return;
        let value: unknown;
        try { value = JSON.parse(event.data); } catch { setError('서버 JSON 응답을 읽을 수 없습니다.'); socket?.close(); return; }
        if (!isServerMessage(value)) { setError('서버 메시지 형식이 올바르지 않습니다.'); socket?.close(); return; }
        if (value.kind === 'response') {
          const p = value.requestId ? mediaPending.current.get(value.requestId) : undefined;
          if (p) {
            clearTimeout(p.timer); mediaPending.current.delete(value.requestId!);
            if (value.type === 'media.result' && value.action === p.action && value.roomId === p.roomId && value.mediaId === p.mediaId) p.resolve(value);
            else {
              p.reject(new Error(value.type === 'error' ? value.message : '잘못된 SFU 응답'));
              if (p.action === 'close') socket?.close();
            }
            return;
          }
          if (value.type === 'media.result') return;
        }
        if (value.kind === 'event') {
          if (value.type === 'media.closed') { for (const listener of mediaListeners.current) listener(value); return; }
          if (value.type === 'media.producer.added' || value.type === 'media.producer.removed' || value.type === 'media.consumer.closed' || value.type === 'media.peers') { for (const listener of remoteListeners.current) listener(value); return; }
          if (value.type === 'session.ready') {
            setSelfId(value.selfId);
            setParticipants(value.participants);
            setProfiles(Object.fromEntries(value.participants.map(p => [p.participantId, p])));
            setStatus('connected');
          } else if (value.type === 'chat.message') {
            const message = value.message;
            const channel = (m: ChatMessage) => m.scope === 'global' ? 'global' : m.roomId;
            setMessages(current => {
              if (current.some(m => m.messageId === message.messageId)) return current;
              const same = current.filter(m => channel(m) === channel(message));
              const dropped = new Set(same.slice(0, Math.max(0, same.length - chatChannelLimit + 1)).map(m => m.messageId));
              return [...current.filter(m => !dropped.has(m.messageId)), message].slice(-chatTotalLimit);
            });
          } else if (value.type === 'participant.left') {
            setParticipants(current => current.filter(participant => participant.participantId !== value.participantId));
          } else if (value.type === 'participant.joined' || value.type === 'participant.updated') {
            setProfiles(current => ({ ...current, [value.participant.participantId]: value.participant }));
            setParticipants(current => [...current.filter(participant => participant.participantId !== value.participant.participantId), value.participant]);
          } else if (value.type === 'rooms.changed') {
            setRooms(value.rooms);
            const ids = new Set(value.rooms.map(room => room.roomId));
            setJoinedRooms(current => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
            setSelectedRoomId(current => ids.has(current) ? current : '');
            setMessages(current => current.filter(m => m.scope === 'global' || ids.has(m.roomId)));
          } else if (value.type === 'room.state') {
            setJoinedRooms(current => Object.hasOwn(current, value.roomId) ? { ...current, [value.roomId]: value.participants } : current);
          }
        } else if (value.type === 'error') {
          setError(value.message);
          if (value.requestId === pending.current?.id) clearPending();
        } else if (value.requestId === pending.current?.id) {
          clearPending();
          setError('');
          if (value.type === 'profile.update') setNotice('프로필을 변경했습니다.');
          else if (value.type === 'chat.send') setNotice('서버가 채팅 전송을 승인했습니다.');
          else if (value.type === 'room.leave') {
            setJoinedRooms(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== value.roomId)));
            setNotice('선택한 회의방에서 퇴장했습니다.');
            setMessages(current => current.filter(m => m.scope === 'global' || m.roomId !== value.roomId));
          } else {
            setJoinedRooms(current => ({ ...current, [value.room.roomId]: value.room.participants }));
            setSelectedRoomId(value.room.roomId);
            setNotice(value.type === 'room.create' ? '회의방을 생성하고 입장했습니다.' : '회의방에 입장했습니다.');
          }
        }
      };
      socket.onerror = () => { if (active) setError('서버에 연결할 수 없습니다. 서버 실행 상태를 확인해주세요.'); };
      socket.onclose = () => {
        if (!active) return;
        if (pending.current) setError('연결이 종료되어 변경 결과를 확인할 수 없습니다.');
        clearPending();
        rejectMedia();
        socketRef.current = null;
        setStatus('disconnected');
        setSelfId(null);
        setParticipants([]);
        setRooms([]);
        setJoinedRooms({});
        setSelectedRoomId('');
        setMessages([]);
        setProfiles({});
        setNotice('');
      };
    }, 0);
    return () => {
      active = false;
      rejectMedia();
      clearTimeout(start);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
      socketRef.current = null;
    };
  }, [attempt]);

  function sendRequest(command: Command) {
    const socket = socketRef.current;
    if (status !== 'connected' || !socket || socket.readyState !== WebSocket.OPEN || pending.current) return;
    const request: ClientRequest = { kind: 'request', requestId: crypto.randomUUID(), ...command };
    setError('');
    setNotice('');
    setSaving(true);
    pending.current = { id: request.requestId, timer: setTimeout(() => {
      clearPending();
      setError('응답 시간이 초과되어 변경 결과를 확인할 수 없습니다. 다시 연결해주세요.');
      socket.close();
    }, 8000) };
    try { socket.send(JSON.stringify(request)); } catch {
      clearPending();
      setError('요청을 보내지 못했습니다.');
      socket.close();
    }
  }

  return {
    status, selfId, participants, rooms, joinedRooms, selectedRoomId, setSelectedRoomId, error, notice, saving, messages, profiles, mediaRequest, onMediaClosed, onMediaEvent,
    sendChat: (target: ChatTarget, body: string) => sendRequest({ type: 'chat.send', ...target, body }),
    updateProfile: (profile: Profile) => sendRequest({ type: 'profile.update', profile }),
    createRoom: (name: string) => sendRequest({ type: 'room.create', name }),
    joinRoom: (roomId: string) => sendRequest({ type: 'room.join', roomId }),
    leaveRoom: (roomId: string) => sendRequest({ type: 'room.leave', roomId }),
    reconnect: () => { if (status === 'disconnected') { setSaving(false); setAttempt(value => value + 1); } },
    disconnect: () => socketRef.current?.close(),
  };
}
