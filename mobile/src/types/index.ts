/**
 * Type definitions for Health Tracker Mobile
 */

// Health data types
export type HealthMetricType = 
  | 'steps'
  | 'heart_rate'
  | 'heart_rate_variability'
  | 'resting_heart_rate'
  | 'sleep'
  | 'sleep_deep'
  | 'sleep_rem'
  | 'sleep_light'
  | 'sleep_awake'
  | 'workout'
  | 'active_calories'
  | 'basal_calories'
  | 'total_calories'
  | 'distance'
  | 'flights_climbed'
  | 'oxygen_saturation'
  | 'respiratory_rate'
  | 'body_temperature'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic';

export interface HealthMetric {
  id?: number;
  source: 'healthkit' | 'healthconnect' | 'manual';
  type: HealthMetricType;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  metadata?: Record<string, any>;
  timestamp: string;
  processed: boolean;
  syncedToBackend: boolean;
}

export interface HealthWorkout {
  id?: number;
  source: 'healthkit' | 'healthconnect';
  workoutType: string;
  startDate: string;
  endDate: string;
  duration: number; // seconds
  calories?: number;
  distance?: number;
  heartRateAvg?: number;
  heartRateMax?: number;
  heartRateMin?: number;
  metadata?: Record<string, any>;
  timestamp: string;
  processed: boolean;
  syncedToBackend: boolean;
}

export interface SleepAnalysis {
  id?: number;
  source: 'healthkit' | 'healthconnect';
  startDate: string;
  endDate: string;
  duration: number; // seconds
  deepSleep?: number; // seconds
  remSleep?: number; // seconds
  lightSleep?: number; // seconds
  awake?: number; // seconds
  efficiency?: number; // percentage
  metadata?: Record<string, any>;
  timestamp: string;
  processed: boolean;
  syncedToBackend: boolean;
}

// Webhook payload types
export interface WebhookPayload {
  event: 'health_data_updated' | 'sync_completed' | 'sync_failed';
  timestamp: string;
  data: {
    metrics?: HealthMetric[];
    workouts?: HealthWorkout[];
    sleep?: SleepAnalysis[];
    deviceInfo: DeviceInfo;
  };
}

export interface DeviceInfo {
  platform: 'ios' | 'android';
  osVersion: string;
  appVersion: string;
  deviceId: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  isSyncing: boolean;
  pendingItems: number;
  lastError?: string;
}

// Permission types
export interface HealthPermissions {
  steps: boolean;
  heartRate: boolean;
  sleep: boolean;
  workouts: boolean;
  calories: boolean;
}

// WebView message types
export interface WebViewMessage {
  type: 'health_data' | 'auth_token' | 'sync_request' | 'sync_status' | 'error';
  payload: any;
}

export interface WebViewHealthDataMessage {
  type: 'health_data';
  payload: {
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  };
}

// Background sync config
export interface BackgroundSyncConfig {
  enabled: boolean;
  intervalMinutes: number;
  requiresCharging: boolean;
  requiresNetwork: boolean;
  syncOnWiFiOnly: boolean;
}

// Settings types
export interface AppSettings {
  backendUrl: string;
  webappUrl: string;
  authToken?: string;
  syncConfig: BackgroundSyncConfig;
  permissions: HealthPermissions;
  webhookEnabled: boolean;
  webhookUrl?: string;
}