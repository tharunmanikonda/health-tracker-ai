/**
 * Backend Sync Service
 * Handles syncing local health data to the backend API
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {databaseService} from './database';
import {STORAGE_KEYS, API_BASE_URL} from '../utils/constants';
import type {HealthMetric, HealthWorkout, SleepAnalysis} from '../types';

class BackendSyncService {
  private isSyncing: boolean = false;

  // Sync all unsynced data to backend
  async syncToBackend(): Promise<{
    metrics: number;
    workouts: number;
    sleep: number;
  }> {
    if (this.isSyncing) {
      console.log('[BackendSync] Already syncing, skipping');
      return { metrics: 0, workouts: 0, sleep: 0 };
    }

    this.isSyncing = true;
    const results = { metrics: 0, workouts: 0, sleep: 0 };

    try {
      const authToken = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      if (!authToken) {
        console.warn('[BackendSync] No auth token, skipping sync');
        return results;
      }

      // Sync metrics
      const unsyncedMetrics = await databaseService.getUnsyncedMetrics(100);
      if (unsyncedMetrics.length > 0) {
        const syncedIds = await this.uploadMetrics(unsyncedMetrics, authToken);
        await databaseService.markAsSynced('health_metrics', syncedIds);
        results.metrics = syncedIds.length;
      }

      // Sync workouts
      const unsyncedWorkouts = await databaseService.getUnsyncedWorkouts(50);
      if (unsyncedWorkouts.length > 0) {
        const syncedIds = await this.uploadWorkouts(unsyncedWorkouts, authToken);
        await databaseService.markAsSynced('health_workouts', syncedIds);
        results.workouts = syncedIds.length;
      }

      // Sync sleep
      const unsyncedSleep = await databaseService.getUnsyncedSleep(30);
      if (unsyncedSleep.length > 0) {
        const syncedIds = await this.uploadSleep(unsyncedSleep, authToken);
        await databaseService.markAsSynced('sleep_analysis', syncedIds);
        results.sleep = syncedIds.length;
      }

      console.log('[BackendSync] Sync completed:', results);
      return results;
    } catch (error) {
      console.error('[BackendSync] Sync failed:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  // Upload metrics to backend
  private async uploadMetrics(metrics: HealthMetric[], authToken: string): Promise<number[]> {
    const syncedIds: number[] = [];

    // Transform to backend format
    const payload = metrics.map(m => ({
      source: m.source,
      type: m.type,
      value: m.value,
      unit: m.unit,
      start_date: m.startDate,
      end_date: m.endDate,
      metadata: m.metadata,
      timestamp: m.timestamp,
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/health-metrics/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ metrics: payload }),
      });

      if (response.ok) {
        // All metrics synced successfully
        metrics.forEach(m => m.id && syncedIds.push(m.id));
      } else if (response.status === 207) {
        // Partial success - parse which ones succeeded
        const result = await response.json();
        if (result.synced_ids) {
          // Backend returns IDs that were synced
          metrics.forEach((m, index) => {
            if (result.synced_ids.includes(index) && m.id) {
              syncedIds.push(m.id);
            }
          });
        }
      } else {
        throw new Error(`Upload failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[BackendSync] Metrics upload error:', error);
      throw error;
    }

    return syncedIds;
  }

  // Upload workouts to backend
  private async uploadWorkouts(workouts: HealthWorkout[], authToken: string): Promise<number[]> {
    const syncedIds: number[] = [];

    const payload = workouts.map(w => ({
      source: w.source,
      workout_type: w.workoutType,
      start_date: w.startDate,
      end_date: w.endDate,
      duration: w.duration,
      calories: w.calories,
      distance: w.distance,
      heart_rate_avg: w.heartRateAvg,
      heart_rate_max: w.heartRateMax,
      heart_rate_min: w.heartRateMin,
      metadata: w.metadata,
      timestamp: w.timestamp,
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/health-workouts/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ workouts: payload }),
      });

      if (response.ok) {
        workouts.forEach(w => w.id && syncedIds.push(w.id));
      } else {
        throw new Error(`Workouts upload failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[BackendSync] Workouts upload error:', error);
      throw error;
    }

    return syncedIds;
  }

  // Upload sleep data to backend
  private async uploadSleep(sleepData: SleepAnalysis[], authToken: string): Promise<number[]> {
    const syncedIds: number[] = [];

    const payload = sleepData.map(s => ({
      source: s.source,
      start_date: s.startDate,
      end_date: s.endDate,
      duration: s.duration,
      deep_sleep: s.deepSleep,
      rem_sleep: s.remSleep,
      light_sleep: s.lightSleep,
      awake: s.awake,
      efficiency: s.efficiency,
      metadata: s.metadata,
      timestamp: s.timestamp,
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/health-sleep/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ sleep: payload }),
      });

      if (response.ok) {
        sleepData.forEach(s => s.id && syncedIds.push(s.id));
      } else {
        throw new Error(`Sleep upload failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[BackendSync] Sleep upload error:', error);
      throw error;
    }

    return syncedIds;
  }

  // Get sync status
  async getSyncStatus(): Promise<{
    isSyncing: boolean;
    pending: { metrics: number; workouts: number; sleep: number };
  }> {
    const pending = await databaseService.getPendingCount();
    return {
      isSyncing: this.isSyncing,
      pending,
    };
  }

  // Check if backend is reachable
  async checkBackendHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const backendSyncService = new BackendSyncService();
export default backendSyncService;