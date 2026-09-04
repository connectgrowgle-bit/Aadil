import { describe, it, expect } from "vitest";
import {
  isValidPaise,
  assertPaise,
  formatPaiseAsInr,
  rupeesToPaise,
  proportionalSharePaise,
} from "@/lib/money";

describe("money: paise validation", () => {
  it("accepts integers", () => {
    expect(isValidPaise(0)).toBe(true);
    expect(isValidPaise(150_000)).toBe(true);
    expect(isValidPaise(-500)).toBe(true); // reversal rows are negative
  });

  it("rejects non-integers — a rupee value where paise is expected is a 100x error", () => {
    expect(isValidPaise(150.5)).toBe(false);
    expect(isValidPaise(NaN)).toBe(false);
    expect(isValidPaise(Infinity)).toBe(false);
    expect(isValidPaise("15000")).toBe(false);
  });

  it("assertPaise throws on a fractional value", () => {
    expect(() => assertPaise(99.99, "orderAmount")).toThrow(/orderAmount/);
  });
});

describe("money: formatPaiseAsInr", () => {
  it("formats a whole-rupee amount", () => {
    expect(formatPaiseAsInr(1_500_000)).toBe("₹15,000.00");
  });

  it("formats paise-level precision", () => {
    expect(formatPaiseAsInr(150_050)).toBe("₹1,500.50");
  });

  it("formats zero", () => {
    expect(formatPaiseAsInr(0)).toBe("₹0.00");
  });

  it("throws on a non-integer input rather than silently truncating", () => {
    expect(() => formatPaiseAsInr(150.5)).toThrow();
  });
});

describe("money: rupeesToPaise", () => {
  it("round-trips a clean rupee amount", () => {
    expect(rupeesToPaise(2000)).toBe(200_000);
    expect(rupeesToPaise(25.5)).toBe(2_550);
  });

  it("rejects negative input", () => {
    expect(() => rupeesToPaise(-1)).toThrow();
  });
});

describe("money: proportionalSharePaise (partial refund reversal)", () => {
  it("computes an exact half", () => {
    expect(proportionalSharePaise(150_000, 1, 2)).toBe(75_000);
  });

  it("floors rather than rounds, so repeated partial reversals never exceed the original", () => {
    // 10000 paise commission, refunded in three unequal thirds.
    const total = 10_000;
    const shares = [
      proportionalSharePaise(total, 1, 3),
      proportionalSharePaise(total, 1, 3),
      proportionalSharePaise(total, 1, 3),
    ];
    const sum = shares.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(total);
    expect(shares.every((s) => Number.isInteger(s))).toBe(true);
  });

  it("a full refund (numerator == denominator) reverses the entire amount", () => {
    expect(proportionalSharePaise(123_456, 5, 5)).toBe(123_456);
  });

  it("a zero refund reverses nothing", () => {
    expect(proportionalSharePaise(123_456, 0, 5)).toBe(0);
  });

  it("rejects a numerator larger than the denominator — cannot refund more than was paid", () => {
    expect(() => proportionalSharePaise(1000, 6, 5)).toThrow();
  });
});
