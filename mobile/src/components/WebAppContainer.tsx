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
  onScanRequested?: () => void;
  navigateTo?: string | null;
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

    // Set viewport-fit=cover so env(safe-area-inset-*) works
    var viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    }

    // Inject styles to make WebView feel like a native app
    var style = document.createElement('style');
    style.textContent = [
      // Prevent overscroll white flash
      'html, body { overscroll-behavior: none; -webkit-overflow-scrolling: touch; background-color: #0B1121 !important; }',
      // Profile avatar is now the only header action, keep it visible
      // Disable text selection to feel native
      '* { -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }',
      'input, textarea { -webkit-user-select: auto; user-select: auto; }',
    ].join('\\n');
    document.head.appendChild(style);

    // Notify that the bridge is ready
    window.ReactNativeWebViewBridge.postMessage({
      type: 'bridge_ready',
      payload: { timestamp: new Date().toISOString() }
    });

    // Intercept /scan navigation to use native scanner
    const checkForScanRoute = function() {
      if (window.location.pathname === '/scan') {
        window.ReactNativeWebViewBridge.postMessage({
          type: 'navigate_scan',
          payload: { url: window.location.href }
        });
        // Navigate back so the scan page doesn't render in WebView
        if (window.history.length > 1) {
          window.history.back();
        }
      }
    };

    // Monitor pushState (React Router uses this)
    var originalPushState = history.pushState;
    history.pushState = function() {
      originalPushState.apply(this, arguments);
      checkForScanRoute();
    };

    // Monitor replaceState
    var originalReplaceState = history.replaceState;
    history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      checkForScanRoute();
    };

    // Monitor popstate (back/forward)
    window.addEventListener('popstate', checkForScanRoute);

    // Sync auth token from localStorage to React Native
    // Web app stores JWT as localStorage.getItem('token')
    function syncAuthToken() {
      var token = localStorage.getItem('token');
      if (token) {
        window.ReactNativeWebViewBridge.postMessage({
          type: 'auth_token',
          payload: { token: token }
        });
      }
    }

    // Sync token immediately
    syncAuthToken();

    // Also sync whenever localStorage changes (login/logout)
    var originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
      originalSetItem.apply(this, arguments);
      if (key === 'token') {
        window.ReactNativeWebViewBridge.postMessage({
          type: 'auth_token',
          payload: { token: value }
        });
      }
    };

    var originalRemoveItem = localStorage.removeItem;
    localStorage.removeItem = function(key) {
      originalRemoveItem.apply(this, arguments);
      if (key === 'token') {
        window.ReactNativeWebViewBridge.postMessage({
          type: 'auth_token',
          payload: { token: null }
        });
      }
    };
  })();
  true;
`;

export const WebAppContainer: React.FC<WebAppContainerProps> = ({onMessage, onScanRequested, navigateTo}) => {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Inject auth token when WebView loads (sync from AsyncStorage → localStorage)
  const injectAuthToken = useCallback(async () => {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (token && webViewRef.current) {
      const script = `
        (function() {
          localStorage.setItem('token', '${token}');
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
            console.log('[WebView] Auth token synced to AsyncStorage');
          } else {
            await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
            console.log('[WebView] Auth token removed from AsyncStorage');
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

        case 'navigate_scan':
          console.log('[WebView] Scan requested - opening native scanner');
          if (onScanRequested) {
            onScanRequested();
          }
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

  // Navigate WebView via SPA click (no page reload, no blink)
  useEffect(() => {
    if (navigateTo && webViewRef.current && !loading) {
      const route = navigateTo.split('?')[0];
      // Click the nav link for SPA navigation, then dispatch refresh event
      const script = `
        (function() {
          // Try exact match first, then partial match on nav links
          var link = document.querySelector('a[href="${route}"]') ||
                     document.querySelector('nav a[href="${route}"]');
          if (link) {
            link.click();
          }
          // Tell the web app to refresh its data (e.g. after native food logging)
          setTimeout(function() {
            window.dispatchEvent(new Event('native-data-changed'));
          }, 300);
        })();
        true;
      `;
      webViewRef.current.injectJavaScript(script);
    }
  }, [navigateTo, loading]);

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
          allowsBackForwardNavigationGestures={true}
          mixedContentMode="always"
          cacheEnabled={true}
          // Prevent white overscroll - makes it feel like a native app
          bounces={false}
          overScrollMode="never"
          scrollEnabled={true}
          // Match the app's dark background so no white flash
          backgroundColor="#0B1121"
          // Handle file uploads
          allowsFileAccess={true}
          allowsFileAccessFromFileURLs={true}
          allowsUniversalAccessFromFileURLs={true}
          // Camera access
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
        />
      )}
      {loading && (
        <View style={styles.loadingContainer}>
          <View style={styles.loadingLogo}>
            <Text style={styles.loadingLogoText}>♥</Text>
          </View>
          <Text style={styles.loadingTitle}>HealthSync</Text>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Syncing your wellness dashboard...</Text>
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
  webview: {
    flex: 1,
    backgroundColor: '#0B1121',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B1121',
  },
  loadingLogo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#007AFF',
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
    color: '#007AFF',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  loadingText: {
    fontSize: 16,
    color: '#94A3B8',
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
    color: '#d32f2f',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryText: {
    fontSize: 14,
    color: '#007AFF',
  },
});

export default WebAppContainer;
