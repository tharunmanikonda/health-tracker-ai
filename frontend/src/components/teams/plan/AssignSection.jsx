import { useState, useEffect } from 'react'
import axios from 'axios'
import { Check } from 'lucide-react'

function AssignSection({ teamId, assignAll, setAssignAll, selectedMembers, setSelectedMembers }) {
  const [members, setMembers] = useState([])

  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const res = await axios.get(`/api/teams/${teamId}`)
        setMembers(res.data.members || [])
      } catch (err) {
        console.error('Failed to load members:', err)
      }
    }
    fetchMembers()
  }, [teamId])

  const toggleMember = (userId) => {
    setSelectedMembers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }

  return (
    <div className="as">
      <div className="as-options">
        <button
          className={`as-option ${assignAll ? 'as-option--active' : ''}`}
          onClick={() => setAssignAll(true)}
        >
          <div className={`as-radio ${assignAll ? 'as-radio--checked' : ''}`}>
            {assignAll && <Check size={12} />}
          </div>
          <div>
            <div className="as-option-title">All Members</div>
            <div className="as-option-desc">Everyone gets this plan</div>
          </div>
        </button>

        <button
          className={`as-option ${!assignAll ? 'as-option--active' : ''}`}
          onClick={() => setAssignAll(false)}
        >
          <div className={`as-radio ${!assignAll ? 'as-radio--checked' : ''}`}>
            {!assignAll && <Check size={12} />}
          </div>
          <div>
            <div className="as-option-title">Select Members</div>
            <div className="as-option-desc">Choose specific people</div>
          </div>
        </button>
      </div>

      {!assignAll && members.length > 0 && (
        <div className="as-members">
          {members.map(m => {
            const selected = selectedMembers.includes(m.user_id)
            return (
              <button
                key={m.user_id}
                className={`as-member ${selected ? 'as-member--selected' : ''}`}
                onClick={() => toggleMember(m.user_id)}
              >
                <div className={`as-check ${selected ? 'as-check--on' : ''}`}>
                  {selected && <Check size={12} />}
                </div>
                <span>{m.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AssignSection
