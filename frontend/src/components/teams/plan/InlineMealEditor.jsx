import { useState } from 'react'
import { Plus, ChevronDown, X, UtensilsCrossed } from 'lucide-react'
import { MEAL_TYPES, formatMealType } from './constants'

const QUICK_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

function InlineMealEditor({ meals, setMeals }) {
  const [expandedItem, setExpandedItem] = useState(null)
  const [showTypePicker, setShowTypePicker] = useState(false)

  const addMeal = (mealType) => {
    const newIdx = meals.length
    setMeals([...meals, {
      meal_type: mealType, food_name: '', quantity_grams: '', calories: '', protein: '', carbs: '', fat: ''
    }])
    setExpandedItem(newIdx)
    setShowTypePicker(false)
  }

  const update = (idx, field, value) => {
    setMeals(meals.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  const remove = (idx) => {
    setMeals(meals.filter((_, i) => i !== idx))
    if (expandedItem === idx) setExpandedItem(null)
    else if (expandedItem > idx) setExpandedItem(expandedItem - 1)
  }

  // Group meals by type, only show types that have items
  const groupedMeals = MEAL_TYPES.reduce((acc, type) => {
    const items = meals.map((m, i) => ({ ...m, _idx: i })).filter(m => m.meal_type === type)
    if (items.length > 0) acc.push({ type, items })
    return acc
  }, [])

  return (
    <div className="ime">
      <div className="cel-header">
        <div className="cel-header-label">
          <UtensilsCrossed size={13} />
          <span>Meals</span>
        </div>
        <button className="cel-add-btn" onClick={() => setShowTypePicker(!showTypePicker)}>
          <Plus size={13} /> Add
        </button>
      </div>

      {/* Type picker dropdown */}
      {showTypePicker && (
        <div className="ime-type-picker">
          {MEAL_TYPES.map(type => (
            <button key={type} className="ime-type-btn" onClick={() => addMeal(type)}>
              {formatMealType(type)}
            </button>
          ))}
        </div>
      )}

      {meals.length === 0 && !showTypePicker ? (
        <div className="ime-empty">
          <div className="ime-empty-btns">
            {QUICK_TYPES.map(type => (
              <button key={type} className="ime-quick-btn" onClick={() => addMeal(type)}>
                <Plus size={12} />
                {formatMealType(type)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ime-groups">
          {groupedMeals.map(({ type, items }) => (
            <div key={type} className="ime-group">
              <div className="ime-group-label">{formatMealType(type)}</div>
              {items.map(m => {
                const isExpanded = expandedItem === m._idx
                return (
                  <div key={m._idx} className={`ime-item ${isExpanded ? 'ime-item--open' : ''}`}>
                    <div className="ime-item-row" onClick={() => setExpandedItem(isExpanded ? null : m._idx)}>
                      <div className="ime-item-info">
                        {m.food_name ? (
                          <span className="ime-item-name">{m.food_name}{m.quantity_grams ? ` ${m.quantity_grams}g` : ''}</span>
                        ) : (
                          <span className="ime-item-name ime-item-name--empty">New item</span>
                        )}
                        {m.calories && <span className="ime-item-cal">{m.calories} cal</span>}
                      </div>
                      <div className="ime-item-actions">
                        <ChevronDown size={14} className="ime-item-chevron" />
                        <button className="cel-remove" onClick={(e) => { e.stopPropagation(); remove(m._idx) }}>
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="ime-item-fields">
                        <div className="ime-field ime-field--wide">
                          <label>Food name</label>
                          <input type="text" value={m.food_name} onChange={e => update(m._idx, 'food_name', e.target.value)} placeholder="e.g. Chicken breast" autoFocus={!m.food_name} />
                        </div>
                        <div className="ime-field">
                          <label>Grams</label>
                          <input type="number" value={m.quantity_grams} onChange={e => update(m._idx, 'quantity_grams', e.target.value)} placeholder="0" />
                        </div>
                        <div className="ime-field">
                          <label>Calories</label>
                          <input type="number" value={m.calories} onChange={e => update(m._idx, 'calories', e.target.value)} placeholder="0" />
                        </div>
                        <div className="ime-field">
                          <label>Protein</label>
                          <input type="number" value={m.protein} onChange={e => update(m._idx, 'protein', e.target.value)} placeholder="0" />
                        </div>
                        <div className="ime-field">
                          <label>Carbs</label>
                          <input type="number" value={m.carbs} onChange={e => update(m._idx, 'carbs', e.target.value)} placeholder="0" />
                        </div>
                        <div className="ime-field">
                          <label>Fat</label>
                          <input type="number" value={m.fat} onChange={e => update(m._idx, 'fat', e.target.value)} placeholder="0" />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default InlineMealEditor
