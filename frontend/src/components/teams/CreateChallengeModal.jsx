import { useMemo, useState } from 'react'
import { X, Trophy, Sparkles, SlidersHorizontal } from 'lucide-react'

const metricOptions = [
  { value: 'calories_burned', label: 'Calories Burned', unit: 'kcal', defaultTarget: '500' },
  { value: 'steps', label: 'Steps', unit: 'steps', defaultTarget: '10000' },
  { value: 'water_intake', label: 'Water Intake', unit: 'ml', defaultTarget: '2500' },
  { value: 'protein_goal', label: 'Protein', unit: 'g', defaultTarget: '150' },
  { value: 'workout_count', label: 'Workouts', unit: 'count', defaultTarget: '1' },
  { value: 'sleep_hours', label: 'Sleep', unit: 'hours', defaultTarget: '7.5' }
]

const quickTemplates = [
  { label: 'Steps Sprint', metric_type: 'steps', target_value: '10000', duration_days: 7 },
  { label: 'Burn Focus', metric_type: 'calories_burned', target_value: '500', duration_days: 7 },
  { label: 'Hydration Reset', metric_type: 'water_intake', target_value: '2500', duration_days: 14 },
  { label: 'Protein Streak', metric_type: 'protein_goal', target_value: '150', duration_days: 14 }
]

const durationOptions = [7, 14, 30]

function formatDateForInput(date) {
  return date.toISOString().split('T')[0]
}

function getDatePlusDays(startDate, daysToAdd) {
  const date = new Date(`${startDate}T00:00:00`)
  date.setDate(date.getDate() + daysToAdd)
  return formatDateForInput(date)
}

function CreateChallengeModal({ onClose, onCreate }) {
  const today = formatDateForInput(new Date())
  const [mode, setMode] = useState('quick')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    metric_type: 'steps',
    target_value: '10000',
    duration_days: 7,
    start_date: today,
    end_date: getDatePlusDays(today, 6)
  })

  const selectedMetric = useMemo(
    () => metricOptions.find((metric) => metric.value === form.metric_type) || metricOptions[0],
    [form.metric_type]
  )

  const targetNumber = Number.parseFloat(form.target_value)
  const isTargetValid = Number.isFinite(targetNumber) && targetNumber > 0
  const autoName = `${form.duration_days}-Day ${selectedMetric.label} (${form.target_value || selectedMetric.defaultTarget} ${selectedMetric.unit}/day)`
  const submitDisabled = loading || !isTargetValid || !form.start_date || !form.end_date

  const handleMetricChange = (metricType) => {
    const metric = metricOptions.find((item) => item.value === metricType)
    if (!metric) return
    setForm((prev) => ({
      ...prev,
      metric_type: metricType,
      target_value: metric.defaultTarget
    }))
  }

  const handleDurationChange = (days) => {
    setForm((prev) => ({
      ...prev,
      duration_days: days,
      end_date: getDatePlusDays(prev.start_date, days - 1)
    }))
  }

  const handleStartDateChange = (value) => {
    setForm((prev) => ({
      ...prev,
      start_date: value,
      end_date: mode === 'quick' ? getDatePlusDays(value, prev.duration_days - 1) : prev.end_date
    }))
  }

  const applyQuickTemplate = (template) => {
    setMode('quick')
    setForm((prev) => ({
      ...prev,
      name: '',
      description: '',
      metric_type: template.metric_type,
      target_value: template.target_value,
      duration_days: template.duration_days,
      end_date: getDatePlusDays(prev.start_date, template.duration_days - 1)
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitDisabled) return
    setLoading(true)
    try {
      await onCreate({
        ...form,
        name: form.name.trim() || autoName,
        description: form.description.trim() || null,
        target_value: targetNumber,
        target_unit: selectedMetric.unit
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content challenge-create-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header challenge-create-header">
          <div>
            <h3><Trophy size={18} className="challenge-create-title-icon" /> Create Plan</h3>
            <p className="challenge-create-subtitle">Quick mode is optimized for the fewest taps.</p>
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body challenge-create-body">
            <div className="challenge-create-mode">
              <button
                type="button"
                className={`challenge-mode-btn ${mode === 'quick' ? 'active' : ''}`}
                onClick={() => setMode('quick')}
              >
                <Sparkles size={15} /> Quick
              </button>
              <button
                type="button"
                className={`challenge-mode-btn ${mode === 'advanced' ? 'active' : ''}`}
                onClick={() => setMode('advanced')}
              >
                <SlidersHorizontal size={15} /> Advanced
              </button>
            </div>

            <div className="challenge-summary-card">
              <div className="challenge-summary-row">
                <span className="challenge-summary-label">Plan Preview</span>
                <span className="badge badge-info">{form.duration_days} days</span>
              </div>
              <h4>{form.name.trim() || autoName}</h4>
              <p>{form.target_value || selectedMetric.defaultTarget} {selectedMetric.unit} per day</p>
            </div>

            <div className="form-group">
              <label className="form-label">Metric</label>
              <div className="challenge-metric-grid">
                {metricOptions.map((metric) => (
                  <button
                    key={metric.value}
                    type="button"
                    className={`challenge-metric-chip ${form.metric_type === metric.value ? 'active' : ''}`}
                    onClick={() => handleMetricChange(metric.value)}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'quick' && (
              <div className="form-group">
                <label className="form-label">Quick Templates</label>
                <div className="challenge-template-grid">
                  {quickTemplates.map((template) => (
                    <button
                      key={template.label}
                      type="button"
                      className="challenge-template-chip"
                      onClick={() => applyQuickTemplate(template)}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-2 challenge-target-row">
              <div className="form-group">
                <label className="form-label">Daily Target ({selectedMetric.unit})</label>
                <input
                  type="number"
                  value={form.target_value}
                  onChange={(e) => setForm((prev) => ({ ...prev, target_value: e.target.value }))}
                  min="0"
                  step="any"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Duration</label>
                <div className="challenge-duration-group">
                  {durationOptions.map((duration) => (
                    <button
                      key={duration}
                      type="button"
                      className={`challenge-duration-btn ${form.duration_days === duration ? 'active' : ''}`}
                      onClick={() => handleDurationChange(duration)}
                    >
                      {duration}d
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-2">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                  min={form.start_date}
                  disabled={mode === 'quick'}
                  required
                />
              </div>
            </div>

            {mode === 'advanced' && (
              <>
                <div className="form-group">
                  <label className="form-label">Custom Plan Name (optional)</label>
                  <input
                    type="text"
                    placeholder={autoName}
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description (optional)</label>
                  <textarea
                    placeholder="Add context for your team..."
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows={2}
                  />
                </div>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary btn-block" disabled={submitDisabled}>
              {loading ? 'Creating...' : 'Create Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateChallengeModal
