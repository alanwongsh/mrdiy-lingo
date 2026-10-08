import type { PublishIntegration, PublishIntegrationType } from "@/lib/publish/integrations/integration";
import { WebhookSiteIntegration } from "@/lib/publish/integrations/WebhookSiteIntegration";

const integrations: PublishIntegration[] = [new WebhookSiteIntegration()];

export function listPublishIntegrations(): PublishIntegrationType[] {
  return integrations.map((integration) => integration.describe());
}

export function getPublishIntegration(code: string): PublishIntegration | null {
  return integrations.find((integration) => integration.code === code) ?? null;
}
