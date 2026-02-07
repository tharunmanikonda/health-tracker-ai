import { useState } from 'react'
import { X, UserPlus } from 'lucide-react'

function JoinTeamModal({ onClose, onJoin }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    try {
      await onJoin(code.trim().toUpperCase())
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join team')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><UserPlus size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Join Team</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Invite Code</label>
              <input
                type="text"
                placeholder="e.g., A3F7B2C1"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                maxLength={8}
                autoFocus
                style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.2em', fontWeight: 700 }}
              />
              <p className="form-hint">Ask your team leader for the invite code</p>
            </div>
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary btn-block" disabled={code.length < 8 || loading}>
              {loading ? 'Joining...' : 'Join Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default JoinTeamModal
