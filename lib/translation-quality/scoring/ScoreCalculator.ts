import type {
  QualityCategoryConfig,
  QualityScore,
  ScoreSeverity,
} from "@/lib/translation-quality/types";
import { clampScore } from "@/lib/translation-quality/text";

export function severityForScore(score: number): ScoreSeverity {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "warning";
  return "critical";
}

export function overallScore(
  scores: QualityScore[],
  categories: QualityCategoryConfig[]
): number | null {
  const available = scores.filter(
    (score): score is QualityScore & { score: number } =>
      typeof score.score === "number" && !score.error
  );
  if (available.length === 0) return null;
  let weightTotal = 0;
  let weighted = 0;
  for (const score of available) {
    const category = categories.find((item) => item.code === score.categoryCode);
    const weight = category && category.weight > 0 ? category.weight : 1;
    weightTotal += weight;
    weighted += score.score * weight;
  }
  if (weightTotal <= 0) return null;
  return clampScore(weighted / weightTotal);
}
