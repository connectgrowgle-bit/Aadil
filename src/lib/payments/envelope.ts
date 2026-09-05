/**
 * The webhook body shape shared by both gateway implementations, modeled
 * on Razorpay's real payload structure (`event`, `payload.payment.entity`,
 * `payload.refund.entity`). Kept in one place so MockPaymentGateway and
 * RazorpayGateway parse identically and the route handler is provider-
 * agnostic.
 */
import { createHash } from "node:crypto";
import type { WebhookEvent, WebhookEventType } from "./gateway";

export interface RawWebhookEnvelope {
  event: WebhookEventType;
  payload: {
    payment: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        status: string;
        amount_refunded?: number;
      };
    };
  };
}

export function buildEnvelope(params: {
  event: WebhookEventType;
  providerPaymentId: string;
  providerOrderId: string;
  amountPaise: number;
  status: string;
  amountRefundedPaise?: number;
}): RawWebhookEnvelope {
  return {
    event: params.event,
    payload: {
      payment: {
        entity: {
          id: params.providerPaymentId,
          order_id: params.providerOrderId,
          amount: params.amountPaise,
          status: params.status,
          ...(params.amountRefundedPaise !== undefined
            ? { amount_refunded: params.amountRefundedPaise }
            : {}),
        },
      },
    },
  };
}

/** Deterministic per exact delivery — see gateway.ts's WebhookEvent doc. */
export function computeProviderEventId(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function parseEnvelope(rawBody: string): WebhookEvent {
  let parsed: RawWebhookEnvelope;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("Webhook body is not valid JSON");
  }

  const entity = parsed?.payload?.payment?.entity;
  if (!parsed?.event || !entity?.id || !entity?.order_id) {
    throw new Error("Webhook body is missing required payment fields");
  }

  return {
    providerEventId: computeProviderEventId(rawBody),
    eventType: parsed.event,
    providerPaymentId: entity.id,
    providerOrderId: entity.order_id,
    amountPaise: entity.amount,
    status: entity.status,
    amountRefundedPaise: entity.amount_refunded,
  };
}
