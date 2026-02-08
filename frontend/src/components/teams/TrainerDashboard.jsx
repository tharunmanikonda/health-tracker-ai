import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronUp, Dumbbell, UtensilsCrossed } from 'lucide-react'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const pct = (value, fallback = null) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.round(parsed)
}

const getWorkoutStatus = (day) => {
  if (!day.dayWorkoutTotal) return 'na'
  if ((day.workoutPct || 0) >= 100) return 'complete'
  if ((day.workoutsCompleted || 0) > 0 || (day.workoutPct || 0) > 0) return 'partial'
  return 'missed'
}

const getNutritionStatus = (day) => {
  if (!day.dayCalorieTarget) return 'na'
  if ((day.foodPct || 0) >= 80) return 'complete'
  if ((day.caloriesLogged || 0) > 0 || (day.foodPct || 0) > 0) return 'partial'
  return 'missed'
}

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

  const sortedMembers = useMemo(() => {
    const members = [...(data.members || [])]
    members.sort((a, b) => {
      if (!!a.needs_attention !== !!b.needs_attention) {
        return a.needs_attention ? -1 : 1
      }
      const aCompliance = Number.isFinite(Number(a.overall_compliance)) ? Number(a.overall_compliance) : 101
      const bCompliance = Number.isFinite(Number(b.overall_compliance)) ? Number(b.overall_compliance) : 101
      return aCompliance - bCompliance
    })
    return members
  }, [data.members])

  const summary = data.summary || {}
  const membersCount = summary.total_members ?? sortedMembers.length

  return (
    <div className="td-root">
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

      <div className="td-stats-row">
        <div className="td-stat-pill">
          <span className="td-stat-label">Members</span>
          <span className="td-stat-value">{membersCount}</span>
        </div>
        <div className="td-stat-pill">
          <span className="td-stat-label">Overall</span>
          <span className="td-stat-value">{pct(summary.avg_overall_compliance, 0)}%</span>
        </div>
        <div className="td-stat-pill">
          <span className="td-stat-label">Workout</span>
          <span className="td-stat-value">{pct(summary.avg_workout_completion, 0)}%</span>
        </div>
        <div className="td-stat-pill">
          <span className="td-stat-label">Nutrition</span>
          <span className="td-stat-value">{pct(summary.avg_nutrition_compliance, 0)}%</span>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.7rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--success)', display: 'inline-block' }}></span>
          Complete (workout/food)
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
        {sortedMembers.map(member => {
          const isExpanded = expandedMember === member.user_id
          const nutrition = member.weekly_nutrition || {}
          return (
            <div key={member.user_id} className="trainer-member-card">
              <div
                onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="td-member-header">
                  <div className="td-member-title-wrap">
                    <span className="td-member-name">{member.name}</span>
                    {member.needs_attention && (
                      <span className="td-attention-pill">
                        <AlertTriangle size={12} />
                        Attention
                      </span>
                    )}
                  </div>
                  <div className="td-member-metrics">
                    <span className="td-member-metric">{pct(member.overall_compliance, 0)}% overall</span>
                    <span className="td-member-metric">{member.missed_days || 0} missed</span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* Week Grid */}
                <div className="trainer-week-grid">
                  {member.days.map((day, i) => {
                    const workoutStatus = getWorkoutStatus(day)
                    const nutritionStatus = getNutritionStatus(day)
                    return (
                      <div key={i} className="trainer-day-cell-wrapper">
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.25rem' }}>
                          {DAY_LABELS[i]}
                        </div>
                        <div className="td-split-cell">
                          <div className={`td-split-half td-workout-${workoutStatus}`} />
                          <div className={`td-split-half td-nutrition-${nutritionStatus}`} />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Summary */}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span className="td-summary-chip">
                    <Dumbbell size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {member.workout_days_completed}/{member.workout_days_total} days
                  </span>
                  <span className="td-summary-chip">
                    <UtensilsCrossed size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {member.avg_food_compliance}% avg
                  </span>
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--glass-border)', paddingTop: '0.75rem' }}>
                  {member.days.map((day, i) => {
                    const workoutStatus = getWorkoutStatus(day)
                    const nutritionStatus = getNutritionStatus(day)
                    return (
                      <div key={i} className="td-day-detail-row">
                        <span className="td-day-label">{DAY_LABELS[i]}</span>
                        <div className="td-day-detail-main">
                          {day.dayWorkoutTotal > 0 ? (
                            <span className={`td-text-${workoutStatus}`}>{day.workoutsCompleted}/{day.dayWorkoutTotal} exercises</span>
                          ) : (
                            <span className="td-text-muted">Rest</span>
                          )}
                        </div>
                        <div className="td-day-detail-nutrition">
                          {day.dayCalorieTarget > 0 ? (
                            <>
                              <span className={`td-text-${nutritionStatus}`}>{day.caloriesLogged}/{day.dayCalorieTarget} cal</span>
                              <div className="td-macro-chip-row">
                                <span className="td-macro-chip">P {Math.round(day.proteinLogged || 0)}g</span>
                                <span className="td-macro-chip">C {Math.round(day.carbsLogged || 0)}g</span>
                                <span className="td-macro-chip">F {Math.round(day.fatLogged || 0)}g</span>
                              </div>
                            </>
                          ) : (
                            <span className="td-text-muted">—</span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  <div className="td-weekly-nutrition">
                    <h4 className="td-weekly-title">Weekly Nutrition Summary</h4>
                    {[
                      ['Protein', nutrition.protein],
                      ['Carbs', nutrition.carbs],
                      ['Fat', nutrition.fat]
                    ].map(([label, row]) => {
                      const macro = row || {}
                      const macroPct = Math.max(0, Math.min(100, pct(macro.pct, 0)))
                      return (
                        <div key={label} className="td-macro-row">
                          <div className="td-macro-row-top">
                            <span>{label}</span>
                            <span>{Math.round(macro.logged || 0)}g / {Math.round(macro.target || 0)}g</span>
                          </div>
                          <div className="td-progress-track">
                            <div className="td-progress-fill" style={{ width: `${macroPct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
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
