import { useCallback, useEffect, useRef, useState } from 'react';

export type InputKind = 'video' | 'audio';
export type InputDevice = { deviceId: string; kind: InputKind; label: string };
export function inputDevices(devices: readonly MediaDeviceInfo[]): InputDevice[] {
  const seen = new Set<string>();
  const counts = { video: 0, audio: 0 };
  return devices.flatMap(device => {
    const kind = device.kind === 'videoinput' ? 'video' : device.kind === 'audioinput' ? 'audio' : null;
    if (!kind || seen.has(kind + ':' + device.deviceId)) return [];
    seen.add(kind + ':' + device.deviceId);
    return [{ deviceId: device.deviceId, kind, label: device.label || `${kind === 'video' ? '카메라' : '마이크'} ${++counts[kind]} (권한에 따라 이름 제한)` }];
  });
}
export function deviceConstraint(deviceId: string): boolean | MediaTrackConstraints {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

export function useMediaDevices() {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState({ video: '', audio: '' });
  const mounted = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    if (!mounted.current) return;
    setStatus('loading');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.enumerateDevices) throw new Error('장치 목록에는 보안 컨텍스트와 enumerateDevices 지원이 필요합니다.');
      const result = await navigator.mediaDevices.enumerateDevices();
      if (mounted.current && id === sequence.current) { setDevices(inputDevices(result)); setStatus('ready'); setError(''); }
    } catch (cause) {
      if (mounted.current && id === sequence.current) { setStatus('error'); setError('장치 목록 조회 실패: ' + String(cause)); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const media = navigator.mediaDevices;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(scheduled);
      scheduled = setTimeout(() => { void refresh(); }, 0);
    };
    media?.addEventListener('devicechange', changed);
    return () => { mounted.current = false; sequence.current++; clearTimeout(scheduled); media?.removeEventListener('devicechange', changed); };
  }, [refresh]);
  return { devices, status, error, selected, refresh, select: (kind: InputKind, deviceId: string) => setSelected(s => ({ ...s, [kind]: deviceId })) };
}
