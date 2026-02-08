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
      <div className="page-header">
        <div className="page-header-copy">
          <h2 className="page-title">My Teams</h2>
          <p className="page-subtitle">Compete and stay accountable with your crew</p>
        </div>
        <div className="page-actions">
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
          <div className="teams-empty-actions">
            <button className="btn btn-secondary" onClick={() => setShowJoin(true)}>
              <UserPlus size={18} /> Join Team
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={18} /> Create Team
            </button>
          </div>
        </div>
      ) : (
        <div className="teams-list">
          {teams.map(team => (
            <div
              key={team.id}
              className="card"
              onClick={() => navigate(`/teams/${team.id}`)}
              style={{cursor: 'pointer'}}
            >
              <div className="team-list-row">
                <div className="team-list-main">
                  <div className="team-list-title-row">
                    <h3 className="team-list-title">{team.name}</h3>
                    {team.my_role === 'leader' && <span className="badge badge-warning team-role-badge"><Crown size={10} /> Leader</span>}
                  </div>
                  <div className="team-list-meta">
                    <span><Users size={12} /> {team.member_count} members</span>
                    {team.active_challenges > 0 && (
                      <span><Trophy size={12} /> {team.active_challenges} active</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={20} className="text-muted" />
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
