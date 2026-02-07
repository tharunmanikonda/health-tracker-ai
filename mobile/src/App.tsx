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
import {WebAppContainer} from './components/WebAppContainer';
import {NativeBarcodeScanner} from './components/NativeBarcodeScanner';
import {healthSyncService} from './services/healthSync';
import {databaseService} from './services/database';
import {backgroundTaskService, headlessTask} from './services/backgroundTask';
import {webhookService} from './services/webhook';
import {backendSyncService} from './services/backendSync';
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
  const [webViewNavigateTo, setWebViewNavigateTo] = useState<string | null>(null);
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
    try {
      const granted = await healthSyncService.requestPermissions();
      setHasPermissions(granted);
      setShowPermissionPrompt(false);
      
      if (granted) {
        performInitialSync();
      } else {
        Alert.alert(
          'Permissions Required',
          'Health permissions are needed to sync your health data. You can enable them later in Settings.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('[App] Permission request failed:', error);
      Alert.alert('Error', 'Failed to request health permissions');
    }
  };

  // Perform initial sync
  const performInitialSync = async () => {
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
    } catch (error) {
      console.error('[App] Initial sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Foreground refresh to keep data fresh when user re-opens app
  async function refreshOnForeground() {
    try {
      console.log('[App] Foreground refresh...');
      await healthSyncService.syncHealthData(1, { preferIncremental: true });
      await backendSyncService.syncToBackend();
      const summary = await healthSyncService.getTodaySummary();
      setTodaySummary(summary);
    } catch (error) {
      console.warn('[App] Foreground refresh failed:', error);
    }
  }

  // Manual sync handler
  const handleManualSync = useCallback(async () => {
    if (isSyncing) return;
    
    try {
      setIsSyncing(true);
      const data = await healthSyncService.syncHealthData(1, { preferIncremental: true });
      await backendSyncService.syncToBackend();
      
      const summary = await healthSyncService.getTodaySummary();
      setTodaySummary(summary);
      
      Alert.alert('Sync Complete', `Synced ${data.metrics.length + data.workouts.length + data.sleep.length} records`);
    } catch (error) {
      Alert.alert('Sync Failed', String(error));
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  // Handle scan request from WebView
  const handleScanRequested = useCallback(() => {
    console.log('[App] Native scanner requested');
    setShowScanner(true);
  }, []);

  // Handle messages from WebView
  const handleWebViewMessage = useCallback((message: any) => {
    console.log('[App] Message from WebView:', message);

    // Handle any app-level message processing here
    switch (message.type) {
      case 'health_data':
        // Update UI with new health data
        break;
    }
  }, []);

  // Permission prompt overlay
  const renderPermissionPrompt = () => {
    if (!showPermissionPrompt) return null;

    return (
      <View style={styles.permissionOverlay}>
        <View style={styles.permissionCard}>
          <Text style={styles.permissionTitle}>Enable Health Access</Text>
          <Text style={styles.permissionText}>
            HealthSync needs access to your health data to provide insights and sync with your dashboard.
          </Text>
          <Text style={styles.permissionSubtext}>
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
              <Text style={styles.permissionButtonText}>Not Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // Sync status bar
  const renderSyncStatus = () => {
    if (!hasPermissions) return null;

    return (
      <View style={styles.statusBar}>
        <View style={styles.statusItem}>
          <Text style={styles.statusValue}>{todaySummary.steps.toLocaleString()}</Text>
          <Text style={styles.statusLabel}>Steps</Text>
        </View>
        <View style={styles.statusItem}>
          <Text style={styles.statusValue}>{Math.round(todaySummary.activeCalories)}</Text>
          <Text style={styles.statusLabel}>Cal</Text>
        </View>
        <View style={styles.statusItem}>
          <Text style={styles.statusValue}>{todaySummary.workouts}</Text>
          <Text style={styles.statusLabel}>Workouts</Text>
        </View>
        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.syncButtonActive]}
          onPress={handleManualSync}
          disabled={isSyncing}
        >
          <Text style={styles.syncButtonText}>
            {isSyncing ? '⟳' : '↻'}
          </Text>
        </TouchableOpacity>
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

      {/* Main WebView - full screen edge-to-edge */}
      <View style={styles.webviewContainer}>
        <WebAppContainer
          onMessage={handleWebViewMessage}
          onScanRequested={handleScanRequested}
          navigateTo={webViewNavigateTo}
        />
      </View>

      {/* Native Barcode Scanner - full screen overlay with own safe areas */}
      {showScanner && (
        <View style={styles.scannerOverlay}>
          <NativeBarcodeScanner
            onClose={() => setShowScanner(false)}
            onFoodLogged={() => {
              console.log('[App] Food logged via native scanner');
              // Navigate to dashboard and trigger refresh
              setWebViewNavigateTo('/?' + Date.now());
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
  webviewContainer: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  statusItem: {
    flex: 1,
    alignItems: 'center',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F1F5F9',
  },
  statusLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  syncButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  syncButtonActive: {
    backgroundColor: '#0056b3',
    opacity: 0.7,
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
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
