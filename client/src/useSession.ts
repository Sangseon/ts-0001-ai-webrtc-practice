import { useEffect, useRef, useState } from 'react';
import { isServerMessage } from '../../server/src/shared/protocol.js';
import type { Participant, Profile, ProfileRequest } from '../../server/src/shared/protocol.js';

export function useSession() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [selfId, setSelfId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
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
          } else {
            setParticipants(current => [...current.filter(participant => participant.participantId !== value.participant.participantId), value.participant]);
          }
        } else if (value.type === 'error') {
          setError(value.message);
          if (value.requestId === pending.current?.id) clearPending();
        } else if (value.requestId === pending.current?.id) {
          clearPending();
          setError('');
          setNotice('프로필을 변경했습니다.');
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

  function updateProfile(profile: Profile) {
    const socket = socketRef.current;
    if (status !== 'connected' || !socket || socket.readyState !== WebSocket.OPEN || pending.current) return;
    const request: ProfileRequest = { kind: 'request', type: 'profile.update', requestId: crypto.randomUUID(), profile };
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
      setError('프로필 요청을 보내지 못했습니다.');
      socket.close();
    }
  }

  return {
    status, selfId, participants, error, notice, saving, updateProfile,
    reconnect: () => { if (status === 'disconnected') { setSaving(false); setAttempt(value => value + 1); } },
    disconnect: () => socketRef.current?.close(),
  };
}
