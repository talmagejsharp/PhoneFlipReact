import type { DetectorResult, SensorSegment, TrickLabel } from "../types/sensorTypes";
import { classifySkateTrick } from "./skateboardTrickClassifier";

/**
 * Derive TrickMetrics from raw sensor segment
 */
function extractMetrics(segment: SensorSegment) {
  const motion = segment.motionSamples ?? [];

  let maxBeta = -Infinity;
  let minBeta = Infinity;
  let maxGamma = -Infinity;
  let minGamma = Infinity;
  let maxAlpha = -Infinity;
  let minAlpha = Infinity;

  let peakAbsBeta = 0;
  let peakAbsGamma = 0;
  let peakAbsAlpha = 0;

  let minAccelZ = Infinity;
  let minAccelY = Infinity;
  let maxAccelY = -Infinity;

  for (const sample of motion) {
    const rot = sample.devicemotion?.rotationRate;
    const acc = sample.devicemotion?.accelerationIncludingGravity;

    if (rot) {
      const alpha = rot.alpha ?? 0;
      const beta = rot.beta ?? 0;
      const gamma = rot.gamma ?? 0;

      maxBeta = Math.max(maxBeta, beta);
      minBeta = Math.min(minBeta, beta);

      maxGamma = Math.max(maxGamma, gamma);
      minGamma = Math.min(minGamma, gamma);

      maxAlpha = Math.max(maxAlpha, alpha);
      minAlpha = Math.min(minAlpha, alpha);

      peakAbsBeta = Math.max(peakAbsBeta, Math.abs(beta));
      peakAbsGamma = Math.max(peakAbsGamma, Math.abs(gamma));
      peakAbsAlpha = Math.max(peakAbsAlpha, Math.abs(alpha));
    }

    if (acc) {
      const y = acc.y ?? 0;
      const z = acc.z ?? 0;

      minAccelZ = Math.min(minAccelZ, z);
      minAccelY = Math.min(minAccelY, y);
      maxAccelY = Math.max(maxAccelY, y);
    }
  }

  // Avoid infinities if no data
  const safe = (v: number) => (Number.isFinite(v) ? v : 0);

  const betaRange = safe(maxBeta) - safe(minBeta);
  const gammaRange = safe(maxGamma) - safe(minGamma);

  const betaAsymmetry =
    betaRange > 0 ? Math.abs(maxBeta) / (Math.abs(minBeta) + 1e-6) : 0;

  const gammaAsymmetry =
    gammaRange > 0 ? Math.abs(maxGamma) / (Math.abs(minGamma) + 1e-6) : 0;

  return {
    maxBeta: safe(maxBeta),
    minBeta: safe(minBeta),
    maxGamma: safe(maxGamma),
    minGamma: safe(minGamma),
    maxAlpha: safe(maxAlpha),
    minAlpha: safe(minAlpha),

    peakAbsBeta,
    peakAbsGamma,
    peakAbsAlpha,

    betaAsymmetry,
    gammaAsymmetry,

    minAccelZ: safe(minAccelZ),
    minAccelY: safe(minAccelY),
    maxAccelY: safe(maxAccelY),

    durationMs: segment.durationMs,
    motionCount: motion.length,
  };
}

/**
 * Main detector
 */
export function detectFlipTrick(segment: SensorSegment): DetectorResult {
  if (!segment.motionSamples || segment.motionSamples.length < 2) {
    return {
      label: "unknown",
      confidence: 0.1,
      reason: "Not enough motion samples.",
    };
  }

  // 1. Extract features
  const metrics = extractMetrics(segment);

  // 2. Classify using provided rules engine
  const result = classifySkateTrick(metrics);

  // 3. Map to app format
  const label = result.detectedFlipName as TrickLabel;

  return {
    label,
    confidence: result.confidence,
    reason:
      result.explanation ??
      `Detected ${label} using ${metrics.motionCount} samples over ${metrics.durationMs}ms.`,
  };
}