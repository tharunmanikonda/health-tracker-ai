import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ChevronLeft, UtensilsCrossed } from 'lucide-react'
import WeekTabs from './plan/WeekTabs'
import WorkoutList from './plan/WorkoutList'
import MealPlanSection from './plan/MealPlanSection'
import LogMealModal from './LogMealModal'
import { getWeekStart, formatDateStr } from './plan/constants'

function WeeklyPlanView() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState({ plan: null, workouts: [], meals: [], progress: [] })
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().getDay()
    return today === 0 ? 6 : today - 1
  })
  const [logMealItem, setLogMealItem] = useState(null)

  const todayDayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1

  const weekStart = useMemo(() => getWeekStart(new Date()), [])
  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    }), [weekStart])

  const selectedDateStr = formatDateStr(weekDates[selectedDay])

  useEffect(() => { fetchPlan() }, [teamId])

  const fetchPlan = async () => {
    try {
      const res = await axios.get(`/api/teams/${teamId}/plans/my-plan`)
      setData(res.data)
    } catch (err) {
      console.error('Failed to load plan:', err)
    } finally {
      setLoading(false)
    }
  }

  const dayWorkouts = useMemo(() => data.workouts.filter(w => w.day_of_week === selectedDay), [data.workouts, selectedDay])
  const dayMeals = useMemo(() => data.meals.filter(m => m.day_of_week === selectedDay), [data.meals, selectedDay])
  const dayProgress = useMemo(() =>
    data.progress.filter(p => (typeof p.date === 'string' ? p.date.split('T')[0] : '') === selectedDateStr),
    [data.progress, selectedDateStr]
  )

  const isWorkoutCompleted = (id) => dayProgress.some(p => p.workout_item_id === id && p.workout_completed)

  const toggleWorkout = async (workoutId) => {
    try {
      await axios.post(`/api/teams/${teamId}/plans/${data.plan.id}/progress/workout`, {
        workout_item_id: workoutId, date: selectedDateStr, completed: !isWorkoutCompleted(workoutId)
      })
      fetchPlan()
    } catch (err) {
      console.error('Toggle workout error:', err)
    }
  }

  if (loading) {
    return <div className="loading-container"><div className="spinner"></div><p>Loading plan...</p></div>
  }

  if (!data.plan) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <button className="btn btn-icon btn-ghost" onClick={() => navigate(`/teams/${teamId}`)} style={{ width: '40px', height: '40px', minHeight: '40px', padding: '0.5rem' }}>
            <ChevronLeft size={20} />
          </button>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Weekly Plan</h2>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <UtensilsCrossed size={36} style={{ marginBottom: '0.75rem', opacity: 0.5 }} />
          <p>No plan assigned for this week</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <button className="btn btn-icon btn-ghost" onClick={() => navigate(`/teams/${teamId}`)} style={{ width: '40px', height: '40px', minHeight: '40px', padding: '0.5rem' }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>{data.plan.title}</h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Week of {new Date(data.plan.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
      </div>

      <WeekTabs selectedDay={selectedDay} onSelect={setSelectedDay} weekDates={weekDates} todayIndex={todayDayIndex} />

      {dayWorkouts.length === 0 && dayMeals.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', marginTop: '1rem' }}>Rest Day</div>
      )}

      <WorkoutList workouts={dayWorkouts} isCompleted={isWorkoutCompleted} onToggle={toggleWorkout} />
      <MealPlanSection meals={dayMeals} progress={dayProgress} onLogMeal={setLogMealItem} />

      {logMealItem && (
        <LogMealModal teamId={teamId} planId={data.plan.id} mealItem={logMealItem} date={selectedDateStr}
          onClose={() => setLogMealItem(null)} onSaved={() => { setLogMealItem(null); fetchPlan() }} />
      )}
    </div>
  )
}

export default WeeklyPlanView
