// Money helpers. All amounts are integer paise (1 rupee = 100 paise) so that
// totals and splits never suffer floating-point drift.

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const inrExact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paise as rupees. Whole-rupee amounts hide the decimals; others show both digits. */
export function formatMoney(paise) {
  const value = paise / 100;
  return paise % 100 === 0 ? inr.format(value) : inrExact.format(value);
}

/** Percentage of an integer-paise amount, rounded half up, using integer maths only. */
export function percentOf(paise, percent) {
  return Math.floor((paise * percent + 50) / 100);
}

/**
 * Split `totalPaise` across `count` people. Shares differ by at most one paisa
 * and always add back up to the total. Earlier people take the extra paise.
 */
export function splitEvenly(totalPaise, count) {
  if (!Number.isInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError("totalPaise must be a non-negative integer");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("count must be a positive integer");
  }
  const base = Math.floor(totalPaise / count);
  const extra = totalPaise - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}
