/**
 * The payment gateway seam (Phase 3/5). One interface, two
 * implementations — MockPaymentGateway for every environment without
 * real Razorpay credentials (which is every environment this build has
 * run in so far), and RazorpayGateway for the real thing. The webhook
 * route and order-creation code only ever talk to this interface.
 *
 * Both implementations produce/consume the same webhook envelope shape
 * (modeled on Razorpay's real `event` / `payload.payment.entity` /
 * `payload.refund.entity` structure), so the route handler that consumes
 * a WebhookEvent does not need to know which gateway produced it.
 */

export interface CreateOrderParams {
  amountPaise: number;
  currency: string;
  /** Our own payment row id — passed through as the provider's receipt so a
   * provider-side order can always be traced back to our record. */
  receipt: string;
}

export interface CreateOrderResult {
  providerOrderId: string;
}

export type WebhookEventType =
  | "payment.captured"
  | "payment.failed"
  | "refund.created"
  | "refund.processed";

export interface WebhookEvent {
  /** Deterministic per exact delivery (sha256 of the raw body) — the
   * idempotency key written to webhook_events.provider_event_id. A byte-
   * identical replay always produces the same id; a delivery carrying new
   * information (e.g. an increased cumulative refund) does not, by
   * construction, and is correctly treated as a new event — Rule 9. */
  providerEventId: string;
  eventType: WebhookEventType;
  providerPaymentId: string;
  providerOrderId: string;
  amountPaise: number;
  status: string;
  /** Cumulative amount refunded so far, straight from the provider —
   * never a locally-incremented counter (Rule 10). Present on refund
   * events; undefined otherwise. */
  amountRefundedPaise?: number;
}

export class WebhookSignatureError extends Error {
  constructor() {
    super("Webhook signature verification failed");
    this.name = "WebhookSignatureError";
  }
}

export interface PaymentGateway {
  readonly name: "mock" | "razorpay";
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  /**
   * Verifies the signature over the RAW body (Rule 7 — never over a
   * parsed-and-reserialized object, which changes the bytes and breaks
   * the digest) and only then parses it. Throws WebhookSignatureError on
   * a bad signature; never returns a parsed event for an unverified body.
   */
  verifyAndParseWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent;
}
