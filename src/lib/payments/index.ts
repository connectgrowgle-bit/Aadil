import { getEnv } from "@/lib/env";
import type { PaymentGateway } from "./gateway";
import { MockPaymentGateway } from "./mock-gateway";
import { RazorpayGateway } from "./razorpay-gateway";

export * from "./gateway";

let cached: PaymentGateway | undefined;

export function getPaymentGateway(): PaymentGateway {
  if (cached) return cached;
  const env = getEnv();
  if (env.paymentProvider === "mock") {
    cached = new MockPaymentGateway();
  } else {
    if (!env.razorpayKeyId || !env.razorpayKeySecret || !env.razorpayWebhookSecret) {
      // env.ts already requires these when paymentProvider is razorpay;
      // this is a defensive re-check, not the primary enforcement.
      throw new Error("Razorpay credentials missing despite PAYMENT_PROVIDER=razorpay");
    }
    cached = new RazorpayGateway({
      keyId: env.razorpayKeyId,
      keySecret: env.razorpayKeySecret,
      webhookSecret: env.razorpayWebhookSecret,
    });
  }
  return cached;
}

export function __resetPaymentGatewayForTests(): void {
  cached = undefined;
}
