/**
 * Background Task Service
 * Handles periodic background sync of health data
 * iOS: Uses react-native-background-fetch
 * Android: Uses WorkManager via react-native-background-task
 */

import BackgroundFetch from 'react-native-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform} from 'react-native';
import {healthSyncService} from './healthSync';
import {webhookService} from './webhook';
import {backendSyncService} from './backendSync';
import {databaseService} from './database';
import {STORAGE_KEYS, DEFAULT_SYNC_CONFIG} from '../utils/constants';
import type {BackgroundSyncConfig} from '../types';

const BACKGROUND_SYNC_TASK = 'com.tharunhealthtracker.backgroundSync';

class BackgroundTaskService {
  private isInitialized: boolean = false;
  private config: BackgroundSyncConfig = DEFAULT_SYNC_CONFIG;

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      // Load config
      const savedConfig = await AsyncStorage.getItem(STORAGE_KEYS.APP_SETTINGS);
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        this.config = { ...DEFAULT_SYNC_CONFIG, ...parsed.syncConfig };
      }

      // Initialize based on platform
      if (Platform.OS === 'ios') {
        await this.initializeIOS();
      } else if (Platform.OS === 'android') {
        await this.initializeAndroid();
      }

      this.isInitialized = true;
      console.log('[BackgroundTask] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[BackgroundTask] Initialization failed:', error);
      return false;
    }
  }

  // iOS BackgroundFetch initialization
  private async initializeIOS(): Promise<void> {
    const status = await BackgroundFetch.configure(
      {
        minimumFetchInterval: 15, // iOS minimum is 15 minutes
        stopOnTerminate: false,
        enableHeadless: true,
        startOnBoot: true,
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
        requiresCharging: this.config.requiresCharging,
        requiresStorageNotLow: false,
        requiresBatteryNotLow: true,
      },
      async (taskId: string) => {
        console.log('[BackgroundTask] iOS background fetch:', taskId);
        await this.performBackgroundSync();
        BackgroundFetch.finish(taskId);
      },
      async (taskId: string) => {
        console.log('[BackgroundTask] iOS background fetch timeout:', taskId);
        BackgroundFetch.finish(taskId);
      }
    );

    console.log('[BackgroundTask] iOS BackgroundFetch status:', status);
  }

  // Android WorkManager initialization
  private async initializeAndroid(): Promise<void> {
    // Android uses a different approach with Headless JS
    // The native module handles the scheduling
    console.log('[BackgroundTask] Android background task registered');
  }

  // Perform background sync
  private async performBackgroundSync(): Promise<void> {
    console.log('[BackgroundTask] Starting background sync...');
    const logId = await databaseService.logSyncStart('background');
    
    let recordsProcessed = 0;
    let recordsFailed = 0;
    let errorMessage: string | undefined;

    try {
      // Initialize services if needed
      await healthSyncService.initialize();
      await webhookService.initialize();

      // Check permissions
      if (!healthSyncService.hasHealthPermissions()) {
        console.log('[BackgroundTask] No health permissions, skipping sync');
        return;
      }

      // Sync health data from native health store
      const { metrics, workouts, sleep } = await healthSyncService.syncHealthData(1);
      recordsProcessed += metrics.length + workouts.length + sleep.length;

      // Sync with backend
      await backendSyncService.syncToBackend();

      // Process any unsent webhook events
      await webhookService.processUnsentEvents();

      // Cleanup old records
      await databaseService.cleanupOldRecords(90);

      // Trigger sync completed webhook
      await webhookService.triggerSyncCompleted(recordsProcessed);

      console.log('[BackgroundTask] Sync completed:', recordsProcessed, 'records');
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      recordsFailed = recordsProcessed;
      console.error('[BackgroundTask] Sync failed:', error);
      await webhookService.triggerSyncFailed(errorMessage);
    } finally {
      await databaseService.logSyncComplete(logId, recordsProcessed, recordsFailed, errorMessage);
    }
  }

  // Start background fetch
  async start(): Promise<boolean> {
    if (!this.config.enabled) {
      console.log('[BackgroundTask] Background sync is disabled');
      return false;
    }

    try {
      if (Platform.OS === 'ios') {
        await BackgroundFetch.start();
      }
      console.log('[BackgroundTask] Background fetch started');
      return true;
    } catch (error) {
      console.error('[BackgroundTask] Failed to start:', error);
      return false;
    }
  }

  // Stop background fetch
  async stop(): Promise<boolean> {
    try {
      if (Platform.OS === 'ios') {
        await BackgroundFetch.stop();
      }
      console.log('[BackgroundTask] Background fetch stopped');
      return true;
    } catch (error) {
      console.error('[BackgroundTask] Failed to stop:', error);
      return false;
    }
  }

  // Get background fetch status
  async getStatus(): Promise<number | null> {
    try {
      if (Platform.OS === 'ios') {
        return await BackgroundFetch.status();
      }
      return null;
    } catch (error) {
      console.error('[BackgroundTask] Failed to get status:', error);
      return null;
    }
  }

  // Simulate background fetch (for testing)
  async simulateBackgroundFetch(): Promise<void> {
    if (__DEV__) {
      console.log('[BackgroundTask] Simulating background fetch...');
      await this.performBackgroundSync();
    }
  }

  // Update sync configuration
  async updateConfig(newConfig: Partial<BackgroundSyncConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    
    // Save to storage
    const settings = await AsyncStorage.getItem(STORAGE_KEYS.APP_SETTINGS);
    const parsed = settings ? JSON.parse(settings) : {};
    parsed.syncConfig = this.config;
    await AsyncStorage.setItem(STORAGE_KEYS.APP_SETTINGS, JSON.stringify(parsed));

    // Re-initialize if running state changed
    if (newConfig.enabled !== undefined) {
      if (newConfig.enabled) {
        await this.start();
      } else {
        await this.stop();
      }
    }
  }

  // Get current configuration
  getConfig(): BackgroundSyncConfig {
    return { ...this.config };
  }
}

export const backgroundTaskService = new BackgroundTaskService();
export default backgroundTaskService;

// Headless task for Android (called when app is killed)
// This needs to be registered in index.js
export const headlessTask = async (event: { taskId: string; isTimeout?: boolean }) => {
  console.log('[BackgroundTask] Android headless task:', event.taskId);
  
  if (event.isTimeout) {
    console.log('[BackgroundTask] Headless task timeout');
    return;
  }

  // Initialize database
  await databaseService.init();
  
  // Initialize services
  await healthSyncService.initialize();
  await webhookService.initialize();
  
  // Perform sync
  try {
    const { metrics, workouts, sleep } = await healthSyncService.syncHealthData(1);
    await backendSyncService.syncToBackend();
    await webhookService.triggerSyncCompleted(metrics.length + workouts.length + sleep.length);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await webhookService.triggerSyncFailed(errorMessage);
  }
};