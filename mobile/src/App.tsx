/**
 * Main App Component
 * Health Tracker Mobile App
 */

import React, {useEffect, useState, useCallback} from 'react';
import {
  StyleSheet,
  View,
  StatusBar,
  Platform,
  AppState,
  useColorScheme,
} from 'react-native';
import {NativeBarcodeScanner} from './components/NativeBarcodeScanner';
import {WebAppContainer} from './components/WebAppContainer';
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
  const [showScanner, setShowScanner] = useState(false);

  // Initialize app
  useEffect(() => {
    initializeApp();
  }, []);

  // Background sync on foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      void refreshOnForeground();
    });
    return () => sub.remove();
  }, []);

  const initializeApp = async () => {
    try {
      console.log('[App] Initializing...');

      await databaseService.init();
      await getDeviceInfo();
      await webhookService.initialize();

      const healthAvailable = await healthSyncService.initialize();
      if (healthAvailable) {
        const permissions = await healthSyncService.checkPermissions();
        const hasAnyPermission = Object.values(permissions).some(Boolean);
        if (hasAnyPermission) {
          performInitialSync();
        }
      }

      await backgroundTaskService.initialize();
      await backgroundTaskService.start();

      setIsInitialized(true);
      console.log('[App] Initialization complete');
    } catch (error) {
      console.error('[App] Initialization failed:', error);
      setIsInitialized(true);
    }
  };

  const performInitialSync = async () => {
    try {
      console.log('[App] Performing initial sync...');
      await healthSyncService.syncHealthData(7);
      await backendSyncService.syncToBackend();
      console.log('[App] Initial sync complete');
    } catch (error) {
      console.error('[App] Initial sync failed:', error);
    }
  };

  async function refreshOnForeground() {
    try {
      console.log('[App] Foreground refresh...');
      await healthSyncService.syncHealthData(1, { preferIncremental: true });
      await backendSyncService.syncToBackend();
    } catch (error) {
      console.warn('[App] Foreground refresh failed:', error);
    }
  }

  const handleOpenScanner = useCallback(() => {
    setShowScanner(true);
  }, []);

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

      <WebAppContainer onScanRequested={handleOpenScanner} />

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
});

export default App;
