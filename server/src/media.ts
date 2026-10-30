import { createWorker } from 'mediasoup';
import type { Worker, Router, WebRtcTransport, Producer, DtlsParameters, RtpParameters } from 'mediasoup/types';
import { closeWorker, mediaCodecs } from './sfu.js';
import type { MediaRequest } from './shared/mediaProtocol.js';

type Slot = { roomId: string; mediaId: string; transport?: WebRtcTransport; producers: Map<string, Producer>; busy: boolean; connected: boolean; timer: ReturnType<typeof setTimeout>; done: Promise<void>; finish: () => void };
type RoomRouter = { promise: Promise<Router>; router?: Router };

// One worker, one Router per logical room, one reserved send slot per participant.
export function createMediaService(isMember: (participantId: string, roomId: string) => boolean,
  roomExists: (roomId: string) => boolean, notify: (participantId: string, slot: Slot, reason: string) => void) {
  const active = new Map<string, Slot>();
  const routers = new Map<string, RoomRouter>();
  const retired = new Map<string, Set<string>>();
  const draining = new Map<string, { mediaId: string; promise: Promise<void> }>();
  const tasks = new Set<Promise<unknown>>();
  let workerPromise: Promise<Worker> | undefined;
  let closing = false;
  let failed = false;

  function retire(id: string, mediaId: string, cleanup = false) {
    const ids = retired.get(id) ?? new Set<string>();
    if (ids.size >= 128 && !ids.has(mediaId)) {
      if (cleanup) return; // Creation is already blocked; cleanup must never be blocked by the quota.
      throw new Error('미디어 시도 한도입니다. 새 WebSocket 세션을 사용해주세요.');
    }
    ids.add(mediaId); retired.set(id, ids);
  }
  function stop(id: string, reason: string, roomId?: string) {
    const slot = active.get(id);
    if (!slot || (roomId && slot.roomId !== roomId)) return;
    active.delete(id);
    if (slot.busy) {
      const barrier = { mediaId: slot.mediaId, promise: slot.done };
      draining.set(id, barrier);
      void slot.done.then(() => { if (draining.get(id) === barrier) draining.delete(id); });
    }
    retire(id, slot.mediaId, true);
    clearTimeout(slot.timer);
    for (const producer of slot.producers.values()) producer.close();
    slot.producers.clear();
    slot.transport?.close();
    notify(id, slot, reason);
  }
  function prune() {
    for (const [roomId, entry] of routers) if (!roomExists(roomId)) {
      routers.delete(roomId); entry.router?.close();
    }
  }
  function check(id: string, roomId: string) {
    if (closing || failed) throw new Error('SFU가 종료됐거나 사용할 수 없습니다.');
    if (!isMember(id, roomId)) throw new Error('실제 소속된 회의방만 사용할 수 있습니다.');
  }
  async function worker() {
    workerPromise ??= createWorker({ logLevel: 'warn' }).then(value => {
      value.once('died', () => {
        failed = true;
        for (const id of active.keys()) stop(id, 'SFU worker 종료');
        routers.clear();
      });
      return value;
    });
    return workerPromise;
  }
  function router(roomId: string): Promise<Router> {
    const existing = routers.get(roomId);
    if (existing) return existing.promise;
    const entry: RoomRouter = { promise: Promise.resolve(null as unknown as Router) };
    entry.promise = (async () => {
      const w = await worker();
      if (closing || failed || !roomExists(roomId)) throw new Error('회의방 또는 SFU가 종료됐습니다.');
      const value = await w.createRouter({ mediaCodecs });
      if (closing || !roomExists(roomId) || routers.get(roomId) !== entry) { value.close(); throw new Error('Router 생성이 취소됐습니다.'); }
      entry.router = value;
      value.observer.once('close', () => {
        if (routers.get(roomId) === entry) routers.delete(roomId);
        for (const [id, slot] of active) if (slot.roomId === roomId) stop(id, 'Router 종료');
      });
      return value;
    })().catch(error => { if (routers.get(roomId) === entry) routers.delete(roomId); throw error; });
    routers.set(roomId, entry);
    return entry.promise;
  }
  async function execute(id: string, request: MediaRequest): Promise<Record<string, unknown>> {
    const { roomId, mediaId, action, payload } = request;
    if (action === 'close') {
      const slot = active.get(id);
      if (slot?.mediaId === mediaId && slot.roomId !== roomId) throw new Error('미디어 자원의 회의방이 다릅니다.');
      if (slot?.mediaId === mediaId) stop(id, '송신 종료');
      retire(id, mediaId);
      const barrier = draining.get(id);
      if (barrier?.mediaId === mediaId) await barrier.promise;
      return { closed: true };
    }
    check(id, roomId);
    if (action === 'capabilities') {
      const value = await router(roomId); check(id, roomId);
      return { routerId: value.id, capabilities: value.rtpCapabilities };
    }
    if (action === 'create') {
      if (active.has(id) || draining.has(id)) throw new Error('이미 활성·생성·정리 중인 미디어 연결이 있습니다. 먼저 종료해주세요.');
      if (retired.get(id)?.has(mediaId) || (retired.get(id)?.size ?? 0) >= 128) throw new Error('종료된 미디어 요청입니다. 새 세션이 필요할 수 있습니다.');
      let finish!: () => void;
      const done = new Promise<void>(resolve => { finish = resolve; });
      const slot: Slot = { roomId, mediaId, producers: new Map(), busy: true, connected: false, done, finish,
        timer: setTimeout(() => { if (active.get(id) === slot) stop(id, '연결 준비 시간 초과'); }, 15000) };
      active.set(id, slot);
      try {
        const value = await router(roomId); check(id, roomId);
        if (active.get(id) !== slot) throw new Error('취소된 미디어 생성입니다.');
        const transport = await value.createWebRtcTransport({
          listenInfos: [{ protocol: 'udp', ip: '127.0.0.1', portRange: { min: 40000, max: 40100 } },
            { protocol: 'tcp', ip: '127.0.0.1', portRange: { min: 40000, max: 40100 } }], enableUdp: true, enableTcp: true, preferUdp: true,
        });
        if (active.get(id) !== slot || !isMember(id, roomId) || closing) { transport.close(); throw new Error('Transport 생성이 취소됐습니다.'); }
        slot.transport = transport; slot.busy = false;
        transport.on('dtlsstatechange', state => { if (active.get(id) === slot && (state === 'failed' || state === 'closed')) stop(id, 'DTLS 연결 종료', roomId); });
        transport.on('icestatechange', state => { if (active.get(id) === slot && (state === 'disconnected' || state === 'closed')) stop(id, 'ICE 연결 종료', roomId); });
        transport.observer.once('close', () => { if (active.get(id) === slot) stop(id, 'Transport 종료'); });
        return { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters };
      } catch (error) { if (active.get(id) === slot) stop(id, 'Transport 생성 실패'); throw error; }
      finally { slot.busy = false; slot.finish(); }
    }
    const slot = active.get(id);
    if (!slot || slot.mediaId !== mediaId || slot.roomId !== roomId || !slot.transport || slot.transport.closed) throw new Error('소유한 활성 미디어 연결이 아닙니다.');
    if (payload.transportId !== undefined && payload.transportId !== slot.transport.id) throw new Error('Transport 소유권이 일치하지 않습니다.');
    const current = () => active.get(id) === slot && isMember(id, roomId) && !closing;
    if (action === 'stats') {
      const producers = await Promise.all([...slot.producers.values()].map(async producer => {
        const stats = await producer.getStats();
        const inbound = stats.filter(s => s.type === 'inbound-rtp');
        return { id: producer.id, kind: producer.kind, packets: inbound.reduce((sum, s) => sum + s.packetCount, 0), bytes: inbound.reduce((sum, s) => sum + s.byteCount, 0) };
      }));
      if (!current()) throw new Error('통계 조회 중 연결이 종료됐습니다.');
      return { iceState: slot.transport.iceState, dtlsState: slot.transport.dtlsState, producers };
    }
    if (action === 'producer.close') {
      const producer = slot.producers.get(payload.producerId as string);
      if (!producer) throw new Error('소유한 Producer가 아닙니다.');
      stop(id, 'Producer 종료');
      return { closed: true };
    }
    if (slot.busy) throw new Error('미디어 요청이 이미 처리 중입니다.');
    if (action === 'connect' && slot.connected) throw new Error('이미 연결한 Transport입니다.');
    if (action === 'produce' && [...slot.producers.values()].some(p => p.kind === payload.kind)) throw new Error('이미 해당 종류의 Producer가 있습니다.');
    slot.busy = true;
    slot.done = new Promise<void>(resolve => { slot.finish = resolve; });
    try {
      if (action === 'connect') {
        await slot.transport.connect({ dtlsParameters: payload.dtlsParameters as DtlsParameters });
        if (!current()) throw new Error('DTLS 연결이 취소됐습니다.');
        slot.connected = true;
        return { connected: true };
      }
      if (!slot.connected) throw new Error('Transport를 먼저 연결해주세요.');
      const producer = await slot.transport.produce({ kind: payload.kind as 'audio' | 'video', rtpParameters: payload.rtpParameters as RtpParameters });
      if (!current()) { producer.close(); throw new Error('Producer 생성이 취소됐습니다.'); }
      slot.producers.set(producer.id, producer);
      clearTimeout(slot.timer);
      return { producerId: producer.id };
    } catch (error) {
      // Invalid parameters cannot leave partially configured send resources alive.
      if (active.get(id) === slot) stop(id, '연결 또는 Producer 생성 실패');
      throw error;
    } finally { slot.busy = false; slot.finish(); }
  }
  function handle(id: string, request: MediaRequest) {
    const task = execute(id, request);
    tasks.add(task); void task.then(() => tasks.delete(task), () => tasks.delete(task));
    return task;
  }
  let closePromise: Promise<void> | undefined;
  function close() {
    closePromise ??= (async () => {
      closing = true;
      for (const id of active.keys()) stop(id, '서버 종료');
      for (const entry of routers.values()) entry.router?.close();
      routers.clear();
      await Promise.allSettled([...tasks]);
      if (workerPromise) { const w = await workerPromise.catch(() => null); if (w) await closeWorker(w); }
      retired.clear();
    })();
    return closePromise;
  }
  return { handle, stop, prune, close, forget(id: string) { stop(id, '연결 종료'); retired.delete(id); } };
}
