import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  User, Sun, Moon, Watch, ChevronRight, LogOut,
  RefreshCw, X, Check, Unlink, ArrowLeft
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const DEVICES = [
  { id: 'whoop', name: 'WHOOP', description: 'Recovery, strain & sleep tracking', authPath: '/api/whoop/auth' },
  { id: 'oura', name: 'Oura Ring', description: 'Sleep, readiness & activity', authEndpoint: '/api/oura/auth-url' },
  { id: 'garmin', name: 'Garmin Watch', description: 'Activity, heart rate & GPS', authEndpoint: '/api/garmin/auth-url' },
  { id: 'fitbit', name: 'Fitbit', description: 'Steps, sleep & heart rate', authEndpoint: '/api/wearables/fitbit/auth-url' },
]

function Profile({ theme, toggleTheme }) {
  const navigate = useNavigate()
  const { user, logout, updateProfile } = useAuth()

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(user?.name || '')
  const [savingName, setSavingName] = useState(false)

  const [connectedDevice, setConnectedDevice] = useState(null)
  const [deviceLoading, setDeviceLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    fetchConnectedDevice()
  }, [])

  const fetchConnectedDevice = async () => {
    setDeviceLoading(true)
    try {
      // Check all providers to find the single connected one
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
    } finally {
      setDeviceLoading(false)
    }
  }

  const handleSaveName = async () => {
    if (!nameInput.trim() || nameInput === user?.name) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    try {
      await updateProfile({ name: nameInput.trim() })
      setEditingName(false)
    } catch {
      // keep editing open on failure
    } finally {
      setSavingName(false)
    }
  }

  const disconnectDevice = async (provider) => {
    setDisconnecting(true)
    try {
      if (provider === 'whoop') {
        await axios.post('/api/whoop/disconnect')
      } else if (provider === 'fitbit') {
        await axios.post('/api/wearables/fitbit/disconnect')
      } else {
        await axios.post(`/api/${provider}/disconnect`)
      }
      setConnectedDevice(null)
    } catch (err) {
      console.error('Failed to disconnect:', err)
    } finally {
      setDisconnecting(false)
    }
  }

  const connectDevice = async (device) => {
    // If a device is already connected, disconnect it first
    if (connectedDevice) {
      await disconnectDevice(connectedDevice.provider)
    }

    // WHOOP uses a direct redirect, others return an authUrl
    if (device.authPath) {
      window.location.href = device.authPath
      return
    }

    try {
      const res = await axios.get(device.authEndpoint)
      const authUrl = res.data?.authUrl
      if (authUrl) {
        window.location.href = authUrl
      }
    } catch (err) {
      console.error(`Failed to connect ${device.name}:`, err)
      alert(`Could not start ${device.name} connection. Check server configuration.`)
    }
  }

  const syncDevice = async () => {
    if (!connectedDevice) return
    setSyncing(true)
    try {
      const provider = connectedDevice.provider
      if (provider === 'whoop') {
        await axios.post('/api/whoop/sync')
      } else if (provider === 'fitbit') {
        await axios.post('/api/wearables/fitbit/sync')
      } else if (provider === 'oura') {
        await axios.post('/api/oura/sync', { days: 30 })
      } else if (provider === 'garmin') {
        await axios.post('/api/garmin/sync', { days: 7 })
      }
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSyncing(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="profile-page">
      <div className="profile-page-header">
        <button className="btn btn-icon btn-ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </button>
        <h2>Profile</h2>
        <div style={{ width: 48 }} />
      </div>

      {/* User Info Card */}
      <div className="card profile-card">
        <div className="profile-user-section">
          <div className="profile-avatar-large">
            {user?.name ? user.name.charAt(0).toUpperCase() : <User size={28} />}
          </div>
          <div className="profile-info">
            {editingName ? (
              <div className="profile-name-edit">
                <input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                  autoFocus
                />
                <button className="btn btn-icon btn-ghost" onClick={handleSaveName} disabled={savingName}>
                  <Check size={16} />
                </button>
                <button className="btn btn-icon btn-ghost" onClick={() => { setEditingName(false); setNameInput(user?.name || '') }}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="profile-name-row" onClick={() => setEditingName(true)} style={{ cursor: 'pointer' }}>
                <h3>{user?.name || 'User'}</h3>
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>tap to edit</span>
              </div>
            )}
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>{user?.email || ''}</p>
          </div>
        </div>
      </div>

      {/* Appearance Card */}
      <div className="card profile-card">
        <h4 className="profile-card-title">Appearance</h4>
        <button className="profile-setting-row" onClick={toggleTheme}>
          <div className="profile-setting-left">
            {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            <span>Theme</span>
          </div>
          <div className="profile-setting-right">
            <span className="text-muted">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            <ChevronRight size={16} />
          </div>
        </button>
      </div>

      {/* Connected Device Card */}
      <div className="card profile-card">
        <h4 className="profile-card-title">Connected Device</h4>

        {deviceLoading ? (
          <div className="profile-device-loading">
            <RefreshCw size={16} className="spin" />
            <span className="text-muted">Checking connections...</span>
          </div>
        ) : connectedDevice && !showPicker ? (
          <div className="profile-device-connected">
            <div className="profile-device-info">
              <div className={`integration-status connected`}>
                {connectedDevice.name}
              </div>
            </div>
            <div className="profile-device-actions">
              <button className="btn btn-secondary btn-sm" onClick={syncDevice} disabled={syncing}>
                {syncing ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
                Sync
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPicker(true)}>
                Change
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => disconnectDevice(connectedDevice.provider)}
                disabled={disconnecting}
                style={{ color: 'var(--danger)' }}
              >
                <Unlink size={14} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {!showPicker && (
              <div className="profile-device-empty">
                <Watch size={24} style={{ color: 'var(--text-muted)' }} />
                <p className="text-muted">Connect a device to sync your health data</p>
                <button className="btn btn-primary btn-sm" onClick={() => setShowPicker(true)}>
                  Connect Device
                </button>
              </div>
            )}
          </>
        )}

        {showPicker && (
          <div className="device-picker">
            <div className="device-picker-header">
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {connectedDevice ? 'Switching will disconnect your current device' : 'Choose a device'}
              </span>
              <button className="btn btn-icon btn-ghost" onClick={() => setShowPicker(false)} style={{ width: 32, height: 32, minHeight: 32, padding: '0.25rem' }}>
                <X size={16} />
              </button>
            </div>
            <div className="device-picker-grid">
              {DEVICES.map(device => (
                <button
                  key={device.id}
                  className={`device-option ${connectedDevice?.provider === device.id ? 'current' : ''}`}
                  onClick={() => connectDevice(device)}
                >
                  <div className="device-option-name">{device.name}</div>
                  <div className="device-option-desc">{device.description}</div>
                  {connectedDevice?.provider === device.id && (
                    <span className="badge badge-success" style={{ marginTop: '0.5rem', fontSize: '0.7rem' }}>Current</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Logout */}
      <button className="btn btn-danger btn-block profile-logout" onClick={handleLogout}>
        <LogOut size={18} />
        Logout
      </button>
    </div>
  )
}

export default Profile
