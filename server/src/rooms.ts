import { randomUUID } from 'node:crypto';
import type { RoomSummary } from './shared/protocol.js';

// Membership lives only here. Profiles remain owned by WebSocket sessions.
export function createRoomStore() {
  const rooms = new Map<string, { roomId: string; name: string; participantIds: Set<string> }>();
  function leave(roomId: string, participantId: string) {
    const room = rooms.get(roomId);
    if (!room) return 'ROOM_NOT_FOUND' as const;
    if (!room.participantIds.delete(participantId)) return 'NOT_JOINED' as const;
    if (!room.participantIds.size) rooms.delete(roomId);
    return null;
  }
  return {
    get: (roomId: string) => rooms.get(roomId),
    list: (): RoomSummary[] => [...rooms.values()].map(room => ({ roomId: room.roomId, name: room.name, participantCount: room.participantIds.size })),
    joined: (participantId: string) => [...rooms.values()].filter(room => room.participantIds.has(participantId)).map(room => room.roomId),
    create(name: string, participantId: string) {
      const room = { roomId: randomUUID(), name, participantIds: new Set([participantId]) };
      rooms.set(room.roomId, room);
      return room.roomId;
    },
    join(roomId: string, participantId: string) {
      const room = rooms.get(roomId);
      if (!room) return 'ROOM_NOT_FOUND' as const;
      if (room.participantIds.has(participantId)) return 'ALREADY_JOINED' as const;
      room.participantIds.add(participantId);
      return null;
    },
    leave,
    clear: () => rooms.clear(),
  };
}
