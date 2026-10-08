import { runDuePublications } from "@/lib/publish/run";

const INTERVAL_MS = 60_000;
const START_DELAY_MS = 5_000;

const globalState = globalThis as typeof globalThis & {
  __lingoPublishScheduler?: boolean;
};

/** Checks for due, approved articles on a timer. Started once per server process. */
export function startPublishScheduler() {
  if (globalState.__lingoPublishScheduler) return;
  globalState.__lingoPublishScheduler = true;

  let running = false;
  let schemaWarned = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runDuePublications();
      schemaWarned = false;
      if (result.delivered > 0 || result.failed > 0 || result.skipped > 0) {
        console.info(
          `[publish] delivered ${result.delivered}, failed ${result.failed}, skipped ${result.skipped}`
        );
        for (const note of result.notes) console.info(`[publish] ${note}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publish scheduler failed.";
      if (/016_publish_vendors|017_publish_language_targets/.test(message)) {
        if (!schemaWarned) {
          console.error(`[publish] ${message}`);
          schemaWarned = true;
        }
      } else {
        console.error(`[publish] ${message}`);
      }
    } finally {
      running = false;
    }
  };

  setTimeout(() => {
    void tick();
  }, START_DELAY_MS);
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  console.info("[publish] background scheduler started");
}
