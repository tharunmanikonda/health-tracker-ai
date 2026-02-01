/**
 * Health Sync Service
 * Handles data synchronization from HealthKit (iOS) and Health Connect (Android)
 */

import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {databaseService} from './database';
import {webhookService} from './webhook';
import {getDeviceInfo, getTimeRange, formatDateTime} from '../utils/helpers';
import {STORAGE_KEYS} from '../utils/constants';
import type {HealthMetric, HealthWorkout, SleepAnalysis, HealthPermissions} from '../types';

// Platform-specific imports
let HealthKit: any = null;
let HealthConnect: any = null;

if (Platform.OS === 'ios') {
  try {
    HealthKit = require('react-native-health').default;
  } catch (e) {
    console.warn('[HealthSync] react-native-health not available');
  }
} else if (Platform.OS === 'android') {
  try {
    HealthConnect = require('react-native-health-connect').default;
  } catch (e) {
    console.warn('[HealthSync] react-native-health-connect not available');
  }
}

// HealthKit constants
const HKConstants = Platform.OS === 'ios' && HealthKit ? {
  Constants: HealthKit.Constants,
} : null;

class HealthSyncService {
  private isAvailable: boolean = false;
  private hasPermissions: boolean = false;

  async initialize(): Promise<boolean> {
    try {
      if (Platform.OS === 'ios') {
        this.isAvailable = await this.initializeHealthKit();
      } else if (Platform.OS === 'android') {
        this.isAvailable = await this.initializeHealthConnect();
      }
      return this.isAvailable;
    } catch (error) {
      console.error('[HealthSync] Initialization failed:', error);
      return false;
    }
  }

  // iOS HealthKit initialization
  private async initializeHealthKit(): Promise<boolean> {
    if (!HealthKit) {
      console.warn('[HealthSync] HealthKit module not available');
      return false;
    }

    return new Promise((resolve) => {
      HealthKit.isAvailable((err: any, available: boolean) => {
        if (err || !available) {
          console.warn('[HealthSync] HealthKit not available:', err);
          resolve(false);
        } else {
          console.log('[HealthSync] HealthKit is available');
          resolve(true);
        }
      });
    });
  }

  // Android Health Connect initialization
  private async initializeHealthConnect(): Promise<boolean> {
    if (!HealthConnect) {
      console.warn('[HealthSync] Health Connect module not available');
      return false;
    }

    try {
      const isAvailable = await HealthConnect.initialize();
      console.log('[HealthSync] Health Connect availability:', isAvailable);
      return isAvailable;
    } catch (error) {
      console.error('[HealthSync] Health Connect init error:', error);
      return false;
    }
  }

  // Request permissions
  async requestPermissions(): Promise<boolean> {
    if (!this.isAvailable) {
      console.warn('[HealthSync] Health service not available');
      return false;
    }

    try {
      if (Platform.OS === 'ios') {
        this.hasPermissions = await this.requestHealthKitPermissions();
      } else if (Platform.OS === 'android') {
        this.hasPermissions = await this.requestHealthConnectPermissions();
      }
      return this.hasPermissions;
    } catch (error) {
      console.error('[HealthSync] Permission request failed:', error);
      return false;
    }
  }

  // iOS HealthKit permissions
  private async requestHealthKitPermissions(): Promise<boolean> {
    if (!HealthKit || !HKConstants) return false;

    const permissions = {
      read: [
        HKConstants?.Permissions?.Steps,
        HKConstants?.Permissions?.DistanceWalkingRunning,
        HKConstants?.Permissions?.HeartRate,
        HKConstants?.Permissions?.RestingHeartRate,
        HKConstants?.Permissions?.HeartRateVariabilitySDNN,
        HKConstants?.Permissions?.ActiveEnergyBurned,
        HKConstants?.Permissions?.BasalEnergyBurned,
        HKConstants?.Permissions?.SleepAnalysis,
        HKConstants?.Permissions?.Workout,
        HKConstants?.Permissions?.FlightsClimbed,
        HKConstants?.Permissions?.OxygenSaturation,
        HKConstants?.Permissions?.RespiratoryRate,
        HKConstants?.Permissions?.BodyTemperature,
      ].filter(Boolean),
      write: [],
    };

    return new Promise((resolve) => {
      HealthKit.initHealthKit(permissions, (err: any) => {
        if (err) {
          console.error('[HealthSync] HealthKit permissions error:', err);
          resolve(false);
        } else {
          console.log('[HealthSync] HealthKit permissions granted');
          resolve(true);
        }
      });
    });
  }

  // Android Health Connect permissions
  private async requestHealthConnectPermissions(): Promise<boolean> {
    if (!HealthConnect) return false;

    const permissions = [
      { accessType: 'read', recordType: 'Steps' },
      { accessType: 'read', recordType: 'Distance' },
      { accessType: 'read', recordType: 'HeartRate' },
      { accessType: 'read', recordType: 'RestingHeartRate' },
      { accessType: 'read', recordType: 'HeartRateVariability' },
      { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
      { accessType: 'read', recordType: 'BasalMetabolicRate' },
      { accessType: 'read', recordType: 'SleepSession' },
      { accessType: 'read', recordType: 'ExerciseSession' },
      { accessType: 'read', recordType: 'FloorsClimbed' },
      { accessType: 'read', recordType: 'OxygenSaturation' },
      { accessType: 'read', recordType: 'RespiratoryRate' },
    ];

    try {
      const granted = await HealthConnect.requestPermission(permissions);
      console.log('[HealthSync] Health Connect permissions:', granted);
      return granted;
    } catch (error) {
      console.error('[HealthSync] Health Connect permissions error:', error);
      return false;
    }
  }

  // Check permissions status
  async checkPermissions(): Promise<HealthPermissions> {
    if (!this.isAvailable) {
      return {
        steps: false,
        heartRate: false,
        sleep: false,
        workouts: false,
        calories: false,
      };
    }

    // Default all to true if we have general permissions
    const hasGeneralPermission = this.hasPermissions;
    
    return {
      steps: hasGeneralPermission,
      heartRate: hasGeneralPermission,
      sleep: hasGeneralPermission,
      workouts: hasGeneralPermission,
      calories: hasGeneralPermission,
    };
  }

  // Main sync function - fetches all health data
  async syncHealthData(days: number = 7): Promise<{
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  }> {
    if (!this.isAvailable || !this.hasPermissions) {
      throw new Error('Health service not available or permissions not granted');
    }

    const { startDate, endDate } = getTimeRange(days);
    
    let metrics: HealthMetric[] = [];
    let workouts: HealthWorkout[] = [];
    let sleep: SleepAnalysis[] = [];

    if (Platform.OS === 'ios') {
      const results = await this.syncHealthKitData(startDate, endDate);
      metrics = results.metrics;
      workouts = results.workouts;
      sleep = results.sleep;
    } else if (Platform.OS === 'android') {
      const results = await this.syncHealthConnectData(startDate, endDate);
      metrics = results.metrics;
      workouts = results.workouts;
      sleep = results.sleep;
    }

    // Store in local database
    await databaseService.insertHealthMetrics(metrics);
    await databaseService.insertWorkouts(workouts);
    await databaseService.insertSleepAnalysis(sleep);

    // Trigger webhook for new data
    if (metrics.length > 0 || workouts.length > 0 || sleep.length > 0) {
      await webhookService.triggerHealthDataUpdated({ metrics, workouts, sleep });
    }

    // Update last sync time
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, new Date().toISOString());

    return { metrics, workouts, sleep };
  }

  // Sync HealthKit data (iOS)
  private async syncHealthKitData(startDate: Date, endDate: Date): Promise<{
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  }> {
    if (!HealthKit) return { metrics: [], workouts: [], sleep: [] };

    const metrics: HealthMetric[] = [];
    const workouts: HealthWorkout[] = [];
    const sleep: SleepAnalysis[] = [];

    const start = startDate.toISOString();
    const end = endDate.toISOString();

    // Fetch steps
    try {
      const steps = await this.getHealthKitSamples('StepCount', start, end);
      steps.forEach(sample => {
        metrics.push({
          source: 'healthkit',
          type: 'steps',
          value: sample.value,
          unit: 'count',
          startDate: sample.startDate,
          endDate: sample.endDate,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Steps fetch error:', e);
    }

    // Fetch heart rate
    try {
      const heartRates = await this.getHealthKitSamples('HeartRate', start, end);
      heartRates.forEach(sample => {
        metrics.push({
          source: 'healthkit',
          type: 'heart_rate',
          value: sample.value,
          unit: 'count/min',
          startDate: sample.startDate,
          endDate: sample.endDate,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Heart rate fetch error:', e);
    }

    // Fetch resting heart rate
    try {
      const restingHR = await this.getHealthKitSamples('RestingHeartRate', start, end);
      restingHR.forEach(sample => {
        metrics.push({
          source: 'healthkit',
          type: 'resting_heart_rate',
          value: sample.value,
          unit: 'count/min',
          startDate: sample.startDate,
          endDate: sample.endDate,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Resting HR fetch error:', e);
    }

    // Fetch active calories
    try {
      const activeCalories = await this.getHealthKitSamples('ActiveEnergyBurned', start, end);
      activeCalories.forEach(sample => {
        metrics.push({
          source: 'healthkit',
          type: 'active_calories',
          value: sample.value,
          unit: 'kcal',
          startDate: sample.startDate,
          endDate: sample.endDate,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Active calories fetch error:', e);
    }

    // Fetch workouts
    try {
      const workoutSamples = await this.getHealthKitWorkouts(start, end);
      workoutSamples.forEach(sample => {
        workouts.push({
          source: 'healthkit',
          workoutType: sample.type,
          startDate: sample.startDate,
          endDate: sample.endDate,
          duration: sample.duration,
          calories: sample.calories,
          distance: sample.distance,
          heartRateAvg: sample.heartRateAvg,
          heartRateMax: sample.heartRateMax,
          heartRateMin: sample.heartRateMin,
          metadata: sample.metadata,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Workouts fetch error:', e);
    }

    // Fetch sleep
    try {
      const sleepSamples = await this.getHealthKitSleep(start, end);
      sleepSamples.forEach(sample => {
        sleep.push({
          source: 'healthkit',
          startDate: sample.startDate,
          endDate: sample.endDate,
          duration: sample.duration,
          metadata: sample.metadata,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Sleep fetch error:', e);
    }

    return { metrics, workouts, sleep };
  }

  // Get HealthKit samples
  private getHealthKitSamples(type: string, startDate: string, endDate: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const options = {
        type,
        startDate,
        endDate,
        includeManuallyAdded: true,
      };

      HealthKit.getSamples(options, (err: any, results: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(results || []);
        }
      });
    });
  }

  // Get HealthKit workouts
  private getHealthKitWorkouts(startDate: string, endDate: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const options = {
        startDate,
        endDate,
        includeManuallyAdded: true,
      };

      HealthKit.getWorkoutSamples(options, (err: any, results: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(results || []);
        }
      });
    });
  }

  // Get HealthKit sleep
  private getHealthKitSleep(startDate: string, endDate: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const options = {
        startDate,
        endDate,
        includeManuallyAdded: true,
      };

      HealthKit.getSleepSamples(options, (err: any, results: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(results || []);
        }
      });
    });
  }

  // Sync Health Connect data (Android)
  private async syncHealthConnectData(startDate: Date, endDate: Date): Promise<{
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  }> {
    if (!HealthConnect) return { metrics: [], workouts: [], sleep: [] };

    const metrics: HealthMetric[] = [];
    const workouts: HealthWorkout[] = [];
    const sleep: SleepAnalysis[] = [];

    const timeRangeFilter = {
      operator: 'between',
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
    };

    // Fetch steps
    try {
      const stepsResponse = await HealthConnect.readRecords('Steps', { timeRangeFilter });
      stepsResponse.records?.forEach((record: any) => {
        metrics.push({
          source: 'healthconnect',
          type: 'steps',
          value: record.count,
          unit: 'count',
          startDate: record.startTime,
          endDate: record.endTime,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Steps fetch error:', e);
    }

    // Fetch heart rate
    try {
      const hrResponse = await HealthConnect.readRecords('HeartRate', { timeRangeFilter });
      hrResponse.records?.forEach((record: any) => {
        record.samples?.forEach((sample: any) => {
          metrics.push({
            source: 'healthconnect',
            type: 'heart_rate',
            value: sample.beatsPerMinute,
            unit: 'count/min',
            startDate: sample.time,
            endDate: sample.time,
            timestamp: new Date().toISOString(),
            processed: false,
            syncedToBackend: false,
          });
        });
      });
    } catch (e) {
      console.error('[HealthSync] Heart rate fetch error:', e);
    }

    // Fetch active calories
    try {
      const caloriesResponse = await HealthConnect.readRecords('ActiveCaloriesBurned', { timeRangeFilter });
      caloriesResponse.records?.forEach((record: any) => {
        metrics.push({
          source: 'healthconnect',
          type: 'active_calories',
          value: record.energy.inKilocalories,
          unit: 'kcal',
          startDate: record.startTime,
          endDate: record.endTime,
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Calories fetch error:', e);
    }

    // Fetch exercise sessions (workouts)
    try {
      const exerciseResponse = await HealthConnect.readRecords('ExerciseSession', { timeRangeFilter });
      exerciseResponse.records?.forEach((record: any) => {
        workouts.push({
          source: 'healthconnect',
          workoutType: record.exerciseType,
          startDate: record.startTime,
          endDate: record.endTime,
          duration: record.duration ? Math.floor(record.duration / 1000) : 0,
          metadata: { notes: record.notes },
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Exercise fetch error:', e);
    }

    // Fetch sleep sessions
    try {
      const sleepResponse = await HealthConnect.readRecords('SleepSession', { timeRangeFilter });
      sleepResponse.records?.forEach((record: any) => {
        const duration = new Date(record.endTime).getTime() - new Date(record.startTime).getTime();
        sleep.push({
          source: 'healthconnect',
          startDate: record.startTime,
          endDate: record.endTime,
          duration: Math.floor(duration / 1000),
          metadata: { title: record.title },
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Sleep fetch error:', e);
    }

    return { metrics, workouts, sleep };
  }

  // Get today's summary
  async getTodaySummary(): Promise<{
    steps: number;
    activeCalories: number;
    workouts: number;
    sleepHours: number;
  }> {
    if (!this.isAvailable || !this.hasPermissions) {
      return { steps: 0, activeCalories: 0, workouts: 0, sleepHours: 0 };
    }

    const { startDate, endDate } = getTimeRange(0);
    const summary = { steps: 0, activeCalories: 0, workouts: 0, sleepHours: 0 };

    try {
      const { metrics, workouts, sleep } = await this.syncHealthData(0);
      
      // Calculate totals
      metrics.forEach(m => {
        if (m.type === 'steps') summary.steps += m.value;
        if (m.type === 'active_calories') summary.activeCalories += m.value;
      });
      summary.workouts = workouts.length;
      summary.sleepHours = sleep.reduce((acc, s) => acc + (s.duration / 3600), 0);
    } catch (error) {
      console.error('[HealthSync] Today summary error:', error);
    }

    return summary;
  }

  // Check if health service is available
  isHealthAvailable(): boolean {
    return this.isAvailable;
  }

  // Check if has permissions
  hasHealthPermissions(): boolean {
    return this.hasPermissions;
  }
}

export const healthSyncService = new HealthSyncService();
export default healthSyncService;