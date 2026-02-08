import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ChevronLeft, Dumbbell, UtensilsCrossed, Users, Sparkles } from 'lucide-react'
import DayAccordion from './DayAccordion'
import AssignSection from './AssignSection'
import { getNextMonday } from './constants'

const DAY_FULL_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function CreatePlanPage() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState('')
  const [weekStart, setWeekStart] = useState(getNextMonday())
  const [workouts, setWorkouts] = useState(Array.from({ length: 7 }, () => []))
  const [meals, setMeals] = useState(Array.from({ length: 7 }, () => []))
  const [assignAll, setAssignAll] = useState(true)
  const [selectedMembers, setSelectedMembers] = useState([])

  const setDayWorkouts = (dayIndex) => (dayWorkouts) => {
    const updated = [...workouts]
    updated[dayIndex] = dayWorkouts
    setWorkouts(updated)
  }

  const setDayMeals = (dayIndex) => (dayMeals) => {
    const updated = [...meals]
    updated[dayIndex] = dayMeals
    setMeals(updated)
  }

  const totalExercises = workouts.reduce((sum, d) => sum + d.length, 0)
  const totalMeals = meals.reduce((sum, d) => sum + d.length, 0)
  const canCreate = title.trim() && weekStart && (assignAll || selectedMembers.length > 0)

  const handleCreate = async () => {
    setSaving(true)
    try {
      const planRes = await axios.post(`/api/teams/${teamId}/plans`, {
        title: title.trim(),
        week_start: weekStart
      })
      const planId = planRes.data.id

      const allWorkouts = workouts.flatMap((dayItems, day) =>
        dayItems.filter(w => w.exercise_name.trim()).map((w, i) => ({
          day_of_week: day,
          muscle_group: w.muscle_group || null,
          exercise_name: w.exercise_name,
          sets: w.sets ? parseInt(w.sets) : null,
          reps: w.reps || null,
          weight_suggestion: w.weight_suggestion || null,
          sort_order: i
        }))
      )
      if (allWorkouts.length > 0) {
        await axios.post(`/api/teams/${teamId}/plans/${planId}/workouts`, allWorkouts)
      }

      const allMeals = meals.flatMap((dayItems, day) =>
        dayItems.filter(m => m.food_name.trim()).map((m, i) => ({
          day_of_week: day,
          meal_type: m.meal_type,
          food_name: m.food_name,
          quantity_grams: m.quantity_grams ? parseFloat(m.quantity_grams) : null,
          calories: m.calories ? parseInt(m.calories) : null,
          protein: m.protein ? parseFloat(m.protein) : null,
          carbs: m.carbs ? parseFloat(m.carbs) : null,
          fat: m.fat ? parseFloat(m.fat) : null,
          sort_order: i
        }))
      )
      if (allMeals.length > 0) {
        await axios.post(`/api/teams/${teamId}/plans/${planId}/meals`, allMeals)
      }

      if (assignAll) {
        await axios.post(`/api/teams/${teamId}/plans/${planId}/assign`, { user_id: null })
      } else {
        await Promise.all(
          selectedMembers.map(uid =>
            axios.post(`/api/teams/${teamId}/plans/${planId}/assign`, { user_id: uid })
          )
        )
      }

      navigate(`/teams/${teamId}`)
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create plan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cpp">
      {/* Header */}
      <div className="cpp-header">
        <button className="cpp-back" onClick={() => navigate(`/teams/${teamId}`)}>
          <ChevronLeft size={20} />
        </button>
        <div>
          <h2 className="cpp-title">Create Plan</h2>
          <p className="cpp-subtitle">Build a weekly workout & meal plan</p>
        </div>
      </div>

      {/* Plan info card */}
      <div className="cpp-info-card">
        <div className="cpp-info-icon">
          <Sparkles size={18} />
        </div>
        <div style={{ flex: 1 }}>
          <input
            type="text"
            className="cpp-title-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Plan title, e.g. Week 3 - Cut"
          />
          <div className="cpp-date-row">
            <label>Week of</label>
            <input
              type="date"
              className="cpp-date-input"
              value={weekStart}
              onChange={e => setWeekStart(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Stats bar */}
      {(totalExercises > 0 || totalMeals > 0) && (
        <div className="cpp-stats">
          <div className="cpp-stat">
            <Dumbbell size={14} />
            <span>{totalExercises} exercise{totalExercises !== 1 ? 's' : ''}</span>
          </div>
          <div className="cpp-stat">
            <UtensilsCrossed size={14} />
            <span>{totalMeals} meal{totalMeals !== 1 ? 's' : ''}</span>
          </div>
          <div className="cpp-stat">
            <span>{workouts.filter(d => d.length > 0).length}/7 days</span>
          </div>
        </div>
      )}

      {/* Section label */}
      <div className="cpp-section-label">
        <span>Weekly Schedule</span>
      </div>

      {/* Mini week overview */}
      <div className="cpp-week-overview">
        {DAY_SHORT.map((d, i) => {
          const hasContent = workouts[i].length > 0 || meals[i].length > 0
          return (
            <div key={i} className={`cpp-week-dot ${hasContent ? 'filled' : ''}`}>
              <span>{d}</span>
              {hasContent && <div className="cpp-week-dot-indicator" />}
            </div>
          )
        })}
      </div>

      {/* Day Accordions */}
      <div className="cpp-days">
        {DAY_FULL_LABELS.map((label, i) => (
          <DayAccordion
            key={i}
            dayIndex={i}
            dayLabel={label}
            dayShort={DAY_SHORT[i]}
            workouts={workouts[i]}
            setWorkouts={setDayWorkouts(i)}
            meals={meals[i]}
            setMeals={setDayMeals(i)}
            defaultOpen={i === 0}
            allWorkouts={workouts}
            allMeals={meals}
            setAllWorkouts={setWorkouts}
            setAllMeals={setMeals}
          />
        ))}
      </div>

      {/* Section label */}
      <div className="cpp-section-label">
        <Users size={14} />
        <span>Assign Members</span>
      </div>

      <AssignSection
        teamId={teamId}
        assignAll={assignAll}
        setAssignAll={setAssignAll}
        selectedMembers={selectedMembers}
        setSelectedMembers={setSelectedMembers}
      />

      {/* Sticky Save */}
      <div className="cpp-save-bar">
        <button
          className="btn btn-primary btn-block btn-lg"
          onClick={handleCreate}
          disabled={saving || !canCreate}
        >
          {saving ? 'Creating...' : 'Create Plan'}
        </button>
      </div>
    </div>
  )
}

export default CreatePlanPage
