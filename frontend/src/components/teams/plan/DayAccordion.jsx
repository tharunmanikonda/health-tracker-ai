import { useState } from 'react'
import { ChevronRight, Dumbbell, UtensilsCrossed, Copy } from 'lucide-react'
import CompactExerciseList from './CompactExerciseList'
import InlineMealEditor from './InlineMealEditor'
import { DAY_LABELS } from './constants'

function DayAccordion({ dayIndex, dayLabel, dayShort, workouts, setWorkouts, meals, setMeals, defaultOpen, allWorkouts, allMeals, setAllWorkouts, setAllMeals }) {
  const [open, setOpen] = useState(defaultOpen || false)

  const exerciseCount = workouts.length
  const mealCount = meals.length
  const hasContent = exerciseCount > 0 || mealCount > 0

  const copyDayTo = (targetDay) => {
    const updatedWorkouts = [...allWorkouts]
    updatedWorkouts[targetDay] = workouts.map(w => ({ ...w }))
    setAllWorkouts(updatedWorkouts)

    const updatedMeals = [...allMeals]
    updatedMeals[targetDay] = meals.map(m => ({ ...m }))
    setAllMeals(updatedMeals)
  }

  return (
    <div className={`da ${open ? 'da--open' : ''} ${hasContent ? 'da--has-content' : ''}`}>
      <button className="da-header" onClick={() => setOpen(!open)}>
        <div className="da-header-left">
          <div className={`da-day-chip ${hasContent ? 'da-day-chip--active' : ''}`}>
            {dayShort}
          </div>
          <span className="da-day-name">{dayLabel}</span>
        </div>
        <div className="da-header-right">
          {exerciseCount > 0 && (
            <span className="da-count"><Dumbbell size={11} /> {exerciseCount}</span>
          )}
          {mealCount > 0 && (
            <span className="da-count da-count--meal"><UtensilsCrossed size={11} /> {mealCount}</span>
          )}
          <ChevronRight size={16} className="da-chevron" />
        </div>
      </button>

      {open && (
        <div className="da-body">
          <CompactExerciseList workouts={workouts} setWorkouts={setWorkouts} />
          <InlineMealEditor meals={meals} setMeals={setMeals} />

          {hasContent && (
            <div className="da-copy">
              <Copy size={12} />
              <span>Copy to</span>
              {DAY_LABELS.map((label, i) => i !== dayIndex && (
                <button key={i} onClick={() => copyDayTo(i)} className="da-copy-btn">
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DayAccordion
