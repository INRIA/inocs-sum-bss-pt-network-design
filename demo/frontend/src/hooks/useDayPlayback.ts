import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseDayPlaybackOptions {
  /** first hour shown before playback starts (Game.tsx: 8) */
  initialHour?: number;
  /** ms per simulated hour (Game.tsx: 420) */
  stepMs?: number;
  /** wraps 23 -> 0 instead of stopping — used by the Build step's city pulse */
  loop?: boolean;
}

/**
 * The day playback timer, extracted from Game.tsx (plan-technical.md §C.3) so the Build step's
 * city pulse can reuse it. One hour every `stepMs`, stops cleanly at 23 unless `loop` is set, in
 * which case it wraps back to 0 instead of stopping. Cleared on unmount.
 */
export function useDayPlayback(opts: UseDayPlaybackOptions = {}) {
  const { initialHour = 8, stepMs = 420, loop = false } = opts;
  const [hour, setHour] = useState(initialHour);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPlay = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (timer.current) return stopPlay();
    setPlaying(true);
    timer.current = setInterval(() => {
      setHour((h) => {
        if (h >= 23) {
          if (loop) return 0;
          stopPlay();
          return 23;
        }
        return h + 1;
      });
    }, stepMs);
  }, [stopPlay, stepMs, loop]);

  useEffect(() => () => stopPlay(), [stopPlay]);

  return { hour, setHour, playing, togglePlay, stopPlay };
}
