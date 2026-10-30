import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { parseRequest } from './shared/protocol.js';
import type { ChatMessage, Participant, ServerMessage } from './shared/protocol.js';
import { createRoomStore } from './rooms.js';

export function createApplication({ heartbeatIntervalMs = 30000 } = {}) {
  const server = createServer((request, response) => {
    const healthy = request.method === 'GET' && request.url === '/health';
    response.writeHead(healthy ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(healthy ? { status: 'ok' } : { error: 'Not found' }));
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
  const sessions = new Map<WebSocket, { participant: Participant; alive: boolean }>();
  const rooms = createRoomStore();
  let closing = false;

  // ws forwards HTTP listen errors; consume them as well as the entrypoint's handler.
  wss.on('error', error => {
    console.error(`WebSocket server error: ${error.message}`);
    void close().catch(() => console.error('WebSocket server failed to close.'));
  });

  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify(message)); } catch {
        if (socket.readyState === WebSocket.OPEN) socket.terminate();
      }
    }
  }
  function broadcast(message: ServerMessage, except?: WebSocket) {
    if (closing) return;
    for (const socket of sessions.keys()) if (socket !== except) send(socket, message);
  }
  function remove(socket: WebSocket) {
    const session = sessions.get(socket);
    if (!session) return;
    const joined = rooms.joined(session.participant.participantId);
    for (const roomId of joined) rooms.leave(roomId, session.participant.participantId);
    sessions.delete(socket);
    for (const roomId of joined) broadcastRoom(roomId);
    if (joined.length) broadcastRooms();
    broadcast({ kind: 'event', type: 'participant.left', participantId: session.participant.participantId });
  }

  function roomParticipants(roomId: string) {
    const ids = rooms.get(roomId)?.participantIds;
    return [...sessions.values()].filter(session => ids?.has(session.participant.participantId)).map(session => session.participant);
  }
  function broadcastRooms() { broadcast({ kind: 'event', type: 'rooms.changed', rooms: rooms.list() }); }
  function broadcastRoom(roomId: string) {
    const room = rooms.get(roomId);
    if (!room || closing) return;
    const message: ServerMessage = { kind: 'event', type: 'room.state', roomId, participants: roomParticipants(roomId) };
    for (const [socket, session] of sessions) if (room.participantIds.has(session.participant.participantId)) send(socket, message);
  }

  wss.on('connection', socket => {
    const participant: Participant = { participantId: randomUUID(), nickname: '참가자', avatarId: 'bear' };
    sessions.set(socket, { participant, alive: true });
    socket.on('error', error => {
      const code = (error as Error & { code?: string }).code;
      if (code !== 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' && socket.readyState === WebSocket.OPEN) socket.terminate();
    });
    socket.on('close', () => remove(socket));
    socket.on('pong', () => { const session = sessions.get(socket); if (session) session.alive = true; });
    send(socket, { kind: 'event', type: 'session.ready', selfId: participant.participantId, participants: [...sessions.values()].map(session => session.participant) });
    send(socket, { kind: 'event', type: 'rooms.changed', rooms: rooms.list() });
    broadcast({ kind: 'event', type: 'participant.joined', participant }, socket);

    socket.on('message', (data, isBinary) => {
      const session = sessions.get(socket);
      if (!session || closing || socket.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        send(socket, { kind: 'response', type: 'error', requestId: null, ok: false, code: 'INVALID_MESSAGE', message: '텍스트 JSON 요청만 지원합니다.' });
        return;
      }
      const request = parseRequest(data.toString());
      if (request.type === 'error') { send(socket, request); return; }
      if (request.type === 'chat.send') {
        const room = request.scope === 'room' ? rooms.get(request.roomId) : undefined;
        if (request.scope === 'room' && (!room || !room.participantIds.has(session.participant.participantId))) {
          send(socket, { kind: 'response', type: 'error', requestId: request.requestId, ok: false,
            code: room ? 'NOT_JOINED' : 'ROOM_NOT_FOUND', message: room ? '참여 중인 회의방에만 전송할 수 있습니다.' : '회의방이 존재하지 않습니다.' });
          return;
        }
        const message: ChatMessage = { messageId: randomUUID(), participantId: session.participant.participantId,
          sentAt: new Date().toISOString(), body: request.body,
          ...(request.scope === 'global' ? { scope: 'global' } : { scope: 'room', roomId: request.roomId }) };
        send(socket, { kind: 'response', type: 'chat.send', requestId: request.requestId, ok: true, messageId: message.messageId,
          ...(request.scope === 'global' ? { scope: 'global' } : { scope: 'room', roomId: request.roomId }) });
        for (const [recipient, recipientSession] of sessions) {
          if (request.scope === 'global' || room?.participantIds.has(recipientSession.participant.participantId)) {
            send(recipient, { kind: 'event', type: 'chat.message', message });
          }
        }
        return;
      }
      if (request.type !== 'profile.update') {
        let roomId: string;
        if (request.type === 'room.create') {
          roomId = rooms.create(request.name, session.participant.participantId);
        } else {
          roomId = request.roomId;
          const error = request.type === 'room.join'
            ? rooms.join(roomId, session.participant.participantId)
            : rooms.leave(roomId, session.participant.participantId);
          if (error) {
            const messages = { ROOM_NOT_FOUND: '회의방이 존재하지 않습니다.', ALREADY_JOINED: '이미 참여 중인 회의방입니다.', NOT_JOINED: '참여하지 않은 회의방입니다.' };
            send(socket, { kind: 'response', type: 'error', requestId: request.requestId, ok: false, code: error, message: messages[error] });
            return;
          }
        }
        if (request.type === 'room.leave') {
          send(socket, { kind: 'response', type: 'room.leave', requestId: request.requestId, ok: true, roomId });
        } else {
          send(socket, { kind: 'response', type: request.type, requestId: request.requestId, ok: true,
            room: { roomId, name: rooms.get(roomId)!.name, participants: roomParticipants(roomId) } });
        }
        // One synchronous mutation: response, room snapshot to members, global summaries.
        broadcastRoom(roomId);
        broadcastRooms();
        return;
      }
      session.participant = { participantId: session.participant.participantId, ...request.profile };
      send(socket, { kind: 'response', type: 'profile.update', requestId: request.requestId, ok: true, participant: session.participant });
      broadcast({ kind: 'event', type: 'participant.updated', participant: session.participant });
      for (const roomId of rooms.joined(session.participant.participantId)) broadcastRoom(roomId);
    });
  });

  const heartbeat = setInterval(() => {
    for (const [socket, session] of sessions) {
      if (!session.alive) { remove(socket); socket.terminate(); continue; }
      session.alive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  let closePromise: Promise<void> | undefined;
  function close() {
    closePromise ??= new Promise<void>((resolve, reject) => {
      closing = true;
      clearInterval(heartbeat);
      for (const socket of sessions.keys()) socket.terminate();
      sessions.clear();
      rooms.clear();
      wss.close(() => {
        server.close(error => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        });
        server.closeIdleConnections();
      });
    });
    return closePromise;
  }
  return { server, close };
}
