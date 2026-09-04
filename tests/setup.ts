/**
 * Runs before every test file. Sets environment variables the suite needs
 * ONLY if they aren't already set, so CI can override with real secrets
 * without this file fighting it. Every suite here runs against a real
 * PostgreSQL database — DATABASE_URL must point at a disposable database
 * (defaults to groweazzy_test), never production.
 */
function setDefault(key: string, value: string) {
  if (!process.env[key]) process.env[key] = value;
}

setDefault("APP_ENV", "development");
setDefault("APP_URL", "http://localhost:3000");
setDefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/groweazzy_test");
setDefault("DATABASE_SSL", "false");
setDefault("SESSION_SECRET", "test-session-secret-not-for-production-use-0000000000");
setDefault("PII_ENCRYPTION_KEY", "0".repeat(64));
setDefault("PAYMENT_PROVIDER", "mock");
setDefault("PAYMENT_MODE", "test");
setDefault("CRON_SECRET", "test-cron-secret");
setDefault("EMAIL_PROVIDER", "console");
setDefault("STORAGE_DRIVER", "local");
setDefault("TRUSTED_PROXY_HEADER", "x-real-ip");
