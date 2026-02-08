import { DAY_LABELS } from './constants'

function WeekTabs({ selectedDay, onSelect, weekDates, todayIndex, badges }) {
  return (
    <div className="week-tabs">
      {DAY_LABELS.map((label, i) => (
        <button
          key={i}
          className={`week-tab ${selectedDay === i ? 'active' : ''} ${todayIndex === i ? 'today' : ''}`}
          onClick={() => onSelect(i)}
        >
          <span className="week-tab-label">{label}</span>
          {weekDates ? (
            <span className="week-tab-date">{weekDates[i].getDate()}</span>
          ) : badges?.[i] > 0 ? (
            <span style={{ fontSize: '0.6rem', color: 'var(--accent)' }}>{badges[i]}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export default WeekTabs
