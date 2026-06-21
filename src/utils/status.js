export function getStatus(p) {
  if (p.qty <= 0) return 'critical'
  if (p.qty < p.reorder) return p.qty < p.reorder * 0.5 ? 'critical' : 'low'
  return 'ok'
}
