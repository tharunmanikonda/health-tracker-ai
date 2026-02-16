import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ChevronLeft, ChevronDown, ChevronUp, Dumbbell, UtensilsCrossed, AlertTriangle, Users, Watch, AlertCircle } from 'lucide-react'

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

  const getWorkoutStatus = (day) => {
    if (day.dayWorkoutTotal === 0) return 'empty'
    if (day.workoutPct === 100) return 'complete'
    if (day.workoutsCompleted > 0) return 'partial'
    return 'empty'
  }

  const getNutritionStatus = (day) => {
    if (day.dayCalorieTarget === 0) return 'empty'
    if (day.foodPct >= 80) return 'complete'
    if (day.caloriesLogged > 0) return 'partial'
    return 'empty'
  }

  const sortedMembers = useMemo(() => {
    if (!data?.members) return []
    return [...data.members].sort((a, b) => {
      if (a.needs_attention && !b.needs_attention) return -1
      if (!a.needs_attention && b.needs_attention) return 1
      const aComp = a.overall_compliance ?? 100
      const bComp = b.overall_compliance ?? 100
      return aComp - bComp
    })
  }, [data?.members])

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

  const summary = data.summary

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

      {/* Team Stats Row */}
      {summary && (
        <div className="td-stats-row">
          <div className="td-stat-pill">
            <span className="td-stat-value">{summary.total_members}</span>
            <span className="td-stat-label"><Users size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Members</span>
          </div>
          <div className="td-stat-pill">
            <span className="td-stat-value">{summary.avg_overall_compliance}%</span>
            <span className="td-stat-label">Overall</span>
          </div>
          <div className="td-stat-pill">
            <span className="td-stat-value">{summary.avg_workout_completion}%</span>
            <span className="td-stat-label"><Dumbbell size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Workout</span>
          </div>
          <div className="td-stat-pill">
            <span className="td-stat-value">{summary.avg_nutrition_compliance}%</span>
            <span className="td-stat-label"><UtensilsCrossed size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Nutrition</span>
          </div>
        </div>
      )}

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
      {sortedMembers.length === 0 && (
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.name}</span>
                    {member.needs_attention && (
                      <span className="td-attention-badge">
                        <AlertTriangle size={10} /> Attention
                      </span>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>

                {/* Week Grid - Split cells */}
                <div className="trainer-week-grid">
                  {member.days.map((day, i) => {
                    const wStatus = getWorkoutStatus(day)
                    const nStatus = getNutritionStatus(day)
                    return (
                      <div key={i} className="trainer-day-cell-wrapper">
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.25rem' }}>
                          {DAY_LABELS[i]}
                        </div>
                        <div className="td-day-cell-split" style={{ position: 'relative' }}>
                          <div className={`td-day-half-top ${wStatus}`} />
                          <div className={`td-day-half-bottom ${nStatus}`} />
                          {day.verifiedCount > 0 && (
                            <span className="td-cell-verified-indicator"><Watch size={8} /></span>
                          )}
                          {day.verifiedCount === 0 && day.conflictingCount > 0 && (
                            <span className="td-cell-conflicting-indicator"><AlertCircle size={8} /></span>
                          )}
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
                  {member.overall_compliance !== null && (
                    <span style={{ marginLeft: 'auto', fontWeight: 500 }}>
                      {member.overall_compliance}% overall
                    </span>
                  )}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span style={{ color: day.workoutPct === 100 ? 'var(--success)' : day.workoutPct > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                              {day.workoutsCompleted}/{day.dayWorkoutTotal} exercises
                            </span>
                            {day.verifiedCount > 0 && (
                              <span className="td-verified-badge">
                                <Watch size={10} /> Verified
                              </span>
                            )}
                            {day.verifiedCount === 0 && day.conflictingCount > 0 && (
                              <span className="td-conflicting-badge">
                                <AlertCircle size={10} /> Type mismatch
                              </span>
                            )}
                            {day.verifiedCount === 0 && day.conflictingCount === 0 && day.noWearableCount > 0 && (
                              <span className="td-wearable-detail">No wearable data</span>
                            )}
                            {day.wearableDetail && (
                              <span className="td-wearable-detail">
                                {day.wearableDetail.workoutType && `${day.wearableDetail.workoutType}`}
                                {day.wearableDetail.duration && ` ${day.wearableDetail.duration}min`}
                                {day.wearableDetail.calories && ` ${Math.round(day.wearableDetail.calories)}cal`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Rest</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {day.dayCalorieTarget > 0 ? (
                          <>
                            <span style={{ color: day.foodPct >= 80 ? 'var(--success)' : day.foodPct > 0 ? 'var(--warning)' : 'var(--text-muted)', fontSize: '0.75rem' }}>
                              {day.caloriesLogged}/{day.dayCalorieTarget} cal
                            </span>
                            {(day.proteinTarget > 0 || day.carbsTarget > 0 || day.fatTarget > 0) && (
                              <div className="td-day-macros">
                                {day.proteinTarget > 0 && <span className="td-macro-chip protein">P {Math.round(day.proteinLogged)}g</span>}
                                {day.carbsTarget > 0 && <span className="td-macro-chip carbs">C {Math.round(day.carbsLogged)}g</span>}
                                {day.fatTarget > 0 && <span className="td-macro-chip fat">F {Math.round(day.fatLogged)}g</span>}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>--</span>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Weekly Nutrition Summary */}
                  {member.weekly_nutrition && (member.weekly_nutrition.target_protein > 0 || member.weekly_nutrition.target_carbs > 0 || member.weekly_nutrition.target_fat > 0) && (
                    <div className="td-nutrition-summary">
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                        Weekly Nutrition Avg
                      </div>
                      {member.weekly_nutrition.target_protein > 0 && (
                        <MacroBar
                          label="Protein"
                          actual={member.weekly_nutrition.avg_protein}
                          target={member.weekly_nutrition.target_protein}
                          colorClass="protein"
                        />
                      )}
                      {member.weekly_nutrition.target_carbs > 0 && (
                        <MacroBar
                          label="Carbs"
                          actual={member.weekly_nutrition.avg_carbs}
                          target={member.weekly_nutrition.target_carbs}
                          colorClass="carbs"
                        />
                      )}
                      {member.weekly_nutrition.target_fat > 0 && (
                        <MacroBar
                          label="Fat"
                          actual={member.weekly_nutrition.avg_fat}
                          target={member.weekly_nutrition.target_fat}
                          colorClass="fat"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MacroBar({ label, actual, target, colorClass }) {
  const pct = target > 0 ? Math.min(Math.round((actual / target) * 100), 150) : 0
  const displayPct = Math.min(pct, 100)

  return (
    <div className="td-macro-row">
      <span className="td-macro-label">{label}</span>
      <div className="td-macro-bar">
        <div
          className={`td-macro-fill ${colorClass}`}
          style={{ width: `${displayPct}%` }}
        />
      </div>
      <span className="td-macro-value">{actual}g / {target}g ({pct}%)</span>
    </div>
  )
}

export default TrainerDashboard
