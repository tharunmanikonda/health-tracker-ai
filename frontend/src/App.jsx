import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Utensils,
  Users,
  TrendingUp,
  Bot,
  Activity,
  User
} from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import FoodLog from './components/FoodLog'
import BarcodeScanner from './components/BarcodeScanner'
import Insights from './components/Insights'
import { AICoach } from './components/AICoach'
import TeamsPage from './components/teams/TeamsPage'
import TeamDetail from './components/teams/TeamDetail'
import ChallengeDetail from './components/teams/ChallengeDetail'
import Profile from './components/Profile'

function AppContent() {
  const { isAuthenticated, user } = useAuth()
  const navigate = useNavigate()

  // Theme state with localStorage persistence + system preference detection
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  // If not authenticated, only show login page
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <div className="app">
      {/* Fixed Header */}
      <header className="header">
        <div className="header-content">
          <div className="header-brand">
            <div className="header-logo" aria-hidden="true">
              <Activity size={16} />
            </div>
            <h1>HealthSync</h1>
          </div>
          <div className="header-actions">
            <button
              className="profile-avatar"
              onClick={() => navigate('/profile')}
              title="Profile"
            >
              {user?.name ? user.name.charAt(0).toUpperCase() : <User size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/profile" element={<Profile theme={theme} toggleTheme={toggleTheme} />} />
          <Route path="/scan" element={<BarcodeScanner />} />
          <Route path="/food" element={<FoodLog />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<TeamDetail />} />
          <Route path="/teams/:teamId/challenges/:challengeId" element={<ChallengeDetail />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/coach" element={<AICoach />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Bottom Navigation */}
      <nav className="nav">
        <NavLink
          to="/"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          end
        >
          <LayoutDashboard size={24}/>
          <span>Home</span>
        </NavLink>
        <NavLink
          to="/food"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <Utensils size={24}/>
          <span>Food</span>
        </NavLink>
        <NavLink
          to="/teams"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <Users size={24}/>
          <span>Teams</span>
        </NavLink>
        <NavLink
          to="/insights"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <TrendingUp size={24}/>
          <span>Insights</span>
        </NavLink>
        <NavLink
          to="/coach"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <Bot size={24}/>
          <span>Coach</span>
        </NavLink>
      </nav>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  )
}

export default App
