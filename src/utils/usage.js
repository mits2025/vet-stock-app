export const USAGE_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export function getUsageInLastDays(product, days = USAGE_WINDOW_DAYS, now = new Date()) {
  const cutoff = now.getTime() - days * DAY_MS

  return (product.countHistory || []).reduce((sum, entry) => {
    const date = new Date(entry.date)
    const time = date.getTime()
    if (Number.isNaN(time) || time < cutoff || time > now.getTime()) return sum
    return sum + Math.max(0, Number(entry.usedWeek) || 0)
  }, 0)
}

export function getUsageInLastDaysWithPendingCount(product, newQty, days = USAGE_WINDOW_DAYS, now = new Date()) {
  const oldQty = Number(product.qty) || 0
  const countedQty = Number(newQty)
  if (!Number.isFinite(countedQty) || countedQty === oldQty) {
    return getUsageInLastDays(product, days, now)
  }

  return getUsageInLastDays({
    ...product,
    countHistory: [
      ...(product.countHistory || []),
      {
        date: now.toISOString(),
        usedWeek: Math.max(0, oldQty - countedQty),
      },
    ],
  }, days, now)
}
