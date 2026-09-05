import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/cron/release-commissions/route";

const URL = "http://localhost/api/cron/release-commissions";
// Matches tests/setup.ts's default.
const CRON_SECRET = process.env.CRON_SECRET!;

function post(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return POST(new Request(URL, { method: "POST", headers }));
}

describe("cron endpoint: authentication", () => {
  it("rejects a missing Authorization header with 401", async () => {
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("rejects a wrong secret with 401", async () => {
    const res = await post("Bearer not-the-real-secret");
    expect(res.status).toBe(401);
  });

  it("rejects a secret of the wrong length with 401 (not a crash)", async () => {
    const res = await post("Bearer short");
    expect(res.status).toBe(401);
  });

  it("accepts the correct secret and runs the scheduler", async () => {
    const res = await post(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("acquired");
    expect(body).toHaveProperty("itemsCandidate");
  });

  it("also accepts the bare secret without a Bearer prefix", async () => {
    const res = await post(CRON_SECRET);
    expect(res.status).toBe(200);
  });
});
