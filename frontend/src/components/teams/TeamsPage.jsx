import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { Users, Plus, UserPlus, ChevronRight, Trophy, Crown } from 'lucide-react'
import CreateTeamModal from './CreateTeamModal'
import JoinTeamModal from './JoinTeamModal'

function TeamsPage() {
  const navigate = useNavigate()
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)

  useEffect(() => {
    fetchTeams()
  }, [])

  const fetchTeams = async () => {
    try {
      const res = await axios.get('/api/teams')
      setTeams(res.data)
    } catch (err) {
      console.error('Failed to load teams:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (data) => {
    try {
      const res = await axios.post('/api/teams', data)
      setShowCreate(false)
      fetchTeams()
      navigate(`/teams/${res.data.id}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create team')
    }
  }

  const handleJoin = async (code) => {
    const res = await axios.post('/api/teams/join', { invite_code: code })
    setShowJoin(false)
    fetchTeams()
    navigate(`/teams/${res.data.team.id}`)
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading teams...</p>
      </div>
    )
  }

  return (
    <div className="teams-page">
      <div className="section-header">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>My Teams</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowJoin(true)}>
            <UserPlus size={16} /> Join
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create
          </button>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Users size={28} />
          </div>
          <h3>No Teams Yet</h3>
          <p>Create a team and invite your friends, or join an existing one with an invite code.</p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={() => setShowJoin(true)}>
              <UserPlus size={18} /> Join Team
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={18} /> Create Team
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {teams.map(team => (
            <div
              key={team.id}
              className="card"
              onClick={() => navigate(`/teams/${team.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{team.name}</h3>
                    {team.my_role === 'leader' && (
                      <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>
                        <Crown size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> Leader
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <span><Users size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {team.member_count} members</span>
                    {team.active_challenges > 0 && (
                      <span><Trophy size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {team.active_challenges} active</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={20} style={{ color: 'var(--text-muted)' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateTeamModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {showJoin && <JoinTeamModal onClose={() => setShowJoin(false)} onJoin={handleJoin} />}
    </div>
  )
}

export default TeamsPage
