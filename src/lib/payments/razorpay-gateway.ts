import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import type { CreateOrderParams, CreateOrderResult, PaymentGateway, WebhookEvent } from "./gateway";
import { WebhookSignatureError } from "./gateway";
import { parseEnvelope } from "./envelope";

/**
 * NOT exercised against the real Razorpay API in this build — this
 * environment has no live or test Razorpay credentials and no verified
 * outbound path to Razorpay (see STATUS.md, Phase 13). The signature
 * verification logic (the part most likely to be gotten wrong per Rules
 * 6-8) is unit-testable without real credentials and is covered; order
 * creation calling the real API is not.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay" as const;
  private readonly client: Razorpay;
  private readonly webhookSecret: string;

  constructor(params: { keyId: string; keySecret: string; webhookSecret: string }) {
    // Rule 8: the webhook secret is never the API key secret — this
    // constructor takes them as two distinct required fields on purpose,
    // so there is no shared default to accidentally collapse them into.
    this.client = new Razorpay({ key_id: params.keyId, key_secret: params.keySecret });
    this.webhookSecret = params.webhookSecret;
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    if (params.amountPaise <= 0) {
      throw new Error("amountPaise must be positive");
    }
    // A payment without an order_id cannot be captured and is
    // auto-refunded (spec Phase 5) — this call is what makes that
    // possible; checkout must never proceed without it succeeding.
    const order = await this.client.orders.create({
      amount: params.amountPaise,
      currency: params.currency,
      receipt: params.receipt,
    });
    return { providerOrderId: order.id };
  }

  verifyAndParseWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent {
    if (!signatureHeader) throw new WebhookSignatureError();
    // Computed over the RAW body, before any JSON.parse — Rule 7.
    // Re-serializing first (JSON.stringify(JSON.parse(rawBody))) can
    // reorder keys or change whitespace and silently break this digest.
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    let receivedBuf: Buffer;
    try {
      receivedBuf = Buffer.from(signatureHeader, "hex");
    } catch {
      throw new WebhookSignatureError();
    }
    if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
      throw new WebhookSignatureError();
    }
    return parseEnvelope(rawBody);
  }
}
