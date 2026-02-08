import { useState, useEffect } from 'react'
import axios from 'axios'
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, BarChart, Bar, Legend 
} from 'recharts'
import { TrendingUp, Activity, Calendar } from 'lucide-react'

function Insights() {
  const [insights, setInsights] = useState(null)
  const [weekData, setWeekData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchInsights()
  }, [])

  const fetchInsights = async () => {
    try {
      const [insightsRes, weekRes] = await Promise.all([
        axios.get('/api/dashboard/insights'),
        axios.get('/api/dashboard/week')
      ])
      
      setInsights(insightsRes.data)
      setWeekData(weekRes.data.reverse())
    } catch (err) {
      console.error('Failed to load insights:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Analyzing your data...</p>
      </div>
    )
  }

  if (!insights || weekData.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <Activity size={32} />
        </div>
        <h3>Not Enough Data Yet</h3>
        <p>Keep logging your food and syncing WHOOP to see insights</p>
      </div>
    )
  }

  const { correlations } = insights

  const insightsChartStroke = 'var(--primary)'
  const insightsSecondaryStroke = 'var(--purple)'

  return (
    <div className="insights-page">
      <div className="page-header">
        <div className="page-header-copy">
          <h2 className="page-title">Insights</h2>
          <p className="page-subtitle">
          Your nutrition and recovery trends over time
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid insights-stats-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <TrendingUp size={16} style={{ display: 'inline', marginRight: '0.5rem' }} />
              High Protein Days
            </div>
          </div>
          <div className="card-value" style={{ color: 'var(--success)' }}>
            {correlations.high_protein_days_count}
          </div>
          <div className="card-subtitle">
            Avg Recovery: <strong>{correlations.high_protein_recovery}%</strong>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Activity size={16} style={{ display: 'inline', marginRight: '0.5rem' }} />
              Low Protein Days
            </div>
          </div>
          <div className="card-value" style={{ color: 'var(--warning)' }}>
            {correlations.low_protein_days_count}
          </div>
          <div className="card-subtitle">
            Avg Recovery: <strong>{correlations.low_protein_recovery}%</strong>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Recovery Difference</div>
          </div>
          <div 
            className="card-value" 
            style={{ 
              color: correlations.protein_recovery_diff > 0 ? 'var(--success)' : 'var(--danger)'
            }}
          >
            {correlations.protein_recovery_diff > 0 ? '+' : ''}
            {correlations.protein_recovery_diff}%
          </div>
          <div className="card-subtitle">
            Better recovery with high protein
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="card insights-chart-card">
        <div className="card-header">
          <div className="card-title">
            <Calendar size={16} style={{ display: 'inline', marginRight: '0.5rem' }} />
            Calories vs Recovery (Last 7 Days)
          </div>
        </div>
        <div className="insights-chart-wrap insights-chart-tall">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weekData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis 
                dataKey="date" 
                stroke="var(--text-muted)"
                tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', {weekday: 'short'})}
                fontSize={12}
              />
              <YAxis yAxisId="left" stroke={insightsChartStroke} fontSize={12} />
              <YAxis yAxisId="right" orientation="right" stroke={insightsSecondaryStroke} domain={[0, 100]} fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: 'var(--glass-bg)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '12px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                  color: 'var(--text-primary)'
                }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="total_calories"
                stroke={insightsChartStroke}
                name="Calories"
                strokeWidth={2}
                dot={{ fill: insightsChartStroke }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="whoop_recovery"
                stroke={insightsSecondaryStroke}
                name="Recovery %"
                strokeWidth={2}
                dot={{ fill: insightsSecondaryStroke }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card insights-chart-card">
        <div className="card-header">
          <div className="card-title">Macro Distribution</div>
        </div>
        <div className="insights-chart-wrap insights-chart-medium">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis 
                dataKey="date" 
                stroke="var(--text-muted)"
                tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', {weekday: 'short'})}
                fontSize={12}
              />
              <YAxis stroke="var(--text-muted)" fontSize={12} />
              <Tooltip
                contentStyle={{
                  background: 'var(--glass-bg)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '12px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                  color: 'var(--text-primary)'
                }}
              />
              <Legend />
              <Bar dataKey="total_protein" stackId="a" fill="var(--success)" name="Protein (g)" />
              <Bar dataKey="total_carbs" stackId="a" fill="var(--primary)" name="Carbs (g)" />
              <Bar dataKey="total_fat" stackId="a" fill="var(--purple)" name="Fat (g)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Data Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Daily Summary</div>
        </div>
        <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</th>
                <th style={{ textAlign: 'right', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Calories</th>
                <th style={{ textAlign: 'right', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Protein</th>
                <th style={{ textAlign: 'right', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Recovery</th>
                <th style={{ textAlign: 'right', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {weekData.slice().reverse().map((day, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                    {new Date(day.date).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.75rem', fontWeight: 600 }}>
                    {day.total_calories}
                  </td>
                  <td style={{ textAlign: 'right', padding: '0.75rem' }}>
                    {Math.round(day.total_protein)}g
                  </td>
                  <td style={{ 
                    textAlign: 'right', 
                    padding: '0.75rem',
                    color: day.whoop_recovery >= 67 ? 'var(--success)' : day.whoop_recovery >= 33 ? 'var(--warning)' : 'var(--danger)',
                    fontWeight: 600
                  }}>
                    {day.whoop_recovery ? `${day.whoop_recovery}%` : '-'}
                  </td>
                  <td style={{ 
                    textAlign: 'right', 
                    padding: '0.75rem',
                    color: day.net_calories > 0 ? 'var(--success)' : 'var(--danger)',
                    fontWeight: 600
                  }}>
                    {day.net_calories > 0 ? '+' : ''}{day.net_calories}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Insights
