export function publishSchemaError(error: { message: string }): Error | null {
  const missing =
    /does not exist|schema cache|Could not find/i.test(error.message);
  if (!missing) return null;
  if (/language_code/i.test(error.message)) {
    return new Error(
      "Run migration 017_publish_language_targets.sql from Setup before publishing."
    );
  }
  if (/publish_vendors|content_publish_targets|content_publications/i.test(error.message)) {
    return new Error(
      "Run migration 016_publish_vendors.sql from Setup before publishing."
    );
  }
  return null;
}

export function throwPublishError(error: { message: string }): never {
  throw publishSchemaError(error) ?? new Error(error.message);
}
