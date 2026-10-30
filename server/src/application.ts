import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { parseRequest } from './shared/protocol.js';
import type { Participant, ServerMessage } from './shared/protocol.js';

export function createApplication({ heartbeatIntervalMs = 30000 } = {}) {
  const server = createServer((request, response) => {
    const healthy = request.method === 'GET' && request.url === '/health';
    response.writeHead(healthy ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(healthy ? { status: 'ok' } : { error: 'Not found' }));
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
  const sessions = new Map<WebSocket, { participant: Participant; alive: boolean }>();
  let closing = false;

  // ws forwards HTTP listen errors; consume them as well as the entrypoint's handler.
  wss.on('error', error => {
    console.error(`WebSocket server error: ${error.message}`);
    void close().catch(() => console.error('WebSocket server failed to close.'));
  });

  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message), error => { if (error) socket.terminate(); });
    }
  }
  function broadcast(message: ServerMessage, except?: WebSocket) {
    if (closing) return;
    for (const socket of sessions.keys()) if (socket !== except) send(socket, message);
  }
  function remove(socket: WebSocket) {
    const session = sessions.get(socket);
    if (!session) return;
    sessions.delete(socket);
    broadcast({ kind: 'event', type: 'participant.left', participantId: session.participant.participantId });
  }

  wss.on('connection', socket => {
    const participant: Participant = { participantId: randomUUID(), nickname: '참가자', avatarId: 'bear' };
    sessions.set(socket, { participant, alive: true });
    socket.on('error', () => { remove(socket); socket.terminate(); });
    socket.on('close', () => remove(socket));
    socket.on('pong', () => { const session = sessions.get(socket); if (session) session.alive = true; });
    send(socket, { kind: 'event', type: 'session.ready', selfId: participant.participantId, participants: [...sessions.values()].map(session => session.participant) });
    broadcast({ kind: 'event', type: 'participant.joined', participant }, socket);

    socket.on('message', (data, isBinary) => {
      const session = sessions.get(socket);
      if (!session || closing) return;
      if (isBinary) {
        send(socket, { kind: 'response', type: 'error', requestId: null, ok: false, code: 'INVALID_MESSAGE', message: '텍스트 JSON 요청만 지원합니다.' });
        return;
      }
      const request = parseRequest(data.toString());
      if (request.type === 'error') { send(socket, request); return; }
      session.participant = { participantId: session.participant.participantId, ...request.profile };
      send(socket, { kind: 'response', type: 'profile.update', requestId: request.requestId, ok: true, participant: session.participant });
      broadcast({ kind: 'event', type: 'participant.updated', participant: session.participant });
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
