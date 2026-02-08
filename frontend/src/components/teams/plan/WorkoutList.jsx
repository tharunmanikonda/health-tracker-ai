import { useMemo } from 'react'
import { Dumbbell, Check } from 'lucide-react'

function WorkoutList({ workouts, isCompleted, onToggle }) {
  const completedCount = workouts.filter(w => isCompleted(w.id)).length

  const groups = useMemo(() => {
    const map = {}
    for (const w of workouts) {
      const key = w.muscle_group || 'General'
      if (!map[key]) map[key] = []
      map[key].push(w)
    }
    return Object.entries(map)
  }, [workouts])

  if (workouts.length === 0) return null

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="section-header">
        <h3 className="section-title">
          <Dumbbell size={18} /> Workout
        </h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {completedCount}/{workouts.length} done
        </span>
      </div>

      {groups.map(([group, exercises]) => (
        <div key={group} style={{ marginBottom: '0.75rem' }}>
          <div className="muscle-group-header">{group}</div>
          {exercises.map(exercise => {
            const done = isCompleted(exercise.id)
            return (
              <div
                key={exercise.id}
                className={`exercise-row ${done ? 'completed' : ''}`}
                onClick={() => onToggle(exercise.id)}
              >
                <div className={`exercise-check ${done ? 'checked' : ''}`}>
                  {done && <Check size={14} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{exercise.exercise_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {[
                      exercise.sets && exercise.reps && `${exercise.sets}x${exercise.reps}`,
                      exercise.weight_suggestion
                    ].filter(Boolean).join(' — ')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export default WorkoutList
