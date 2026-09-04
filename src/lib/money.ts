/**
 * All money in this codebase is integer paise, stored as BIGINT. Never a
 * float, never rupees, in the database or in any calculation — Rule 1.
 * These helpers exist so "convert paise to a rupee string for display" has
 * exactly one implementation.
 */

export function isValidPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function assertPaise(value: number, label = "amount"): void {
  if (!isValidPaise(value)) {
    throw new TypeError(`${label} must be an integer number of paise, got ${String(value)}`);
  }
}

/** Formats paise as an INR display string, e.g. 250_0000 -> "₹25,000.00". */
export function formatPaiseAsInr(paise: number): string {
  assertPaise(paise, "paise");
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Whole-rupee input (e.g. an admin form field) to integer paise. Rejects
 * fractional paise (more than 2 decimal digits) rather than silently
 * truncating it. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) {
    throw new TypeError(`rupees must be a non-negative finite number, got ${String(rupees)}`);
  }
  const paise = Math.round(rupees * 100);
  if (Math.abs(paise / 100 - rupees) > 1e-9) {
    throw new TypeError(`rupees value has sub-paise precision: ${rupees}`);
  }
  return paise;
}

/**
 * Computes a proportional share in basis points (1..10000), rounded down
 * (floor) so repeated proportional reversals can never sum to more than
 * the original amount — Rule 10: partial refunds reverse a proportional
 * share of commission, derived from the provider's cumulative refunded
 * amount, never a locally-incremented counter.
 */
export function proportionalSharePaise(totalPaise: number, numerator: number, denominator: number): number {
  assertPaise(totalPaise, "totalPaise");
  if (denominator <= 0) throw new TypeError("denominator must be positive");
  if (numerator < 0 || numerator > denominator) {
    throw new TypeError("numerator must be between 0 and denominator");
  }
  return Math.floor((totalPaise * numerator) / denominator);
}
