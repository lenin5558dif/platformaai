import type { Prisma } from "@prisma/client";
import type { OrgModelPolicy, OrgDlpPolicy } from "@/lib/org-settings";
import { getOrgDlpPolicy, getOrgModelPolicy } from "@/lib/org-settings";
import { isModelAllowed } from "@/lib/model-policy";
import { evaluateDlp, type DlpOutcome } from "@/lib/dlp";
import { logAudit } from "@/lib/audit";
import type { ChatMessage } from "@/lib/context";

type ModelValidationResult =
  | { ok: true }
  | { ok: false; status: 403; error: string };

type DlpMessage = ChatMessage;

type DlpApplyResult =
  | {
      ok: true;
      blocked: false;
      redacted: boolean;
      content?: string;
      messages?: DlpMessage[];
    }
  | {
      ok: false;
      blocked: true;
      status: 400;
      error: string;
      matches: string[];
    };

type AuditContext = {
  orgId: string | null;
  actorId: string;
  targetId: string | null;
};

/**
 * Validates if a model is allowed by the organization's model policy.
 * Logs POLICY_BLOCKED audit event if blocked.
 */
export async function validateModelPolicy(params: {
  modelId: string;
  policy: OrgModelPolicy;
  audit: AuditContext;
}): Promise<ModelValidationResult> {
  const { modelId, policy, audit } = params;

  if (isModelAllowed(modelId, policy)) {
    return { ok: true };
  }

  await logAudit({
    action: "POLICY_BLOCKED",
    orgId: audit.orgId,
    actorId: audit.actorId,
    targetType: "model",
    targetId: modelId,
    metadata: { reason: "blocked_by_policy" },
  });

  return {
    ok: false,
    status: 403,
    error: "Модель запрещена политикой организации.",
  };
}

/**
 * Filters an array of fallback model IDs through the model policy.
 * Returns only models that are allowed by the policy.
 */
export function filterFallbackModels(
  fallbackModels: string[],
  policy: OrgModelPolicy
): string[] {
  return fallbackModels.filter((modelId) => isModelAllowed(modelId, policy));
}

/**
 * Applies DLP policy to a single text string.
 * Logs POLICY_BLOCKED audit event on block or redact.
 * Returns structured result for caller to handle response.
 */
export async function applyDlpToText(params: {
  text: string;
  policy: OrgDlpPolicy;
  audit: AuditContext;
}): Promise<DlpApplyResult> {
  const { text, policy, audit } = params;
  const outcome = evaluateDlp(text, policy);

  if (outcome.action === "allow") {
    return {
      ok: true,
      blocked: false,
      redacted: false,
      content: text,
    };
  }

  if (outcome.action === "block") {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: audit.orgId,
      actorId: audit.actorId,
      targetType: "dlp",
      targetId: audit.targetId,
      metadata: { matches: outcome.matches },
    });

    return {
      ok: false,
      blocked: true,
      status: 400,
      error: "Запрос отклонен политикой DLP.",
      matches: outcome.matches,
    };
  }

  // redact
  await logAudit({
    action: "POLICY_BLOCKED",
    orgId: audit.orgId,
    actorId: audit.actorId,
    targetType: "dlp",
    targetId: audit.targetId,
    metadata: { action: "redact" },
  });

  return {
    ok: true,
    blocked: false,
    redacted: true,
    content: outcome.redactedText ?? text,
  };
}

/**
 * Applies DLP policy to an array of chat messages.
 * Only processes messages with role === "user".
 * Logs POLICY_BLOCKED audit event on first block, or on redactions.
 * Returns structured result for caller to handle response.
 */
export async function applyDlpToMessages(params: {
  messages: DlpMessage[];
  policy: OrgDlpPolicy;
  audit: AuditContext;
}): Promise<DlpApplyResult> {
  const { messages, policy, audit } = params;

  let redactedAny = false;
  const processedMessages: DlpMessage[] = [];
  let blockedMatches: string[] | null = null;

  for (const message of messages) {
    if (message.role !== "user") {
      processedMessages.push(message);
      continue;
    }

    const outcome = evaluateDlp(message.content, policy);

    if (outcome.action === "block") {
      blockedMatches = outcome.matches;
      // Keep processing to maintain array shape, but we'll reject at the end
      processedMessages.push(message);
      break; // Stop processing on first block
    }

    if (outcome.action === "redact" && outcome.redactedText) {
      redactedAny = true;
      processedMessages.push({ ...message, content: outcome.redactedText });
    } else {
      processedMessages.push(message);
    }
  }

  // Handle block
  if (blockedMatches) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: audit.orgId,
      actorId: audit.actorId,
      targetType: "dlp",
      targetId: audit.targetId,
      metadata: { matches: blockedMatches },
    });

    return {
      ok: false,
      blocked: true,
      status: 400,
      error: "Запрос отклонен политикой DLP.",
      matches: blockedMatches,
    };
  }

  // Handle redaction audit
  if (redactedAny) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: audit.orgId,
      actorId: audit.actorId,
      targetType: "dlp",
      targetId: audit.targetId,
      metadata: { action: "redact" },
    });
  }

  return {
    ok: true,
    blocked: false,
    redacted: redactedAny,
    messages: processedMessages,
  };
}

// ============================================================================
// Telegram Bot Helpers
// ============================================================================

export type AuthorizationContext = {
  userId: string;
  orgId?: string | null;
  settings?: Prisma.JsonValue | null;
  source?: string;
};

type ModelCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "model_blocked" };

type DlpCheckResult =
  | { action: "allow" }
  | { action: "block"; matches: string[] }
  | { action: "redact"; redactedText: string; matches: string[] };

/**
 * Check if a model is allowed by organization policy.
 * Emits POLICY_BLOCKED audit log if blocked.
 * For use by Telegram bot.
 */
export async function checkModelAllowed(
  modelId: string,
  ctx: AuthorizationContext
): Promise<ModelCheckResult> {
  const modelPolicy = getOrgModelPolicy(ctx.settings ?? null);
  if (!isModelAllowed(modelId, modelPolicy)) {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: "model",
      targetId: modelId,
      metadata: { source: ctx.source ?? "unknown" },
    });
    return { allowed: false, reason: "model_blocked" };
  }
  return { allowed: true };
}

/**
 * Evaluate DLP policy against content.
 * Emits POLICY_BLOCKED audit log for block/redact actions.
 * For use by Telegram bot.
 */
async function checkDlpPolicy(
  content: string,
  ctx: AuthorizationContext
): Promise<DlpCheckResult> {
  const dlpPolicy = getOrgDlpPolicy(ctx.settings ?? null);
  const outcome: DlpOutcome = evaluateDlp(content, dlpPolicy);

  if (outcome.action === "block") {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: "dlp",
      targetId: null,
      metadata: { source: ctx.source ?? "unknown", matches: outcome.matches },
    });
    return { action: "block", matches: outcome.matches };
  }

  if (outcome.action === "redact") {
    await logAudit({
      action: "POLICY_BLOCKED",
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: "dlp",
      targetId: null,
      metadata: { source: ctx.source ?? "unknown", action: "redact" },
    });
    return {
      action: "redact",
      redactedText: outcome.redactedText ?? content,
      matches: outcome.matches,
    };
  }

  return { action: "allow" };
}

/**
 * Convenience function to run both model and DLP checks.
 * Returns the final content (redacted if needed) or null if blocked.
 * For use by Telegram bot.
 */
export async function authorizeAiRequest(
  modelId: string,
  content: string,
  ctx: AuthorizationContext
): Promise<
  | { allowed: true; finalContent: string }
  | { allowed: false; reason: "model_blocked" | "dlp_blocked" }
> {
  // Model policy check
  const modelResult = await checkModelAllowed(modelId, ctx);
  if (!modelResult.allowed) {
    return { allowed: false, reason: "model_blocked" };
  }

  // DLP policy check
  const dlpResult = await checkDlpPolicy(content, ctx);
  if (dlpResult.action === "block") {
    return { allowed: false, reason: "dlp_blocked" };
  }

  const finalContent =
    dlpResult.action === "redact" ? dlpResult.redactedText : content;

  return { allowed: true, finalContent };
}
