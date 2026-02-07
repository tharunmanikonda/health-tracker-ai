import { Trophy, Medal } from 'lucide-react'

function Leaderboard({ entries, currentUserId }) {
  if (!entries || entries.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
        No participants yet
      </div>
    )
  }

  return (
    <div className="leaderboard">
      {entries.map((entry) => {
        const isMe = entry.user_id === currentUserId
        const isTop3 = entry.rank <= 3
        const rankColors = { 1: '#f59e0b', 2: '#94a3b8', 3: '#cd7f32' }

        return (
          <div
            key={entry.user_id}
            className="leaderboard-row"
            style={{
              background: isMe ? 'rgba(14, 165, 233, 0.08)' : 'var(--glass-bg)',
              border: isMe ? '1px solid rgba(14, 165, 233, 0.2)' : '1px solid var(--glass-border)',
            }}
          >
            <div className="leaderboard-rank" style={{ color: rankColors[entry.rank] || 'var(--text-muted)' }}>
              {isTop3 ? (
                <Trophy size={18} />
              ) : (
                <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>#{entry.rank}</span>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: isMe ? 700 : 500, fontSize: '0.9375rem' }}>
                {entry.name}{isMe ? ' (You)' : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '80px' }}>
                <div className="progress-bar" style={{ height: '6px' }}>
                  <div
                    className="progress-fill purple"
                    style={{ width: `${Math.min(entry.percentage, 100)}%` }}
                  ></div>
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: '0.875rem',
                color: entry.percentage >= 100 ? 'var(--success)' : 'var(--text-primary)',
                minWidth: '45px',
                textAlign: 'right'
              }}>
                {Math.round(entry.percentage)}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default Leaderboard
