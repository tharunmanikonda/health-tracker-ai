import { useState, useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash2, Search, Utensils, X, ScanLine,
  Flame, Dumbbell, Wheat as WheatIcon, Droplets,
  Calendar, ChevronDown, Filter
} from 'lucide-react'

function FoodLog() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [newFood, setNewFood] = useState({
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    fiber: '',
    sugar: '',
    sodium: '',
    serving_size: '1 serving'
  })

  useEffect(() => {
    fetchLogs()
  }, [selectedDate])

  const fetchLogs = async () => {
    try {
      setLoading(true)
      const res = await axios.get(`/api/food/logs/${selectedDate}`)
      setLogs(res.data)
    } catch (err) {
      console.error('Failed to load logs:', err)
    } finally {
      setLoading(false)
    }
  }

  const addFood = async (e) => {
    e.preventDefault()
    try {
      await axios.post('/api/food/log', {
        ...newFood,
        calories: parseInt(newFood.calories) || 0,
        protein: parseFloat(newFood.protein) || 0,
        carbs: parseFloat(newFood.carbs) || 0,
        fat: parseFloat(newFood.fat) || 0,
        fiber: parseFloat(newFood.fiber) || 0,
        sugar: parseFloat(newFood.sugar) || 0,
        sodium: parseInt(newFood.sodium) || 0,
        source: 'manual',
        timestamp: new Date(selectedDate).toISOString()
      })
      setNewFood({ 
        name: '', calories: '', protein: '', carbs: '', fat: '', 
        fiber: '', sugar: '', sodium: '', serving_size: '1 serving' 
      })
      setShowAddForm(false)
      fetchLogs()
    } catch (err) {
      alert('Failed to add food: ' + err.message)
    }
  }

  const deleteFood = async (id) => {
    if (!window.confirm('Delete this entry?')) return
    try {
      await axios.delete(`/api/food/log/${id}`)
      fetchLogs()
    } catch (err) {
      alert('Failed to delete: ' + err.message)
    }
  }

  const totals = logs.reduce((acc, log) => ({
    calories: acc.calories + (log.calories || 0),
    protein: acc.protein + (log.protein || 0),
    carbs: acc.carbs + (log.carbs || 0),
    fat: acc.fat + (log.fat || 0),
    fiber: acc.fiber + (log.fiber || 0),
    sugar: acc.sugar + (log.sugar || 0),
    sodium: acc.sodium + (log.sodium || 0)
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 })

  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading your food log...</p>
      </div>
    )
  }

  return (
    <div className="food-log">
      {/* Header */}
      <div className="page-header">
        <div className="page-header-copy">
          <h2 className="page-title">Food Log</h2>
          <p className="page-subtitle">
            {logs.length} items • {isToday ? 'Today' : new Date(selectedDate).toLocaleDateString()}
          </p>
        </div>
        <button 
          className="btn btn-primary btn-icon" 
          onClick={() => setShowAddForm(!showAddForm)}
          aria-label={showAddForm ? 'Cancel' : 'Add Food'}
        >
          {showAddForm ? <X size={20} /> : <Plus size={20} />}
        </button>
      </div>

      {/* Scan Barcode Button */}
      <button
        className="btn btn-secondary btn-block mb-2 food-scan-btn"
        onClick={() => navigate('/scan')}
      >
        <ScanLine size={18} /> Scan Barcode
      </button>

      {/* Date Selector */}
      <div className="card food-date-card">
        <div className="food-date-row">
          <Calendar size={18} className="text-muted" />
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="food-date-input"
          />
          <button 
            className="btn btn-sm btn-secondary"
            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
            disabled={isToday}
          >
            Today
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-4 food-macro-grid">
        <div className="stat-card food-macro-card">
          <div className="stat-icon orange food-macro-icon">
            <Flame size={16} />
          </div>
          <div className="stat-value food-macro-value">{Math.round(totals.calories)}</div>
          <div className="stat-label food-macro-label">Calories</div>
        </div>
        <div className="stat-card food-macro-card">
          <div className="stat-icon green food-macro-icon">
            <Dumbbell size={16} />
          </div>
          <div className="stat-value food-macro-value">{Math.round(totals.protein)}g</div>
          <div className="stat-label food-macro-label">Protein</div>
        </div>
        <div className="stat-card food-macro-card">
          <div className="stat-icon blue food-macro-icon">
            <WheatIcon size={16} />
          </div>
          <div className="stat-value food-macro-value">{Math.round(totals.carbs)}g</div>
          <div className="stat-label food-macro-label">Carbs</div>
        </div>
        <div className="stat-card food-macro-card">
          <div className="stat-icon purple food-macro-icon">
            <Droplets size={16} />
          </div>
          <div className="stat-value food-macro-value">{Math.round(totals.fat)}g</div>
          <div className="stat-label food-macro-label">Fat</div>
        </div>
      </div>

      {/* Add Food Form */}
      {showAddForm && (
        <div className="card food-form-card">
          <h3 className="food-form-title">
            <Utensils size={18} /> Add Food Manually
          </h3>
          <form onSubmit={addFood}>
            <div className="form-group">
              <label className="form-label">Food Name *</label>
              <input 
                type="text" 
                placeholder="e.g., Grilled Chicken Breast"
                value={newFood.name}
                onChange={e => setNewFood({...newFood, name: e.target.value})}
                required
              />
            </div>
            
            <div className="grid grid-2">
              <div className="form-group">
                <label className="form-label">Calories *</label>
                <input 
                  type="number" 
                  placeholder="0"
                  value={newFood.calories}
                  onChange={e => setNewFood({...newFood, calories: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Protein (g)</label>
                <input 
                  type="number" 
                  step="0.1"
                  placeholder="0"
                  value={newFood.protein}
                  onChange={e => setNewFood({...newFood, protein: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Carbs (g)</label>
                <input 
                  type="number" 
                  step="0.1"
                  placeholder="0"
                  value={newFood.carbs}
                  onChange={e => setNewFood({...newFood, carbs: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Fat (g)</label>
                <input 
                  type="number" 
                  step="0.1"
                  placeholder="0"
                  value={newFood.fat}
                  onChange={e => setNewFood({...newFood, fat: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Fiber (g)</label>
                <input 
                  type="number" 
                  step="0.1"
                  placeholder="0"
                  value={newFood.fiber}
                  onChange={e => setNewFood({...newFood, fiber: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Sugar (g)</label>
                <input 
                  type="number" 
                  step="0.1"
                  placeholder="0"
                  value={newFood.sugar}
                  onChange={e => setNewFood({...newFood, sugar: e.target.value})}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Sodium (mg)</label>
              <input 
                type="number" 
                placeholder="0"
                value={newFood.sodium}
                onChange={e => setNewFood({...newFood, sodium: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Serving Size</label>
              <input 
                type="text" 
                placeholder="e.g., 1 cup, 100g, 1 piece"
                value={newFood.serving_size}
                onChange={e => setNewFood({...newFood, serving_size: e.target.value})}
              />
            </div>

            <div className="food-form-actions">
              <button type="submit" className="btn btn-primary food-form-submit">
                <Plus size={18} /> Add to Log
              </button>
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Additional Macros Summary */}
      {(totals.fiber > 0 || totals.sugar > 0 || totals.sodium > 0) && (
        <div className="card food-extra-card">
          <h4 className="food-extra-title">Additional Nutrition</h4>
          <div className="food-extra-chips">
            {totals.fiber > 0 && (
              <span className="food-extra-chip">
                Fiber: {Math.round(totals.fiber)}g
              </span>
            )}
            {totals.sugar > 0 && (
              <span className="food-extra-chip">
                Sugar: {Math.round(totals.sugar)}g
              </span>
            )}
            {totals.sodium > 0 && (
              <span className="food-extra-chip">
                Sodium: {Math.round(totals.sodium)}mg
              </span>
            )}
          </div>
        </div>
      )}

      {/* Food List */}
      {logs.length === 0 ? (
        <div className="empty-state food-empty-state">
          <div className="empty-state-icon">
            <Search size={28} />
          </div>
          <h3>No Food Logged {isToday ? 'Yet' : 'This Day'}</h3>
          <p className="food-empty-text">
            {isToday ? 'Start tracking your nutrition by adding your first meal' : 'No food was logged on this date'}
          </p>
          {isToday && (
            <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
              <Plus size={18} /> Add Your First Food
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="food-list">
            {logs.map(log => (
              <div key={log.id} className="food-log-item">
                <div className="food-log-info">
                  <h4>{log.name}</h4>
                  <div className="food-log-meta">
                    <span className="source">{log.source}</span>
                    <span>•</span>
                    <span>{new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    {log.protein > 0 && <span className="macro">P: {Math.round(log.protein)}g</span>}
                    {log.carbs > 0 && <span>C: {Math.round(log.carbs)}g</span>}
                    {log.fat > 0 && <span>F: {Math.round(log.fat)}g</span>}
                  </div>
                </div>
                <div className="food-log-calories">
                  <span className="calorie-badge">{Math.round(log.calories)}</span>
                  <button 
                    className="btn btn-icon btn-danger"
                    onClick={() => deleteFood(log.id)}
                    title="Delete"
                    aria-label="Delete food entry"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default FoodLog
