import { Flame, Footprints, Droplets, Dumbbell, Moon, Activity, Calendar } from 'lucide-react'

const metricIcons = {
  calories_burned: Flame,
  steps: Footprints,
  water_intake: Droplets,
  protein_goal: Dumbbell,
  workout_count: Activity,
  sleep_hours: Moon
}

const metricLabels = {
  calories_burned: 'Calories Burned',
  steps: 'Steps',
  water_intake: 'Water Intake',
  protein_goal: 'Protein',
  workout_count: 'Workouts',
  sleep_hours: 'Sleep'
}

function ChallengeCard({ challenge, onClick }) {
  const Icon = metricIcons[challenge.metric_type] || Activity
  const label = metricLabels[challenge.metric_type] || challenge.metric_type
  const pct = Math.round(challenge.today_percentage || challenge.overall_percentage || 0)

  const now = new Date()
  const start = new Date(challenge.start_date)
  const end = new Date(challenge.end_date)
  const isActive = start <= now && end >= now
  const isUpcoming = start > now
  const daysLeft = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)))

  return (
    <div className="challenge-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className="stat-header">
        <div className="stat-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'var(--secondary)' }}>
          <Icon size={18} />
        </div>
        <span className={`badge ${isActive ? 'badge-success' : isUpcoming ? 'badge-info' : 'badge-warning'}`}>
          {isActive ? `${daysLeft}d left` : isUpcoming ? 'Upcoming' : 'Ended'}
        </span>
      </div>
      <h4 style={{ fontFamily: 'var(--font-heading)', fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.25rem' }}>
        {challenge.name}
      </h4>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {label} — {challenge.target_value} {challenge.target_unit}/day
      </div>
      {isActive && (
        <>
          <div className="progress-bar">
            <div className="progress-fill purple" style={{ width: `${Math.min(pct, 100)}%` }}></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span>{pct}% today</span>
            {challenge.participant_count && <span>{challenge.participant_count} participants</span>}
          </div>
        </>
      )}
      {challenge.my_rank && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--primary)' }}>
          Rank #{challenge.my_rank} of {challenge.total_participants}
        </div>
      )}
    </div>
  )
}

export default ChallengeCard
