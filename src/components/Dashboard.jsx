import { getStatus } from '../utils/status'

export default function Dashboard({ products }) {
  const ok           = products.filter(p => getStatus(p) === 'ok').length
  const low          = products.filter(p => getStatus(p) === 'low').length
  const crit         = products.filter(p => getStatus(p) === 'critical').length
  const soldAllTime  = products.reduce((a, p) => a + (p.sold || 0), 0)
  const soldThisWeek = products.reduce((a, p) => a + Math.max(0, (p.lastQty || p.qty) - p.qty), 0)

  const cards = [
    { label: 'Total products',  value: products.length, color: '#185FA5', sub: null },
    { label: 'In stock (OK)',   value: ok,              color: '#0F6E56', sub: null },
    { label: 'Low / critical',  value: low + crit,      color: '#A32D2D', sub: null },
    { label: 'Used this week',  value: soldThisWeek,    color: '#5B21B6', sub: 'units — latest count only' },
    { label: 'Used all time',   value: soldAllTime,     color: '#92400E', sub: 'units — since app started' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: '1.25rem' }}>
      {cards.map(c => (
        <div key={c.label} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.value}</div>
          {c.sub && <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  )
}
