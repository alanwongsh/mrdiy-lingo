import { htmlToText, nearestStretch } from "@/lib/translation-quality/text";
import type { QualityAction, QualityFinding } from "@/lib/translation-quality/types";

const NEAR_COPY = 0.8;

/**
 * Other checks (such as the model's "missing summary") can suggest wording that contains a
 * required boilerplate passage written slightly differently. Swap the approved wording into those
 * suggestions, so whichever one the reviewer accepts, the passage reads as approved and the two
 * suggestions do not disagree.
 */
export function alignWithBoilerplate<T extends { findings: QualityFinding[]; actions: QualityAction[] }>(
  draft: T
): T {
  const boilerplateIds = new Set(
    draft.findings.filter((f) => f.categoryCode === "boilerplate").map((f) => f.id)
  );
  const approved = draft.actions
    .filter((a) => boilerplateIds.has(a.findingId) && a.proposedText)
    .map((a) => htmlToText(a.proposedText ?? "").trim())
    .filter(Boolean);
  if (approved.length === 0) return draft;

  const swap = (text: string | undefined): string | undefined => {
    if (!text) return text;
    let next = text;
    for (const passage of approved) {
      const near = nearestStretch(next, passage);
      if (!near || near.score < NEAR_COPY || near.score === 1) continue;
      if (next.includes(near.text)) next = next.replace(near.text, passage);
    }
    return next;
  };

  const actions = draft.actions.map((action) =>
    boilerplateIds.has(action.findingId) ? action : { ...action, proposedText: swap(action.proposedText) }
  );
  const findings = draft.findings.map((finding) =>
    boilerplateIds.has(finding.id) ? finding : { ...finding, suggestedText: swap(finding.suggestedText) }
  );
  return { ...draft, actions, findings };
}
