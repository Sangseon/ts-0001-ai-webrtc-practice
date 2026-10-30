import { useEffect, useRef, useState } from 'react';
import { isServerMessage } from '../../server/src/shared/protocol.js';
import type { Participant, Profile, ClientRequest, RoomSummary } from '../../server/src/shared/protocol.js';

type Command = { type: 'profile.update'; profile: Profile } | { type: 'room.create'; name: string } | { type: 'room.join' | 'room.leave'; roomId: string };

export function useSession() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [selfId, setSelfId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [joinedRooms, setJoinedRooms] = useState<Record<string, Participant[]>>({});
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

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
        if (value.kind === 'event') {
          if (value.type === 'session.ready') {
            setSelfId(value.selfId);
            setParticipants(value.participants);
            setStatus('connected');
          } else if (value.type === 'participant.left') {
            setParticipants(current => current.filter(participant => participant.participantId !== value.participantId));
          } else if (value.type === 'participant.joined' || value.type === 'participant.updated') {
            setParticipants(current => [...current.filter(participant => participant.participantId !== value.participant.participantId), value.participant]);
          } else if (value.type === 'rooms.changed') {
            setRooms(value.rooms);
            const ids = new Set(value.rooms.map(room => room.roomId));
            setJoinedRooms(current => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
            setSelectedRoomId(current => ids.has(current) ? current : '');
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
          else if (value.type === 'room.leave') {
            setJoinedRooms(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== value.roomId)));
            setNotice('선택한 회의방에서 퇴장했습니다.');
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
        socketRef.current = null;
        setStatus('disconnected');
        setSelfId(null);
        setParticipants([]);
        setRooms([]);
        setJoinedRooms({});
        setSelectedRoomId('');
        setNotice('');
      };
    }, 0);
    return () => {
      active = false;
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
    status, selfId, participants, rooms, joinedRooms, selectedRoomId, setSelectedRoomId, error, notice, saving,
    updateProfile: (profile: Profile) => sendRequest({ type: 'profile.update', profile }),
    createRoom: (name: string) => sendRequest({ type: 'room.create', name }),
    joinRoom: (roomId: string) => sendRequest({ type: 'room.join', roomId }),
    leaveRoom: (roomId: string) => sendRequest({ type: 'room.leave', roomId }),
    reconnect: () => { if (status === 'disconnected') { setSaving(false); setAttempt(value => value + 1); } },
    disconnect: () => socketRef.current?.close(),
  };
}
