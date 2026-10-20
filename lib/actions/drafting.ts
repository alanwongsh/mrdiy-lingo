"use server";

import { requireAppCapability, requireChosenMarket } from "@/lib/auth/access";
import { listContentTypes } from "@/lib/actions/content-types";
import { listLanguages } from "@/lib/actions/languages";
import { draftArticle } from "@/lib/drafting/gemini";
import { UserFacingError } from "@/lib/errors";
import { marketName } from "@/lib/markets";
import { languageKey } from "@/lib/target-languages";
import { listActiveBoilerplate } from "@/lib/translation-quality/repository";
import type { SourceContentFields } from "@/lib/types";

const PROMPT_LIMIT = 4000;

/** A first draft for the new-article form. Nothing is saved; the editor saves it as usual. */
export async function generateArticleDraft(input: {
  applicationId: string;
  prompt: string;
  contentType: string;
  sourceLanguage: string;
  market: string;
}): Promise<SourceContentFields> {
  await requireAppCapability(input.applicationId, "edit");
  const grant = await requireAppCapability(input.applicationId, "content.generate");
  const market = requireChosenMarket(grant.access, input.market);
  const prompt = input.prompt.trim();
  if (!prompt) throw new UserFacingError("Describe the article you want drafted.");
  if (prompt.length > PROMPT_LIMIT) {
    throw new UserFacingError(`Keep the brief under ${PROMPT_LIMIT} characters.`);
  }

  const [types, languages, boilerplate] = await Promise.all([
    listContentTypes(input.applicationId),
    listLanguages(),
    // Drafting still works without the standard passages.
    listActiveBoilerplate(input.applicationId).catch(() => []),
  ]);
  const contentType = types.find((type) => type.code === input.contentType)?.name ?? "article";
  const language =
    languages.find((item) => languageKey(item.code) === languageKey(input.sourceLanguage))?.name ??
    input.sourceLanguage;

  try {
    return await draftArticle({
      prompt,
      language,
      contentType,
      market: marketName(market),
      boilerplate,
    });
  } catch (error) {
    throw new UserFacingError(error instanceof Error ? error.message : "Drafting failed.");
  }
}
