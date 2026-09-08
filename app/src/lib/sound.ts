// CUSTOM-JOURNAL: small sound-effect helper for the two identified choke
// points (AudioDialog's startRecording, EditorStore.handleSend) — see
// docs/workstreams/09-entry-personalization.md §3.2. Uses the Web Audio API
// to synthesize short, soft tones rather than shipping external audio files
// (none were available to source here) — swap in real recordings later by
// replacing playTone()'s body with `new Audio('/sounds/x.mp3').play()`; the
// call sites (playStartChime/playFinishChime) don't need to change.

import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/** A single soft sine tone with a gentle attack/decay envelope. */
function playTone(freq: number, startOffset: number, duration: number, ctx: AudioContext, gainValue: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);

  const startTime = ctx.currentTime + startOffset;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainValue, startTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

function isSoundEnabled(): boolean {
  // Read directly from the same BlinkoStore config the rest of the app uses,
  // defaulting to enabled (undefined !== false) so this doesn't require a
  // migration/seed value to work out of the box.
  try {
    const blinko = RootStore.Get(BlinkoStore);
    return blinko.config.value?.soundEnabled !== false;
  } catch {
    return true;
  }
}

/** Soft two-note ascending tone — "opening a notebook" feel. */
export function playStartChime() {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  playTone(523.25, 0, 0.35, ctx, 0.12); // C5
  playTone(659.25, 0.12, 0.4, ctx, 0.1); // E5
}

/** Soft two-note descending tone — "closing the book" feel. */
export function playFinishChime() {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;
  playTone(659.25, 0, 0.3, ctx, 0.1); // E5
  playTone(440.0, 0.1, 0.45, ctx, 0.12); // A4
}
