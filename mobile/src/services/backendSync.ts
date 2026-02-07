/**
 * Backend Sync Service
 * Handles syncing local health data to the backend API
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {databaseService} from './database';
import {STORAGE_KEYS, API_BASE_URL} from '../utils/constants';
import type {HealthMetric, HealthWorkout, SleepAnalysis} from '../types';

type BackendMobileMetric = {
  type: string;
  value: number;
  unit?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  metadata?: Record<string, any> | null;
};

type SyncRequestError = Error & {
  retryAfterMs?: number;
  retryable?: boolean;
  status?: number;
};

class BackendSyncService {
  private isSyncing = false;

  // Sync all unsynced data to backend
  async syncToBackend(): Promise<{
    metrics: number;
    workouts: number;
    sleep: number;
  }> {
    if (this.isSyncing) {
      console.log('[BackendSync] Already syncing, skipping');
      return {metrics: 0, workouts: 0, sleep: 0};
    }

    this.isSyncing = true;
    const results = {metrics: 0, workouts: 0, sleep: 0};

    try {
      const authToken = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      if (!authToken) {
        console.warn('[BackendSync] No auth token, skipping sync');
        return results;
      }

      const unsyncedMetrics = await databaseService.getUnsyncedMetrics(200);
      if (unsyncedMetrics.length > 0) {
        const syncedIds = await this.uploadMetrics(unsyncedMetrics, authToken);
        await databaseService.markAsSynced('health_metrics', syncedIds);
        results.metrics = syncedIds.length;
      }

      const unsyncedWorkouts = await databaseService.getUnsyncedWorkouts(100);
      if (unsyncedWorkouts.length > 0) {
        const syncedIds = await this.uploadWorkouts(unsyncedWorkouts, authToken);
        await databaseService.markAsSynced('health_workouts', syncedIds);
        results.workouts = syncedIds.length;
      }

      const unsyncedSleep = await databaseService.getUnsyncedSleep(100);
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

  private mapSource(source: HealthMetric['source'] | HealthWorkout['source'] | SleepAnalysis['source']): string {
    if (source === 'healthkit') return 'apple_healthkit';
    if (source === 'healthconnect') return 'health_connect';
    return source;
  }

  private normalizeMetricType(type: string): string {
    if (type === 'heart_rate_variability') return 'hrv';
    return type;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private parseRetryAfterMs(value: string | null): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }

    const at = Date.parse(value);
    if (!Number.isFinite(at)) return null;
    return Math.max(0, at - Date.now());
  }

  private getRetryDelayMs(attempt: number, retryAfterMs?: number): number {
    if (Number.isFinite(retryAfterMs) && (retryAfterMs as number) > 0) {
      return retryAfterMs as number;
    }
    const exponential = Math.min(30_000, 750 * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * 500);
    return exponential + jitter;
  }

  private async postMobileSync(source: string, metrics: BackendMobileMetric[], authToken: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/mobile/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({source, metrics}),
    });

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`Mobile sync failed (${response.status}): ${text}`) as SyncRequestError;
      err.status = response.status;
      err.retryAfterMs = this.parseRetryAfterMs(response.headers.get('retry-after')) ?? undefined;
      err.retryable = response.status === 429 || response.status >= 500;
      throw err;
    }
  }

  private async uploadGroupedMetrics(
    grouped: Record<string, BackendMobileMetric[]>,
    authToken: string,
  ): Promise<void> {
    for (const [source, metrics] of Object.entries(grouped)) {
      const batches = this.chunk(metrics, 100);
      for (const batch of batches) {
        let attempts = 0;
        while (true) {
          try {
            await this.postMobileSync(source, batch, authToken);
            break;
          } catch (error) {
            attempts += 1;
            const requestError = error as SyncRequestError;
            if (!requestError.retryable || attempts >= 4) throw error;
            const delayMs = this.getRetryDelayMs(attempts, requestError.retryAfterMs);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }
    }
  }

  private async uploadMetrics(metrics: HealthMetric[], authToken: string): Promise<number[]> {
    const grouped: Record<string, BackendMobileMetric[]> = {};

    for (const metric of metrics) {
      if (!Number.isFinite(metric.value)) continue;
      const source = this.mapSource(metric.source);
      if (!grouped[source]) grouped[source] = [];

      grouped[source].push({
        type: this.normalizeMetricType(metric.type),
        value: metric.value,
        unit: metric.unit,
        startTime: metric.startDate,
        endTime: metric.endDate,
        metadata: metric.metadata || null,
      });
    }

    await this.uploadGroupedMetrics(grouped, authToken);
    return metrics.filter((m) => !!m.id).map((m) => m.id!) as number[];
  }

  private async uploadWorkouts(workouts: HealthWorkout[], authToken: string): Promise<number[]> {
    const grouped: Record<string, BackendMobileMetric[]> = {};

    for (const workout of workouts) {
      const source = this.mapSource(workout.source);
      if (!grouped[source]) grouped[source] = [];

      grouped[source].push({
        type: 'workout',
        value: Math.round((workout.duration / 60) * 100) / 100,
        unit: 'minutes',
        startTime: workout.startDate,
        endTime: workout.endDate,
        metadata: {
          workoutType: workout.workoutType,
          calories: workout.calories,
          distance: workout.distance,
          heartRateAvg: workout.heartRateAvg,
          heartRateMax: workout.heartRateMax,
          heartRateMin: workout.heartRateMin,
          ...(workout.metadata || {}),
        },
      });
    }

    await this.uploadGroupedMetrics(grouped, authToken);
    return workouts.filter((w) => !!w.id).map((w) => w.id!) as number[];
  }

  private async uploadSleep(sleepData: SleepAnalysis[], authToken: string): Promise<number[]> {
    const grouped: Record<string, BackendMobileMetric[]> = {};

    for (const sleep of sleepData) {
      const source = this.mapSource(sleep.source);
      if (!grouped[source]) grouped[source] = [];

      grouped[source].push({
        type: 'sleep',
        value: Math.round((sleep.duration / 60) * 100) / 100,
        unit: 'minutes',
        startTime: sleep.startDate,
        endTime: sleep.endDate,
        metadata: {
          deepSleep: sleep.deepSleep,
          remSleep: sleep.remSleep,
          lightSleep: sleep.lightSleep,
          awake: sleep.awake,
          efficiency: sleep.efficiency,
          ...(sleep.metadata || {}),
        },
      });
    }

    await this.uploadGroupedMetrics(grouped, authToken);
    return sleepData.filter((s) => !!s.id).map((s) => s.id!) as number[];
  }

  // Get sync status
  async getSyncStatus(): Promise<{
    isSyncing: boolean;
    pending: {metrics: number; workouts: number; sleep: number};
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
