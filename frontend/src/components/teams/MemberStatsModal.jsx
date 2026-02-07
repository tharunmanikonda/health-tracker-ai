import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  X, Flame, Dumbbell, Droplets, Moon, Activity,
  Heart, Wind, Scale
} from 'lucide-react'

function MemberStatsModal({ teamId, userId, memberName, onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const res = await axios.get(`/api/teams/${teamId}/members/${userId}/stats`)
      setStats(res.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{memberName}'s Stats</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          {loading && (
            <div className="loading-container" style={{ padding: '2rem' }}>
              <div className="spinner"></div>
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--danger)', textAlign: 'center', padding: '2rem' }}>{error}</div>
          )}

          {stats && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Nutrition */}
              <div>
                <h4 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  <Flame size={14} style={{display: 'inline', verticalAlign: 'middle', marginRight: '4px'}} /> Nutrition
                </h4>
                <div className="grid grid-4" style={{ marginBottom: 0 }}>
                  <div className="stat-card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                    <div className="stat-value" style={{ fontSize: '1.125rem' }}>{Math.round(stats.nutrition.calories)}</div>
                    <div className="stat-label" style={{ fontSize: '0.65rem' }}>Calories</div>
                  </div>
                  <div className="stat-card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                    <div className="stat-value" style={{ fontSize: '1.125rem' }}>{Math.round(stats.nutrition.protein)}g</div>
                    <div className="stat-label" style={{ fontSize: '0.65rem' }}>Protein</div>
                  </div>
                  <div className="stat-card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                    <div className="stat-value" style={{ fontSize: '1.125rem' }}>{Math.round(stats.nutrition.carbs)}g</div>
                    <div className="stat-label" style={{ fontSize: '0.65rem' }}>Carbs</div>
                  </div>
                  <div className="stat-card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                    <div className="stat-value" style={{ fontSize: '1.125rem' }}>{Math.round(stats.nutrition.fat)}g</div>
                    <div className="stat-label" style={{ fontSize: '0.65rem' }}>Fat</div>
                  </div>
                </div>
              </div>

              {/* Water */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--glass-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                  <Droplets size={16} /> Water
                </span>
                <span style={{ fontWeight: 700 }}>{stats.water} ml</span>
              </div>

              {/* WHOOP */}
              {stats.whoop && (
                <div>
                  <h4 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    <Activity size={14} style={{display: 'inline', verticalAlign: 'middle', marginRight: '4px'}} /> WHOOP
                  </h4>
                  <div className="grid grid-3" style={{ marginBottom: 0 }}>
                    <div className="stat-card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <div className="stat-value" style={{ fontSize: '1.125rem' }}>{stats.whoop.recovery_score || '--'}%</div>
                      <div className="stat-label" style={{ fontSize: '0.65rem' }}>Recovery</div>
                    </div>
                    <div className="stat-card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <div className="stat-value" style={{ fontSize: '1.125rem' }}>{stats.whoop.hrv || '--'}</div>
                      <div className="stat-label" style={{ fontSize: '0.65rem' }}>HRV</div>
                    </div>
                    <div className="stat-card" style={{ padding: '0.75rem', textAlign: 'center' }}>
                      <div className="stat-value" style={{ fontSize: '1.125rem' }}>{stats.whoop.resting_hr || '--'}</div>
                      <div className="stat-label" style={{ fontSize: '0.65rem' }}>Rest HR</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sleep */}
              {stats.sleep && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--glass-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                    <Moon size={16} /> Sleep
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    {stats.sleep.duration ? `${Math.floor(stats.sleep.duration)}h ${Math.round((stats.sleep.duration % 1) * 60)}m` : '--'}
                  </span>
                </div>
              )}

              {/* Weight */}
              {stats.weight && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--glass-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                    <Scale size={16} /> Weight
                  </span>
                  <span style={{ fontWeight: 700 }}>{stats.weight.weight} {stats.weight.unit}</span>
                </div>
              )}

              {/* Workouts */}
              {stats.workouts && stats.workouts.length > 0 && (
                <div>
                  <h4 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                    <Dumbbell size={14} style={{display: 'inline', verticalAlign: 'middle', marginRight: '4px'}} /> Workouts
                  </h4>
                  {stats.workouts.map((w, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span>{w.type}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{w.duration} min {w.calories ? `• ${w.calories} cal` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default MemberStatsModal
