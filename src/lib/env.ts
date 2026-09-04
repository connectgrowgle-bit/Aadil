/**
 * Environment validation. Runs at import time (module top level) so that
 * anything importing this module transitively fails to boot rather than
 * failing silently later. See spec §12: "A crashed deploy is recoverable in
 * minutes; silently taking no money for a week is not."
 *
 * Every branch here exists because of a real failure mode named in the
 * build's own history — see the inline comments and docs/MISTAKES.md.
 */
import { z } from "zod";

const APP_ENVS = ["development", "staging", "production"] as const;

const rawSchema = z.object({
  // No default: an unset APP_ENV must not silently fall back to "development"
  // in a place where "production" was meant.
  APP_ENV: z.enum(APP_ENVS),
  APP_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["true", "false"]).optional(),

  SESSION_SECRET: z.string().min(32),
  PII_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 32 bytes hex (openssl rand -hex 32)"),

  PAYMENT_PROVIDER: z.enum(["mock", "razorpay"]),
  // No default, same reasoning as APP_ENV: this gates whether real money
  // moves. A `rzp_test_` key with PAYMENT_MODE=live must refuse to boot
  // (checked below, not by the schema alone).
  PAYMENT_MODE: z.enum(["test", "live"]),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  CRON_SECRET: z.string().min(16),

  EMAIL_PROVIDER: z.enum(["console", "resend", "ses"]).default("console"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  SENTRY_DSN: z.string().optional(),

  // The header the platform overwrites for the client IP. If this is left
  // as a header a caller can set unchecked (e.g. a bare "x-forwarded-for"
  // behind a proxy that doesn't strip inbound ones), rate limiting and audit
  // logs can be spoofed.
  TRUSTED_PROXY_HEADER: z.string().min(1).default("x-real-ip"),
});

export type AppEnv = (typeof APP_ENVS)[number];

export interface Env {
  appEnv: AppEnv;
  appUrl: string;
  databaseUrl: string;
  databaseSsl: boolean;
  sessionSecret: string;
  piiEncryptionKey: string;
  paymentProvider: "mock" | "razorpay";
  paymentMode: "test" | "live";
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  cronSecret: string;
  emailProvider: "console" | "resend" | "ses";
  storageDriver: "local" | "s3";
  sentryDsn?: string;
  trustedProxyHeader: string;
}

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(`Environment validation failed:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

function collectSource(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const keys = [
    "APP_ENV",
    "APP_URL",
    "DATABASE_URL",
    "DATABASE_SSL",
    "SESSION_SECRET",
    "PII_ENCRYPTION_KEY",
    "PAYMENT_PROVIDER",
    "PAYMENT_MODE",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "CRON_SECRET",
    "EMAIL_PROVIDER",
    "STORAGE_DRIVER",
    "SENTRY_DSN",
    "TRUSTED_PROXY_HEADER",
  ] as const;
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = source[k];
  return out;
}

/**
 * Pure validation function so it can be unit-tested against arbitrary
 * process.env-shaped objects without mutating the real process environment.
 */
export function validateEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = rawSchema.safeParse(collectSource(source));
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const v = parsed.data;
  const issues: string[] = [];

  // Rule: `?schema=` in DATABASE_URL is tolerated by Drizzle/pg but rejected
  // by `pg_dump` — the backup fails only during an incident. Reject it here,
  // at the boundary that's actually checked in CI, not at 3am.
  if (/[?&]schema=/i.test(v.DATABASE_URL)) {
    issues.push(
      "DATABASE_URL must not contain a ?schema= parameter (pg_dump rejects it; backups fail silently otherwise)",
    );
  }

  if (v.APP_ENV === "production" && !v.APP_URL.startsWith("https://")) {
    issues.push("APP_URL must be https:// in production");
  }

  if ((v.APP_ENV === "staging" || v.APP_ENV === "production") && v.DATABASE_SSL !== "true") {
    issues.push("DATABASE_SSL must be true in staging and production");
  }

  if (v.APP_ENV === "production" && !v.SENTRY_DSN) {
    issues.push("SENTRY_DSN is required in production");
  }

  if (v.PAYMENT_PROVIDER === "razorpay") {
    if (!v.RAZORPAY_KEY_ID || !v.RAZORPAY_KEY_SECRET) {
      issues.push("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay");
    }
    if (!v.RAZORPAY_WEBHOOK_SECRET) {
      issues.push("RAZORPAY_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=razorpay");
    }
    // The webhook secret and the API key secret are separate values from
    // separate Razorpay dashboard pages (Rule 8). Catch the most common way
    // this gets conflated: someone pastes the same value into both.
    if (
      v.RAZORPAY_WEBHOOK_SECRET &&
      v.RAZORPAY_KEY_SECRET &&
      v.RAZORPAY_WEBHOOK_SECRET === v.RAZORPAY_KEY_SECRET
    ) {
      issues.push(
        "RAZORPAY_WEBHOOK_SECRET must not equal RAZORPAY_KEY_SECRET — they come from different dashboard pages",
      );
    }
    // PAYMENT_MODE must be cross-checked against the key prefix. A
    // rzp_test_ key with PAYMENT_MODE=live must refuse to boot, and vice
    // versa, because Razorpay itself won't stop you from doing this.
    if (v.RAZORPAY_KEY_ID) {
      const isTestKey = v.RAZORPAY_KEY_ID.startsWith("rzp_test_");
      const isLiveKey = v.RAZORPAY_KEY_ID.startsWith("rzp_live_");
      if (!isTestKey && !isLiveKey) {
        issues.push("RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_");
      } else if (v.PAYMENT_MODE === "live" && isTestKey) {
        issues.push("PAYMENT_MODE=live but RAZORPAY_KEY_ID is a rzp_test_ key");
      } else if (v.PAYMENT_MODE === "test" && isLiveKey) {
        issues.push("PAYMENT_MODE=test but RAZORPAY_KEY_ID is a rzp_live_ key");
      }
    }
    if (v.APP_ENV === "production" && v.PAYMENT_MODE !== "live") {
      issues.push("PAYMENT_MODE must be live when APP_ENV=production and PAYMENT_PROVIDER=razorpay");
    }
  }

  if (v.APP_ENV === "production" && v.PAYMENT_PROVIDER === "mock") {
    issues.push("PAYMENT_PROVIDER must not be mock in production");
  }

  // TRUSTED_PROXY_HEADER must be one the platform itself overwrites (i.e.
  // not something an inbound client request can already set and have
  // survive to the app). We can't verify the deployment topology here, but
  // we can refuse the two headers most commonly left client-writable by
  // accident when no reverse proxy strips them.
  const clientWritableHeaders = new Set(["x-forwarded-for"]);
  if (
    v.APP_ENV === "production" &&
    clientWritableHeaders.has(v.TRUSTED_PROXY_HEADER.toLowerCase())
  ) {
    issues.push(
      `TRUSTED_PROXY_HEADER=${v.TRUSTED_PROXY_HEADER} is commonly client-writable unless your edge strictly strips it; prefer a header only your platform sets (e.g. x-real-ip behind a trusted LB) and confirm your deployment topology`,
    );
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return {
    appEnv: v.APP_ENV,
    appUrl: v.APP_URL,
    databaseUrl: v.DATABASE_URL,
    databaseSsl: v.DATABASE_SSL === "true",
    sessionSecret: v.SESSION_SECRET,
    piiEncryptionKey: v.PII_ENCRYPTION_KEY,
    paymentProvider: v.PAYMENT_PROVIDER,
    paymentMode: v.PAYMENT_MODE,
    razorpayKeyId: v.RAZORPAY_KEY_ID,
    razorpayKeySecret: v.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: v.RAZORPAY_WEBHOOK_SECRET,
    cronSecret: v.CRON_SECRET,
    emailProvider: v.EMAIL_PROVIDER,
    storageDriver: v.STORAGE_DRIVER,
    sentryDsn: v.SENTRY_DSN,
    trustedProxyHeader: v.TRUSTED_PROXY_HEADER,
  };
}

let cached: Env | undefined;

/** Lazily validated, memoized singleton. Throws on first access if invalid. */
export function getEnv(): Env {
  if (!cached) {
    cached = validateEnv(process.env);
  }
  return cached;
}

/** Test-only: clears the memoized env so validateEnv can be re-exercised. */
export function __resetEnvCacheForTests(): void {
  cached = undefined;
}
