import { useState, useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import {
  Flame, Dumbbell, Moon, Activity, TrendingUp,
  RefreshCw, Plus, ChevronRight, Heart, Wind,
  Thermometer, Clock, Zap, Droplets, Brain,
  Battery, Sun, Sunrise, GlassWater, Scale,
  Smile, Bed, Timer, Footprints, Pill, X,
  Trophy, ChevronUp, ChevronDown, ArrowUp, ArrowDown,
  Utensils, ScanLine, Frown, Meh, Laugh, Watch, Users
} from 'lucide-react'

function Dashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeChallenges, setActiveChallenges] = useState([])

  // Connected device banner state
  const [connectedDevice, setConnectedDevice] = useState(null)
  const [deviceSyncing, setDeviceSyncing] = useState(false)

  // Modal states
  const [activeModal, setActiveModal] = useState(null)
  const [modalData, setModalData] = useState({})

  // Tracking data
  const [waterAmount, setWaterAmount] = useState(0)
  const [weight, setWeight] = useState('')
  const [mood, setMood] = useState(null)
  const [energy, setEnergy] = useState(5)
  const [sleep, setSleep] = useState({ hours: '', minutes: '', quality: 5 })
  const [workout, setWorkout] = useState({ type: '', duration: '', calories: '' })
  const [meds, setMeds] = useState({ name: '', taken: true })

  useEffect(() => {
    fetchDashboard()
    fetchConnectedDevice()
    fetchWater()
    fetchActiveChallenges()

    // Listen for native app events (e.g. food logged from barcode scanner)
    const handleNativeChange = () => {
      fetchDashboard()
      fetchWater()
    }
    window.addEventListener('native-data-changed', handleNativeChange)
    return () => window.removeEventListener('native-data-changed', handleNativeChange)
  }, [])

  const fetchDashboard = async () => {
    try {
      const res = await axios.get('/api/dashboard/today')
      setData(res.data)
    } catch (err) {
      console.error('Failed to load dashboard:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchWater = async () => {
    try {
      const res = await axios.get('/api/water/today')
      setWaterAmount(res.data.total || 0)
    } catch (err) {
      console.error('Failed to load water:', err)
    }
  }

  const fetchConnectedDevice = async () => {
    try {
      const [whoopRes, ouraRes, garminRes, fitbitRes] = await Promise.allSettled([
        axios.get('/api/whoop/status'),
        axios.get('/api/oura/status'),
        axios.get('/api/garmin/status'),
        axios.get('/api/wearables/fitbit/status')
      ])

      if (whoopRes.status === 'fulfilled' && whoopRes.value.data?.authenticated) {
        setConnectedDevice({ provider: 'whoop', name: 'WHOOP' })
      } else if (ouraRes.status === 'fulfilled' && ouraRes.value.data?.status?.connected) {
        setConnectedDevice({ provider: 'oura', name: 'Oura Ring' })
      } else if (garminRes.status === 'fulfilled' && garminRes.value.data?.status?.connected) {
        setConnectedDevice({ provider: 'garmin', name: 'Garmin Watch' })
      } else if (fitbitRes.status === 'fulfilled' && fitbitRes.value.data?.connected) {
        setConnectedDevice({ provider: 'fitbit', name: 'Fitbit' })
      } else {
        setConnectedDevice(null)
      }
    } catch {
      setConnectedDevice(null)
    }
  }

  const syncDevice = async () => {
    if (!connectedDevice) return
    setDeviceSyncing(true)
    try {
      const p = connectedDevice.provider
      if (p === 'whoop') await axios.post('/api/whoop/sync')
      else if (p === 'fitbit') await axios.post('/api/wearables/fitbit/sync')
      else if (p === 'oura') await axios.post('/api/oura/sync', { days: 30 })
      else if (p === 'garmin') await axios.post('/api/garmin/sync', { days: 7 })
      await fetchDashboard()
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setDeviceSyncing(false)
    }
  }

  const fetchActiveChallenges = async () => {
    try {
      const res = await axios.get('/api/teams/my-active-challenges')
      setActiveChallenges(res.data)
    } catch (err) {
      // Not critical, silently fail
    }
  }

  // Tracking handlers
  const addWater = async (amount) => {
    try {
      await axios.post('/api/water/log', { amount, unit: 'ml' })
      setWaterAmount(prev => prev + amount)
    } catch (err) {
      console.error('Failed to log water:', err)
    }
  }

  const logWeight = async () => {
    if (!weight) return
    try {
      await axios.post('/api/weight/log', { 
        weight: parseFloat(weight), 
        unit: 'lbs',
        date: new Date().toISOString()
      })
      setWeight('')
      setActiveModal(null)
    } catch (err) {
      console.error('Failed to log weight:', err)
    }
  }

  const logMood = async () => {
    if (!mood) return
    try {
      await axios.post('/api/mood/log', { 
        mood_score: mood,
        energy_score: energy,
        notes: '',
        timestamp: new Date().toISOString()
      })
      setMood(null)
      setEnergy(5)
      setActiveModal(null)
    } catch (err) {
      console.error('Failed to log mood:', err)
    }
  }

  const logSleep = async () => {
    if (!sleep.hours) return
    try {
      const duration = parseFloat(sleep.hours) + (parseFloat(sleep.minutes || 0) / 60)
      await axios.post('/api/sleep/log', { 
        duration: duration,
        quality: sleep.quality,
        date: new Date().toISOString()
      })
      setSleep({ hours: '', minutes: '', quality: 5 })
      setActiveModal(null)
    } catch (err) {
      console.error('Failed to log sleep:', err)
    }
  }

  const logWorkout = async () => {
    if (!workout.type || !workout.duration) return
    try {
      await axios.post('/api/workouts/manual', { 
        type: workout.type,
        duration: parseInt(workout.duration),
        calories: parseInt(workout.calories || 0),
        date: new Date().toISOString()
      })
      setWorkout({ type: '', duration: '', calories: '' })
      setActiveModal(null)
    } catch (err) {
      console.error('Failed to log workout:', err)
    }
  }

  const logMeds = async () => {
    if (!meds.name) return
    try {
      await axios.post('/api/meds/log', { 
        name: meds.name,
        taken: meds.taken,
        timestamp: new Date().toISOString()
      })
      setMeds({ name: '', taken: true })
      setActiveModal(null)
    } catch (err) {
      console.error('Failed to log medication:', err)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading your dashboard...</p>
      </div>
    )
  }

  if (!data) return null

  const { totals, goals, remaining, whoop, fitbit, fitbit_derived, workouts, food_logs, calories_burned, burned_source } = data
  const calPercent = Math.min((totals.calories / goals.daily_calorie_goal) * 100, 100)
  const proteinPercent = Math.min((totals.protein / goals.daily_protein_goal) * 100, 100)

  const totalBurned = calories_burned || 0
  const burnedGoal = goals.daily_calorie_goal // Use same goal as rough reference
  const burnedPercent = burnedGoal > 0 ? Math.min((totalBurned / burnedGoal) * 100, 100) : 0
  const waterGoal = 2500
  const waterPercent = Math.min((waterAmount / waterGoal) * 100, 100)
  const recoveryScore = whoop?.recovery_score ?? fitbit_derived?.readiness_score
  const recoveryRestingHr = whoop?.resting_hr ?? fitbit_derived?.resting_heart_rate
  const recoveryHrv = whoop?.hrv ?? fitbit_derived?.hrv
  const sleepHours = whoop?.sleep_hours ?? fitbit_derived?.sleep_hours
  const sleepScore = whoop?.sleep_score ?? fitbit_derived?.sleep_efficiency

  const getRecoveryColor = (score) => {
    if (!score) return 'var(--text-muted)'
    if (score >= 67) return '#10b981'
    if (score >= 33) return '#f59e0b'
    return '#ef4444'
  }

  const formatHours = (hours) => {
    if (!hours) return '--'
    const h = Math.floor(hours)
    const m = Math.round((hours - h) * 60)
    return `${h}h ${m}m`
  }

  // Render modals
  const renderModal = () => {
    if (!activeModal) return null

    const modals = {
      water: (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Droplets size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Log Water</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => setActiveModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="text-center mb-3">
                <div className="stat-value">{waterAmount}<span className="unit">ml</span></div>
                <div className="stat-label">Today</div>
              </div>
              <div className="water-quick-add">
                <button className="water-btn" onClick={() => addWater(250)}>+250ml</button>
                <button className="water-btn" onClick={() => addWater(500)}>+500ml</button>
                <button className="water-btn" onClick={() => addWater(750)}>+750ml</button>
              </div>
              <div className="progress-container mt-3">
                <div className="progress-bar">
                  <div className="progress-fill" style={{width: `${waterPercent}%`}}></div>
                </div>
                <div className="progress-text">
                  <span>{Math.round(waterPercent)}% of goal</span>
                  <span>{waterGoal - waterAmount > 0 ? `${waterGoal - waterAmount}ml left` : <><Trophy size={14} style={{display: 'inline', verticalAlign: 'middle'}} /> Goal reached!</>}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      weight: (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Scale size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Log Weight</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => setActiveModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Weight (lbs)</label>
                <input 
                  type="number" 
                  placeholder="e.g., 175"
                  value={weight}
                  onChange={e => setWeight(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary btn-block" onClick={logWeight} disabled={!weight}>
                Log Weight
              </button>
            </div>
          </div>
        </div>
      ),
      mood: (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Smile size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> How are you feeling?</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => setActiveModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="mood-options">
                {[1, 2, 3, 4, 5].map(score => (
                  <button 
                    key={score}
                    className={`mood-btn ${mood === score ? 'selected' : ''}`}
                    onClick={() => setMood(score)}
                  >
                    <span className="mood-emoji">
                      {score === 1 && <Frown size={24} />}
                      {score === 2 && <Frown size={24} style={{opacity: 0.7}} />}
                      {score === 3 && <Meh size={24} />}
                      {score === 4 && <Smile size={24} />}
                      {score === 5 && <Laugh size={24} />}
                    </span>
                    <span className="mood-label">
                      {score === 1 && 'Rough'}
                      {score === 2 && 'Not Great'}
                      {score === 3 && 'Okay'}
                      {score === 4 && 'Good'}
                      {score === 5 && 'Great'}
                    </span>
                  </button>
                ))}
              </div>
              <div className="form-group mt-3">
                <label className="form-label">Energy Level: {energy}/10</label>
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  value={energy}
                  onChange={e => setEnergy(parseInt(e.target.value))}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary btn-block" onClick={logMood} disabled={!mood}>
                Log Mood
              </button>
            </div>
          </div>
        </div>
      ),
      sleep: (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Moon size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Log Sleep</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => setActiveModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="grid grid-2 mb-2">
                <div className="form-group">
                  <label className="form-label">Hours</label>
                  <input 
                    type="number" 
                    placeholder="7"
                    value={sleep.hours}
                    onChange={e => setSleep({...sleep, hours: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Minutes</label>
                  <input 
                    type="number" 
                    placeholder="30"
                    value={sleep.minutes}
                    onChange={e => setSleep({...sleep, minutes: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Sleep Quality: {sleep.quality}/10</label>
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  value={sleep.quality}
                  onChange={e => setSleep({...sleep, quality: parseInt(e.target.value)})}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary btn-block" onClick={logSleep} disabled={!sleep.hours}>
                Log Sleep
              </button>
            </div>
          </div>
        </div>
      ),
      workout: (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Dumbbell size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Log Workout</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => setActiveModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Workout Type</label>
                <select 
                  value={workout.type}
                  onChange={e => setWorkout({...workout, type: e.target.value})}
                >
                  <option value="">Select type...</option>
                  <option value="Running">Running</option>
                  <option value="Cycling">Cycling</option>
                  <option value="Swimming">Swimming</option>
                  <option value="Weightlifting">Weightlifting</option>
                  <option value="HIIT">HIIT</option>
                  <option value="Yoga">Yoga</option>
                  <option value="Walking">Walking</option>
                  <option value="Sports">Sports</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="grid grid-2">
                <div className="form-group">
                  <label className="form-label">Duration (min)</label>
                  <input 
                    type="number" 
                    placeholder="30"
                    value={workout.duration}
                    onChange={e => setWorkout({...workout, duration: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Calories (est)</label>
                  <input 
                    type="number" 
                    placeholder="200"
                    value={workout.calories}
                    onChange={e => setWorkout({...workout, calories: e.target.value})}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary btn-block" onClick={logWorkout} disabled={!workout.type || !workout.duration}>
                Log Workout
              </button>
            </div>
          </div>
        </div>
      ),
      meds: (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><Pill size={18} style={{display: 'inline', verticalAlign: 'middle', marginRight: '6px'}} /> Log Medication</h3>
              <button className="btn btn-icon btn-ghost" onClick={() => setActiveModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Medication Name</label>
                <input 
                  type="text" 
                  placeholder="e.g., Vitamin D, Protein Powder"
                  value={meds.name}
                  onChange={e => setMeds({...meds, name: e.target.value})}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary btn-block" onClick={logMeds} disabled={!meds.name}>
                Log Taken
              </button>
            </div>
          </div>
        </div>
      )
    }

    return modals[activeModal] || null
  }

  return (
    <div className="dashboard">
      {/* Connected Device Banner */}
      {connectedDevice ? (
        <div className="device-connected-banner">
          <div className="device-banner-info">
            <div className={`integration-status connected`}>
              {connectedDevice.name}
            </div>
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>Connected</span>
          </div>
          <div className="device-banner-actions">
            <button className="btn btn-secondary btn-sm" onClick={syncDevice} disabled={deviceSyncing}>
              {deviceSyncing ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Sync
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/profile')}>
              <Watch size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="device-connected-banner no-device">
          <div className="device-banner-info">
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>No Device Connected</span>
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>Connect a device in your profile to sync health data</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/profile')}>
            Connect <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Main Stats Grid */}
      <div className="grid grid-2">
        {/* Calories Intake Card */}
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon orange"><Utensils size={18} /></div>
            <span className={`badge ${calPercent > 100 ? 'badge-danger' : 'badge-success'}`}>
              {Math.round(calPercent)}%
            </span>
          </div>
          <div className="stat-value">{Math.round(totals.calories)}</div>
          <div className="stat-label">Intake</div>
          <div className="progress-bar">
            <div className="progress-fill orange" style={{width: `${Math.min(calPercent, 100)}%`}}></div>
          </div>
          <div className="stat-footer">
            {remaining.calories > 0 ? `${Math.round(remaining.calories)} cal left` : `${Math.abs(Math.round(remaining.calories))} over`}
          </div>
        </div>

        {/* Calories Burned Card */}
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon danger"><Flame size={18} /></div>
            {totalBurned > 0 && (
              <span className="badge badge-danger">
                {burned_source || ''}
              </span>
            )}
          </div>
          <div className="stat-value">{totalBurned > 0 ? Math.round(totalBurned) : '--'}</div>
          <div className="stat-label">Burned</div>
          <div className="progress-bar">
            <div className="progress-fill burn" style={{width: `${burnedPercent}%`}}></div>
          </div>
          <div className="stat-footer">
            {totalBurned > 0 ? `Net: ${Math.round(totals.calories - totalBurned)} cal` : 'Connect device to track'}
          </div>
        </div>

        {/* Protein Card */}
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon green"><Dumbbell size={18} /></div>
            <span className="badge badge-success">{Math.round(proteinPercent)}%</span>
          </div>
          <div className="stat-value">{Math.round(totals.protein)}<span className="unit">g</span></div>
          <div className="stat-label">Protein</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{width: `${Math.min(proteinPercent, 100)}%`}}></div>
          </div>
          <div className="stat-footer">{Math.round(remaining.protein)}g left</div>
        </div>

        {/* Water Card */}
        <div className="stat-card" onClick={() => setActiveModal('water')} style={{cursor: 'pointer'}}>
          <div className="stat-header">
            <div className="stat-icon cyan"><Droplets size={18} /></div>
            <span className="badge badge-info">{Math.round(waterPercent)}%</span>
          </div>
          <div className="stat-value">{waterAmount}<span className="unit">ml</span></div>
          <div className="stat-label">Water</div>
          <div className="progress-bar">
            <div className="progress-fill blue" style={{width: `${Math.min(waterPercent, 100)}%`}}></div>
          </div>
          <div className="stat-footer">Tap to add</div>
        </div>

        {/* Recovery Card */}
        <div className="stat-card">
          <div className="stat-header">
            <div className="stat-icon" style={{ background: `${getRecoveryColor(recoveryScore)}20`, color: getRecoveryColor(recoveryScore) }}>
              <Battery size={18} />
            </div>
            {recoveryScore && (
              <span className="badge" style={{ 
                background: `${getRecoveryColor(recoveryScore)}20`,
                color: getRecoveryColor(recoveryScore)
              }}>
                {recoveryScore >= 67 ? 'Green' : recoveryScore >= 33 ? 'Yellow' : 'Red'}
              </span>
            )}
          </div>
          <div className="stat-value" style={{ color: getRecoveryColor(recoveryScore) }}>
            {recoveryScore || '--'}<span className="unit">%</span>
          </div>
          <div className="stat-label">{whoop?.recovery_score ? 'Recovery' : 'Readiness (Derived)'}</div>
          {(recoveryRestingHr || recoveryHrv) && (
            <div className="stat-footer" style={{display: 'flex', gap: '0.75rem'}}>
              <span><Heart size={12} style={{display: 'inline', verticalAlign: 'middle'}} /> {recoveryRestingHr || '--'}</span>
              <span><Activity size={12} style={{display: 'inline', verticalAlign: 'middle'}} /> {recoveryHrv || '--'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="section-header">
        <h3 className="section-title">
          <Plus size={18} /> Quick Track
        </h3>
      </div>
      <div className="quick-actions">
        <button className="quick-action" onClick={() => setActiveModal('water')}>
          <div className="quick-action-icon water"><GlassWater size={22} /></div>
          <span className="quick-action-label">Water</span>
        </button>
        <button className="quick-action" onClick={() => setActiveModal('weight')}>
          <div className="quick-action-icon weight"><Scale size={22} /></div>
          <span className="quick-action-label">Weight</span>
        </button>
        <button className="quick-action" onClick={() => setActiveModal('mood')}>
          <div className="quick-action-icon mood"><Smile size={22} /></div>
          <span className="quick-action-label">Mood</span>
        </button>
        <button className="quick-action" onClick={() => setActiveModal('sleep')}>
          <div className="quick-action-icon sleep"><Bed size={22} /></div>
          <span className="quick-action-label">Sleep</span>
        </button>
        <button className="quick-action" onClick={() => setActiveModal('workout')}>
          <div className="quick-action-icon workout"><Activity size={22} /></div>
          <span className="quick-action-label">Workout</span>
        </button>
        <button className="quick-action" onClick={() => setActiveModal('meds')}>
          <div className="quick-action-icon meds"><Pill size={22} /></div>
          <span className="quick-action-label">Meds</span>
        </button>
        <button className="quick-action" onClick={() => window.location.href = '/scan'}>
          <div className="quick-action-icon fast"><ScanLine size={22} /></div>
          <span className="quick-action-label">Scan Food</span>
        </button>
        <button className="quick-action" onClick={() => window.location.href = '/food'}>
          <div className="quick-action-icon steps"><Utensils size={22} /></div>
          <span className="quick-action-label">Food Log</span>
        </button>
      </div>

      {/* Active Challenges Widget */}
      {activeChallenges.length > 0 && (
        <div className="mt-2">
          <div className="section-header">
            <h3 className="section-title">
              <Trophy size={18} /> Active Challenges
            </h3>
            <button className="btn btn-sm btn-ghost" onClick={() => navigate('/teams')}>
              View All <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {activeChallenges.slice(0, 2).map(c => (
              <div
                key={c.id}
                className="card"
                onClick={() => navigate(`/teams/${c.team_id}/challenges/${c.id}`)}
                style={{ cursor: 'pointer', padding: '1rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600 }}>{c.name}</h4>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.team_name}</span>
                  </div>
                  <span className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                    #{c.my_rank}/{c.total_participants}
                  </span>
                </div>
                <div className="progress-bar" style={{ height: '6px' }}>
                  <div className="progress-fill purple" style={{ width: `${Math.min(c.today_percentage || 0, 100)}%` }}></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.375rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <span>{Math.round(c.today_percentage || 0)}% today</span>
                  <span>{Math.round(c.overall_percentage || 0)}% overall</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sleep Card (WHOOP or Fitbit-derived fallback) */}
      {sleepHours > 0 && (
        <div className="card mt-2">
          <div className="section-header">
            <h3 className="section-title">
              <Moon size={18} /> Sleep
            </h3>
            {sleepScore && (
              <span className="badge badge-info">{Math.round(sleepScore)}%</span>
            )}
          </div>
          <div className="stat-value">{formatHours(sleepHours)}</div>
          {whoop?.sleep_cycles ? (
            <div className="stat-footer" style={{display: 'flex', gap: '1rem', marginTop: '0.5rem'}}>
              <span>{whoop.sleep_cycles} cycles</span>
              <span>{whoop.disturbances} disturbances</span>
            </div>
          ) : (
            <div className="stat-footer" style={{display: 'flex', gap: '1rem', marginTop: '0.5rem'}}>
              {fitbit_derived?.sleep_debt_hours != null && <span>Debt: {fitbit_derived.sleep_debt_hours}h</span>}
              {fitbit_derived?.deep_rem_ratio_pct != null && <span>Deep+REM: {fitbit_derived.deep_rem_ratio_pct}%</span>}
              {fitbit?.last_metric_at && <span>Updated: {new Date(fitbit.last_metric_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
          )}
        </div>
      )}

      {/* Recent Workouts */}
      {workouts && workouts.length > 0 && (
        <div className="mt-2">
          <div className="section-header">
            <h3 className="section-title">
              <Trophy size={18} /> Recent Workouts
            </h3>
          </div>
          <div className="timeline">
            {workouts.slice(0, 3).map(workout => (
              <div key={workout.workout_id} className="timeline-item">
                <div className="timeline-icon warning">
                  <Activity size={20} />
                </div>
                <div className="timeline-content">
                  <h4>{workout.sport_name}</h4>
                  <p>{workout.duration_minutes} min • {workout.calories} cal</p>
                </div>
                <div className="timeline-value warning">
                  {workout.strain?.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Food */}
      <div className="mt-2">
        <div className="section-header">
          <h3 className="section-title">
            <Sunrise size={18} /> Today's Food
          </h3>
          <span className="section-count">{food_logs.length} items</span>
        </div>

        {food_logs.length === 0 ? (
          <div className="empty-state" style={{padding: '2rem 1rem'}}>
            <div className="empty-state-icon" style={{width: '64px', height: '64px'}}>
              <Plus size={28} />
            </div>
            <h3>No food logged yet</h3>
            <p style={{marginBottom: '1rem'}}>Start tracking your nutrition</p>
            <button className="btn btn-primary" onClick={() => window.location.href = '/scan'}>
              <Plus size={16} /> Add Food
            </button>
          </div>
        ) : (
          <div className="card">
            <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
              {food_logs.slice(0, 5).map(log => (
                <div key={log.id} className="food-log-item">
                  <div className="food-log-info">
                    <h4>{log.name}</h4>
                    <div className="food-log-meta">
                      <span className="source">{log.source}</span>
                      <span>•</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      {log.protein > 0 && <span className="macro">P: {Math.round(log.protein)}g</span>}
                    </div>
                  </div>
                  <div className="food-log-calories">
                    <span className="calorie-badge">{Math.round(log.calories)}</span>
                  </div>
                </div>
              ))}
            </div>
            
            {food_logs.length > 5 && (
              <button 
                className="btn btn-ghost btn-block mt-2" 
                onClick={() => window.location.href = '/food'}
              >
                View all {food_logs.length} items <ChevronRight size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Render Modal */}
      {renderModal()}
    </div>
  )
}

export default Dashboard
