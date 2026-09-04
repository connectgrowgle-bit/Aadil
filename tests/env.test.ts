import { describe, it, expect } from "vitest";
import { validateEnv, EnvValidationError } from "@/lib/env";

type EnvShape = Record<string, string | undefined>;

function omit(env: EnvShape, key: string): EnvShape {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

/** validateEnv is typed against NodeJS.ProcessEnv for production callers;
 * tests build plain objects, so cast once here rather than at every call
 * site. */
function parse(env: EnvShape) {
  return validateEnv(env as unknown as NodeJS.ProcessEnv);
}

function baseEnv(overrides: EnvShape = {}): EnvShape {
  return {
    APP_ENV: "development",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/groweazzy_dev",
    DATABASE_SSL: "false",
    SESSION_SECRET: "x".repeat(32),
    PII_ENCRYPTION_KEY: "0".repeat(64),
    PAYMENT_PROVIDER: "mock",
    PAYMENT_MODE: "test",
    CRON_SECRET: "y".repeat(16),
    EMAIL_PROVIDER: "console",
    STORAGE_DRIVER: "local",
    TRUSTED_PROXY_HEADER: "x-real-ip",
    ...overrides,
  };
}

function prodBase(overrides: EnvShape = {}): EnvShape {
  return baseEnv({
    APP_ENV: "production",
    APP_URL: "https://groweazzy.example",
    DATABASE_SSL: "true",
    SENTRY_DSN: "https://x@sentry.io/1",
    PAYMENT_PROVIDER: "razorpay",
    PAYMENT_MODE: "live",
    RAZORPAY_KEY_ID: "rzp_live_abc123",
    RAZORPAY_KEY_SECRET: "livesecret",
    RAZORPAY_WEBHOOK_SECRET: "webhooksecret",
    ...overrides,
  });
}

function razorpayBase(overrides: EnvShape = {}): EnvShape {
  return baseEnv({
    PAYMENT_PROVIDER: "razorpay",
    RAZORPAY_KEY_SECRET: "secretA",
    RAZORPAY_WEBHOOK_SECRET: "secretB",
    ...overrides,
  });
}

describe("env: baseline", () => {
  it("accepts a valid development env", () => {
    const env = parse(baseEnv());
    expect(env.appEnv).toBe("development");
  });
});

describe("env: no default for APP_ENV or PAYMENT_MODE", () => {
  it("rejects a missing APP_ENV rather than defaulting to development", () => {
    expect(() => parse(omit(baseEnv(), "APP_ENV"))).toThrow(EnvValidationError);
  });

  it("rejects a missing PAYMENT_MODE rather than defaulting to test", () => {
    expect(() => parse(omit(baseEnv(), "PAYMENT_MODE"))).toThrow(EnvValidationError);
  });
});

describe("env: DATABASE_URL must not carry ?schema=", () => {
  it("rejects ?schema= — pg_dump rejects it, so the backup fails only during an incident", () => {
    expect(() =>
      parse(baseEnv({ DATABASE_URL: "postgresql://u:p@host:5432/db?schema=public" })),
    ).toThrow(/schema=/);
  });

  it("rejects &schema= after another query param", () => {
    expect(() =>
      parse(baseEnv({ DATABASE_URL: "postgresql://u:p@host:5432/db?sslmode=require&schema=public" })),
    ).toThrow(/schema=/);
  });
});

describe("env: production requirements", () => {
  it("accepts a fully-configured production env", () => {
    expect(() => parse(prodBase())).not.toThrow();
  });

  it("rejects http:// APP_URL in production", () => {
    expect(() => parse(prodBase({ APP_URL: "http://groweazzy.example" }))).toThrow(/https/);
  });

  it("rejects DATABASE_SSL=false in production", () => {
    expect(() => parse(prodBase({ DATABASE_SSL: "false" }))).toThrow(/DATABASE_SSL/);
  });

  it("rejects a missing SENTRY_DSN in production", () => {
    const env = prodBase();
    delete env.SENTRY_DSN;
    expect(() => parse(env)).toThrow(/SENTRY_DSN/);
  });

  it("rejects PAYMENT_PROVIDER=mock in production", () => {
    expect(() => parse(prodBase({ PAYMENT_PROVIDER: "mock" }))).toThrow(/mock/);
  });
});

describe("env: Razorpay key/mode cross-check", () => {
  it("rejects a rzp_test_ key with PAYMENT_MODE=live", () => {
    expect(() =>
      parse(razorpayBase({ PAYMENT_MODE: "live", RAZORPAY_KEY_ID: "rzp_test_abc" })),
    ).toThrow(/rzp_test_/);
  });

  it("rejects a rzp_live_ key with PAYMENT_MODE=test", () => {
    expect(() =>
      parse(razorpayBase({ PAYMENT_MODE: "test", RAZORPAY_KEY_ID: "rzp_live_abc" })),
    ).toThrow(/rzp_live_/);
  });

  it("accepts a matching rzp_test_ key with PAYMENT_MODE=test", () => {
    expect(() =>
      parse(razorpayBase({ PAYMENT_MODE: "test", RAZORPAY_KEY_ID: "rzp_test_abc" })),
    ).not.toThrow();
  });

  it("rejects a key with neither recognized prefix", () => {
    expect(() =>
      parse(razorpayBase({ PAYMENT_MODE: "test", RAZORPAY_KEY_ID: "sk_live_abc" })),
    ).toThrow();
  });

  it("rejects RAZORPAY_WEBHOOK_SECRET equal to RAZORPAY_KEY_SECRET — separate dashboard pages", () => {
    expect(() =>
      parse(
        razorpayBase({
          PAYMENT_MODE: "test",
          RAZORPAY_KEY_ID: "rzp_test_abc",
          RAZORPAY_KEY_SECRET: "sameSecret",
          RAZORPAY_WEBHOOK_SECRET: "sameSecret",
        }),
      ),
    ).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
  });

  it("rejects razorpay provider missing key id/secret", () => {
    const env = baseEnv({ PAYMENT_PROVIDER: "razorpay", PAYMENT_MODE: "test" });
    expect(() => parse(env)).toThrow(/RAZORPAY_KEY_ID/);
  });
});
