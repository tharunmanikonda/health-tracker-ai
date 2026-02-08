/**
 * Main App Component
 * Health Tracker Mobile App
 */

import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
  AppState,
  useColorScheme,
} from 'react-native';
import {NativeBarcodeScanner} from './components/NativeBarcodeScanner';
import MobilePriorityShell from './components/MobilePriorityShell';
import {healthSyncService} from './services/healthSync';
import {databaseService} from './services/database';
import {backgroundTaskService, headlessTask} from './services/backgroundTask';
import {webhookService} from './services/webhook';
import {backendSyncService} from './services/backendSync';
import {analyticsService} from './services/analytics';
import {getDeviceInfo} from './utils/helpers';

// Register Android headless task
if (Platform.OS === 'android') {
  const BackgroundFetch = require('react-native-background-fetch').default;
  BackgroundFetch.registerHeadlessTask(headlessTask);
}

const App: React.FC = () => {
  const isDarkMode = useColorScheme() === 'dark';
  const appBackground = isDarkMode ? '#0B1121' : '#FFFFFF';
  const statusBarStyle = isDarkMode ? 'light-content' : 'dark-content';
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const lastForegroundRefreshRef = useRef(0);
  const [todaySummary, setTodaySummary] = useState({
    steps: 0,
    activeCalories: 0,
    workouts: 0,
    sleepHours: 0,
  });

  // Initialize app
  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (!hasPermissions || isSyncing) return;

      const now = Date.now();
      if (now - lastForegroundRefreshRef.current < 60 * 1000) return;
      lastForegroundRefreshRef.current = now;

      void refreshOnForeground();
    });

    return () => {
      sub.remove();
    };
  }, [hasPermissions, isSyncing]);

  const initializeApp = async () => {
    try {
      console.log('[App] Initializing...');

      // Initialize database
      await databaseService.init();

      // Initialize device info
      await getDeviceInfo();

      // Initialize webhook service
      await webhookService.initialize();

      // Initialize health sync
      const healthAvailable = await healthSyncService.initialize();
      
      if (healthAvailable) {
        // Check existing permissions
        const permissions = await healthSyncService.checkPermissions();
        const hasAnyPermission = Object.values(permissions).some(Boolean);
        
        if (!hasAnyPermission) {
          setShowPermissionPrompt(true);
        } else {
          setHasPermissions(true);
          // Perform initial sync
          performInitialSync();
        }
      }

      // Initialize background tasks
      await backgroundTaskService.initialize();
      await backgroundTaskService.start();

      setIsInitialized(true);
      console.log('[App] Initialization complete');
    } catch (error) {
      console.error('[App] Initialization failed:', error);
      setIsInitialized(true); // Continue anyway
    }
  };

  // Request health permissions
  const requestPermissions = async () => {
    const startedAt = Date.now();
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-SET',
      flow_id: 'F-SET',
      action: 'request_permissions',
      source: 'manual',
    });
    try {
      const granted = await healthSyncService.requestPermissions();
      setHasPermissions(granted);
      setShowPermissionPrompt(false);
      
      if (granted) {
        analyticsService.track('action_succeeded', {
          screen_id: 'M-SET',
          flow_id: 'F-SET',
          action: 'request_permissions',
          source: 'manual',
          latency_ms: Date.now() - startedAt,
        });
        performInitialSync();
      } else {
        analyticsService.track('action_failed', {
          screen_id: 'M-SET',
          flow_id: 'F-SET',
          action: 'request_permissions',
          source: 'manual',
          latency_ms: Date.now() - startedAt,
          error_message: 'permissions_not_granted',
        });
        Alert.alert(
          'Permissions Required',
          'Health permissions are needed to sync your health data. You can enable them later in Settings.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('[App] Permission request failed:', error);
      analyticsService.track('action_failed', {
        screen_id: 'M-SET',
        flow_id: 'F-SET',
        action: 'request_permissions',
        source: 'manual',
        latency_ms: Date.now() - startedAt,
        error_message: String(error),
      });
      Alert.alert('Error', 'Failed to request health permissions');
    }
  };

  // Perform initial sync
  const performInitialSync = async () => {
    const startedAt = Date.now();
    try {
      setIsSyncing(true);
      console.log('[App] Performing initial sync...');
      
      // Sync last 7 days of health data
      await healthSyncService.syncHealthData(7);
      
      // Get today's summary
      const summary = await healthSyncService.getTodaySummary();
      setTodaySummary(summary);
      
      // Sync to backend
      await backendSyncService.syncToBackend();
      
      console.log('[App] Initial sync complete');
      analyticsService.track('action_succeeded', {
        screen_id: 'M-HOME',
        flow_id: 'F-003',
        action: 'initial_sync',
        source: 'background',
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      console.error('[App] Initial sync failed:', error);
      analyticsService.track('action_failed', {
        screen_id: 'M-HOME',
        flow_id: 'F-003',
        action: 'initial_sync',
        source: 'background',
        latency_ms: Date.now() - startedAt,
        error_message: String(error),
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Foreground refresh to keep data fresh when user re-opens app
  async function refreshOnForeground() {
    const startedAt = Date.now();
    try {
      console.log('[App] Foreground refresh...');
      await healthSyncService.syncHealthData(1, { preferIncremental: true });
      await backendSyncService.syncToBackend();
      const summary = await healthSyncService.getTodaySummary();
      setTodaySummary(summary);
      analyticsService.track('action_succeeded', {
        screen_id: 'M-HOME',
        flow_id: 'F-003',
        action: 'foreground_refresh',
        source: 'foreground',
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      console.warn('[App] Foreground refresh failed:', error);
      analyticsService.track('action_failed', {
        screen_id: 'M-HOME',
        flow_id: 'F-003',
        action: 'foreground_refresh',
        source: 'foreground',
        latency_ms: Date.now() - startedAt,
        error_message: String(error),
      });
    }
  }

  // Manual sync handler
  const handleManualSync = useCallback(async () => {
    if (isSyncing) return;
    const startedAt = Date.now();
    
    try {
      setIsSyncing(true);
      const data = await healthSyncService.syncHealthData(1, { preferIncremental: true });
      await backendSyncService.syncToBackend();
      
      const summary = await healthSyncService.getTodaySummary();
      setTodaySummary(summary);

      const syncedRecords = data.metrics.length + data.workouts.length + data.sleep.length;
      analyticsService.track('action_succeeded', {
        screen_id: 'M-HOME',
        flow_id: 'F-003',
        action: 'manual_sync',
        source: 'manual',
        latency_ms: Date.now() - startedAt,
        synced_records: syncedRecords,
      });

      Alert.alert('Sync Complete', `Synced ${syncedRecords} records`);
    } catch (error) {
      analyticsService.track('action_failed', {
        screen_id: 'M-HOME',
        flow_id: 'F-003',
        action: 'manual_sync',
        source: 'manual',
        latency_ms: Date.now() - startedAt,
        error_message: String(error),
      });
      Alert.alert('Sync Failed', String(error));
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  // Open native scanner from any native screen
  const handleOpenScanner = useCallback(() => {
    setShowScanner(true);
  }, []);

  // Permission prompt overlay
  const renderPermissionPrompt = () => {
    if (!showPermissionPrompt) return null;

    const promptCardBg = isDarkMode ? '#111827' : '#FFFFFF';
    const promptTitleColor = isDarkMode ? '#F8FAFC' : '#0F172A';
    const promptBodyColor = isDarkMode ? '#CBD5E1' : '#334155';
    const promptMutedColor = isDarkMode ? '#94A3B8' : '#64748B';
    const promptBorderColor = isDarkMode ? 'rgba(148,163,184,0.25)' : 'rgba(15,23,42,0.12)';
    const promptSecondaryColor = isDarkMode ? '#93C5FD' : '#2563EB';

    return (
      <View style={styles.permissionOverlay}>
        <View style={[styles.permissionCard, {backgroundColor: promptCardBg, borderColor: promptBorderColor}]}>
          <Text style={[styles.permissionTitle, {color: promptTitleColor}]}>Enable Health Access</Text>
          <Text style={[styles.permissionText, {color: promptBodyColor}]}>
            HealthSync needs access to your health data to provide insights and sync with your dashboard.
          </Text>
          <Text style={[styles.permissionSubtext, {color: promptMutedColor}]}>
            We can access: Steps, Heart Rate, Sleep, Workouts, and Calories
          </Text>
          <View style={styles.permissionButtons}>
            <TouchableOpacity
              style={[styles.permissionButton, styles.permissionButtonPrimary]}
              onPress={requestPermissions}
            >
              <Text style={styles.permissionButtonTextPrimary}>Allow Access</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.permissionButton}
              onPress={() => setShowPermissionPrompt(false)}
            >
              <Text style={[styles.permissionButtonText, {color: promptSecondaryColor}]}>Not Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (!isInitialized) {
    return (
      <View style={[styles.container, {backgroundColor: appBackground}]}>
        <StatusBar barStyle={statusBarStyle} />
      </View>
    );
  }

  return (
    <View style={[styles.container, {backgroundColor: appBackground}]}>
      <StatusBar barStyle={statusBarStyle} />

      <MobilePriorityShell
        isDarkMode={isDarkMode}
        hasPermissions={hasPermissions}
        isSyncing={isSyncing}
        todaySummary={todaySummary}
        onManualSync={handleManualSync}
        onRequestPermissions={requestPermissions}
        onOpenScanner={handleOpenScanner}
      />

      {/* Native Barcode Scanner - full screen overlay with own safe areas */}
      {showScanner && (
        <View style={styles.scannerOverlay}>
          <NativeBarcodeScanner
            onClose={() => setShowScanner(false)}
            onFoodLogged={() => {
              console.log('[App] Food logged via native scanner');
              setShowScanner(false);
            }}
          />
        </View>
      )}

      {/* Permission Prompt */}
      {renderPermissionPrompt()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1121',
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  permissionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F1F5F9',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 15,
    color: '#CBD5E1',
    lineHeight: 22,
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionSubtext: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 20,
    textAlign: 'center',
  },
  permissionButtons: {
    gap: 10,
  },
  permissionButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  permissionButtonPrimary: {
    backgroundColor: '#007AFF',
  },
  permissionButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  permissionButtonTextPrimary: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
});

export default App;
