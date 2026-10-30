import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from 'mediasoup-client';
import type { Producer, Transport, TransportOptions, RtpCapabilities } from 'mediasoup-client/types';
import type { useSession } from './useSession';
import type { useLocalMedia } from './useLocalMedia';

type Attempt = { mediaId: string; roomId: string; transport?: Transport; producers: Producer[]; timer?: ReturnType<typeof setTimeout> };
export function useSfuSender(session: ReturnType<typeof useSession>, local: ReturnType<typeof useLocalMedia>) {
  const current = useRef<Attempt | null>(null);
  const mounted = useRef(false);
  const stopping = useRef<Promise<void> | null>(null);
  const [state, setState] = useState({ phase: 'idle', activeMediaRoomId: '', mediaId: '', transportId: '', connection: 'new', error: '', producers: [] as { id: string; kind: string }[] });
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const rpc = session.mediaRequest;
  const dispose = useCallback((attempt: Attempt) => {
    clearTimeout(attempt.timer);
    for (const producer of attempt.producers) producer.close();
    attempt.transport?.close();
  }, []);
  const stop = useCallback((): Promise<void> => {
    if (stopping.current) return stopping.current;
    const attempt = current.current;
    if (!attempt) return Promise.resolve();
    current.current = null; dispose(attempt);
    if (mounted.current) { setState(s => ({ ...s, phase: 'stopping', activeMediaRoomId: '', producers: [], connection: 'closed' })); setStats({}); }
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
    current.current = null; dispose(attempt); setStats({});
    setState(s => ({ ...s, phase: 'idle', activeMediaRoomId: '', connection: 'closed', producers: [], error: event.reason }));
  }), [session.onMediaClosed, dispose]);
  useEffect(() => {
    const attempt = current.current;
    if (attempt && (local.status !== 'ready' || session.status !== 'connected' || !Object.hasOwn(session.joinedRooms, attempt.roomId))) void stop().catch(() => {});
  }, [local.status, session.status, session.joinedRooms, stop]);

  async function start(roomId: string) {
    if (stopping.current) return;
    try {
      if (current.current) await stop();
      if (!mounted.current || local.status !== 'ready' || !Object.hasOwn(session.joinedRooms, roomId)) throw new Error('로컬 미디어와 대상 방 참여가 필요합니다.');
      const tracks = local.streamRef.current?.getTracks().filter(t => t.readyState === 'live') ?? [];
      if (!tracks.length) throw new Error('송신할 로컬 트랙이 없습니다.');
      const attempt: Attempt = { roomId, mediaId: crypto.randomUUID(), producers: [] };
      current.current = attempt;
      const check = () => { if (current.current !== attempt || !mounted.current) throw new Error('취소된 송신 요청'); };
      const call = async (action: Parameters<typeof rpc>[0], payload: Record<string, unknown> = {}) => {
        check(); const result = await rpc(action, roomId, attempt.mediaId, payload); check(); return result.data;
      };
      setState({ phase: 'connecting', activeMediaRoomId: roomId, mediaId: attempt.mediaId, transportId: '', connection: 'new', error: '', producers: [] });
      attempt.timer = setTimeout(() => {
        if (current.current === attempt) void stop().catch(() => {}).finally(() => { if (mounted.current && !current.current) setState(s => ({ ...s, phase: 'error', error: 'ICE/DTLS 연결 시간이 초과됐습니다.' })); });
      }, 15000);
      try {
        const capabilities = (await call('capabilities')).capabilities as RtpCapabilities;
        const device = new Device();
        await device.load({ routerRtpCapabilities: capabilities }); check();
        for (const track of tracks) if (!device.canProduce(track.kind as 'audio' | 'video')) throw new Error('지원하지 않는 트랙 종류입니다.');
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
        for (const track of tracks) {
          check();
          const producer = await transport.produce({ track, stopTracks: false, codec: device.rtpCapabilities.codecs?.find(c => c.mimeType.toLowerCase() === (track.kind === 'audio' ? 'audio/opus' : 'video/vp8')) });
          if (current.current !== attempt) { producer.close(); check(); }
          attempt.producers.push(producer);
          producer.on('trackended', () => { if (current.current === attempt) void stop().catch(() => {}); });
          setState(s => ({ ...s, producers: attempt.producers.map(p => ({ id: p.id, kind: p.kind })) }));
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
      if (!attempt?.transport || busy || !attempt.producers.length) return;
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
        if (current.current === attempt && mounted.current) setStats({ browser, server: server.data });
      })().catch(error => {
        if (current.current === attempt) void stop().catch(() => {}).finally(() => { if (mounted.current && !current.current) setState(s => ({ ...s, phase: 'error', error: String(error) })); });
      }).finally(() => { busy = false; });
    }, 1000);
    return () => clearInterval(timer);
  }, [rpc, stop]);
  return { ...state, stats, start, stop };
}
