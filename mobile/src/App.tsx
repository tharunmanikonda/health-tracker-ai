/**
 * Main App Component
 * Tharun Health Tracker Mobile App
 */

import React, {useEffect, useState, useCallback} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  StatusBar,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {WebAppContainer} from './components/WebAppContainer';
import {healthSyncService} from './services/healthSync';
import {databaseService} from './services/database';
import {backgroundTaskService, headlessTask} from './services/backgroundTask';
import {webhookService} from './services/webhook';
import {backendSyncService} from './services/backendSync';
import {getDeviceInfo} from './utils/helpers';
import {STORAGE_KEYS} from './utils/constants';
import type {HealthPermissions} from './types';

// Register Android headless task
if (Platform.OS === 'android') {
  const BackgroundTask = require('react-native-background-task');
  BackgroundTask.define(headlessTask);
}

const App: React.FC = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
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

  // Manual sync handler
  const handleManualSync = useCallback(async () => {
    if (isSyncing) return;
    
    try {
      setIsSyncing(true);
      const data = await healthSyncService.syncHealthData(1);
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
            Tharun Health Tracker needs access to your health data to provide insights and sync with your dashboard.
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
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      {/* Sync Status Bar */}
      {renderSyncStatus()}
      
      {/* Main WebView */}
      <View style={styles.webviewContainer}>
        <WebAppContainer onMessage={handleWebViewMessage} />
      </View>
      
      {/* Permission Prompt */}
      {renderPermissionPrompt()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webviewContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 18,
    color: '#666',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  statusItem: {
    flex: 1,
    alignItems: 'center',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#212529',
  },
  statusLabel: {
    fontSize: 11,
    color: '#6c757d',
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
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#212529',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 15,
    color: '#495057',
    lineHeight: 22,
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionSubtext: {
    fontSize: 13,
    color: '#6c757d',
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