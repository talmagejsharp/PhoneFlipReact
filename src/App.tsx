import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PermissionCard } from "./components/PermissionCard";
import { ResultCard } from "./components/ResultCard";
import { UnsupportedCard } from "./components/UnsupportedCard";
import { SENSOR_CONFIG, isSupportedMobileDevice } from "./config/sensorConfig";
import { detectFlipTrick } from "./lib/flipDetector";
import type {
  AppState,
  MotionSample,
  OrientationSample,
  PermissionState,
  SensorSegment,
} from "./types/sensorTypes";

function nowMs() {
  return Date.now();
}

function safeNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function vectorMagnitude(x: number | null, y: number | null, z: number | null): number {
  const sx = x ?? 0;
  const sy = y ?? 0;
  const sz = z ?? 0;
  return Math.sqrt(sx * sx + sy * sy + sz * sz);
}

function orientationMagnitude(alpha: number | null, beta: number | null, gamma: number | null): number {
  const a = alpha ?? 0;
  const b = beta ?? 0;
  const g = gamma ?? 0;
  return Math.sqrt(a * a + b * b + g * g);
}

function isIosPermissionApiAvailable<T extends "DeviceMotionEvent" | "DeviceOrientationEvent">(key: T): boolean {
  const source = (window as unknown as Record<string, unknown>)[key] as {
    requestPermission?: () => Promise<"granted" | "denied">;
  } | undefined;

  return !!source && typeof source.requestPermission === "function";
}

async function requestSensorPermission(): Promise<{
  motion: PermissionState;
  orientation: PermissionState;
}> {
  const motionCtor = (window as Window & { DeviceMotionEvent?: { requestPermission?: () => Promise<"granted" | "denied"> } })
    .DeviceMotionEvent;
  const orientationCtor = (window as Window & { DeviceOrientationEvent?: { requestPermission?: () => Promise<"granted" | "denied"> } })
    .DeviceOrientationEvent;

  let motion: PermissionState = "unsupported";
  let orientation: PermissionState = "unsupported";

  if (motionCtor) {
    if (typeof motionCtor.requestPermission === "function") {
      try {
        const result = await motionCtor.requestPermission();
        motion = result === "granted" ? "granted" : "denied";
      } catch {
        motion = "denied";
      }
    } else {
      motion = "notRequired";
    }
  }

  if (orientationCtor) {
    if (typeof orientationCtor.requestPermission === "function") {
      try {
        const result = await orientationCtor.requestPermission();
        orientation = result === "granted" ? "granted" : "denied";
      } catch {
        orientation = "denied";
      }
    } else {
      orientation = "notRequired";
    }
  }

  return { motion, orientation };
}

export default function App() {
  const supported = useMemo(() => isSupportedMobileDevice(), []);
  const [appState, setAppState] = useState<AppState>(supported ? "permissionRequired" : "unsupported");
  const [motionPermission, setMotionPermission] = useState<PermissionState>("unknown");
  const [orientationPermission, setOrientationPermission] = useState<PermissionState>("unknown");
  const [resultLabel, setResultLabel] = useState<"threeSixty" | "reverseThreeSixty" | "heelFlip" | "kickFlip" | "unknown">("unknown");
  const [statusText, setStatusText] = useState("Do a Trick");

  const latestMotionRef = useRef<MotionSample | null>(null);
  const latestOrientationRef = useRef<OrientationSample | null>(null);

  const segmentStartEpochMsRef = useRef<number | null>(null);
  const motionSamplesRef = useRef<MotionSample[]>([]);
  const orientationSamplesRef = useRef<OrientationSample[]>([]);
  const settleStartedAtRef = useRef<number | null>(null);

  const isRecordingRef = useRef(false);
  const appStateRef = useRef<AppState>(appState);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const resetToIdle = useCallback(() => {
    setResultLabel("unknown");
    setStatusText("Do a Trick");
    motionSamplesRef.current = [];
    orientationSamplesRef.current = [];
    latestMotionRef.current = null;
    latestOrientationRef.current = null;
    segmentStartEpochMsRef.current = null;
    settleStartedAtRef.current = null;
    isRecordingRef.current = false;
    setAppState("idle");
  }, []);

  const finalizeSegment = useCallback(() => {
    const start = segmentStartEpochMsRef.current;
    if (!start) {
      resetToIdle();
      return;
    }

    const end = nowMs();
    const durationMs = end - start;

    const segment: SensorSegment = {
      segmentStartEpochMs: start,
      segmentEndEpochMs: end,
      durationMs,
      motionSamples: [...motionSamplesRef.current],
      orientationSamples: [...orientationSamplesRef.current],
      metadata: {
        userAgent: navigator.userAgent,
        platform: (navigator as Navigator & { platform?: string }).platform,
        language: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          devicePixelRatio: window.devicePixelRatio,
        },
      },
    };

    isRecordingRef.current = false;
    setAppState("analyzing");
    setStatusText("Checking the clip...");
    const detection = detectFlipTrick(segment);

    setResultLabel(detection.label);

    if (detection.label === "unknown") {
      setStatusText("No clean land.");
    } else {
      setStatusText(detection.label);
    }

    setAppState("idle");

    segmentStartEpochMsRef.current = null;
    motionSamplesRef.current = [];
    orientationSamplesRef.current = [];
  }, [resetToIdle]);

  const pushMotionSample = useCallback((event: DeviceMotionEvent) => {
  const ts = nowMs();
  const acc = event.acceleration;
  const accGravity = event.accelerationIncludingGravity;
  const rotation = event.rotationRate;

  const motionMagnitude = vectorMagnitude(
    safeNumber(accGravity?.x),
    safeNumber(accGravity?.y),
    safeNumber(accGravity?.z)
  );

  const rotationMagnitude = vectorMagnitude(
    safeNumber(rotation?.alpha),
    safeNumber(rotation?.beta),
    safeNumber(rotation?.gamma)
  );

  const start = segmentStartEpochMsRef.current;
  const relativeTimeMs = start ? ts - start : 0;

  const sample: MotionSample = {
    timestampEpochMs: ts,
    relativeTimeMs,
    motionMagnitude,
    rotationMagnitude,
    devicemotion: {
      interval: typeof event.interval === "number" ? event.interval : null,
      acceleration: acc
        ? {
            x: safeNumber(acc.x),
            y: safeNumber(acc.y),
            z: safeNumber(acc.z),
          }
        : null,
      accelerationIncludingGravity: accGravity
        ? {
            x: safeNumber(accGravity.x),
            y: safeNumber(accGravity.y),
            z: safeNumber(accGravity.z),
          }
        : null,
      rotationRate: rotation
        ? {
            alpha: safeNumber(rotation.alpha),
            beta: safeNumber(rotation.beta),
            gamma: safeNumber(rotation.gamma),
          }
        : null,
      accelerationRaw: acc ?? null,
      accelerationIncludingGravityRaw: accGravity ?? null,
      rotationRateRaw: rotation ?? null,
    },
  };

  // Always keep latest live reading updated so idle -> recording can happen
  latestMotionRef.current = sample;

  // Only store full history once a segment is actually recording
  if (isRecordingRef.current && start) {
    motionSamplesRef.current.push(sample);
  }
}, []);

  const pushOrientationSample = useCallback((event: DeviceOrientationEvent) => {
  const ts = nowMs();
  const start = segmentStartEpochMsRef.current;
  const relativeTimeMs = start ? ts - start : 0;

  const sample: OrientationSample = {
    timestampEpochMs: ts,
    relativeTimeMs,
    orientationMagnitude: orientationMagnitude(
      safeNumber(event.alpha),
      safeNumber(event.beta),
      safeNumber(event.gamma)
    ),
    deviceorientation: {
      alpha: safeNumber(event.alpha),
      beta: safeNumber(event.beta),
      gamma: safeNumber(event.gamma),
      absolute: typeof event.absolute === "boolean" ? event.absolute : null,
      raw: {
        alpha: safeNumber(event.alpha),
        beta: safeNumber(event.beta),
        gamma: safeNumber(event.gamma),
        absolute: typeof event.absolute === "boolean" ? event.absolute : null,
      },
    },
  };

  latestOrientationRef.current = sample;

  if (isRecordingRef.current && start) {
    orientationSamplesRef.current.push(sample);
  }
}, []);

  const beginSegment = useCallback(() => {
  const start = nowMs();
  segmentStartEpochMsRef.current = start;
  motionSamplesRef.current = [];
  orientationSamplesRef.current = [];
  settleStartedAtRef.current = null;
  isRecordingRef.current = true;
  setAppState("recording");
  setStatusText("Flip it.");

  if (latestMotionRef.current) {
    motionSamplesRef.current.push({
      ...latestMotionRef.current,
      relativeTimeMs: 0,
    });
  }

  if (latestOrientationRef.current) {
    orientationSamplesRef.current.push({
      ...latestOrientationRef.current,
      relativeTimeMs: 0,
    });
  }
}, []);

  const evaluateRecordingState = useCallback(() => {
    if (!supported) return;
    if (!["idle", "arming", "recording"].includes(appStateRef.current)) return;

    const lastMotion = latestMotionRef.current;
    const motionMagnitude = lastMotion?.motionMagnitude ?? 0;
    const rotationMagnitude = lastMotion?.rotationMagnitude ?? 0;

    const exceedsStartThreshold =
      motionMagnitude >= SENSOR_CONFIG.startThresholds.motionMagnitude ||
      rotationMagnitude >= SENSOR_CONFIG.startThresholds.rotationMagnitude;

    const belowSettleThreshold =
      motionMagnitude <= SENSOR_CONFIG.settleThresholds.motionMagnitude &&
      rotationMagnitude <= SENSOR_CONFIG.settleThresholds.rotationMagnitude;

    if (!isRecordingRef.current) {
      if (exceedsStartThreshold) {
        beginSegment();
      } else if (appStateRef.current !== "idle") {
        setAppState("idle");
        setStatusText("Do a Trick");
      }
      return;
    }

    const start = segmentStartEpochMsRef.current;
    if (!start) return;

    const elapsedMs = nowMs() - start;

    if (elapsedMs >= SENSOR_CONFIG.maximumSegmentDurationMs) {
      finalizeSegment();
      return;
    }

    if (belowSettleThreshold) {
      if (!settleStartedAtRef.current) {
        settleStartedAtRef.current = nowMs();
      }

      const settledForMs = nowMs() - settleStartedAtRef.current;
      if (
        settledForMs >= SENSOR_CONFIG.settleDurationMs &&
        elapsedMs >= SENSOR_CONFIG.minimumSegmentDurationMs
      ) {
        finalizeSegment();
      }
    } else {
      settleStartedAtRef.current = null;
    }
  }, [beginSegment, finalizeSegment, supported]);

  useEffect(() => {
    if (!supported) return;

    const onMotion = (event: DeviceMotionEvent) => {
      if (!["idle", "arming", "recording"].includes(appStateRef.current)) return;

      pushMotionSample(event);

      if (!isRecordingRef.current) {
        const motionMagnitude = latestMotionRef.current?.motionMagnitude ?? 0;
        const rotationMagnitude = latestMotionRef.current?.rotationMagnitude ?? 0;

        const nearStartThreshold =
          motionMagnitude >= SENSOR_CONFIG.startThresholds.motionMagnitude * 0.6 ||
          rotationMagnitude >= SENSOR_CONFIG.startThresholds.rotationMagnitude * 0.6;

        if (nearStartThreshold && appStateRef.current === "idle") {
          setAppState("arming");
          setStatusText("...ready...");
        }
      }

      evaluateRecordingState();
    };

    const onOrientation = (event: DeviceOrientationEvent) => {
      if (!["idle", "arming", "recording"].includes(appStateRef.current)) return;

      if (isRecordingRef.current) {
        pushOrientationSample(event);
      }
    };

    window.addEventListener("devicemotion", onMotion as EventListener, { passive: true });
    window.addEventListener("deviceorientation", onOrientation as EventListener, { passive: true });

    return () => {
      window.removeEventListener("devicemotion", onMotion as EventListener);
      window.removeEventListener("deviceorientation", onOrientation as EventListener);
    };
  }, [evaluateRecordingState, pushMotionSample, pushOrientationSample, supported]);

  const handleRequestPermission = useCallback(async () => {
    if (!supported) {
      setAppState("unsupported");
      return;
    }

    const hasMotionPermissionApi = isIosPermissionApiAvailable("DeviceMotionEvent");
    const hasOrientationPermissionApi = isIosPermissionApiAvailable("DeviceOrientationEvent");

    const result = await requestSensorPermission();

    setMotionPermission(result.motion);
    setOrientationPermission(result.orientation);

    const motionAllowed = result.motion === "granted" || result.motion === "notRequired";
    const orientationAllowed = result.orientation === "granted" || result.orientation === "notRequired";

    const noExplicitPermissionApi = !hasMotionPermissionApi && !hasOrientationPermissionApi;

    if (motionAllowed || orientationAllowed || noExplicitPermissionApi) {
      setAppState("idle");
      setStatusText("Do a Trick");
    } else {
      setAppState("permissionDenied");
    }
  }, [supported]);

  if (!supported || appState === "unsupported") {
    return (
      <main className="app-shell">
        <UnsupportedCard />
      </main>
    );
  }

  if (appState === "permissionRequired") {
    return (
      <main className="app-shell">
        <PermissionCard onRequestPermission={handleRequestPermission} />
      </main>
    );
  }

  if (appState === "permissionDenied") {
    return (
      <main className="app-shell">
        <PermissionCard denied onRequestPermission={handleRequestPermission} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="main-stage">
        <div className="title-lockup">
          <div className="eyebrow">PhoneFlip</div>
        </div>

        {(appState === "idle" || appState === "arming" || appState === "recording" || appState === "analyzing") && (
          <>
            <div className="hero-text">{statusText}</div>

            {appState === "recording" && (
              <div className="flip-indicator" aria-label="recording flip animation">
                <div className="phone phone-a" />
                <div className="phone phone-b" />
                <div className="phone phone-c" />
              </div>
            )}

            <div className="footer-note">
              {appState === "idle" && ""}
              {appState === "arming" && "That movement woke it up."}
              {appState === "recording" && "Recording your motion segment..."}
              {appState === "analyzing" && "Placeholder detector is taking a guess."}
            </div>
          </>
        )}

        {/* {appState !== "recording" && appState !== "analyzing" && (
            <ResultCard label={resultLabel} onReset={resetToIdle} />
        )} */}

        {/* <div className="debug-row">
          <span className="pill">motion: {motionPermission}</span>
          <span className="pill">orientation: {orientationPermission}</span>
          <span className="pill">state: {appState}</span>
        </div> */}
      </div>
    </main>
  );
}