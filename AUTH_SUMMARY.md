# Health Tracker - Authentication System Summary

## Overview
Complete JWT-based authentication system added to the Health Tracker app. Users must now log in to access the dashboard and tracking features.

## Default User (Pre-seeded)
- **Email:** manikondatharun885@gmail.com
- **Password:** Tharun1234
- **Name:** Tharun

## Database Changes

### New Tables
1. **users** - User accounts
   - id, email, password_hash, name
   - daily_calorie_goal, daily_protein_goal
   - is_active, created_at, updated_at

### Updated Tables (Added user_id foreign key)
- whoop_metrics
- whoop_workouts
- whoop_cycles
- food_logs
- water_logs
- weight_logs
- mood_logs
- sleep_manual
- workouts_manual
- medication_logs
- daily_summaries
- user_settings

## Backend API Endpoints

### Authentication (Public)
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/register` - Create new account
- `GET /api/auth/me` - Get current user (protected)
- `POST /api/auth/logout` - Logout (protected)
- `PUT /api/auth/profile` - Update profile (protected)
- `PUT /api/auth/password` - Change password (protected)

### Protected Routes (Require JWT Token)
All other `/api/*` routes now require authentication via Bearer token in Authorization header.

## Frontend Components

### New Files
1. **src/contexts/AuthContext.jsx**
   - Global authentication state
   - Login/register/logout functions
   - Axios interceptor for token management
   - Auto-redirect on 401 errors

2. **src/components/Login.jsx**
   - Beautiful login/registration UI
   - Email + password fields
   - "Remember me" checkbox
   - Password visibility toggle
   - Demo account display
   - Smooth animations

3. **src/components/ProtectedRoute.jsx**
   - Route guard for authenticated routes
   - Shows loading spinner while checking auth
   - Redirects to login if not authenticated

### Updated Files
1. **src/App.jsx**
   - Wrapped with AuthProvider
   - Shows Login when not authenticated
   - Shows app with logout button when authenticated
   - User greeting in header

2. **src/index.css**
   - Added header action styles
   - User greeting styles
   - Logout button styles

## Security Features
- Passwords hashed with bcrypt (10 rounds)
- JWT tokens with expiration (7 days default, 30 days with "remember me")
- Auth middleware protects all data routes
- User data isolation (user_id filtering on all queries)
- Token stored in localStorage
- Automatic logout on token expiration

## Multi-user Support
- Each user has isolated data
- User-specific queries on all tables
- Registration endpoint available for new users
- Admin user auto-created on first run

## Login Flow
1. User visits app → sees Login page
2. Enters credentials → POST /api/auth/login
3. JWT token received → stored in localStorage
4. Axios configured with Bearer token
5. User redirected to Dashboard
6. All API calls include auth token
7. Logout clears token and redirects to login

## Files Modified/Created

### Backend
- `backend/database.js` - Added users table, user_id to all tables, default user
- `backend/server.js` - Added auth routes and middleware
- `backend/routes/auth.js` - NEW - Authentication routes
- `backend/routes/food.js` - Added user_id filtering
- `backend/routes/dashboard.js` - Added user_id filtering
- `backend/services/food.js` - Updated to handle user_id

### Frontend
- `frontend/src/contexts/AuthContext.jsx` - NEW - Auth state management
- `frontend/src/components/Login.jsx` - NEW - Login UI
- `frontend/src/components/ProtectedRoute.jsx` - NEW - Route guard
- `frontend/src/App.jsx` - Updated for auth flow
- `frontend/src/index.css` - Added header/auth styles

## Dependencies Added
- `bcrypt` - Password hashing
- `jsonwebtoken` - JWT token handling

## Testing
1. Start backend: `node server.js`
2. Default user auto-created
3. Open app → see Login page
4. Login with: manikondatharun885@gmail.com / Tharun1234
5. Access dashboard and all features
6. Logout → returns to login page
