import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ChevronLeft, ChevronDown, ChevronUp, Dumbbell, UtensilsCrossed } from 'lucide-react'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function TrainerDashboard() {
  const { teamId, planId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedMember, setExpandedMember] = useState(null)

  useEffect(() => {
    fetchDashboard()
  }, [teamId, planId])

  const fetchDashboard = async () => {
    try {
      const res = await axios.get(`/api/teams/${teamId}/plans/${planId}/dashboard`)
      setData(res.data)
    } catch (err) {
      console.error('Dashboard error:', err)
    } finally {
      setLoading(false)
    }
  }

  const getDayStatus = (day) => {
    const hasWorkout = day.dayWorkoutTotal > 0
    const hasFood = day.dayCalorieTarget > 0

    if (!hasWorkout && !hasFood) return 'empty'

    const workoutDone = !hasWorkout || day.workoutPct === 100
    const foodDone = !hasFood || day.foodPct >= 80

    if (workoutDone && foodDone) return 'complete'
    if (day.workoutsCompleted > 0 || day.caloriesLogged > 0) return 'partial'
    return 'empty'
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    )
  }

  if (!data) return null

  const weekRange = data.week_dates?.length >= 2
    ? `${new Date(data.week_dates[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(data.week_dates[6]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : ''

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <button className="btn btn-icon btn-ghost" onClick={() => navigate(`/teams/${teamId}`)} style={{ width: '40px', height: '40px', minHeight: '40px', padding: '0.5rem' }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>{data.plan?.title}</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{weekRange}</p>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--success)', display: 'inline-block' }}></span>
          Complete
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--warning)', display: 'inline-block' }}></span>
          Partial
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--bg-tertiary)', display: 'inline-block' }}></span>
          Nothing
        </span>
      </div>

      {/* Members */}
      {data.members?.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          No members assigned to this plan
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {data.members?.map(member => {
          const isExpanded = expandedMember === member.user_id
          return (
            <div key={member.user_id} className="trainer-member-card">
              <div
                onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.name}</span>
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>

                {/* Week Grid */}
                <div className="trainer-week-grid">
                  {member.days.map((day, i) => {
                    const status = getDayStatus(day)
                    return (
                      <div key={i} className="trainer-day-cell-wrapper">
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.25rem' }}>
                          {DAY_LABELS[i]}
                        </div>
                        <div className={`trainer-day-cell ${status}`} />
                      </div>
                    )
                  })}
                </div>

                {/* Summary */}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span>
                    <Dumbbell size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {member.workout_days_completed}/{member.workout_days_total} days
                  </span>
                  <span>
                    <UtensilsCrossed size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {member.avg_food_compliance}% avg
                  </span>
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--glass-border)', paddingTop: '0.75rem' }}>
                  {member.days.map((day, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.375rem 0', fontSize: '0.8rem' }}>
                      <span style={{ width: '30px', fontWeight: 500 }}>{DAY_LABELS[i]}</span>
                      <div style={{ flex: 1 }}>
                        {day.dayWorkoutTotal > 0 ? (
                          <span style={{ color: day.workoutPct === 100 ? 'var(--success)' : day.workoutPct > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                            {day.workoutsCompleted}/{day.dayWorkoutTotal} exercises
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Rest</span>
                        )}
                      </div>
                      <div>
                        {day.dayCalorieTarget > 0 ? (
                          <span style={{ color: day.foodPct >= 80 ? 'var(--success)' : day.foodPct > 0 ? 'var(--warning)' : 'var(--text-muted)', fontSize: '0.75rem' }}>
                            {day.caloriesLogged}/{day.dayCalorieTarget} cal
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default TrainerDashboard
