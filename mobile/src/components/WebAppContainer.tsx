/**
 * WebApp Container Component
 * Wraps the existing React web app in a WebView
 * Handles bi-directional communication between native and web
 */

import React, {useRef, useState, useCallback, useEffect} from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  RefreshControl,
  ScrollView,
} from 'react-native';
import {WebView} from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {healthSyncService} from '../services/healthSync';
import {databaseService} from '../services/database';
import {backendSyncService} from '../services/backendSync';
import {STORAGE_KEYS, WEBAPP_URL} from '../utils/constants';
import type {WebViewMessage, WebViewHealthDataMessage} from '../types';

interface WebAppContainerProps {
  onMessage?: (message: any) => void;
}

const INJECTED_JAVASCRIPT = `
  (function() {
    // Create bridge object for React Native communication
    window.ReactNativeWebViewBridge = {
      postMessage: function(data) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
      }
    };

    // Override console.log to send to React Native in debug mode
    const originalLog = console.log;
    console.log = function(...args) {
      originalLog.apply(console, args);
      if (window.__DEV__) {
        window.ReactNativeWebViewBridge.postMessage({
          type: 'console',
          level: 'log',
          payload: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
        });
      }
    };

    // Notify that the bridge is ready
    window.ReactNativeWebViewBridge.postMessage({
      type: 'bridge_ready',
      payload: { timestamp: new Date().toISOString() }
    });

    // Listen for auth token updates
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      // Check if auth token is in response
      const authHeader = response.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        window.ReactNativeWebViewBridge.postMessage({
          type: 'auth_token',
          payload: { token: authHeader.replace('Bearer ', '') }
        });
      }
      return response;
    };
  })();
  true;
`;

export const WebAppContainer: React.FC<WebAppContainerProps> = ({onMessage}) => {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Inject auth token when WebView loads
  const injectAuthToken = useCallback(async () => {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (token && webViewRef.current) {
      const script = `
        (function() {
          localStorage.setItem('auth_token', '${token}');
          window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token' }));
        })();
        true;
      `;
      webViewRef.current.injectJavaScript(script);
    }
  }, []);

  // Handle messages from WebView
  const handleMessage = useCallback(async (event: any) => {
    try {
      const message: WebViewMessage = JSON.parse(event.nativeEvent.data);
      
      switch (message.type) {
        case 'bridge_ready':
          console.log('[WebView] Bridge ready');
          await injectAuthToken();
          break;

        case 'auth_token':
          if (message.payload?.token) {
            await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, message.payload.token);
          }
          break;

        case 'sync_request':
          // Web app requested a health data sync
          try {
            const data = await healthSyncService.syncHealthData(message.payload?.days || 7);
            sendMessageToWebView({
              type: 'health_data',
              payload: data,
            });
          } catch (err) {
            sendMessageToWebView({
              type: 'error',
              payload: { error: 'Sync failed', details: String(err) },
            });
          }
          break;

        case 'sync_status':
          const status = await backendSyncService.getSyncStatus();
          sendMessageToWebView({
            type: 'sync_status',
            payload: status,
          });
          break;

        case 'console':
          if (__DEV__) {
            console.log('[WebView Console]', message.payload);
          }
          break;

        default:
          console.log('[WebView] Unknown message:', message);
      }

      if (onMessage) {
        onMessage(message);
      }
    } catch (err) {
      console.error('[WebView] Message parse error:', err);
    }
  }, [injectAuthToken, onMessage]);

  // Send message to WebView
  const sendMessageToWebView = useCallback((message: WebViewMessage) => {
    if (webViewRef.current) {
      const script = `
        (function() {
          window.dispatchEvent(new MessageEvent('message', {
            data: ${JSON.stringify(message)}
          }));
          if (window.onReactNativeMessage) {
            window.onReactNativeMessage(${JSON.stringify(message)});
          }
        })();
        true;
      `;
      webViewRef.current.injectJavaScript(script);
    }
  }, []);

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
    setRefreshing(false);
  }, []);

  // Handle WebView errors
  const handleError = useCallback((syntheticEvent: any) => {
    const {nativeEvent} = syntheticEvent;
    console.error('[WebView] Error:', nativeEvent);
    setError(nativeEvent.description || 'Failed to load app');
    setLoading(false);
  }, []);

  // Send health data to WebView
  const sendHealthDataToWebView = useCallback(async () => {
    try {
      const metrics = await databaseService.getUnprocessedMetrics(50);
      const workouts = await databaseService.getUnprocessedWorkouts(20);
      const sleep = await databaseService.getUnprocessedSleep(10);

      if (metrics.length > 0 || workouts.length > 0 || sleep.length > 0) {
        sendMessageToWebView({
          type: 'health_data',
          payload: { metrics, workouts, sleep },
        });
      }
    } catch (err) {
      console.error('[WebView] Failed to send health data:', err);
    }
  }, [sendMessageToWebView]);

  // Initial health data send
  useEffect(() => {
    if (!loading) {
      sendHealthDataToWebView();
    }
  }, [loading, sendHealthDataToWebView]);

  return (
    <View style={styles.container}>
      {error ? (
        <ScrollView
          contentContainerStyle={styles.errorContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <Text style={styles.errorText}>Failed to load app</Text>
          <Text style={styles.errorSubtext}>{error}</Text>
          <Text style={styles.retryText}>Pull down to retry</Text>
        </ScrollView>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: WEBAPP_URL }}
          style={styles.webview}
          injectedJavaScript={INJECTED_JAVASCRIPT}
          onMessage={handleMessage}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={handleError}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          pullToRefreshEnabled={true}
          allowsBackForwardNavigationGestures={true}
          mixedContentMode="always"
          cacheEnabled={true}
          // Handle file uploads
          allowsFileAccess={true}
          allowsFileAccessFromFileURLs={true}
          allowsUniversalAccessFromFileURLs={true}
        />
      )}
      {loading && (
        <View style={styles.loadingContainer}>
          <View style={styles.loadingLogo}>
            <Text style={styles.loadingLogoText}>♥</Text>
          </View>
          <Text style={styles.loadingTitle}>Health Tracker</Text>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Syncing your wellness dashboard...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingLogo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingLogoText: {
    color: '#f8fafc',
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 36,
  },
  loadingTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  loadingText: {
    fontSize: 16,
    color: '#94a3b8',
    marginTop: 4,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ef4444',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryText: {
    fontSize: 14,
    color: '#10B981',
  },
});

export default WebAppContainer;
