/**
 * Constants and configuration values
 */

import {Platform} from 'react-native';

// API Configuration - Use your local IP for device testing
// Update this IP if your network changes
const LOCAL_IP = '10.0.0.116';
export const API_BASE_URL = __DEV__
  ? `http://${LOCAL_IP}:8000/api`
  : 'https://your-production-domain.com/api';
export const WEBAPP_URL = __DEV__
  ? `http://${LOCAL_IP}:5173`
  : 'https://your-production-domain.com';

// Health data constants
export const HEALTH_METRICS = {
  STEPS: 'steps',
  HEART_RATE: 'heart_rate',
  RESTING_HEART_RATE: 'resting_heart_rate',
  HEART_RATE_VARIABILITY: 'heart_rate_variability',
  SLEEP: 'sleep',
  SLEEP_DEEP: 'sleep_deep',
  SLEEP_REM: 'sleep_rem',
  SLEEP_LIGHT: 'sleep_light',
  SLEEP_AWAKE: 'sleep_awake',
  WORKOUT: 'workout',
  ACTIVE_CALORIES: 'active_calories',
  BASAL_CALORIES: 'basal_calories',
  TOTAL_CALORIES: 'total_calories',
  DISTANCE: 'distance',
  FLIGHTS_CLIMBED: 'flights_climbed',
  OXYGEN_SATURATION: 'oxygen_saturation',
  RESPIRATORY_RATE: 'respiratory_rate',
  BODY_TEMPERATURE: 'body_temperature',
} as const;

// Units for health metrics
export const HEALTH_UNITS = {
  COUNT: 'count',
  COUNT_MIN: 'count/min',
  MS: 'ms',
  HR: 'hr',
  MIN: 'min',
  KCAL: 'kcal',
  METER: 'm',
  KM: 'km',
  PERCENT: '%',
  CELSIUS: 'degC',
  MMHG: 'mmHg',
} as const;

// AsyncStorage keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: '@auth_token',
  LAST_SYNC_TIME: '@last_sync_time',
  APP_SETTINGS: '@app_settings',
  PENDING_HEALTH_DATA: '@pending_health_data',
  DEVICE_ID: '@device_id',
  WEBHOOK_CONFIG: '@webhook_config',
} as const;

// Background sync configuration
export const DEFAULT_SYNC_CONFIG = {
  enabled: true,
  intervalMinutes: 15,
  requiresCharging: false,
  requiresNetwork: true,
  syncOnWiFiOnly: false,
};

// Health permissions (iOS HealthKit)
export const HEALTHKIT_PERMISSIONS = {
  // Quantities to read
  read: [
    'Steps',
    'DistanceWalkingRunning',
    'HeartRate',
    'RestingHeartRate',
    'HeartRateVariabilitySDNN',
    'ActiveEnergyBurned',
    'BasalEnergyBurned',
    'SleepAnalysis',
    'Workout',
    'FlightsClimbed',
    'OxygenSaturation',
    'RespiratoryRate',
    'BodyTemperature',
    'BloodPressureSystolic',
    'BloodPressureDiastolic',
  ],
  // Quantities to write (we don't write, only read)
  write: [],
};

// Health Connect permissions (Android)
export const HEALTH_CONNECT_PERMISSIONS = {
  read: [
    'Steps',
    'Distance',
    'HeartRate',
    'RestingHeartRate',
    'HeartRateVariability',
    'ActiveCaloriesBurned',
    'BasalMetabolicRate',
    'TotalCaloriesBurned',
    'SleepSession',
    'SleepStage',
    'ExerciseSession',
    'FloorsClimbed',
    'OxygenSaturation',
    'RespiratoryRate',
    'BodyTemperature',
    'BloodPressure',
  ],
  write: [],
};

// Webhook events
export const WEBHOOK_EVENTS = {
  HEALTH_DATA_UPDATED: 'health_data_updated',
  SYNC_COMPLETED: 'sync_completed',
  SYNC_FAILED: 'sync_failed',
} as const;

// Platform detection helpers
export const IS_IOS = Platform.OS === 'ios';
export const IS_ANDROID = Platform.OS === 'android';

// Sync intervals in milliseconds
export const SYNC_INTERVALS = {
  MINIMUM: 15 * 60 * 1000, // 15 minutes (minimum allowed by OS)
  DEFAULT: 15 * 60 * 1000, // 15 minutes
  HOURLY: 60 * 60 * 1000,  // 1 hour
  DAILY: 24 * 60 * 60 * 1000, // 24 hours
};

// Error messages
export const ERROR_MESSAGES = {
  HEALTH_PERMISSION_DENIED: 'Health permissions were denied. Please enable them in Settings.',
  SYNC_FAILED: 'Failed to sync health data. Will retry later.',
  NETWORK_ERROR: 'Network connection failed. Please check your connection.',
  AUTH_REQUIRED: 'Authentication required. Please log in again.',
  BACKGROUND_SYNC_DISABLED: 'Background sync is disabled by system settings.',
  HEALTH_CONNECT_NOT_AVAILABLE: 'Health Connect is not available on this device.',
  HEALTHKIT_NOT_AVAILABLE: 'HealthKit is not available on this device.',
};

// Time ranges for data fetching
export const TIME_RANGES = {
  TODAY: { days: 0, label: 'Today' },
  WEEK: { days: 7, label: 'Last 7 days' },
  MONTH: { days: 30, label: 'Last 30 days' },
  QUARTER: { days: 90, label: 'Last 90 days' },
};