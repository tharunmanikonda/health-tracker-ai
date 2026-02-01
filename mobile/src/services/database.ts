/**
 * Database service for local SQLite storage
 * Handles health data storage with processed flag for AI feeding
 */

import SQLite from 'react-native-sqlite-storage';
import type {HealthMetric, HealthWorkout, SleepAnalysis} from '../types';

SQLite.enablePromise(true);

const DB_NAME = 'HealthTracker.db';
const DB_VERSION = '1.0';
const DB_DISPLAY_NAME = 'Health Tracker Database';
const DB_SIZE = 200000;

class DatabaseService {
  private db: SQLite.SQLiteDatabase | null = null;

  async init(): Promise<void> {
    try {
      this.db = await SQLite.openDatabase({
        name: DB_NAME,
        location: 'default',
      });
      await this.createTables();
      console.log('[Database] Initialized successfully');
    } catch (error) {
      console.error('[Database] Failed to initialize:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Health metrics table with processed flag for AI feeding
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS health_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        metadata TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        processed INTEGER DEFAULT 0,
        synced_to_backend INTEGER DEFAULT 0,
        backend_sync_time TEXT,
        UNIQUE(source, type, start_date, end_date)
      )
    `);

    // Workouts table
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS health_workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        workout_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        duration INTEGER NOT NULL,
        calories REAL,
        distance REAL,
        heart_rate_avg REAL,
        heart_rate_max REAL,
        heart_rate_min REAL,
        metadata TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        processed INTEGER DEFAULT 0,
        synced_to_backend INTEGER DEFAULT 0,
        backend_sync_time TEXT,
        UNIQUE(source, start_date, end_date)
      )
    `);

    // Sleep analysis table
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS sleep_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        duration INTEGER NOT NULL,
        deep_sleep INTEGER,
        rem_sleep INTEGER,
        light_sleep INTEGER,
        awake INTEGER,
        efficiency REAL,
        metadata TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        processed INTEGER DEFAULT 0,
        synced_to_backend INTEGER DEFAULT 0,
        backend_sync_time TEXT,
        UNIQUE(source, start_date)
      )
    `);

    // Sync log table
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_type TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        records_processed INTEGER DEFAULT 0,
        records_failed INTEGER DEFAULT 0,
        error_message TEXT,
        status TEXT DEFAULT 'pending'
      )
    `);

    // Webhook events log
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        sent INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT
      )
    `);

    // Indexes for performance
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_metrics_processed ON health_metrics(processed)
    `);
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_metrics_synced ON health_metrics(synced_to_backend)
    `);
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_metrics_type ON health_metrics(type)
    `);
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON health_metrics(timestamp)
    `);
  }

  // Insert health metrics
  async insertHealthMetrics(metrics: HealthMetric[]): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    let inserted = 0;
    for (const metric of metrics) {
      try {
        await this.db.executeSql(
          `INSERT OR REPLACE INTO health_metrics 
           (source, type, value, unit, start_date, end_date, metadata, timestamp, processed, synced_to_backend)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            metric.source,
            metric.type,
            metric.value,
            metric.unit,
            metric.startDate,
            metric.endDate,
            JSON.stringify(metric.metadata || {}),
            metric.timestamp,
            metric.processed ? 1 : 0,
            metric.syncedToBackend ? 1 : 0,
          ]
        );
        inserted++;
      } catch (error) {
        console.error('[Database] Failed to insert metric:', error);
      }
    }
    return inserted;
  }

  // Insert workouts
  async insertWorkouts(workouts: HealthWorkout[]): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    let inserted = 0;
    for (const workout of workouts) {
      try {
        await this.db.executeSql(
          `INSERT OR REPLACE INTO health_workouts 
           (source, workout_type, start_date, end_date, duration, calories, distance, 
            heart_rate_avg, heart_rate_max, heart_rate_min, metadata, timestamp, processed, synced_to_backend)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            workout.source,
            workout.workoutType,
            workout.startDate,
            workout.endDate,
            workout.duration,
            workout.calories || null,
            workout.distance || null,
            workout.heartRateAvg || null,
            workout.heartRateMax || null,
            workout.heartRateMin || null,
            JSON.stringify(workout.metadata || {}),
            workout.timestamp,
            workout.processed ? 1 : 0,
            workout.syncedToBackend ? 1 : 0,
          ]
        );
        inserted++;
      } catch (error) {
        console.error('[Database] Failed to insert workout:', error);
      }
    }
    return inserted;
  }

  // Insert sleep analysis
  async insertSleepAnalysis(sleepData: SleepAnalysis[]): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    let inserted = 0;
    for (const sleep of sleepData) {
      try {
        await this.db.executeSql(
          `INSERT OR REPLACE INTO sleep_analysis 
           (source, start_date, end_date, duration, deep_sleep, rem_sleep, light_sleep, 
            awake, efficiency, metadata, timestamp, processed, synced_to_backend)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sleep.source,
            sleep.startDate,
            sleep.endDate,
            sleep.duration,
            sleep.deepSleep || null,
            sleep.remSleep || null,
            sleep.lightSleep || null,
            sleep.awake || null,
            sleep.efficiency || null,
            JSON.stringify(sleep.metadata || {}),
            sleep.timestamp,
            sleep.processed ? 1 : 0,
            sleep.syncedToBackend ? 1 : 0,
          ]
        );
        inserted++;
      } catch (error) {
        console.error('[Database] Failed to insert sleep:', error);
      }
    }
    return inserted;
  }

  // Get unprocessed health metrics (for AI feeding)
  async getUnprocessedMetrics(limit: number = 100): Promise<HealthMetric[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `SELECT * FROM health_metrics WHERE processed = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    
    return this.mapMetricsResult(result);
  }

  // Get unprocessed workouts
  async getUnprocessedWorkouts(limit: number = 50): Promise<HealthWorkout[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `SELECT * FROM health_workouts WHERE processed = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    
    return this.mapWorkoutsResult(result);
  }

  // Get unprocessed sleep data
  async getUnprocessedSleep(limit: number = 30): Promise<SleepAnalysis[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `SELECT * FROM sleep_analysis WHERE processed = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    
    return this.mapSleepResult(result);
  }

  // Mark records as processed
  async markAsProcessed(table: 'health_metrics' | 'health_workouts' | 'sleep_analysis', ids: number[]): Promise<void> {
    if (!this.db || ids.length === 0) return;
    
    const placeholders = ids.map(() => '?').join(',');
    await this.db.executeSql(
      `UPDATE ${table} SET processed = 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  // Mark records as synced to backend
  async markAsSynced(table: 'health_metrics' | 'health_workouts' | 'sleep_analysis', ids: number[]): Promise<void> {
    if (!this.db || ids.length === 0) return;
    
    const placeholders = ids.map(() => '?').join(',');
    const syncTime = new Date().toISOString();
    await this.db.executeSql(
      `UPDATE ${table} SET synced_to_backend = 1, backend_sync_time = ? WHERE id IN (${placeholders})`,
      [syncTime, ...ids]
    );
  }

  // Get unsynced records for backend upload
  async getUnsyncedMetrics(limit: number = 100): Promise<HealthMetric[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `SELECT * FROM health_metrics WHERE synced_to_backend = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    
    return this.mapMetricsResult(result);
  }

  async getUnsyncedWorkouts(limit: number = 50): Promise<HealthWorkout[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `SELECT * FROM health_workouts WHERE synced_to_backend = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    
    return this.mapWorkoutsResult(result);
  }

  async getUnsyncedSleep(limit: number = 30): Promise<SleepAnalysis[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `SELECT * FROM sleep_analysis WHERE synced_to_backend = 0 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    
    return this.mapSleepResult(result);
  }

  // Get pending count for sync status
  async getPendingCount(): Promise<{ metrics: number; workouts: number; sleep: number }> {
    if (!this.db) return { metrics: 0, workouts: 0, sleep: 0 };
    
    const [metricsResult] = await this.db.executeSql(
      `SELECT COUNT(*) as count FROM health_metrics WHERE synced_to_backend = 0`
    );
    const [workoutsResult] = await this.db.executeSql(
      `SELECT COUNT(*) as count FROM health_workouts WHERE synced_to_backend = 0`
    );
    const [sleepResult] = await this.db.executeSql(
      `SELECT COUNT(*) as count FROM sleep_analysis WHERE synced_to_backend = 0`
    );
    
    return {
      metrics: metricsResult.rows.item(0).count,
      workouts: workoutsResult.rows.item(0).count,
      sleep: sleepResult.rows.item(0).count,
    };
  }

  // Log webhook event
  async logWebhookEvent(eventType: string, payload: any): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `INSERT INTO webhook_events (event_type, payload) VALUES (?, ?)`,
      [eventType, JSON.stringify(payload)]
    );
    
    return result.insertId;
  }

  // Get unsent webhook events
  async getUnsentWebhookEvents(limit: number = 50): Promise<Array<{ id: number; event_type: string; payload: string; timestamp: string; retry_count: number }>> {
    if (!this.db) return [];
    
    const [result] = await this.db.executeSql(
      `SELECT id, event_type, payload, timestamp, retry_count FROM webhook_events 
       WHERE sent = 0 AND retry_count < 5 ORDER BY timestamp ASC LIMIT ?`,
      [limit]
    );
    
    const events = [];
    for (let i = 0; i < result.rows.length; i++) {
      events.push(result.rows.item(i));
    }
    return events;
  }

  // Mark webhook event as sent
  async markWebhookEventSent(id: number): Promise<void> {
    if (!this.db) return;
    await this.db.executeSql(
      `UPDATE webhook_events SET sent = 1 WHERE id = ?`,
      [id]
    );
  }

  // Update webhook retry count
  async updateWebhookRetry(id: number, errorMessage: string): Promise<void> {
    if (!this.db) return;
    await this.db.executeSql(
      `UPDATE webhook_events SET retry_count = retry_count + 1, error_message = ? WHERE id = ?`,
      [errorMessage, id]
    );
  }

  // Log sync operation
  async logSyncStart(syncType: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    const [result] = await this.db.executeSql(
      `INSERT INTO sync_log (sync_type, start_time, status) VALUES (?, datetime('now'), 'running')`,
      [syncType]
    );
    
    return result.insertId;
  }

  async logSyncComplete(logId: number, recordsProcessed: number, recordsFailed: number, errorMessage?: string): Promise<void> {
    if (!this.db) return;
    
    const status = errorMessage ? 'failed' : 'completed';
    await this.db.executeSql(
      `UPDATE sync_log SET end_time = datetime('now'), records_processed = ?, 
       records_failed = ?, error_message = ?, status = ? WHERE id = ?`,
      [recordsProcessed, recordsFailed, errorMessage || null, status, logId]
    );
  }

  // Get last successful sync time
  async getLastSyncTime(syncType: string): Promise<string | null> {
    if (!this.db) return null;
    
    const [result] = await this.db.executeSql(
      `SELECT end_time FROM sync_log WHERE sync_type = ? AND status = 'completed' 
       ORDER BY end_time DESC LIMIT 1`,
      [syncType]
    );
    
    if (result.rows.length > 0) {
      return result.rows.item(0).end_time;
    }
    return null;
  }

  // Cleanup old processed records (keep last 90 days)
  async cleanupOldRecords(daysToKeep: number = 90): Promise<void> {
    if (!this.db) return;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoff = cutoffDate.toISOString();
    
    await this.db.executeSql(
      `DELETE FROM health_metrics WHERE processed = 1 AND timestamp < ?`,
      [cutoff]
    );
    await this.db.executeSql(
      `DELETE FROM health_workouts WHERE processed = 1 AND timestamp < ?`,
      [cutoff]
    );
    await this.db.executeSql(
      `DELETE FROM sleep_analysis WHERE processed = 1 AND timestamp < ?`,
      [cutoff]
    );
    await this.db.executeSql(
      `DELETE FROM webhook_events WHERE sent = 1 AND timestamp < ?`,
      [cutoff]
    );
  }

  // Close database
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // Helper methods to map SQL results
  private mapMetricsResult(result: SQLite.ResultSet): HealthMetric[] {
    const metrics: HealthMetric[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      metrics.push({
        id: row.id,
        source: row.source,
        type: row.type,
        value: row.value,
        unit: row.unit,
        startDate: row.start_date,
        endDate: row.end_date,
        metadata: JSON.parse(row.metadata || '{}'),
        timestamp: row.timestamp,
        processed: row.processed === 1,
        syncedToBackend: row.synced_to_backend === 1,
      });
    }
    return metrics;
  }

  private mapWorkoutsResult(result: SQLite.ResultSet): HealthWorkout[] {
    const workouts: HealthWorkout[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      workouts.push({
        id: row.id,
        source: row.source,
        workoutType: row.workout_type,
        startDate: row.start_date,
        endDate: row.end_date,
        duration: row.duration,
        calories: row.calories,
        distance: row.distance,
        heartRateAvg: row.heart_rate_avg,
        heartRateMax: row.heart_rate_max,
        heartRateMin: row.heart_rate_min,
        metadata: JSON.parse(row.metadata || '{}'),
        timestamp: row.timestamp,
        processed: row.processed === 1,
        syncedToBackend: row.synced_to_backend === 1,
      });
    }
    return workouts;
  }

  private mapSleepResult(result: SQLite.ResultSet): SleepAnalysis[] {
    const sleepData: SleepAnalysis[] = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows.item(i);
      sleepData.push({
        id: row.id,
        source: row.source,
        startDate: row.start_date,
        endDate: row.end_date,
        duration: row.duration,
        deepSleep: row.deep_sleep,
        remSleep: row.rem_sleep,
        lightSleep: row.light_sleep,
        awake: row.awake,
        efficiency: row.efficiency,
        metadata: JSON.parse(row.metadata || '{}'),
        timestamp: row.timestamp,
        processed: row.processed === 1,
        syncedToBackend: row.synced_to_backend === 1,
      });
    }
    return sleepData;
  }
}

export const databaseService = new DatabaseService();
export default databaseService;