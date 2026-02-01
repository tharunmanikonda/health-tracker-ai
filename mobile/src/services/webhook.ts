/**
 * Webhook Service
 * Handles triggering webhooks when health data changes
 * and manages webhook event queue
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {databaseService} from './database';
import {getDeviceInfo} from '../utils/helpers';
import {API_BASE_URL, STORAGE_KEYS, WEBHOOK_EVENTS} from '../utils/constants';
import type {WebhookPayload, HealthMetric, HealthWorkout, SleepAnalysis, DeviceInfo} from '../types';

class WebhookService {
  private webhookUrl: string | null = null;
  private deviceInfo: DeviceInfo | null = null;

  async initialize(): Promise<void> {
    // Load webhook configuration
    const config = await AsyncStorage.getItem(STORAGE_KEYS.WEBHOOK_CONFIG);
    if (config) {
      const parsed = JSON.parse(config);
      this.webhookUrl = parsed.url || null;
    }
    this.deviceInfo = await getDeviceInfo();
  }

  // Set webhook URL
  async setWebhookUrl(url: string | null): Promise<void> {
    this.webhookUrl = url;
    await AsyncStorage.setItem(
      STORAGE_KEYS.WEBHOOK_CONFIG,
      JSON.stringify({ url, enabled: !!url })
    );
  }

  // Get webhook URL
  getWebhookUrl(): string | null {
    return this.webhookUrl;
  }

  // Check if webhook is configured
  isWebhookConfigured(): boolean {
    return !!this.webhookUrl;
  }

  // Trigger webhook for health data updates
  async triggerHealthDataUpdated(data: {
    metrics: HealthMetric[];
    workouts: HealthWorkout[];
    sleep: SleepAnalysis[];
  }): Promise<void> {
    // Log event to database
    await databaseService.logWebhookEvent(
      WEBHOOK_EVENTS.HEALTH_DATA_UPDATED,
      data
    );

    // If webhook URL configured, try to send immediately
    if (this.webhookUrl) {
      try {
        await this.sendWebhookEvent(WEBHOOK_EVENTS.HEALTH_DATA_UPDATED, data);
      } catch (error) {
        console.warn('[Webhook] Immediate send failed, queued for retry:', error);
      }
    }

    // Also send to backend webhook endpoint
    try {
      await this.sendToBackendWebhook(WEBHOOK_EVENTS.HEALTH_DATA_UPDATED, data);
    } catch (error) {
      console.warn('[Webhook] Backend webhook send failed:', error);
    }
  }

  // Trigger sync completed webhook
  async triggerSyncCompleted(recordsProcessed: number): Promise<void> {
    const data = { recordsProcessed, timestamp: new Date().toISOString() };
    
    await databaseService.logWebhookEvent(WEBHOOK_EVENTS.SYNC_COMPLETED, data);

    if (this.webhookUrl) {
      try {
        await this.sendWebhookEvent(WEBHOOK_EVENTS.SYNC_COMPLETED, data);
      } catch (error) {
        console.warn('[Webhook] Sync completed webhook failed:', error);
      }
    }

    await this.sendToBackendWebhook(WEBHOOK_EVENTS.SYNC_COMPLETED, data);
  }

  // Trigger sync failed webhook
  async triggerSyncFailed(errorMessage: string): Promise<void> {
    const data = { error: errorMessage, timestamp: new Date().toISOString() };
    
    await databaseService.logWebhookEvent(WEBHOOK_EVENTS.SYNC_FAILED, data);

    if (this.webhookUrl) {
      try {
        await this.sendWebhookEvent(WEBHOOK_EVENTS.SYNC_FAILED, data);
      } catch (error) {
        console.warn('[Webhook] Sync failed webhook failed:', error);
      }
    }

    await this.sendToBackendWebhook(WEBHOOK_EVENTS.SYNC_FAILED, data);
  }

  // Send webhook event to configured URL
  private async sendWebhookEvent(eventType: string, data: any): Promise<void> {
    if (!this.webhookUrl) return;

    const payload: WebhookPayload = {
      event: eventType as any,
      timestamp: new Date().toISOString(),
      data: {
        ...data,
        deviceInfo: this.deviceInfo || await getDeviceInfo(),
      },
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Health-Tracker-Source': 'mobile-app',
        'X-Event-Type': eventType,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
    }
  }

  // Send to backend webhook endpoint
  private async sendToBackendWebhook(eventType: string, data: any): Promise<void> {
    const authToken = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    
    const payload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      source: 'mobile',
      deviceInfo: this.deviceInfo || await getDeviceInfo(),
      data,
    };

    try {
      const response = await fetch(`${API_BASE_URL}/health-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[Webhook] Backend webhook error:', response.status, errorText);
      } else {
        console.log('[Webhook] Backend webhook sent successfully');
      }
    } catch (error) {
      console.error('[Webhook] Failed to send to backend:', error);
      throw error;
    }
  }

  // Process unsent webhook events (call this periodically)
  async processUnsentEvents(): Promise<{
    sent: number;
    failed: number;
  }> {
    const events = await databaseService.getUnsentWebhookEvents(50);
    let sent = 0;
    let failed = 0;

    for (const event of events) {
      try {
        if (this.webhookUrl) {
          await this.sendWebhookEvent(event.event_type, JSON.parse(event.payload));
        }
        await databaseService.markWebhookEventSent(event.id);
        sent++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await databaseService.updateWebhookRetry(event.id, errorMessage);
        failed++;
      }
    }

    return { sent, failed };
  }

  // Get webhook statistics
  async getWebhookStats(): Promise<{
    pending: number;
    sent: number;
    failed: number;
  }> {
    // This would require additional DB queries
    // For now, return basic info
    return {
      pending: 0,
      sent: 0,
      failed: 0,
    };
  }
}

export const webhookService = new WebhookService();
export default webhookService;