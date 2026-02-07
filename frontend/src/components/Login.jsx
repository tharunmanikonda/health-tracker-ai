import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  Eye, EyeOff, Mail, Lock, CheckCircle, 
  AlertCircle, Activity, ArrowRight
} from 'lucide-react';

function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { login, register } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (!email || !password) {
      setError('Please enter both email and password');
      setLoading(false);
      return;
    }

    if (!isLogin && !name) {
      setError('Please enter your name');
      setLoading(false);
      return;
    }

    let result;
    if (isLogin) {
      result = await login(email, password, rememberMe);
    } else {
      result = await register(email, password, name);
    }

    if (!result.success) {
      setError(result.error);
    } else {
      setSuccess(isLogin ? 'Welcome back!' : 'Account created successfully!');
    }

    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-container">
        {/* Logo Section */}
        <div className="login-header">
          <div className="login-logo">
            <Activity size={40} />
          </div>
          <h1>HealthSync</h1>
          <p>Track your nutrition, fitness, and wellness</p>
        </div>

        {/* Form Card */}
        <div className="login-card">
          <div className="login-tabs">
            <button 
              className={`login-tab ${isLogin ? 'active' : ''}`}
              onClick={() => { setIsLogin(true); setError(''); }}
            >
              Sign In
            </button>
            <button 
              className={`login-tab ${!isLogin ? 'active' : ''}`}
              onClick={() => { setIsLogin(false); setError(''); }}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="login-alert error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="login-alert success">
              <CheckCircle size={18} />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            {!isLogin && (
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <div className="input-wrapper">
                  <Activity size={18} className="input-icon" />
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div className="input-wrapper">
                <Mail size={18} className="input-icon" />
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {isLogin && (
                <a href="#" className="forgot-password">
                  Forgot password?
                </a>
              )}
            </div>

            {isLogin && (
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span className="checkbox-custom"></span>
                  <span>Remember me</span>
                </label>
              </div>
            )}

            <button 
              type="submit" 
              className="btn btn-primary btn-lg btn-block"
              disabled={loading}
            >
              {loading ? (
                <span className="spinner-small"></span>
              ) : (
                <>
                  {isLogin ? 'Sign In' : 'Create Account'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="login-divider">
            <span>or continue with</span>
          </div>

          <div className="demo-login">
            <p>Demo Account:</p>
            <code>manikondatharun885@gmail.com</code>
            <code>Tharun1234</code>
          </div>
        </div>

        <p className="login-footer">
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          min-height: 100dvh;
          background: var(--bg-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          padding-top: calc(1rem + var(--safe-top));
          padding-bottom: calc(1rem + var(--safe-bottom));
          position: relative;
          overflow: hidden;
        }

        /* Mesh gradient background orbs */
        .login-page::before {
          content: '';
          position: absolute;
          top: -30%;
          left: -20%;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none;
        }

        .login-page::after {
          content: '';
          position: absolute;
          bottom: -30%;
          right: -20%;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none;
        }

        .login-container {
          width: 100%;
          max-width: 420px;
          animation: fadeInUp 0.5s ease;
          position: relative;
          z-index: 1;
        }

        .login-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .login-logo {
          width: 72px;
          height: 72px;
          background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
          color: white;
          box-shadow: 0 8px 32px rgba(14, 165, 233, 0.3), 0 0 60px rgba(139, 92, 246, 0.15);
        }

        .login-header h1 {
          font-family: var(--font-heading);
          font-size: 1.75rem;
          font-weight: 700;
          background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 0.5rem;
        }

        .login-header p {
          color: var(--text-muted);
          font-size: 0.9375rem;
        }

        .login-card {
          background: var(--glass-bg);
          backdrop-filter: blur(var(--glass-blur));
          -webkit-backdrop-filter: blur(var(--glass-blur));
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-xl);
          padding: 1.5rem;
          box-shadow: var(--shadow-lg);
        }

        .login-tabs {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
          padding: 0.25rem;
          background: var(--bg-secondary);
          border-radius: var(--radius);
        }

        .login-tab {
          flex: 1;
          padding: 0.75rem;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-family: var(--font-heading);
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          border-radius: var(--radius-sm);
          transition: all var(--transition-fast);
        }

        .login-tab:hover {
          color: var(--text-primary);
        }

        .login-tab.active {
          background: linear-gradient(135deg, var(--primary), var(--secondary));
          color: white;
          box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
        }

        .login-alert {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 1rem;
          border-radius: var(--radius);
          margin-bottom: 1rem;
          font-size: 0.875rem;
        }

        .login-alert.error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }

        .login-alert.success {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: var(--accent);
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 1rem;
          color: var(--text-muted);
          pointer-events: none;
        }

        .input-wrapper input {
          padding-left: 2.75rem;
          padding-right: 2.75rem;
        }

        .password-toggle {
          position: absolute;
          right: 1rem;
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 0.25rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .password-toggle:hover {
          color: var(--text-primary);
        }

        .forgot-password {
          display: block;
          text-align: right;
          margin-top: 0.5rem;
          font-size: 0.8rem;
          color: var(--primary);
          text-decoration: none;
        }

        .forgot-password:hover {
          text-decoration: underline;
        }

        .checkbox-group {
          margin-top: 0.5rem;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          cursor: pointer;
          font-size: 0.875rem;
          color: var(--text-secondary);
        }

        .checkbox-label input {
          display: none;
        }

        .checkbox-custom {
          width: 20px;
          height: 20px;
          border: 2px solid var(--border);
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all var(--transition-fast);
        }

        .checkbox-label input:checked + .checkbox-custom {
          background: linear-gradient(135deg, var(--primary), var(--secondary));
          border-color: var(--primary);
        }

        .checkbox-label input:checked + .checkbox-custom::after {
          content: '\\2713';
          color: white;
          font-size: 12px;
          font-weight: bold;
        }

        .spinner-small {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .login-divider {
          display: flex;
          align-items: center;
          margin: 1.5rem 0;
          color: var(--text-muted);
          font-size: 0.8rem;
        }

        .login-divider::before,
        .login-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        .login-divider span {
          padding: 0 1rem;
        }

        .demo-login {
          text-align: center;
          padding: 1rem;
          background: var(--bg-secondary);
          border-radius: var(--radius);
          border: 1px dashed var(--border);
        }

        .demo-login p {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .demo-login code {
          display: block;
          font-family: monospace;
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin: 0.25rem 0;
        }

        .login-footer {
          text-align: center;
          margin-top: 1.5rem;
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        @media (max-width: 480px) {
          .login-container {
            max-width: 100%;
          }

          .login-card {
            padding: 1.25rem;
          }

          .login-header h1 {
            font-size: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
}

export default Login;
