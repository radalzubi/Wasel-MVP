import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ────────────────────────────────────────────────────────────────────────────
// Startup Health / Crash-Loop Breaker
//
// The reopen-crash-loop we've been chasing has one property that makes it
// particularly nasty: when the app dies, reopening lands on the exact same
// crash surface (live-trip restore + MapView mount), so the user can't get
// unstuck without deleting and reinstalling.
//
// This breaker is deliberately small:
//   1. At every launch we mark "pendingSince = now" BEFORE any heavy work.
//   2. If the app survives the boot sequence + stays on screen past
//      HEALTHY_CHECKPOINT_DELAY_MS, we clear the mark — call it "healthy".
//   3. On the NEXT launch, if pendingSince is still set, the previous
//      launch never reached healthy → it crashed. We increment a counter.
//   4. Once consecutive unhealthy launches >= RECOVERY_THRESHOLD, the
//      next launch enters "recovery" mode:
//        - skip live-trip restore
//        - do not mount MapView on first paint
//        - show a recovery UI that lets the user continue safely
//
// Tuning notes:
//   - HEALTHY_CHECKPOINT_DELAY_MS is deliberately generous (4s). If the JS
//     bundle loaded, auth resolved, restore decided, AND we stayed on the
//     rendered screen for 4s, it is extremely unlikely we are in a crash
//     loop — the iOS watchdog window is ~20s so we have plenty of margin.
//   - RECOVERY_THRESHOLD = 2 means the THIRD consecutive crash triggers
//     recovery (counts are stored post-increment). That's the right
//     tradeoff: one legitimate crash shouldn't lock the user out, but
//     a repeating pattern should.
//
// All AsyncStorage calls are wrapped in try/catch. This module MUST NEVER
// throw — it's the last line of defense; if it threw, it would become the
// very thing it's designed to prevent.
// ────────────────────────────────────────────────────────────────────────────

const KEY = '@wasel/startup-health';
const RECOVERY_THRESHOLD = 2;
const HEALTHY_CHECKPOINT_DELAY_MS = 4000;

interface StartupHealthState {
  // Timestamp (ms) when the current launch started. Set at beginLaunch(),
  // cleared at markLaunchHealthy(). If still set on the NEXT launch read,
  // the previous launch died before reaching the healthy checkpoint.
  pendingSince: number | null;
  // Monotonically increasing counter of launches that failed to reach
  // healthy. Reset to 0 on a successful healthy checkpoint.
  consecutiveCrashes: number;
}

function defaultState(): StartupHealthState {
  return { pendingSince: null, consecutiveCrashes: 0 };
}

async function readState(): Promise<StartupHealthState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Defensive: accept only well-formed objects. A malformed value shouldn't
    // trigger a false recovery mode.
    if (
      typeof parsed !== 'object' || parsed === null ||
      (parsed.pendingSince !== null && typeof parsed.pendingSince !== 'number') ||
      typeof parsed.consecutiveCrashes !== 'number'
    ) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

async function writeState(state: StartupHealthState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Swallow: persistence failure is not fatal. Next launch will just
    // read the prior value (or default) and the breaker degrades
    // gracefully into a no-op.
  }
}

export type BootState = 'booting' | 'recovery' | 'normal';

/**
 * Top-level startup-health hook. Mount in the root layout (or a near-root
 * component) exactly once per app.
 *
 * @returns
 *   bootState:          current boot phase ('booting' → 'normal' | 'recovery')
 *   shouldSkipRestore:  true while bootState is 'recovery' AND briefly after
 *                       exiting recovery. Trip-restore screens (rider home /
 *                       driver dashboard) MUST consult this before calling
 *                       /api/trips/active — otherwise the first render after
 *                       Continue re-enters the exact crash surface we just
 *                       recovered from.
 *   markBootstrapDone:  call when the bootstrap sequence is complete. Starts
 *                       the healthy-checkpoint timer. Idempotent.
 *   exitRecoveryMode:   user-initiated exit from recovery UI. Immediately
 *                       transitions to 'normal', sets shouldSkipRestore=true
 *                       for this render, and starts the healthy timer.
 */
export function useStartupHealth(): {
  bootState: BootState;
  shouldSkipRestore: boolean;
  markBootstrapDone: () => void;
  exitRecoveryMode: () => void;
} {
  const [bootState, setBootState] = useState<BootState>('booting');
  // True whenever restore should be skipped: either we're currently in
  // recovery mode OR the user just exited it (in which case we want a clean
  // home/dashboard render without any restore fetch).
  const [skipRestore, setSkipRestore] = useState(true);
  const bootstrapDoneRef = useRef(false);
  const healthyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const prior = await readState();
      const priorCrashed = prior.pendingSince !== null;
      const nextCrashes = priorCrashed
        ? prior.consecutiveCrashes + 1
        : prior.consecutiveCrashes;

      // Write the NEW pending mark before any heavy work. If we crash below
      // this point, the next launch sees pendingSince still set.
      await writeState({
        pendingSince: Date.now(),
        consecutiveCrashes: nextCrashes,
      });

      if (cancelled) return;
      const isRecovery = nextCrashes >= RECOVERY_THRESHOLD;
      setBootState(isRecovery ? 'recovery' : 'normal');
      // skipRestore only applies when we actually enter recovery. A normal
      // boot clears it so the restore fetch can run as usual.
      setSkipRestore(isRecovery);
    })();

    return () => {
      cancelled = true;
      if (healthyTimerRef.current) {
        clearTimeout(healthyTimerRef.current);
        healthyTimerRef.current = null;
      }
    };
  }, []);

  const markBootstrapDone = (): void => {
    if (bootstrapDoneRef.current) return;
    bootstrapDoneRef.current = true;
    // Once home/dashboard has decided "bootstrap complete", re-enable restore
    // for subsequent actions (e.g. foreground resume). The flag is only
    // meant to suppress the FIRST render after a recovery exit.
    setSkipRestore(false);
    // Wait HEALTHY_CHECKPOINT_DELAY_MS — if we're still on screen after that,
    // call the launch healthy. Any mid-window crash means the next launch
    // still reads pendingSince !== null and counts as unhealthy.
    healthyTimerRef.current = setTimeout(() => {
      void writeState(defaultState());
    }, HEALTHY_CHECKPOINT_DELAY_MS);
  };

  const exitRecoveryMode = (): void => {
    // User tapped "Continue" on the recovery UI. Flip to normal but KEEP
    // skipRestore=true so the newly-mounted home/dashboard doesn't fire its
    // restore fetch — that fetch is exactly what the crash loop was built on.
    // markBootstrapDone will clear skipRestore once the screen reports ready.
    setBootState('normal');
    setSkipRestore(true);
  };

  return { bootState, shouldSkipRestore: skipRestore, markBootstrapDone, exitRecoveryMode };
}
