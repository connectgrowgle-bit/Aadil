import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { MockPaymentGateway } from "@/lib/payments/mock-gateway";
import { RazorpayGateway } from "@/lib/payments/razorpay-gateway";
import { WebhookSignatureError } from "@/lib/payments/gateway";
import { buildEnvelope, computeProviderEventId } from "@/lib/payments/envelope";

describe("MockPaymentGateway.createOrder", () => {
  it("returns a provider order id for a positive amount", async () => {
    const gw = new MockPaymentGateway();
    const result = await gw.createOrder({ amountPaise: 10_000, currency: "INR", receipt: "r1" });
    expect(result.providerOrderId).toMatch(/^mock_order_/);
  });

  it("rejects a non-positive amount — a payment for nothing should never reach a gateway", async () => {
    const gw = new MockPaymentGateway();
    await expect(gw.createOrder({ amountPaise: 0, currency: "INR", receipt: "r1" })).rejects.toThrow();
    await expect(gw.createOrder({ amountPaise: -100, currency: "INR", receipt: "r1" })).rejects.toThrow();
  });
});

describe("MockPaymentGateway.verifyAndParseWebhook", () => {
  const gw = new MockPaymentGateway();

  it("accepts a correctly signed delivery and parses it", () => {
    const { rawBody, signature } = gw.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountPaise: 5_000,
      status: "captured",
    });
    const event = gw.verifyAndParseWebhook(rawBody, signature);
    expect(event.eventType).toBe("payment.captured");
    expect(event.providerPaymentId).toBe("pay_1");
    expect(event.providerOrderId).toBe("order_1");
    expect(event.amountPaise).toBe(5_000);
  });

  it("rejects a body that was tampered with after signing (Rule 7 — raw body signing)", () => {
    const { rawBody, signature } = gw.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountPaise: 5_000,
      status: "captured",
    });
    const tampered = rawBody.replace("5000", "50000");
    expect(() => gw.verifyAndParseWebhook(tampered, signature)).toThrow(WebhookSignatureError);
  });

  it("rejects a wrong signature", () => {
    const { rawBody } = gw.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountPaise: 5_000,
      status: "captured",
    });
    expect(() => gw.verifyAndParseWebhook(rawBody, "0".repeat(64))).toThrow(WebhookSignatureError);
  });

  it("rejects a missing signature header", () => {
    const { rawBody } = gw.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountPaise: 5_000,
      status: "captured",
    });
    expect(() => gw.verifyAndParseWebhook(rawBody, null)).toThrow(WebhookSignatureError);
  });

  it("rejects a non-hex signature without throwing an unrelated error", () => {
    const { rawBody } = gw.buildSignedWebhookDelivery({
      event: "payment.captured",
      providerPaymentId: "pay_1",
      providerOrderId: "order_1",
      amountPaise: 5_000,
      status: "captured",
    });
    expect(() => gw.verifyAndParseWebhook(rawBody, "not-hex-at-all!!")).toThrow(WebhookSignatureError);
  });
});

describe("RazorpayGateway.verifyAndParseWebhook (signature logic only, no live API calls)", () => {
  const gateway = new RazorpayGateway({ keyId: "rzp_test_x", keySecret: "keysecret", webhookSecret: "webhooksecret" });

  it("accepts a signature computed the same way Razorpay computes it: HMAC-SHA256 over the raw body", () => {
    const rawBody = JSON.stringify(
      buildEnvelope({
        event: "payment.captured",
        providerPaymentId: "pay_rzp_1",
        providerOrderId: "order_rzp_1",
        amountPaise: 12_345,
        status: "captured",
      }),
    );
    const signature = createHmac("sha256", "webhooksecret").update(rawBody).digest("hex");
    const event = gateway.verifyAndParseWebhook(rawBody, signature);
    expect(event.providerPaymentId).toBe("pay_rzp_1");
  });

  it("rejects a signature computed with the wrong secret (e.g. the API key secret instead of the webhook secret — Rule 8)", () => {
    const rawBody = JSON.stringify(
      buildEnvelope({
        event: "payment.captured",
        providerPaymentId: "pay_rzp_1",
        providerOrderId: "order_rzp_1",
        amountPaise: 12_345,
        status: "captured",
      }),
    );
    const wrongSignature = createHmac("sha256", "keysecret").update(rawBody).digest("hex");
    expect(() => gateway.verifyAndParseWebhook(rawBody, wrongSignature)).toThrow(WebhookSignatureError);
  });
});

describe("computeProviderEventId: idempotency key derivation", () => {
  it("is deterministic for identical bytes", () => {
    const body = '{"a":1}';
    expect(computeProviderEventId(body)).toBe(computeProviderEventId(body));
  });

  it("differs for different bytes (e.g. an updated cumulative refund amount)", () => {
    expect(computeProviderEventId('{"amount_refunded":100}')).not.toBe(
      computeProviderEventId('{"amount_refunded":200}'),
    );
  });
});
