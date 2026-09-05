/**
 * Phase 12's commission release scheduler. `releaseMaturedCommissions`
 * does NOT simply release anything past its hold date — for each
 * candidate it re-verifies conversion status, affiliate status, and that
 * no payout already claims it, from source, inside a per-entry
 * transaction with a row lock and a repeated WHERE clause on the actual
 * UPDATE, so a refund landing mid-run makes that update a no-op rather
 * than a race.
 *
 * The advisory lock is held on a DEDICATED connection, not the shared
 * pool (`getDb()`). Postgres advisory locks are session-scoped and
 * re-entrant; through a pool, a second concurrent run could be handed the
 * very physical connection already holding the lock and sail straight
 * through it. A pooled advisory lock is worse than none — it looks like
 * mutual exclusion and isn't (spec's own mistake #12).
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, lte, isNull } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import * as schema from "@/lib/db/schema";
import { commissionEntries, affiliateConversions, affiliates, jobRuns } from "@/lib/db/schema";

// Arbitrary fixed key for this job's advisory lock. Postgres advisory
// locks are a flat 64-bit keyspace shared across every job that might
// ever use one — if a second scheduled job is added later, give it its
// own distinct key rather than reusing this one.
const ADVISORY_LOCK_KEY = 727_100_001;

const JOB_NAME = "release_matured_commissions";

export interface ReleaseSummary {
  /** false means another instance already holds the lock — this run did
   * nothing and that is the correct, safe outcome, not a failure. */
  acquired: boolean;
  itemsCandidate: number;
  itemsReleased: number;
  itemsSkipped: number;
  itemsFailed: number;
}

type LockDb = ReturnType<typeof drizzle<typeof schema>>;

export async function releaseMaturedCommissions(): Promise<ReleaseSummary> {
  const env = getEnv();
  const client = postgres(env.databaseUrl, {
    ssl: env.databaseSsl ? "require" : false,
    max: 1, // exactly one connection — this IS the dedicated connection the lock lives on
  });
  const lockDb = drizzle(client, { schema });

  try {
    const lockRows = await client`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS acquired`;
    const acquired = Boolean(lockRows[0]?.acquired);
    if (!acquired) {
      return { acquired: false, itemsCandidate: 0, itemsReleased: 0, itemsSkipped: 0, itemsFailed: 0 };
    }

    return await runRelease(lockDb);
  } finally {
    await client`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`.catch(() => {
      // Best-effort: the connection is about to close anyway, which
      // releases every advisory lock it holds regardless.
    });
    await client.end({ timeout: 5 });
  }
}

async function runRelease(lockDb: LockDb): Promise<ReleaseSummary> {
  const [jobRun] = await lockDb.insert(jobRuns).values({ jobName: JOB_NAME, status: "RUNNING" }).returning({ id: jobRuns.id });

  const now = new Date();
  let candidates: { id: string }[] = [];
  let released = 0;
  let skipped = 0;
  let failed = 0;

  try {
    candidates = await lockDb
      .select({ id: commissionEntries.id })
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.type, "EARNING"),
          eq(commissionEntries.status, "PENDING"),
          lte(commissionEntries.holdUntil, now),
        ),
      );

    for (const candidate of candidates) {
      try {
        const wasReleased = await releaseOneEntry(lockDb, candidate.id);
        if (wasReleased) released++;
        else skipped++;
      } catch (err) {
        // A single bad row must never abort the batch — logged, not
        // thrown, matching the spec's own hardening guidance.
        failed++;
        console.error(`${JOB_NAME}: entry ${candidate.id} failed`, err);
      }
    }

    if (jobRun) {
      await lockDb
        .update(jobRuns)
        .set({
          status: "SUCCEEDED",
          finishedAt: new Date(),
          itemsProcessed: candidates.length,
          itemsFailed: failed,
        })
        .where(eq(jobRuns.id, jobRun.id));
    }
  } catch (err) {
    if (jobRun) {
      await lockDb
        .update(jobRuns)
        .set({
          status: "FAILED",
          finishedAt: new Date(),
          itemsProcessed: candidates.length,
          itemsFailed: failed,
          errorSummary: err instanceof Error ? err.message : String(err),
        })
        .where(eq(jobRuns.id, jobRun.id));
    }
    throw err;
  }

  return { acquired: true, itemsCandidate: candidates.length, itemsReleased: released, itemsSkipped: skipped, itemsFailed: failed };
}

/**
 * One entry, one transaction, one row lock. Returns false for anything
 * that turns out — on fresh, locked, from-source verification — not to be
 * releasable right now; that is a normal, silent outcome, not an error.
 */
async function releaseOneEntry(lockDb: LockDb, entryId: string): Promise<boolean> {
  return lockDb.transaction(async (tx) => {
    const now = new Date();

    const [entry] = await tx
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.id, entryId))
      .for("update")
      .limit(1);
    if (!entry || entry.type !== "EARNING" || entry.status !== "PENDING") return false;
    if (!entry.holdUntil || entry.holdUntil.getTime() > now.getTime()) return false;
    if (entry.payoutId) return false; // a payout already claims this entry — never touch it here

    const [conversion] = await tx
      .select({ status: affiliateConversions.status })
      .from(affiliateConversions)
      .where(eq(affiliateConversions.id, entry.conversionId))
      .limit(1);
    if (!conversion || conversion.status !== "CONFIRMED") return false;

    const [affiliate] = await tx
      .select({ status: affiliates.status })
      .from(affiliates)
      .where(eq(affiliates.id, entry.affiliateId))
      .limit(1);
    if (!affiliate || affiliate.status !== "ACTIVE") return false;

    // The repeated WHERE clause on the actual UPDATE: even though the
    // FOR UPDATE above already serializes against any concurrent writer
    // for the lifetime of this transaction, this is the belt-and-braces
    // spec asks for explicitly — if any of these conditions somehow no
    // longer hold, this UPDATE affects zero rows and is a no-op rather
    // than corrupting state.
    const updated = await tx
      .update(commissionEntries)
      .set({ status: "AVAILABLE", updatedAt: new Date() })
      .where(
        and(
          eq(commissionEntries.id, entryId),
          eq(commissionEntries.status, "PENDING"),
          lte(commissionEntries.holdUntil, now),
          isNull(commissionEntries.payoutId),
        ),
      )
      .returning({ id: commissionEntries.id });
    if (updated.length === 0) return false;

    // Co-release any sibling REVERSAL rows still PENDING for this
    // conversion, atomically with the earning — see engine.ts's module
    // doc for why this pairing matters.
    await tx
      .update(commissionEntries)
      .set({ status: "AVAILABLE", updatedAt: new Date() })
      .where(
        and(
          eq(commissionEntries.conversionId, entry.conversionId),
          eq(commissionEntries.type, "REVERSAL"),
          eq(commissionEntries.status, "PENDING"),
        ),
      );

    return true;
  });
}
