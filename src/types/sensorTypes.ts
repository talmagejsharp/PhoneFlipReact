export const trickLabels = [
  "threeSixty",
  "reverseThreeSixty",
  "heelFlip",
  "kickFlip",
  "unknown",
] as const;

export type TrickLabel = (typeof trickLabels)[number];

export type SupportedTrickLabel = Exclude<TrickLabel, "unknown">;

export type AppState =
  | "unsupported"
  | "permissionRequired"
  | "permissionDenied"
  | "idle"
  | "arming"
  | "recording"
  | "analyzing"
  | "resultSuccess"
  | "resultUnknown";

export type PermissionState = "unknown" | "granted" | "denied" | "notRequired" | "unsupported";

export type MotionVector = {
  x: number | null;
  y: number | null;
  z: number | null;
};

export type RotationVector = {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
};

export type MotionSample = {
  timestampEpochMs: number;
  relativeTimeMs: number;
  motionMagnitude: number;
  rotationMagnitude: number;
  devicemotion: {
    interval: number | null;
    acceleration: MotionVector | null;
    accelerationIncludingGravity: MotionVector | null;
    rotationRate: RotationVector | null;
    accelerationRaw: DeviceMotionEvent["acceleration"] | null;
    accelerationIncludingGravityRaw: DeviceMotionEvent["accelerationIncludingGravity"] | null;
    rotationRateRaw: DeviceMotionEvent["rotationRate"] | null;
  };
};

export type OrientationSample = {
  timestampEpochMs: number;
  relativeTimeMs: number;
  orientationMagnitude: number;
  deviceorientation: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
    absolute: boolean | null;
    raw: {
      alpha: number | null;
      beta: number | null;
      gamma: number | null;
      absolute: boolean | null;
    };
  };
};

export type SegmentMetadata = {
  userAgent: string;
  platform?: string;
  language: string;
  timeZone: string;
  screen: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
};

export type SensorSegment = {
  segmentStartEpochMs: number;
  segmentEndEpochMs: number;
  durationMs: number;
  motionSamples: MotionSample[];
  orientationSamples: OrientationSample[];
  metadata: SegmentMetadata;
};

export type TrickDefinition = {
  id: SupportedTrickLabel;
  label: string;
  celebration: string;
};

export type DetectorResult = {
  label: TrickLabel;
  confidence: number;
  reason: string;
};