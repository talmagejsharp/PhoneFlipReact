/* skateboardTrickClassifier.ts */

export type FlipName =
  | "kickFlip"
  | "heelFlip"
  | "threeSixty"
  | "reverseThreeSixty"
  | "unknown";

export type Axis = "beta" | "gamma" | "alpha";

export interface TrickMetrics {
  maxBeta?: number;
  minBeta?: number;
  maxGamma?: number;
  minGamma?: number;
  maxAlpha?: number;
  minAlpha?: number;

  peakAbsBeta?: number;
  peakAbsGamma?: number;
  peakAbsAlpha?: number;

  betaAsymmetry?: number;
  gammaAsymmetry?: number;

  netBeta?: number;
  netGamma?: number;

  minAccelZ?: number;
  minAccelY?: number;
  maxAccelY?: number;

  durationMs?: number;
  motionCount?: number;
}

/**
 * Accept either a metrics object directly, or an input object that contains `metrics`.
 * This keeps the classifier easy to wire into different pipelines.
 */
export type SegmentLike = TrickMetrics & {
  metrics?: TrickMetrics;
  timeSeries?: unknown;
  [key: string]: unknown;
};

export interface ClassificationResult {
  detectedFlipName: FlipName;
  confidence: number; // 0..1
  explanation?: string;
}

interface RuleContribution {
  label: string;
  weight: number;
  score: number; // 0..1
}

interface TrickProfile {
  name: Exclude<FlipName, "unknown">;
  rules: Array<(m: RequiredMetrics) => RuleContribution>;
}

type RequiredMetrics = {
  [K in keyof Required<TrickMetrics>]: number;
};

const EPS = 1e-9;

/**
 * Tuning is centralized here.
 * You can adjust these values without touching the scoring engine.
 */
const TUNING = {
  noise: {
    minDominantPeak: 140,
    minSumPeak: 280,
    minMotionCount: 3,
    minDurationMs: 120,

    rejectIfBestBelow: 0.42, // normalized score
    rejectIfGapBelow: 0.06,  // best minus runner-up
    rejectIfRatioBelow: 1.12 // best / runner-up
  },

  scoring: {
    // Softness controls how tolerant the classifier is outside the nominal range.
    rangeSoftnessMultiplier: 0.75,
    oneSidedSoftnessMultiplier: 0.8,
    dominanceSoftnessMultiplier: 0.8
  }
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Score is 1 inside the interval, then decays linearly outside it with generous softness.
 * This keeps the classifier tolerant of different execution styles.
 */
function scoreInterval(
  value: number | undefined,
  low: number,
  high: number,
  softnessMultiplier = TUNING.scoring.rangeSoftnessMultiplier
): number {
  if (!isFiniteNumber(value)) return 0;

  if (value >= low && value <= high) return 1;

  const span = Math.max(1, Math.abs(high - low));
  const softness = span * softnessMultiplier;
  const dist = value < low ? low - value : value - high;
  return clamp01(1 - dist / softness);
}

function scoreAtLeast(
  value: number | undefined,
  minValue: number,
  softnessMultiplier = TUNING.scoring.oneSidedSoftnessMultiplier
): number {
  if (!isFiniteNumber(value)) return 0;
  if (value >= minValue) return 1;

  const softness = Math.max(1, Math.abs(minValue) * softnessMultiplier);
  return clamp01(1 - (minValue - value) / softness);
}

function scoreAtMost(
  value: number | undefined,
  maxValue: number,
  softnessMultiplier = TUNING.scoring.oneSidedSoftnessMultiplier
): number {
  if (!isFiniteNumber(value)) return 0;
  if (value <= maxValue) return 1;

  const softness = Math.max(1, Math.abs(maxValue) * softnessMultiplier);
  return clamp01(1 - (value - maxValue) / softness);
}

function getMetrics(input: SegmentLike): RequiredMetrics {
  const raw = (isFiniteNumber(input.maxBeta) || isFiniteNumber(input.peakAbsBeta))
    ? input
    : (input.metrics ?? input);

  const out: RequiredMetrics = {
    maxBeta: isFiniteNumber(raw.maxBeta) ? raw.maxBeta : 0,
    minBeta: isFiniteNumber(raw.minBeta) ? raw.minBeta : 0,
    maxGamma: isFiniteNumber(raw.maxGamma) ? raw.maxGamma : 0,
    minGamma: isFiniteNumber(raw.minGamma) ? raw.minGamma : 0,
    maxAlpha: isFiniteNumber(raw.maxAlpha) ? raw.maxAlpha : 0,
    minAlpha: isFiniteNumber(raw.minAlpha) ? raw.minAlpha : 0,

    peakAbsBeta: isFiniteNumber(raw.peakAbsBeta) ? raw.peakAbsBeta : 0,
    peakAbsGamma: isFiniteNumber(raw.peakAbsGamma) ? raw.peakAbsGamma : 0,
    peakAbsAlpha: isFiniteNumber(raw.peakAbsAlpha) ? raw.peakAbsAlpha : 0,

    betaAsymmetry: isFiniteNumber(raw.betaAsymmetry) ? raw.betaAsymmetry : 0,
    gammaAsymmetry: isFiniteNumber(raw.gammaAsymmetry) ? raw.gammaAsymmetry : 0,

    netBeta: isFiniteNumber(raw.netBeta) ? raw.netBeta : 0,
    netGamma: isFiniteNumber(raw.netGamma) ? raw.netGamma : 0,

    minAccelZ: isFiniteNumber(raw.minAccelZ) ? raw.minAccelZ : 0,
    minAccelY: isFiniteNumber(raw.minAccelY) ? raw.minAccelY : 0,
    maxAccelY: isFiniteNumber(raw.maxAccelY) ? raw.maxAccelY : 0,

    durationMs: isFiniteNumber(raw.durationMs) ? raw.durationMs : 0,
    motionCount: isFiniteNumber(raw.motionCount) ? raw.motionCount : 0
  };

  return out;
}

function axisPeak(m: RequiredMetrics, axis: Axis): number {
  switch (axis) {
    case "beta":
      return m.peakAbsBeta ?? 0;
    case "gamma":
      return m.peakAbsGamma ?? 0;
    case "alpha":
      return m.peakAbsAlpha ?? 0;
  }
}

function dominanceScore(m: RequiredMetrics, axis: Axis, minRatio: number): number {
  const target = axisPeak(m, axis);
  const competitors = ["beta", "gamma", "alpha"]
    .filter((a): a is Axis => a !== axis)
    .map((a) => axisPeak(m, a));

  const strongestOther = Math.max(...competitors, 0);
  const ratio = target / (strongestOther + 1);
  return scoreAtLeast(ratio, minRatio, TUNING.scoring.dominanceSoftnessMultiplier);
}

function ratioScore(
  numerator: number | undefined,
  denominator: number | undefined,
  minRatio: number,
  maxRatio?: number
): number {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator <= 0) return 0;
  const ratio = numerator / denominator;

  if (maxRatio !== undefined) {
    if (ratio >= minRatio && ratio <= maxRatio) return 1;
    if (ratio < minRatio) return scoreAtLeast(ratio, minRatio);
    return scoreAtMost(ratio, maxRatio);
  }

  return scoreAtLeast(ratio, minRatio);
}

function noiseGateScore(m: RequiredMetrics): number {
  const peakBeta = m.peakAbsBeta ?? 0;
  const peakGamma = m.peakAbsGamma ?? 0;
  const peakAlpha = m.peakAbsAlpha ?? 0;

  const dominantPeak = Math.max(peakBeta, peakGamma, peakAlpha);
  const sumPeaks = peakBeta + peakGamma + peakAlpha;

  const motionScore = average([
    scoreAtLeast(dominantPeak, TUNING.noise.minDominantPeak),
    scoreAtLeast(sumPeaks, TUNING.noise.minSumPeak),
    scoreAtLeast(m.motionCount, TUNING.noise.minMotionCount),
    scoreAtLeast(m.durationMs, TUNING.noise.minDurationMs)
  ]);

  return motionScore;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildProfiles(): TrickProfile[] {
  return [
    {
      name: "kickFlip",
      rules: [
        (m) => ({
          label: "net beta strongly forward",
          weight: 3.0,
          score: scoreAtLeast(m.netBeta, 1000)
        }),
        (m) => ({
          label: "dominant beta axis",
          weight: 2.0,
          score: dominanceScore(m, "beta", 1.12)
        }),
        (m) => ({
          label: "maxBeta in range",
          weight: 2.0,
          score: scoreInterval(m.maxBeta, 1300, 2200)
        }),
        (m) => ({
          label: "gamma very low",
          weight: 2.5,
          score: scoreAtMost(m.peakAbsGamma, 400)
        }),
        (m) => ({
          label: "minGamma not strongly negative",
          weight: 1.5,
          score: scoreInterval(m.minGamma, -280, 0)
        }),
        (m) => ({
          label: "alpha is secondary",
          weight: 0.8,
          score: scoreAtMost(m.peakAbsAlpha, 700)
        })
      ]
    },

    {
      name: "heelFlip",
      rules: [
        (m) => ({
          label: "net beta strongly backward",
          weight: 3.0,
          score: scoreAtMost(m.netBeta, -350)
        }),
        (m) => ({
          label: "dominant beta axis",
          weight: 2.0,
          score: dominanceScore(m, "beta", 1.10)
        }),
        (m) => ({
          label: "minBeta in range",
          weight: 2.5,
          score: scoreInterval(m.minBeta, -1400, -1000)
        }),
        (m) => ({
          label: "maxBeta limited",
          weight: 1.5,
          score: scoreAtMost(m.maxBeta, 1000)
        }),
        (m) => ({
          label: "gamma low",
          weight: 2.0,
          score: scoreAtMost(m.peakAbsGamma, 500)
        }),
        (m) => ({
          label: "net gamma not positive",
          weight: 1.5,
          score: scoreAtMost(m.netGamma, 150)
        }),
        (m) => ({
          label: "alpha is secondary",
          weight: 0.8,
          score: scoreAtMost(m.peakAbsAlpha, 450)
        })
      ]
    },

    {
      name: "threeSixty",
      rules: [
        (m) => ({
          label: "net gamma strongly negative",
          weight: 3.0,
          score: scoreAtMost(m.netGamma, -550)
        }),
        (m) => ({
          label: "minGamma strongly negative",
          weight: 2.5,
          score: scoreAtMost(m.minGamma, -700)
        }),
        (m) => ({
          label: "strong gamma magnitude",
          weight: 2.0,
          score: scoreAtLeast(m.peakAbsGamma, 750)
        }),
        (m) => ({
          label: "dominant gamma axis",
          weight: 2.0,
          score: dominanceScore(m, "gamma", 1.05)
        }),
        (m) => ({
          label: "high alpha involvement",
          weight: 1.5,
          score: scoreAtLeast(m.peakAbsAlpha, 400)
        }),
        (m) => ({
          label: "beta not extreme",
          weight: 1.0,
          score: scoreAtMost(m.peakAbsBeta, 1500)
        })
      ]
    },

    {
      name: "reverseThreeSixty",
      rules: [
        (m) => ({
          label: "maxGamma in range",
          weight: 3.0,
          score: scoreInterval(m.maxGamma, 840, 1100)
        }),
        (m) => ({
          label: "net gamma strongly positive",
          weight: 2.5,
          score: scoreAtLeast(m.netGamma, 650)
        }),
        (m) => ({
          label: "dominant gamma axis",
          weight: 2.3,
          score: dominanceScore(m, "gamma", 1.08)
        }),
        (m) => ({
          label: "minGamma small negative",
          weight: 2.0,
          score: scoreInterval(m.minGamma, -150, -40)
        }),
        (m) => ({
          label: "gamma magnitude high",
          weight: 1.6,
          score: scoreAtLeast(m.peakAbsGamma, 760)
        }),
        (m) => ({
          label: "alpha is secondary",
          weight: 0.9,
          score: scoreAtMost(m.peakAbsAlpha, 760)
        }),
        (m) => ({
          label: "beta is secondary",
          weight: 0.8,
          score: scoreAtMost(m.peakAbsBeta, 900)
        })
      ]
    }
  ];
}

const PROFILES = buildProfiles();

function scoreProfile(m: RequiredMetrics, profile: TrickProfile) {
  const contributions: RuleContribution[] = [];
  let weighted = 0;
  let totalWeight = 0;

  for (const rule of profile.rules) {
    const c = rule(m);
    contributions.push(c);
    weighted += c.weight * c.score;
    totalWeight += c.weight;
  }

  const normalized = totalWeight > 0 ? weighted / totalWeight : 0;
  contributions.sort((a, b) => b.weight * b.score - a.weight * a.score);

  return {
    normalized,
    rawWeighted: weighted,
    totalWeight,
    contributions
  };
}

function buildExplanation(name: FlipName, topContribs: RuleContribution[]): string {
  const useful = topContribs
    .filter((c) => c.score >= 0.6)
    .slice(0, 3)
    .map((c) => c.label);

  if (useful.length === 0) return `Matched ${name} best, but with only weak supporting signals.`;
  return `${name} fit best because of ${useful.join(", ")}.`;
}

/**
 * Main entry point.
 */
export function classifySkateTrick(input: SegmentLike): ClassificationResult {
  const m = getMetrics(input);
  const profiles = PROFILES.map((p) => ({
    profile: p,
    result: scoreProfile(m, p)
  }));

  // 1) Reject obvious noise first.
  const noiseScore = noiseGateScore(m);
  if (noiseScore < 0.28) {
    return {
      detectedFlipName: "unknown",
      confidence: clamp01(noiseScore),
      explanation: "Motion looked too weak or too noisy to classify reliably."
    };
  }

  // 2) Score all known trick classes.
  profiles.sort((a, b) => b.result.normalized - a.result.normalized);

  const best = profiles[0];
  const runnerUp = profiles[1];

  const bestScore = best?.result.normalized ?? 0;
  const secondScore = runnerUp?.result.normalized ?? 0;
  const gap = bestScore - secondScore;
  const ratio = bestScore / Math.max(secondScore, 0.001);

  // 3) Reject if the winner is not clearly ahead.
  if (
    bestScore < TUNING.noise.rejectIfBestBelow ||
    gap < TUNING.noise.rejectIfGapBelow ||
    ratio < TUNING.noise.rejectIfRatioBelow
  ) {
    return {
      detectedFlipName: "unknown",
      confidence: clamp01(bestScore),
      explanation: "The motion did not separate cleanly enough between trick classes."
    };
  }

  const topName = best.profile.name as FlipName;
  const explanation = buildExplanation(topName, best.result.contributions);

  // Confidence rewards both absolute fit and margin over the runner-up.
  const confidence = clamp01(
    0.65 * bestScore + 0.35 * clamp01(gap / 0.25)
  );

  return {
    detectedFlipName: topName,
    confidence,
    explanation
  };
}

/* ---------------------------------------------
   Example usage
----------------------------------------------

// import { classifySkateTrick } from "./skateboardTrickClassifier";

const result = classifySkateTrick({
  maxBeta: 1820,
  minBeta: -310,
  maxGamma: 220,
  minGamma: -180,
  maxAlpha: 160,
  minAlpha: -90,
  peakAbsBeta: 1820,
  peakAbsGamma: 240,
  peakAbsAlpha: 180,
  betaAsymmetry: 5.9,
  gammaAsymmetry: 1.3,
  minAccelZ: -1.9,
  minAccelY: -0.8,
  maxAccelY: 1.4,
  durationMs: 820,
  motionCount: 14
});

console.log(result);

---------------------------------------------- */