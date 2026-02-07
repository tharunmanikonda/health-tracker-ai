import { useState, useRef } from 'react'
import axios from 'axios'
import { X, Camera } from 'lucide-react'

function LogMealModal({ teamId, planId, mealItem, date, onClose, onSaved }) {
  const [form, setForm] = useState({
    actual_food_name: mealItem.food_name,
    actual_quantity_grams: mealItem.quantity_grams || '',
    actual_calories: mealItem.calories || '',
    actual_protein: mealItem.protein || '',
    actual_carbs: mealItem.carbs || '',
    actual_fat: mealItem.fat || ''
  })
  const [image, setImage] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('meal_item_id', mealItem.id)
      formData.append('date', date)
      formData.append('actual_food_name', form.actual_food_name)
      if (form.actual_quantity_grams) formData.append('actual_quantity_grams', form.actual_quantity_grams)
      if (form.actual_calories) formData.append('actual_calories', form.actual_calories)
      if (form.actual_protein) formData.append('actual_protein', form.actual_protein)
      if (form.actual_carbs) formData.append('actual_carbs', form.actual_carbs)
      if (form.actual_fat) formData.append('actual_fat', form.actual_fat)
      if (image) formData.append('image', image)

      await axios.post(
        `/api/teams/${teamId}/plans/${planId}/progress/meal`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      onSaved()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to log meal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>Log Meal</h3>
          <button className="btn btn-icon btn-ghost" onClick={onClose} style={{ width: '36px', height: '36px', minHeight: '36px', padding: '0.25rem' }}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {/* Planned item reference */}
          <div style={{
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius)',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            color: 'var(--text-muted)'
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Planned</div>
            {mealItem.quantity_grams ? `${mealItem.quantity_grams}g ` : ''}{mealItem.food_name}
            {mealItem.calories ? ` — ${mealItem.calories} cal` : ''}
            {mealItem.protein ? `, ${mealItem.protein}g protein` : ''}
          </div>

          <div className="form-group">
            <label className="form-label">What did you eat?</label>
            <input
              type="text"
              value={form.actual_food_name}
              onChange={e => handleChange('actual_food_name', e.target.value)}
              placeholder="Food name"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Amount (g)</label>
              <input
                type="number"
                value={form.actual_quantity_grams}
                onChange={e => handleChange('actual_quantity_grams', e.target.value)}
                placeholder="grams"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Calories</label>
              <input
                type="number"
                value={form.actual_calories}
                onChange={e => handleChange('actual_calories', e.target.value)}
                placeholder="cal"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Protein (g)</label>
              <input
                type="number"
                value={form.actual_protein}
                onChange={e => handleChange('actual_protein', e.target.value)}
                placeholder="g"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Carbs (g)</label>
              <input
                type="number"
                value={form.actual_carbs}
                onChange={e => handleChange('actual_carbs', e.target.value)}
                placeholder="g"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Fat (g)</label>
              <input
                type="number"
                value={form.actual_fat}
                onChange={e => handleChange('actual_fat', e.target.value)}
                placeholder="g"
              />
            </div>
          </div>

          {/* Photo */}
          <div className="form-group">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => fileRef.current?.click()}
              style={{ width: '100%' }}
            >
              <Camera size={16} /> {image ? image.name : 'Add Photo'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={e => setImage(e.target.files?.[0] || null)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || !form.actual_food_name}
            style={{ flex: 2 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default LogMealModal
