export function getStatus(p) {
  if (p.trackStock === false) return 'ok'
  if (p.qty <= 0) return 'critical'
  if (p.qty < p.reorder) return p.qty < p.reorder * 0.5 ? 'critical' : 'low'
  return 'ok'
}
