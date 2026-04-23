import { mapBillingError } from "@/lib/billing-errors";
import { HttpError } from "@/lib/http-error";

function isOpenRouterInsufficientCreditsMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("openrouter image generation error") &&
    normalized.includes("insufficient credits")
  );
}

export function toImageGenerationErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
      },
    };
  }

  const message = error instanceof Error ? error.message : "Image generation error";

  if (isOpenRouterInsufficientCreditsMessage(message)) {
    return {
      status: 402,
      body: {
        error: "Недостаточно баланса OpenRouter. Пополните credits или выберите другую модель.",
        code: "OPENROUTER_INSUFFICIENT_CREDITS",
      },
    };
  }

  const billing = mapBillingError(message);
  if (billing.status !== 500 || message === "USER_NOT_FOUND") {
    return {
      status: billing.status,
      body: {
        error: billing.error,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: message,
    },
  };
}
