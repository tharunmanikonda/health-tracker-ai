import { useState } from 'react'
import { X, Users } from 'lucide-react'

function CreateTeamModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await onCreate({ name: name.trim(), description: description.trim() || null })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Users size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Create Team</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Team Name *</label>
              <input
                type="text"
                placeholder="e.g., Morning Runners"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                placeholder="What's this team about?"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary btn-block" disabled={!name.trim() || loading}>
              {loading ? 'Creating...' : 'Create Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateTeamModal
