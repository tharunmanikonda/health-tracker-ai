import { useState } from 'react'
import { X, Trophy } from 'lucide-react'

const metricOptions = [
  { value: 'calories_burned', label: 'Calories Burned', unit: 'kcal', placeholder: '500' },
  { value: 'steps', label: 'Steps', unit: 'steps', placeholder: '10000' },
  { value: 'water_intake', label: 'Water Intake', unit: 'ml', placeholder: '2500' },
  { value: 'protein_goal', label: 'Protein', unit: 'g', placeholder: '150' },
  { value: 'workout_count', label: 'Workouts', unit: 'count', placeholder: '1' },
  { value: 'sleep_hours', label: 'Sleep', unit: 'hours', placeholder: '7' }
]

function CreateChallengeModal({ onClose, onCreate }) {
  const today = new Date().toISOString().split('T')[0]
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

  const [form, setForm] = useState({
    name: '',
    description: '',
    metric_type: 'calories_burned',
    target_value: '',
    start_date: today,
    end_date: nextWeek
  })
  const [loading, setLoading] = useState(false)

  const selectedMetric = metricOptions.find(m => m.value === form.metric_type)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.target_value) return
    setLoading(true)
    try {
      await onCreate({
        ...form,
        name: form.name.trim(),
        description: form.description.trim() || null,
        target_value: parseFloat(form.target_value),
        target_unit: selectedMetric.unit
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3><Trophy size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Create Challenge</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Challenge Name *</label>
              <input
                type="text"
                placeholder="e.g., Burn 500 kcal daily"
                value={form.name}
                onChange={e => setForm({...form, name: e.target.value})}
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                placeholder="Optional details..."
                value={form.description}
                onChange={e => setForm({...form, description: e.target.value})}
                rows={2}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Metric *</label>
              <select
                value={form.metric_type}
                onChange={e => setForm({...form, metric_type: e.target.value, target_value: ''})}
              >
                {metricOptions.map(m => (
                  <option key={m.value} value={m.value}>{m.label} ({m.unit})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Daily Target ({selectedMetric.unit}) *</label>
              <input
                type="number"
                placeholder={selectedMetric.placeholder}
                value={form.target_value}
                onChange={e => setForm({...form, target_value: e.target.value})}
                min="0"
                step="any"
                required
              />
            </div>
            <div className="grid grid-2">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={e => setForm({...form, start_date: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={e => setForm({...form, end_date: e.target.value})}
                  min={form.start_date}
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary btn-block" disabled={!form.name.trim() || !form.target_value || loading}>
              {loading ? 'Creating...' : 'Create Challenge'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateChallengeModal
