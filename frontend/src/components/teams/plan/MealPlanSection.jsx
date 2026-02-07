import { useMemo } from 'react'
import { UtensilsCrossed } from 'lucide-react'
import { formatMealType } from './constants'

function MealPlanSection({ meals, progress, onLogMeal }) {
  const plannedCalories = meals.reduce((sum, m) => sum + (m.calories || 0), 0)
  const loggedCalories = progress
    .filter(p => p.meal_item_id && p.actual_calories)
    .reduce((sum, p) => sum + p.actual_calories, 0)
  const caloriePercent = plannedCalories > 0
    ? Math.min(100, Math.round((loggedCalories / plannedCalories) * 100))
    : 0

  const isMealLogged = (mealId) =>
    progress.some(p => p.meal_item_id === mealId && p.logged_at)

  const mealsByType = useMemo(() => {
    const groups = {}
    const order = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout']
    for (const meal of meals) {
      if (!groups[meal.meal_type]) groups[meal.meal_type] = []
      groups[meal.meal_type].push(meal)
    }
    return order.filter(t => groups[t]).map(t => ({ type: t, items: groups[t] }))
  }, [meals])

  if (meals.length === 0) return null

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div className="section-header">
        <h3 className="section-title">
          <UtensilsCrossed size={18} /> Meal Plan
        </h3>
      </div>

      {/* Daily calorie progress */}
      {plannedCalories > 0 && (
        <div className="food-progress-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Daily Calories</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {loggedCalories.toLocaleString()} / {plannedCalories.toLocaleString()} cal
            </span>
          </div>
          <div className="progress-bar">
            <div
              className={`progress-fill ${caloriePercent >= 90 ? 'green' : caloriePercent >= 50 ? 'blue' : 'orange'}`}
              style={{ width: `${caloriePercent}%` }}
            />
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {caloriePercent}%
          </div>
        </div>
      )}

      {mealsByType.map(({ type, items }) => (
        <div key={type} style={{ marginBottom: '0.75rem' }}>
          <div className="meal-type-header">{formatMealType(type)}</div>
          {items.map(item => {
            const logged = isMealLogged(item.id)
            return (
              <div key={item.id} className={`meal-item ${logged ? 'logged' : ''}`}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                    {item.quantity_grams ? `${item.quantity_grams}g ` : ''}{item.food_name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem' }}>
                    {item.calories && <span>{item.calories} cal</span>}
                    {item.protein && <span>{item.protein}g protein</span>}
                  </div>
                </div>
                {logged ? (
                  <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>Logged</span>
                ) : (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => onLogMeal(item)}
                    style={{ padding: '0.375rem 0.75rem', minHeight: '32px', fontSize: '0.8rem' }}
                  >
                    Log
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default MealPlanSection
