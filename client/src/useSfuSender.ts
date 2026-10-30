import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import type { Producer, Consumer, ConsumerOptions, Transport, TransportOptions, RtpCapabilities } from 'mediasoup-client/types';
import type { RemoteProducer } from '../../server/src/shared/mediaProtocol.js';
import type { useSession } from './useSession';
import type { useLocalMedia } from './useLocalMedia';

export type RemoteTrack = { participantId: string; producerId: string; consumerId: string; kind: 'audio' | 'video'; track: MediaStreamTrack };
type Attempt = { mediaId: string; roomId: string; transport?: Transport; producers: Producer[]; timer?: ReturnType<typeof setTimeout>;
  recv?: Transport; receiveOnly: boolean; consumers: Map<string, { consumer: Consumer; participantId: string }>; discovered: Map<string, RemoteProducer>; removed: Set<string>; closedConsumers: Set<string>; subscribe?: (producer: RemoteProducer) => void; recvTimer?: ReturnType<typeof setTimeout> };
export function useSfuSender(session: ReturnType<typeof useSession>, local: ReturnType<typeof useLocalMedia>) {
  const current = useRef<Attempt | null>(null);
  const mounted = useRef(false);
  const stopping = useRef<Promise<void> | null>(null);
  const [state, setState] = useState({ phase: 'idle', activeMediaRoomId: '', mediaId: '', transportId: '', connection: 'new', error: '', producers: [] as { id: string; kind: string }[] });
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [remoteTracks, setRemoteTracks] = useState<RemoteTrack[]>([]);
  const [recvConnection, setRecvConnection] = useState('new');
  const rpc = session.mediaRequest;
  const dispose = useCallback((attempt: Attempt) => {
    clearTimeout(attempt.timer);
    clearTimeout(attempt.recvTimer);
    for (const { consumer } of attempt.consumers.values()) consumer.close();
    attempt.consumers.clear(); attempt.recv?.close();
    for (const producer of attempt.producers) producer.close();
    attempt.transport?.close();
  }, []);
  const stop = useCallback((): Promise<void> => {
    if (stopping.current) return stopping.current;
    const attempt = current.current;
    if (!attempt) return Promise.resolve();
    current.current = null; dispose(attempt);
    if (mounted.current) { setRemoteTracks([]); setRecvConnection('closed'); setState(s => ({ ...s, phase: 'stopping', activeMediaRoomId: '', producers: [], connection: 'closed' })); setStats({}); }
    const task = rpc('close', attempt.roomId, attempt.mediaId).then(() => {
      if (mounted.current) setState(s => ({ ...s, phase: 'idle', activeMediaRoomId: '', error: '' }));
    }, error => {
      if (mounted.current) setState(s => ({ ...s, phase: 'error', activeMediaRoomId: '', error: '서버 종료 확인 실패: ' + String(error) }));
      throw error;
    }).finally(() => { if (stopping.current === task) stopping.current = null; });
    stopping.current = task;
    return task;
  }, [rpc, dispose]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const attempt = current.current; current.current = null;
      if (attempt) { dispose(attempt); void rpc('close', attempt.roomId, attempt.mediaId).catch(() => {}); }
    };
  }, [dispose, rpc]);
  useEffect(() => session.onMediaClosed(event => {
    const attempt = current.current;
    if (attempt?.mediaId !== event.mediaId) return;
    current.current = null; dispose(attempt); setStats({}); setRemoteTracks([]); setRecvConnection('closed');
    setState(s => ({ ...s, phase: 'idle', activeMediaRoomId: '', connection: 'closed', producers: [], error: event.reason }));
  }), [session.onMediaClosed, dispose]);
  const refreshRemote = useCallback((attempt: Attempt) => {
    if (current.current !== attempt || !mounted.current) return;
    setRemoteTracks([...attempt.consumers.values()].map(({ consumer, participantId }) => ({ participantId, producerId: consumer.producerId, consumerId: consumer.id, kind: consumer.kind, track: consumer.track })));
  }, []);
  useEffect(() => session.onMediaEvent(event => {
    const attempt = current.current;
    if (!attempt || attempt.mediaId !== event.mediaId || attempt.roomId !== event.roomId) return;
    if (event.type === 'media.producer.added') {
      attempt.discovered.set(event.producer.producerId, event.producer); attempt.subscribe?.(event.producer);
    } else {
      if (event.type === 'media.producer.removed') { attempt.removed.add(event.producer.producerId); attempt.discovered.delete(event.producer.producerId); }
      else if (event.type === 'media.consumer.closed') attempt.closedConsumers.add(event.consumerId);
      for (const [producerId, entry] of attempt.consumers) if (event.type === 'media.producer.removed' ? producerId === event.producer.producerId : event.type === 'media.consumer.closed' && entry.consumer.id === event.consumerId) {
        entry.consumer.close(); attempt.consumers.delete(producerId);
      }
      refreshRemote(attempt);
    }
  }), [session.onMediaEvent, refreshRemote]);
  useEffect(() => {
    const attempt = current.current;
    if (attempt && ((!attempt.receiveOnly && local.status !== 'ready') || session.status !== 'connected' || !Object.hasOwn(session.joinedRooms, attempt.roomId))) void stop().catch(() => {});
  }, [local.status, session.status, session.joinedRooms, stop]);

  async function start(roomId: string, receiveOnly = false) {
    if (stopping.current) return;
    try {
      if (current.current) await stop();
      if (!mounted.current || (!receiveOnly && local.status !== 'ready') || !Object.hasOwn(session.joinedRooms, roomId)) throw new Error('대상 방 참여와 송신 시 로컬 미디어가 필요합니다.');
      const tracks = receiveOnly ? [] : local.streamRef.current?.getTracks().filter(t => t.readyState === 'live') ?? [];
      if (!receiveOnly && !tracks.length) throw new Error('송신할 로컬 트랙이 없습니다.');
      const attempt: Attempt = { roomId, mediaId: crypto.randomUUID(), producers: [], receiveOnly, consumers: new Map(), discovered: new Map(), removed: new Set(), closedConsumers: new Set() };
      current.current = attempt;
      const check = () => { if (current.current !== attempt || !mounted.current) throw new Error('취소된 송신 요청'); };
      const call = async (action: Parameters<typeof rpc>[0], payload: Record<string, unknown> = {}) => {
        check(); const result = await rpc(action, roomId, attempt.mediaId, payload); check(); return result.data;
      };
      setState({ phase: 'connecting', activeMediaRoomId: roomId, mediaId: attempt.mediaId, transportId: '', connection: 'new', error: '', producers: [] });
      setRemoteTracks([]); setRecvConnection('new');
      attempt.timer = setTimeout(() => {
        if (current.current === attempt) void stop().catch(() => {}).finally(() => { if (mounted.current && !current.current) setState(s => ({ ...s, phase: 'error', error: 'ICE/DTLS 연결 시간이 초과됐습니다.' })); });
      }, 15000);
      try {
        const capabilities = (await call('capabilities')).capabilities as RtpCapabilities;
        const device = new Device();
        await device.load({ routerRtpCapabilities: capabilities }); check();
        for (const track of tracks) if (!device.canProduce(track.kind as 'audio' | 'video')) throw new Error('지원하지 않는 트랙 종류입니다.');
        if (receiveOnly) {
          await setupReceiver(); check(); clearTimeout(attempt.timer);
          setState(s => ({ ...s, phase: 'receiving' })); return;
        }
        const options = await call('create');
        const transport = device.createSendTransport(options as TransportOptions); attempt.transport = transport;
        setState(s => ({ ...s, transportId: transport.id }));
        transport.on('connect', ({ dtlsParameters }, callback, errback) => { void call('connect', { transportId: transport.id, dtlsParameters }).then(() => callback(), errback); });
        transport.on('produce', ({ kind, rtpParameters }, callback, errback) => { void call('produce', { transportId: transport.id, kind, rtpParameters }).then(data => callback({ id: data.producerId as string }), errback); });
        transport.on('connectionstatechange', connection => {
          if (current.current !== attempt) return;
          setState(s => ({ ...s, connection, phase: connection === 'connected' ? 'sending' : s.phase }));
          if (connection === 'connected') clearTimeout(attempt.timer);
          if (connection === 'failed' || connection === 'disconnected') void stop().catch(() => {});
        });
        await setupReceiver(); check();
        for (const track of tracks) {
          check();
          const producer = await transport.produce({ track, stopTracks: false, codec: device.rtpCapabilities.codecs?.find(c => c.mimeType.toLowerCase() === (track.kind === 'audio' ? 'audio/opus' : 'video/vp8')) });
          if (current.current !== attempt) { producer.close(); check(); }
          attempt.producers.push(producer);
          producer.on('trackended', () => { if (current.current === attempt) void stop().catch(() => {}); });
          setState(s => ({ ...s, producers: attempt.producers.map(p => ({ id: p.id, kind: p.kind })) }));
        }
        async function setupReceiver() {
          const recvOptions = await call('receive');
          const recv = device.createRecvTransport(recvOptions as TransportOptions); attempt.recv = recv;
          recv.on('connect', ({ dtlsParameters }, callback, errback) => { void call('recv.connect', { transportId: recv.id, dtlsParameters }).then(() => callback(), errback); });
          recv.on('connectionstatechange', connection => {
            if (current.current !== attempt) return;
            setRecvConnection(connection);
            if (connection === 'connected') clearTimeout(attempt.recvTimer);
            if (connection === 'failed' || connection === 'disconnected') void stop().catch(() => {});
          });
          const pending = new Set<string>();
          let queue = Promise.resolve();
          attempt.subscribe = descriptor => {
            const producerId = descriptor.producerId;
            if (pending.has(producerId) || attempt.consumers.has(producerId) || attempt.removed.has(producerId)) return;
            pending.add(producerId);
            queue = queue.then(async () => {
              check(); if (attempt.removed.has(producerId)) return;
              let serverConsumerId: string | undefined;
              let consumer: Consumer | undefined;
              try {
                const data = await call('consume', { transportId: recv.id, producerId, rtpCapabilities: device.recvRtpCapabilities });
                serverConsumerId = data.id as string;
                if (attempt.removed.has(producerId) || attempt.closedConsumers.has(serverConsumerId)) throw new Error('종료된 원격 Producer');
                if (recv.connectionState === 'new') attempt.recvTimer ??= setTimeout(() => { if (current.current === attempt) void stop().catch(() => {}); }, 15000);
                consumer = await recv.consume(data as unknown as ConsumerOptions); check();
                if (attempt.removed.has(producerId) || attempt.closedConsumers.has(consumer.id)) throw new Error('종료된 원격 Consumer');
                attempt.consumers.set(producerId, { consumer, participantId: descriptor.participantId });
                await call('consumer.resume', { consumerId: consumer.id }); check();
                refreshRemote(attempt);
              } catch (error) {
                consumer?.close(); attempt.consumers.delete(producerId); refreshRemote(attempt);
                if (serverConsumerId && current.current === attempt) await call('consumer.close', { consumerId: serverConsumerId }).catch(() => {});
                if (current.current === attempt && !attempt.removed.has(producerId)) setState(s => ({ ...s, error: '원격 미디어 수신 실패: ' + String(error) }));
              }
            }).catch(() => {}).finally(() => { pending.delete(producerId); });
          };
          const initial = await call('producers');
          for (const descriptor of initial.producers as RemoteProducer[]) attempt.discovered.set(descriptor.producerId, descriptor);
          for (const descriptor of attempt.discovered.values()) attempt.subscribe(descriptor);
        }
      } catch (error) {
        if (current.current === attempt) {
          await stop().catch(() => {});
          if (mounted.current && !current.current) setState(s => ({ ...s, phase: 'error', error: String(error) }));
        }
      }
    } catch (error) { if (mounted.current) setState(s => ({ ...s, phase: 'error', error: String(error) })); }
  }
  useEffect(() => {
    let busy = false;
    const timer = setInterval(() => {
      const attempt = current.current;
      if (!attempt || (!attempt.transport && !attempt.recv) || busy) return;
      busy = true;
      void (async () => {
        const server = await rpc('stats', attempt.roomId, attempt.mediaId);
        const browser = [] as { id: string; kind: string; packetsSent: number; bytesSent: number }[];
        for (const producer of attempt.producers) {
          const report = await producer.getStats();
          let packetsSent = 0, bytesSent = 0;
          report.forEach(stat => { if (stat.type === 'outbound-rtp' && !stat.isRemote) { packetsSent += stat.packetsSent ?? 0; bytesSent += stat.bytesSent ?? 0; } });
          browser.push({ id: producer.id, kind: producer.kind, packetsSent, bytesSent });
        }
        const received = [] as { id: string; producerId: string; kind: string; packetsReceived: number; bytesReceived: number; framesDecoded: number }[];
        for (const { consumer } of attempt.consumers.values()) {
          let packetsReceived = 0, bytesReceived = 0, framesDecoded = 0;
          const report = await consumer.getStats().catch(error => { if (consumer.closed) return null; throw error; });
          report?.forEach(stat => { if (stat.type === 'inbound-rtp') { packetsReceived += stat.packetsReceived ?? 0; bytesReceived += stat.bytesReceived ?? 0; framesDecoded += stat.framesDecoded ?? 0; } });
          if (!consumer.closed) received.push({ id: consumer.id, producerId: consumer.producerId, kind: consumer.kind, packetsReceived, bytesReceived, framesDecoded });
        }
        if (current.current === attempt && mounted.current) setStats({ browser, received, server: server.data });
      })().catch(error => {
        if (current.current === attempt) void stop().catch(() => {}).finally(() => { if (mounted.current && !current.current) setState(s => ({ ...s, phase: 'error', error: String(error) })); });
      }).finally(() => { busy = false; });
    }, 1000);
    return () => clearInterval(timer);
  }, [rpc, stop]);
  return { ...state, stats, remoteTracks, recvConnection, start, stop };
}
