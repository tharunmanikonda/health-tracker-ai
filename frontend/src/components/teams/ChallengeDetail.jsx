import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  ChevronLeft, Trophy, Calendar, Target, Users,
  Flame, Footprints, Droplets, Dumbbell, Moon, Activity
} from 'lucide-react'
import Leaderboard from './Leaderboard'
import { useAuth } from '../../contexts/AuthContext'

const metricIcons = {
  calories_burned: Flame,
  steps: Footprints,
  water_intake: Droplets,
  protein_goal: Dumbbell,
  workout_count: Activity,
  sleep_hours: Moon
}

function ChallengeDetail() {
  const { teamId, challengeId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [challenge, setChallenge] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    fetchData()
  }, [challengeId])

  const fetchData = async () => {
    try {
      const [challengeRes, leaderboardRes] = await Promise.all([
        axios.get(`/api/teams/${teamId}/challenges/${challengeId}`),
        axios.get(`/api/teams/${teamId}/challenges/${challengeId}/leaderboard`)
      ])
      setChallenge(challengeRes.data)
      setLeaderboard(leaderboardRes.data)
    } catch (err) {
      console.error('Failed to load challenge:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    setJoining(true)
    try {
      await axios.post(`/api/teams/${teamId}/challenges/${challengeId}/join`)
      fetchData()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading challenge...</p>
      </div>
    )
  }

  if (!challenge) return null

  const Icon = metricIcons[challenge.metric_type] || Activity
  const now = new Date()
  const start = new Date(challenge.start_date)
  const end = new Date(challenge.end_date)
  const isActive = start <= now && end >= now
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24))
  const daysLeft = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)))
  const daysElapsed = totalDays - daysLeft

  return (
    <div className="challenge-detail">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <button className="btn btn-icon btn-ghost" onClick={() => navigate(`/teams/${teamId}`)} style={{ width: '40px', height: '40px', minHeight: '40px', padding: '0.5rem' }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{challenge.name}</h2>
          {challenge.description && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{challenge.description}</p>
          )}
        </div>
      </div>

      {/* Challenge Info */}
      <div className="grid grid-3" style={{ marginBottom: '1rem' }}>
        <div className="stat-card" style={{ padding: '0.875rem', textAlign: 'center' }}>
          <div className="stat-icon purple" style={{ margin: '0 auto 0.5rem', width: '32px', height: '32px' }}>
            <Icon size={16} />
          </div>
          <div className="stat-value" style={{ fontSize: '1.125rem' }}>{challenge.target_value}</div>
          <div className="stat-label" style={{ fontSize: '0.65rem' }}>{challenge.target_unit}/day</div>
        </div>
        <div className="stat-card" style={{ padding: '0.875rem', textAlign: 'center' }}>
          <div className="stat-icon blue" style={{ margin: '0 auto 0.5rem', width: '32px', height: '32px' }}>
            <Calendar size={16} />
          </div>
          <div className="stat-value" style={{ fontSize: '1.125rem' }}>{isActive ? daysLeft : totalDays}</div>
          <div className="stat-label" style={{ fontSize: '0.65rem' }}>{isActive ? 'Days Left' : 'Total Days'}</div>
        </div>
        <div className="stat-card" style={{ padding: '0.875rem', textAlign: 'center' }}>
          <div className="stat-icon green" style={{ margin: '0 auto 0.5rem', width: '32px', height: '32px' }}>
            <Users size={16} />
          </div>
          <div className="stat-value" style={{ fontSize: '1.125rem' }}>{challenge.participant_count}</div>
          <div className="stat-label" style={{ fontSize: '0.65rem' }}>Participants</div>
        </div>
      </div>

      {/* Join button if not joined */}
      {!challenge.joined && challenge.is_active && (
        <button className="btn btn-primary btn-block mb-2" onClick={handleJoin} disabled={joining}>
          <Trophy size={18} /> {joining ? 'Joining...' : 'Join Challenge'}
        </button>
      )}

      {/* My Progress */}
      {challenge.joined && (
        <div className="card mb-2">
          <div className="section-header" style={{ marginBottom: '0.75rem' }}>
            <h3 className="section-title" style={{ fontSize: '0.875rem' }}>
              <Target size={16} /> My Progress
            </h3>
            <span className="badge badge-info">{Math.round(challenge.my_overall_percentage)}% avg</span>
          </div>

          {/* Daily progress list */}
          {challenge.my_progress && challenge.my_progress.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {challenge.my_progress.slice(0, 7).map(p => (
                <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '60px', flexShrink: 0 }}>
                    {new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="progress-bar" style={{ height: '6px' }}>
                      <div className="progress-fill purple" style={{ width: `${Math.min(p.percentage, 100)}%` }}></div>
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 600, minWidth: '40px', textAlign: 'right',
                    color: p.percentage >= 100 ? 'var(--success)' : 'var(--text-primary)'
                  }}>
                    {Math.round(p.percentage)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Progress updates every 15 minutes
            </div>
          )}
        </div>
      )}

      {/* Leaderboard */}
      <div className="section-header">
        <h3 className="section-title">
          <Trophy size={18} /> Leaderboard
        </h3>
      </div>
      <div className="card">
        <Leaderboard entries={leaderboard} currentUserId={user?.id} />
      </div>

      {/* Date info */}
      <div style={{ textAlign: 'center', padding: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {new Date(challenge.start_date).toLocaleDateString()} — {new Date(challenge.end_date).toLocaleDateString()}
        {isActive && ` (Day ${daysElapsed} of ${totalDays})`}
      </div>
    </div>
  )
}

export default ChallengeDetail
