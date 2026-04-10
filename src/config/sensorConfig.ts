import type { TrickDefinition } from "../types/sensorTypes";

export const TRICKS: readonly TrickDefinition[] = [
  {
    id: "threeSixty",
    label: "360",
    celebration: "Big spin energy.",
  },
  {
    id: "reverseThreeSixty",
    label: "Reverse 360",
    celebration: "Backside chaos. Respect.",
  },
  {
    id: "heelFlip",
    label: "Heelflip",
    celebration: "Clean heel pop.",
  },
  {
    id: "kickFlip",
    label: "Kickflip",
    celebration: "Classic flick.",
  },
] as const;

export const SENSOR_CONFIG = {
  startThresholds: {
    motionMagnitude: 40,
    rotationMagnitude: 420,
  },
  settleThresholds: {
    motionMagnitude: 20,
    rotationMagnitude: 250,
  },
  settleDurationMs: 200,
  minimumSegmentDurationMs: 250,
  maximumSegmentDurationMs: 3000,
  staleResultDurationMs: 2200,
} as const;

/**
 * Mobile-first heuristic.
 * This is intentionally conservative for MVP and can be widened later.
 */
export function isSupportedMobileDevice(): boolean {
  const ua = navigator.userAgent || "";
  const touchCapable =
    navigator.maxTouchPoints > 0 ||
    "ontouchstart" in window;

  const hasMotion =
    typeof window !== "undefined" &&
    typeof (window as Window & { DeviceMotionEvent?: unknown }).DeviceMotionEvent !== "undefined";

  const hasOrientation =
    typeof window !== "undefined" &&
    typeof (window as Window & { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent !== "undefined";

  const mobileUa = /iPhone|iPod|Android|Mobile/i.test(ua);

  return touchCapable && mobileUa && (hasMotion || hasOrientation);
}