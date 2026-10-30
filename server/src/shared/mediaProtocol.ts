export const mediaActions = ['capabilities', 'create', 'connect', 'produce', 'close', 'producer.close', 'producer.pause', 'producer.resume', 'stats', 'receive', 'recv.connect', 'producers', 'consume', 'consumer.resume', 'consumer.close', 'recv.close'] as const;
export type MediaAction = typeof mediaActions[number];
export type MediaRequest = { kind: 'request'; type: 'media.request'; requestId: string; roomId: string; mediaId: string; action: MediaAction; payload: Record<string, unknown> };
export type MediaResponse = { kind: 'response'; type: 'media.result'; requestId: string; ok: true; roomId: string; mediaId: string; action: MediaAction; data: Record<string, unknown> };
export type MediaClosed = { kind: 'event'; type: 'media.closed'; roomId: string; mediaId: string; reason: string };
export type RemoteProducer = { producerId: string; participantId: string; kind: 'audio' | 'video' };
export type MediaPeer = { participantId: string; sending: boolean; video: boolean; audio: boolean; muted: boolean };
export type MediaEvent = { kind: 'event'; type: 'media.producer.added' | 'media.producer.removed'; roomId: string; mediaId: string; producer: RemoteProducer }
  | { kind: 'event'; type: 'media.consumer.closed'; roomId: string; mediaId: string; consumerId: string }
  | { kind: 'event'; type: 'media.peers'; roomId: string; mediaId: string; revision: number; peers: MediaPeer[] };
export const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v);
export const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).length === fields.length && Object.keys(v).every(k => fields.includes(k));
export const validRemoteProducer = (v: unknown): v is RemoteProducer => object(v) && identifier(v.producerId) && identifier(v.participantId) && ['audio', 'video'].includes(v.kind as string);
export const validPeerSnapshot = (v: Record<string, unknown>) => Number.isSafeInteger(v.revision) && (v.revision as number) >= 0 && Array.isArray(v.peers) && v.peers.every(p => object(p) && identifier(p.participantId) && ['sending', 'video', 'audio', 'muted'].every(k => typeof p[k] === 'boolean'));
export function validMediaEvent(v: Record<string, unknown>): boolean {
  if (v.type === 'media.peers') return identifier(v.roomId) && identifier(v.mediaId) && validPeerSnapshot(v);
  return identifier(v.roomId) && identifier(v.mediaId) && (v.type === 'media.consumer.closed' ? identifier(v.consumerId) : validRemoteProducer(v.producer));
}

export function validMediaRequest(v: Record<string, unknown>): v is MediaRequest {
  if (!exact(v, ['kind', 'type', 'requestId', 'roomId', 'mediaId', 'action', 'payload']) || !identifier(v.roomId) || !identifier(v.mediaId)
    || !mediaActions.includes(v.action as MediaAction) || !object(v.payload)) return false;
  const p = v.payload;
  switch (v.action) {
    case 'recv.connect':
    case 'connect': {
      if (!exact(p, ['transportId', 'dtlsParameters']) || !identifier(p.transportId) || !object(p.dtlsParameters)) return false;
      const d = p.dtlsParameters;
      return (d.role === undefined || ['auto', 'client', 'server'].includes(d.role as string)) && Array.isArray(d.fingerprints) && d.fingerprints.length > 0 && d.fingerprints.length <= 8
        && d.fingerprints.every(f => object(f) && ['sha-1', 'sha-224', 'sha-256', 'sha-384', 'sha-512'].includes(f.algorithm as string) && typeof f.value === 'string' && /^([0-9A-Fa-f]{2}:)+[0-9A-Fa-f]{2}$/.test(f.value));
    }
    case 'produce': {
      if (!exact(p, p.paused === undefined ? ['transportId', 'kind', 'rtpParameters'] : ['transportId', 'kind', 'rtpParameters', 'paused']) || (p.paused !== undefined && (p.kind !== 'audio' || typeof p.paused !== 'boolean')) || !identifier(p.transportId) || !['audio', 'video'].includes(p.kind as string) || !object(p.rtpParameters)) return false;
      const r = p.rtpParameters;
      return Array.isArray(r.codecs) && r.codecs.length > 0 && r.codecs.length <= 8 && r.codecs.every(c => object(c) && typeof c.mimeType === 'string'
        && ['audio/opus', 'video/vp8', 'video/rtx'].includes(c.mimeType.toLowerCase()) && Number.isInteger(c.payloadType) && (c.payloadType as number) >= 0 && (c.payloadType as number) <= 127 && Number.isInteger(c.clockRate) && (c.clockRate as number) > 0)
        && (r.encodings === undefined || (Array.isArray(r.encodings) && r.encodings.length <= 1 && r.encodings.every(object)));
    }
    case 'producer.pause':
    case 'producer.resume':
    case 'producer.close': return exact(p, ['transportId', 'producerId']) && identifier(p.transportId) && identifier(p.producerId);
    case 'consume': return exact(p, ['transportId', 'producerId', 'rtpCapabilities']) && identifier(p.transportId) && identifier(p.producerId)
      && object(p.rtpCapabilities) && Array.isArray(p.rtpCapabilities.codecs) && p.rtpCapabilities.codecs.length > 0 && p.rtpCapabilities.codecs.length <= 8
      && p.rtpCapabilities.codecs.every(c => object(c) && typeof c.mimeType === 'string' && ['audio/opus', 'video/vp8', 'video/rtx'].includes(c.mimeType.toLowerCase()) && Number.isInteger(c.clockRate) && (c.clockRate as number) > 0);
    case 'consumer.resume':
    case 'consumer.close': return exact(p, ['consumerId']) && identifier(p.consumerId);
    default: return exact(p, []);
  }
}

export function validMediaResponse(v: Record<string, unknown>): boolean {
  if (!identifier(v.requestId) || !identifier(v.roomId) || !identifier(v.mediaId) || v.ok !== true || !mediaActions.includes(v.action as MediaAction) || !object(v.data)) return false;
  const d = v.data;
  switch (v.action) {
    case 'capabilities': return object(d.capabilities) && Array.isArray(d.capabilities.codecs);
    case 'receive':
    case 'create': return identifier(d.id) && object(d.iceParameters) && Array.isArray(d.iceCandidates) && d.iceCandidates.every(object) && object(d.dtlsParameters);
    case 'producers': return Array.isArray(d.producers) && d.producers.every(validRemoteProducer) && validPeerSnapshot(d);
    case 'consume': return identifier(d.id) && identifier(d.producerId) && identifier(d.participantId) && ['audio', 'video'].includes(d.kind as string) && object(d.rtpParameters) && Array.isArray(d.rtpParameters.codecs);
    case 'consumer.resume': return d.resumed === true;
    case 'producer.pause':
    case 'producer.resume': return identifier(d.producerId) && typeof d.paused === 'boolean';
    case 'produce': return identifier(d.producerId);
    case 'stats': return typeof d.iceState === 'string' && typeof d.dtlsState === 'string' && Array.isArray(d.producers) && d.producers.every(p => object(p) && identifier(p.id) && ['audio', 'video'].includes(p.kind as string) && typeof p.packets === 'number' && typeof p.bytes === 'number');
    default: return d.closed === true || d.connected === true;
  }
}
