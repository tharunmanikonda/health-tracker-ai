import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { 
  LayoutDashboard, 
  Utensils, 
  ScanLine, 
  TrendingUp,
  LogOut,
  User,
  Bot
} from 'lucide-react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import FoodLog from './components/FoodLog'
import BarcodeScanner from './components/BarcodeScanner'
import Insights from './components/Insights'
import { AICoach } from './components/AICoach'

function AppContent() {
  const { isAuthenticated, user, logout } = useAuth()

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
          <h1>💪 Health Tracker</h1>
          <div className="header-actions">
            <span className="user-greeting">Hi, {user?.name || 'User'}</span>
            <button 
              className="btn btn-icon btn-ghost logout-btn" 
              onClick={logout}
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/scan" element={<BarcodeScanner />} />
          <Route path="/food" element={<FoodLog />} />
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
          to="/scan" 
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <ScanLine size={24}/>
          <span>Scan</span>
        </NavLink>
        <NavLink 
          to="/food" 
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        >
          <Utensils size={24}/>
          <span>Food</span>
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
