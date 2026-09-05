import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CreateOrderParams, CreateOrderResult, PaymentGateway, WebhookEvent } from "./gateway";
import { WebhookSignatureError } from "./gateway";
import { buildEnvelope, parseEnvelope } from "./envelope";

// Not a secret in any meaningful sense — this gateway never talks to a
// real payment network. It exists so the signature-verification code
// path (Rule 7) is exercised for real in every environment, including
// this one, which has no live Razorpay credentials.
const MOCK_WEBHOOK_SECRET = "mock-gateway-webhook-secret-not-real";

function sign(rawBody: string): string {
  return createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

export class MockPaymentGateway implements PaymentGateway {
  readonly name = "mock" as const;

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    // A real gateway rejects amounts <= 0; a mock that doesn't would let
    // a bug elsewhere sail through only to fail against the real thing.
    if (params.amountPaise <= 0) {
      throw new Error("amountPaise must be positive");
    }
    return { providerOrderId: `mock_order_${randomUUID()}` };
  }

  verifyAndParseWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent {
    if (!signatureHeader) throw new WebhookSignatureError();
    const expected = sign(rawBody);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signatureHeader, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookSignatureError();
    }
    return parseEnvelope(rawBody);
  }

  /** Test/simulation helper only — builds and signs a webhook delivery the
   * way the real endpoint would receive one over HTTP, so tests exercise
   * the exact same signature-verification path production traffic would. */
  buildSignedWebhookDelivery(params: {
    event: Parameters<typeof buildEnvelope>[0]["event"];
    providerPaymentId: string;
    providerOrderId: string;
    amountPaise: number;
    status: string;
    amountRefundedPaise?: number;
  }): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify(buildEnvelope(params));
    return { rawBody, signature: sign(rawBody) };
  }
}
