import { Plus, X, Dumbbell, GripVertical } from 'lucide-react'

function CompactExerciseList({ workouts, setWorkouts }) {
  const addWorkout = () => {
    setWorkouts([...workouts, {
      muscle_group: '', exercise_name: '', sets: '', reps: '', weight_suggestion: ''
    }])
  }

  const update = (idx, field, value) => {
    setWorkouts(workouts.map((w, i) => i === idx ? { ...w, [field]: value } : w))
  }

  const remove = (idx) => {
    setWorkouts(workouts.filter((_, i) => i !== idx))
  }

  const handleSetsRepsChange = (idx, value) => {
    if (value.includes('x') || value.includes('X')) {
      const parts = value.toLowerCase().split('x')
      update(idx, 'sets', parts[0]?.trim() || '')
      update(idx, 'reps', parts[1]?.trim() || '')
    } else {
      update(idx, 'sets', value)
    }
  }

  const getSetsRepsDisplay = (w) => {
    if (w.sets && w.reps) return `${w.sets}x${w.reps}`
    if (w.sets) return w.sets
    return ''
  }

  return (
    <div className="cel">
      <div className="cel-header">
        <div className="cel-header-label">
          <Dumbbell size={13} />
          <span>Workouts</span>
        </div>
        <button className="cel-add-btn" onClick={addWorkout}>
          <Plus size={13} /> Add
        </button>
      </div>

      {workouts.length === 0 ? (
        <button className="cel-empty" onClick={addWorkout}>
          <Plus size={16} />
          <span>Add first exercise</span>
        </button>
      ) : (
        <div className="cel-list">
          {workouts.map((w, idx) => (
            <div key={idx} className="cel-row">
              <div className="cel-row-grip">
                <GripVertical size={12} />
              </div>
              <div className="cel-row-fields">
                <div className="cel-row-top">
                  <input
                    type="text"
                    value={w.exercise_name}
                    onChange={e => update(idx, 'exercise_name', e.target.value)}
                    placeholder="Exercise name"
                    className="cel-input-name"
                  />
                  <button className="cel-remove" onClick={() => remove(idx)}>
                    <X size={14} />
                  </button>
                </div>
                <div className="cel-row-bottom">
                  <input
                    type="text"
                    value={w.muscle_group}
                    onChange={e => update(idx, 'muscle_group', e.target.value)}
                    placeholder="Group"
                    className="cel-input-sm"
                  />
                  <input
                    type="text"
                    value={getSetsRepsDisplay(w)}
                    onChange={e => handleSetsRepsChange(idx, e.target.value)}
                    placeholder="3x12"
                    className="cel-input-sm"
                  />
                  <input
                    type="text"
                    value={w.weight_suggestion}
                    onChange={e => update(idx, 'weight_suggestion', e.target.value)}
                    placeholder="60kg"
                    className="cel-input-sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CompactExerciseList
