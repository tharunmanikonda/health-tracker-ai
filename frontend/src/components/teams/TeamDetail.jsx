import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  Users, Trophy, Crown, Copy, RefreshCw, Plus,
  ChevronLeft, Settings, UserMinus, LogOut, Eye,
  Check
} from 'lucide-react'
import ChallengeCard from './ChallengeCard'
import CreateChallengeModal from './CreateChallengeModal'
import MemberStatsModal from './MemberStatsModal'

const quickPlanTemplates = [
  { label: '7d Steps', metric_type: 'steps', target_value: 10000, target_unit: 'steps', duration_days: 7 },
  { label: '7d Burn', metric_type: 'calories_burned', target_value: 500, target_unit: 'kcal', duration_days: 7 },
  { label: '14d Water', metric_type: 'water_intake', target_value: 2500, target_unit: 'ml', duration_days: 14 }
]

function formatDateForInput(date) {
  return date.toISOString().split('T')[0]
}

function getDatePlusDays(startDate, daysToAdd) {
  const date = new Date(`${startDate}T00:00:00`)
  date.setDate(date.getDate() + daysToAdd)
  return formatDateForInput(date)
}

function TeamDetail() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateChallenge, setShowCreateChallenge] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [copied, setCopied] = useState(false)
  const [memberStats, setMemberStats] = useState(null)
  const [quickCreating, setQuickCreating] = useState('')

  useEffect(() => {
    fetchTeam()
  }, [teamId])

  const fetchTeam = async () => {
    try {
      const res = await axios.get(`/api/teams/${teamId}`)
      setTeam(res.data)
      setEditName(res.data.name)
      setEditDesc(res.data.description || '')
    } catch (err) {
      console.error('Failed to load team:', err)
      if (err.response?.status === 403) navigate('/teams')
    } finally {
      setLoading(false)
    }
  }

  const copyInvite = () => {
    navigator.clipboard.writeText(team.invite_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const regenerateInvite = async () => {
    try {
      const res = await axios.post(`/api/teams/${teamId}/regenerate-invite`)
      setTeam({ ...team, invite_code: res.data.invite_code })
    } catch (err) {
      alert('Failed to regenerate invite code')
    }
  }

  const createChallenge = async (data, closeModal = true) => {
    try {
      await axios.post(`/api/teams/${teamId}/challenges`, data)
      if (closeModal) {
        setShowCreateChallenge(false)
      }
      fetchTeam()
      return true
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create challenge')
      return false
    }
  }

  const handleCreateChallenge = async (data) => createChallenge(data, true)

  const handleQuickCreate = async (template) => {
    const today = formatDateForInput(new Date())
    const endDate = getDatePlusDays(today, template.duration_days - 1)
    const name = `${template.duration_days}-Day ${template.label} (${template.target_value} ${template.target_unit}/day)`

    setQuickCreating(template.label)
    await createChallenge({
      name,
      description: null,
      metric_type: template.metric_type,
      target_value: template.target_value,
      target_unit: template.target_unit,
      start_date: today,
      end_date: endDate
    }, false)
    setQuickCreating('')
  }

  const handleUpdateTeam = async () => {
    try {
      await axios.put(`/api/teams/${teamId}`, { name: editName, description: editDesc })
      setShowSettings(false)
      fetchTeam()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update')
    }
  }

  const handleLeave = async () => {
    if (!window.confirm('Are you sure you want to leave this team?')) return
    try {
      await axios.delete(`/api/teams/${teamId}/leave`)
      navigate('/teams')
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to leave team')
    }
  }

  const handleKick = async (userId, name) => {
    if (!window.confirm(`Remove ${name} from the team?`)) return
    try {
      await axios.delete(`/api/teams/${teamId}/members/${userId}`)
      fetchTeam()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove member')
    }
  }

  const handlePromote = async (userId, currentRole) => {
    const newRole = currentRole === 'leader' ? 'member' : 'leader'
    try {
      await axios.put(`/api/teams/${teamId}/members/${userId}/role`, { role: newRole })
      fetchTeam()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update role')
    }
  }

  const handleDeleteTeam = async () => {
    if (!window.confirm('Are you sure you want to delete this team? This cannot be undone.')) return
    try {
      await axios.delete(`/api/teams/${teamId}`)
      navigate('/teams')
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete team')
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading team...</p>
      </div>
    )
  }

  if (!team) return null

  const isLeader = team.my_role === 'leader'
  const activeChallenges = (team.challenges || []).filter(c => {
    const now = new Date()
    return c.is_active && new Date(c.start_date) <= now && new Date(c.end_date) >= now
  })
  const otherChallenges = (team.challenges || []).filter(c => !activeChallenges.includes(c))

  return (
    <div className="team-detail">
      {/* Header */}
      <div className="page-header page-header-with-back">
        <button className="btn btn-icon btn-ghost page-back-btn" onClick={() => navigate('/teams')}>
          <ChevronLeft size={20} />
        </button>
        <div className="page-header-copy">
          <h2 className="page-title">{team.name}</h2>
          {team.description && (
            <p className="page-subtitle">{team.description}</p>
          )}
        </div>
        {isLeader && (
          <button className="btn btn-icon btn-ghost page-back-btn" onClick={() => setShowSettings(!showSettings)}>
            <Settings size={18} />
          </button>
        )}
      </div>

      {/* Settings Panel (leader only) */}
      {showSettings && isLeader && (
        <div className="card mb-2">
          <h4 style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>Team Settings</h4>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={2} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleUpdateTeam}>Save</button>
            <button className="btn btn-danger btn-sm" onClick={handleDeleteTeam}>Delete Team</button>
          </div>
        </div>
      )}

      {/* Invite Code */}
      <div className="card mb-2">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Invite Code</div>
            <div className="invite-code-display">{team.invite_code}</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-sm btn-secondary" onClick={copyInvite}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {isLeader && (
              <button className="btn btn-sm btn-ghost" onClick={regenerateInvite} title="Generate new code">
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active Challenges */}
      <div className="section-header">
        <h3 className="section-title">
          <Trophy size={18} /> Active Plans
        </h3>
        {isLeader && (
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreateChallenge(true)}>
            <Plus size={14} /> New Plan
          </button>
        )}
      </div>

      {activeChallenges.length === 0 ? (
        <div className="card mb-2 challenge-empty-state">
          <p className="text-center text-muted">
            No active plans{isLeader ? ' yet' : ''}.
          </p>
          {isLeader && (
            <div className="challenge-quick-actions">
              {quickPlanTemplates.map((template) => (
                <button
                  key={template.label}
                  className="btn btn-sm btn-secondary"
                  onClick={() => handleQuickCreate(template)}
                  disabled={quickCreating.length > 0}
                >
                  {quickCreating === template.label ? 'Creating...' : template.label}
                </button>
              ))}
              <button className="btn btn-sm btn-primary" onClick={() => setShowCreateChallenge(true)}>
                Full Custom
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="teams-list mb-2">
          {activeChallenges.map(c => (
            <ChallengeCard
              key={c.id}
              challenge={c}
              onClick={() => navigate(`/teams/${teamId}/challenges/${c.id}`)}
            />
          ))}
        </div>
      )}

      {/* Other Challenges */}
      {otherChallenges.length > 0 && (
        <>
          <div className="section-header">
            <h3 className="section-title" style={{ fontSize: '0.875rem' }}>Past / Upcoming Plans</h3>
          </div>
          <div className="teams-list mb-2">
            {otherChallenges.map(c => (
              <ChallengeCard
                key={c.id}
                challenge={c}
                onClick={() => navigate(`/teams/${teamId}/challenges/${c.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {/* Members */}
      <div className="section-header">
        <h3 className="section-title">
          <Users size={18} /> Members ({team.members?.length || 0})
        </h3>
      </div>
      <div className="card">
        <div className="teams-list-sm">
          {(team.members || []).map(member => (
            <div key={member.user_id} className="team-member-row">
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 500 }}>{member.name}</span>
                  {member.role === 'leader' && (
                    <span className="badge badge-warning" style={{ fontSize: '0.6rem', padding: '0.125rem 0.375rem' }}>
                      <Crown size={8} style={{ display: 'inline', verticalAlign: 'middle' }} /> Leader
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {isLeader && (
                  <button
                    className="btn btn-icon btn-ghost"
                    onClick={() => setMemberStats({ userId: member.user_id, name: member.name })}
                    title="View stats"
                    style={{ width: '32px', height: '32px', minHeight: '32px', minWidth: '32px', padding: '0.25rem' }}
                  >
                    <Eye size={14} />
                  </button>
                )}
                {isLeader && member.user_id !== team.created_by && (
                  <>
                    <button
                      className="btn btn-icon btn-ghost"
                      onClick={() => handlePromote(member.user_id, member.role)}
                      title={member.role === 'leader' ? 'Demote' : 'Promote'}
                      style={{ width: '32px', height: '32px', minHeight: '32px', minWidth: '32px', padding: '0.25rem' }}
                    >
                      <Crown size={14} />
                    </button>
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => handleKick(member.user_id, member.name)}
                      title="Remove"
                      style={{ width: '32px', height: '32px', minHeight: '32px', minWidth: '32px', padding: '0.25rem' }}
                    >
                      <UserMinus size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leave button */}
      <button className="btn btn-ghost btn-block mt-3" onClick={handleLeave} style={{ color: 'var(--danger)' }}>
        <LogOut size={16} /> Leave Team
      </button>

      {/* Modals */}
      {showCreateChallenge && (
        <CreateChallengeModal onClose={() => setShowCreateChallenge(false)} onCreate={handleCreateChallenge} />
      )}
      {memberStats && (
        <MemberStatsModal
          teamId={teamId}
          userId={memberStats.userId}
          memberName={memberStats.name}
          onClose={() => setMemberStats(null)}
        />
      )}
    </div>
  )
}

export default TeamDetail
