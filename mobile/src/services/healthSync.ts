/**
 * Health Sync Service
 * Handles data synchronization from HealthKit (iOS) and Health Connect (Android)
 */

import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {databaseService} from './database';
import {webhookService} from './webhook';
import {backendSyncService} from './backendSync';
import {getTimeRange} from '../utils/helpers';
import {STORAGE_KEYS} from '../utils/constants';
import type {HealthMetric, HealthWorkout, SleepAnalysis, HealthPermissions} from '../types';

// Platform-specific imports
let HealthKit: any = null;
let HealthConnect: any = null;

if (Platform.OS === 'ios') {
  try {
    HealthKit = require('react-native-health');
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

const IOS_OBSERVER_EVENT_THROTTLE_MS = 15 * 1000;
const IOS_INCREMENTAL_OVERLAP_MINUTES = 180;
const IOS_OBSERVER_RESCHEDULE_MS = 5 * 1000;

class HealthSyncService {
  private isAvailable = false;
  private hasPermissions = false;
  private isSyncing = false;
  private observersConfigured = false;
  private lastObserverSyncAt = 0;
  private observerSyncQueued = false;
  private observerSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private observerEmitter: NativeEventEmitter | null = null;
  private observerSubscriptions: Array<{ remove: () => void }> = [];

  async initialize(): Promise<boolean> {
    try {
      this.hasPermissions = await this.getStoredPermissionState();

      if (Platform.OS === 'ios') {
        this.isAvailable = await this.initializeHealthKit();
        // If permissions were previously granted, re-initialize the HealthKit session
        // so that getSamples calls don't fail with "Authorization not determined"
        if (this.isAvailable && this.hasPermissions) {
          await this.requestHealthKitPermissions();
        }
      } else if (Platform.OS === 'android') {
        this.isAvailable = await this.initializeHealthConnect();
      }

      if (this.isAvailable && this.hasPermissions && Platform.OS === 'ios') {
        await this.setupHealthKitObservers();
      }

      return this.isAvailable;
    } catch (error) {
      console.error('[HealthSync] Initialization failed:', error);
      return false;
    }
  }

  private async getStoredPermissionState(): Promise<boolean> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.HEALTH_PERMISSIONS_GRANTED);
      return stored === 'true';
    } catch {
      return false;
    }
  }

  private async setStoredPermissionState(granted: boolean): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.HEALTH_PERMISSIONS_GRANTED, granted ? 'true' : 'false');
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
        if (this.hasPermissions) {
          await this.setupHealthKitObservers();
        }
      } else if (Platform.OS === 'android') {
        this.hasPermissions = await this.requestHealthConnectPermissions();
      }
      await this.setStoredPermissionState(this.hasPermissions);
      return this.hasPermissions;
    } catch (error) {
      console.error('[HealthSync] Permission request failed:', error);
      return false;
    }
  }

  // iOS HealthKit permissions
  private async requestHealthKitPermissions(): Promise<boolean> {
    if (!HealthKit?.Constants?.Permissions) return false;

    const permissions = {
      permissions: {
        read: [
          HealthKit.Constants.Permissions.StepCount,
          HealthKit.Constants.Permissions.DistanceWalkingRunning,
          HealthKit.Constants.Permissions.HeartRate,
          HealthKit.Constants.Permissions.RestingHeartRate,
          HealthKit.Constants.Permissions.HeartRateVariabilitySDNN,
          HealthKit.Constants.Permissions.ActiveEnergyBurned,
          HealthKit.Constants.Permissions.BasalEnergyBurned,
          HealthKit.Constants.Permissions.SleepAnalysis,
          HealthKit.Constants.Permissions.Workout,
          HealthKit.Constants.Permissions.FlightsClimbed,
          HealthKit.Constants.Permissions.OxygenSaturation,
          HealthKit.Constants.Permissions.RespiratoryRate,
          HealthKit.Constants.Permissions.BodyTemperature,
        ].filter(Boolean),
        write: [],
      },
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
      {accessType: 'read', recordType: 'Steps'},
      {accessType: 'read', recordType: 'Distance'},
      {accessType: 'read', recordType: 'HeartRate'},
      {accessType: 'read', recordType: 'RestingHeartRate'},
      {accessType: 'read', recordType: 'HeartRateVariability'},
      {accessType: 'read', recordType: 'ActiveCaloriesBurned'},
      {accessType: 'read', recordType: 'BasalMetabolicRate'},
      {accessType: 'read', recordType: 'SleepSession'},
      {accessType: 'read', recordType: 'ExerciseSession'},
      {accessType: 'read', recordType: 'FloorsClimbed'},
      {accessType: 'read', recordType: 'OxygenSaturation'},
      {accessType: 'read', recordType: 'RespiratoryRate'},
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

  private getHealthKitObserverTypes(): string[] {
    return [
      'StepCount',
      'ActiveEnergyBurned',
      'BasalEnergyBurned',
      'HeartRate',
      'RestingHeartRate',
      'HeartRateVariabilitySDNN',
      'Workout',
      'SleepAnalysis',
    ];
  }

  private async setupHealthKitObservers(): Promise<void> {
    if (Platform.OS !== 'ios' || !HealthKit || this.observersConfigured || !this.hasPermissions) return;
    const appleHealthModule = NativeModules.AppleHealthKit;
    if (!appleHealthModule) {
      console.warn('[HealthSync] AppleHealthKit native module unavailable for event emitter');
      return;
    }

    this.observerEmitter = new NativeEventEmitter(appleHealthModule);
    const observerTypes = this.getHealthKitObserverTypes();

    for (const type of observerTypes) {
      const onSample = () => {
        this.handleHealthKitObserverEvent(type).catch((err) =>
          console.warn('[HealthSync] Observer sync failed:', err),
        );
      };
      const onFailure = (payload: any) =>
        console.warn(`[HealthSync] Observer failure for ${type}:`, payload);

      this.observerSubscriptions.push(
        this.observerEmitter.addListener(`healthKit:${type}:new`, onSample),
      );
      this.observerSubscriptions.push(
        this.observerEmitter.addListener(`healthKit:${type}:sample`, onSample),
      );
      this.observerSubscriptions.push(
        this.observerEmitter.addListener(`healthKit:${type}:failure`, onFailure),
      );
      this.observerSubscriptions.push(
        this.observerEmitter.addListener(`healthKit:${type}:setup:failure`, onFailure),
      );
    }

    this.observersConfigured = true;
    console.log('[HealthSync] HealthKit observers configured:', observerTypes.join(', '));
  }

  private async handleHealthKitObserverEvent(observerType: string): Promise<void> {
    console.log(`[HealthSync] HealthKit observer event received: ${observerType}`);
    this.observerSyncQueued = true;
    this.scheduleObserverSync();
  }

  private scheduleObserverSync(delayMs: number = 0): void {
    if (this.observerSyncTimer) return;
    const elapsed = Date.now() - this.lastObserverSyncAt;
    const throttleDelay = Math.max(0, IOS_OBSERVER_EVENT_THROTTLE_MS - elapsed);
    const waitMs = Math.max(delayMs, throttleDelay);
    this.observerSyncTimer = setTimeout(() => {
      this.observerSyncTimer = null;
      this.flushObserverSyncQueue().catch((err) =>
        console.warn('[HealthSync] Observer queue flush failed:', err),
      );
    }, waitMs);
  }

  private async flushObserverSyncQueue(): Promise<void> {
    if (!this.observerSyncQueued || !this.hasPermissions) return;
    if (this.isSyncing) {
      this.scheduleObserverSync(IOS_OBSERVER_RESCHEDULE_MS);
      return;
    }

    this.observerSyncQueued = false;
    this.lastObserverSyncAt = Date.now();
    const data = await this.syncHealthData(1, {preferIncremental: true, overlapMinutes: IOS_INCREMENTAL_OVERLAP_MINUTES});
    if (data.metrics.length || data.workouts.length || data.sleep.length) {
      await backendSyncService.syncToBackend();
    }

    if (this.observerSyncQueued) {
      this.scheduleObserverSync();
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

    this.hasPermissions = await this.getStoredPermissionState();
    if (this.hasPermissions && Platform.OS === 'ios') {
      await this.setupHealthKitObservers();
    }

    return {
      steps: this.hasPermissions,
      heartRate: this.hasPermissions,
      sleep: this.hasPermissions,
      workouts: this.hasPermissions,
      calories: this.hasPermissions,
    };
  }

  private async getSyncWindow(days: number, preferIncremental: boolean, overlapMinutes: number): Promise<{startDate: Date; endDate: Date}> {
    const base = getTimeRange(days);
    if (!preferIncremental) return base;

    try {
      const lastSync = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC_TIME);
      if (!lastSync) return base;

      const lastSyncDate = new Date(lastSync);
      if (Number.isNaN(lastSyncDate.getTime())) return base;

      const incrementalStart = new Date(lastSyncDate.getTime() - overlapMinutes * 60 * 1000);
      if (incrementalStart > base.startDate && incrementalStart < base.endDate) {
        return {startDate: incrementalStart, endDate: base.endDate};
      }
    } catch (error) {
      console.warn('[HealthSync] Failed to compute incremental sync window:', error);
    }

    return base;
  }

  // Main sync function - fetches all health data
  async syncHealthData(
    days: number = 7,
    options: {preferIncremental?: boolean; overlapMinutes?: number} = {},
  ): Promise<{
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  }> {
    if (!this.isAvailable || !this.hasPermissions) {
      throw new Error('Health service not available or permissions not granted');
    }

    if (this.isSyncing) {
      console.log('[HealthSync] Sync already in progress, skipping duplicate request');
      return {metrics: [], workouts: [], sleep: []};
    }

    this.isSyncing = true;
    try {
      const {startDate, endDate} = await this.getSyncWindow(
        days,
        options.preferIncremental ?? days <= 1,
        options.overlapMinutes ?? IOS_INCREMENTAL_OVERLAP_MINUTES,
      );

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

      await databaseService.insertHealthMetrics(metrics);
      await databaseService.insertWorkouts(workouts);
      await databaseService.insertSleepAnalysis(sleep);

      if (metrics.length > 0 || workouts.length > 0 || sleep.length > 0) {
        await webhookService.triggerHealthDataUpdated({metrics, workouts, sleep});
      }

      await AsyncStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, new Date().toISOString());
      return {metrics, workouts, sleep};
    } finally {
      this.isSyncing = false;
    }
  }

  private buildMetricMetadata(sample: any): Record<string, any> {
    return {
      sampleId: sample?.id || sample?.uuid || null,
      tracked: sample?.tracked ?? null,
      sourceName: sample?.sourceName || sample?.source || null,
      sourceId: sample?.sourceId || null,
      device: sample?.device || null,
    };
  }

  private normalizeMetricValue(metricType: string, value: any): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (metricType === 'oxygen_saturation' && parsed <= 1) {
      return Math.round(parsed * 10000) / 100;
    }
    return parsed;
  }

  private pushSampleAsMetric(
    metrics: HealthMetric[],
    sample: any,
    metricType: HealthMetric['type'],
    unit: string,
    extraMetadata: Record<string, any> = {},
  ): void {
    // react-native-health native module returns "quantity" or "distance" as the value key,
    // and "start"/"end" instead of "startDate"/"endDate"
    const rawValue = sample?.value ?? sample?.quantity ?? sample?.distance;
    const value = this.normalizeMetricValue(metricType, rawValue);
    if (value == null) return;
    const startDate = sample?.startDate || sample?.start;
    const endDate = sample?.endDate || sample?.end;
    if (!startDate || !endDate) return;

    metrics.push({
      source: 'healthkit',
      type: metricType,
      value,
      unit,
      startDate,
      endDate,
      metadata: {...this.buildMetricMetadata(sample), ...extraMetadata},
      timestamp: new Date().toISOString(),
      processed: false,
      syncedToBackend: false,
    });
  }

  // Sync HealthKit data (iOS)
  private async syncHealthKitData(startDate: Date, endDate: Date): Promise<{
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  }> {
    if (!HealthKit) return {metrics: [], workouts: [], sleep: []};

    const metrics: HealthMetric[] = [];
    const workouts: HealthWorkout[] = [];
    const sleep: SleepAnalysis[] = [];

    const start = startDate.toISOString();
    const end = endDate.toISOString();

    const metricSpecs: Array<{
      healthKitType: string;
      metricType: HealthMetric['type'];
      unit: string;
      healthKitUnit: string;
    }> = [
      {healthKitType: 'StepCount', metricType: 'steps', unit: 'count', healthKitUnit: 'count'},
      {healthKitType: 'HeartRate', metricType: 'heart_rate', unit: 'count/min', healthKitUnit: 'bpm'},
      {healthKitType: 'RestingHeartRate', metricType: 'resting_heart_rate', unit: 'count/min', healthKitUnit: 'bpm'},
      {healthKitType: 'HeartRateVariabilitySDNN', metricType: 'heart_rate_variability', unit: 'ms', healthKitUnit: 'second'},
      {healthKitType: 'ActiveEnergyBurned', metricType: 'active_calories', unit: 'kcal', healthKitUnit: 'kilocalorie'},
      {healthKitType: 'BasalEnergyBurned', metricType: 'basal_calories', unit: 'kcal', healthKitUnit: 'kilocalorie'},
      {healthKitType: 'DistanceWalkingRunning', metricType: 'distance', unit: 'm', healthKitUnit: 'meter'},
      {healthKitType: 'FlightsClimbed', metricType: 'flights_climbed', unit: 'count', healthKitUnit: 'count'},
      {healthKitType: 'OxygenSaturation', metricType: 'oxygen_saturation', unit: '%', healthKitUnit: 'percent'},
      {healthKitType: 'RespiratoryRate', metricType: 'respiratory_rate', unit: 'count/min', healthKitUnit: 'bpm'},
      {healthKitType: 'BodyTemperature', metricType: 'body_temperature', unit: 'degC', healthKitUnit: 'celsius'},
    ];

    console.log(`[HealthSync] Fetching metrics from ${start} to ${end}`);
    for (const spec of metricSpecs) {
      try {
        const samples = await this.getHealthKitSamples(spec.healthKitType, start, end, spec.healthKitUnit);
        console.log(`[HealthSync] ${spec.healthKitType}: ${samples.length} samples`);
        if (samples.length > 0) {
          console.log(`[HealthSync] ${spec.healthKitType} sample[0]:`, JSON.stringify(samples[0]).slice(0, 200));
        }
        for (const sample of samples) {
          this.pushSampleAsMetric(metrics, sample, spec.metricType, spec.unit);
        }
      } catch (error) {
        console.error(`[HealthSync] ${spec.healthKitType} fetch error:`, error);
      }
    }
    console.log(`[HealthSync] Total metrics after fetch: ${metrics.length}`);

    // Fetch workouts
    try {
      const workoutSamples = await this.getHealthKitWorkouts(start, end);
      workoutSamples.forEach((sample) => {
        workouts.push({
          source: 'healthkit',
          workoutType: sample.type || sample.activityName || 'Workout',
          startDate: sample.startDate || sample.start,
          endDate: sample.endDate || sample.end,
          duration: sample.duration || 0,
          calories: sample.calories,
          distance: sample.distance,
          heartRateAvg: sample.heartRateAvg,
          heartRateMax: sample.heartRateMax,
          heartRateMin: sample.heartRateMin,
          metadata: {
            ...this.buildMetricMetadata(sample),
            activityId: sample.activityId,
          },
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (error) {
      console.error('[HealthSync] Workouts fetch error:', error);
    }

    // Fetch sleep
    try {
      const sleepSamples = await this.getHealthKitSleep(start, end);
      sleepSamples.forEach((sample) => {
        const sampleStart = sample.startDate;
        const sampleEnd = sample.endDate;
        if (!sampleStart || !sampleEnd) return;

        const rawStage = String(sample.value || '').toUpperCase();
        if (rawStage === 'INBED') {
          return;
        }

        const durationSeconds = sample.duration || Math.max(0, Math.floor((new Date(sampleEnd).getTime() - new Date(sampleStart).getTime()) / 1000));
        if (!durationSeconds) return;

        sleep.push({
          source: 'healthkit',
          startDate: sampleStart,
          endDate: sampleEnd,
          duration: durationSeconds,
          deepSleep: rawStage.includes('DEEP') ? durationSeconds : undefined,
          remSleep: rawStage.includes('REM') ? durationSeconds : undefined,
          lightSleep: rawStage.includes('CORE') || rawStage.includes('LIGHT') ? durationSeconds : undefined,
          awake: rawStage.includes('AWAKE') ? durationSeconds : undefined,
          metadata: {
            ...this.buildMetricMetadata(sample),
            sleepStage: sample.value,
          },
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (error) {
      console.error('[HealthSync] Sleep fetch error:', error);
    }

    return {metrics, workouts, sleep};
  }

  // Get HealthKit samples
  private getHealthKitSamples(type: string, startDate: string, endDate: string, unit?: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const options: Record<string, any> = {
        type,
        startDate,
        endDate,
        includeManuallyAdded: true,
      };
      if (unit) {
        options.unit = unit;
      }

      HealthKit.getSamples(options, (err: any, results: any[]) => {
        if (err) reject(err);
        else resolve(results || []);
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

      HealthKit.getAnchoredWorkouts(options, (err: any, results: any) => {
        if (err) reject(err);
        else {
          // getAnchoredWorkouts returns { anchor, data } where data is the workout array
          const workouts = results?.data || results || [];
          resolve(Array.isArray(workouts) ? workouts : []);
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
        if (err) reject(err);
        else resolve(results || []);
      });
    });
  }

  // Sync Health Connect data (Android)
  private async syncHealthConnectData(startDate: Date, endDate: Date): Promise<{
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  }> {
    if (!HealthConnect) return {metrics: [], workouts: [], sleep: []};

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
      const stepsResponse = await HealthConnect.readRecords('Steps', {timeRangeFilter});
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
      const hrResponse = await HealthConnect.readRecords('HeartRate', {timeRangeFilter});
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
      const caloriesResponse = await HealthConnect.readRecords('ActiveCaloriesBurned', {timeRangeFilter});
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
      const exerciseResponse = await HealthConnect.readRecords('ExerciseSession', {timeRangeFilter});
      exerciseResponse.records?.forEach((record: any) => {
        workouts.push({
          source: 'healthconnect',
          workoutType: record.exerciseType,
          startDate: record.startTime,
          endDate: record.endTime,
          duration: record.duration ? Math.floor(record.duration / 1000) : 0,
          metadata: {notes: record.notes},
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
      const sleepResponse = await HealthConnect.readRecords('SleepSession', {timeRangeFilter});
      sleepResponse.records?.forEach((record: any) => {
        const duration = new Date(record.endTime).getTime() - new Date(record.startTime).getTime();
        sleep.push({
          source: 'healthconnect',
          startDate: record.startTime,
          endDate: record.endTime,
          duration: Math.floor(duration / 1000),
          metadata: {title: record.title},
          timestamp: new Date().toISOString(),
          processed: false,
          syncedToBackend: false,
        });
      });
    } catch (e) {
      console.error('[HealthSync] Sleep fetch error:', e);
    }

    return {metrics, workouts, sleep};
  }

  // Get today's summary
  async getTodaySummary(): Promise<{
    steps: number;
    activeCalories: number;
    workouts: number;
    sleepHours: number;
  }> {
    if (!this.isAvailable || !this.hasPermissions) {
      return {steps: 0, activeCalories: 0, workouts: 0, sleepHours: 0};
    }

    const summary = {steps: 0, activeCalories: 0, workouts: 0, sleepHours: 0};

    try {
      // Use days=1 so the summary includes last night's sleep and recent activity
      // (days=0 would only show data from midnight today, which is empty early morning)
      const {metrics, workouts, sleep} = await this.syncHealthData(1, {
        preferIncremental: false,
      });

      metrics.forEach((m) => {
        if (m.type === 'steps') summary.steps += m.value;
        if (m.type === 'active_calories') summary.activeCalories += m.value;
      });
      summary.workouts = workouts.length;
      summary.sleepHours = sleep.reduce((acc, s) => acc + s.duration / 3600, 0);
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
