/**
 * Utility functions for the Health Tracker Mobile app
 */

import {Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {STORAGE_KEYS} from './constants';
import type {DeviceInfo} from '../types';

/**
 * Generate a unique device ID
 */
export async function getDeviceId(): Promise<string> {
  let deviceId = await AsyncStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = `${Platform.OS}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await AsyncStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
  }
  return deviceId;
}

/**
 * Get device information
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  const DeviceInfo = require('react-native-device-info');
  return {
    platform: Platform.OS as 'ios' | 'android',
    osVersion: DeviceInfo.getSystemVersion(),
    appVersion: DeviceInfo.getVersion(),
    deviceId: await getDeviceId(),
  };
}

/**
 * Format date to ISO string (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format date to ISO datetime string
 */
export function formatDateTime(date: Date): string {
  return date.toISOString();
}

/**
 * Get start and end dates for a time range
 */
export function getTimeRange(days: number): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

/**
 * Convert milliseconds to hours with decimals
 */
export function msToHours(ms: number): number {
  return Math.round((ms / (1000 * 60 * 60)) * 100) / 100;
}

/**
 * Convert milliseconds to minutes
 */
export function msToMinutes(ms: number): number {
  return Math.round(ms / (1000 * 60));
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Check if running in debug mode
 */
export function isDebugMode(): boolean {
  return __DEV__;
}

/**
 * Sleep/delay helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const delay = baseDelay * Math.pow(2, i);
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Format health value with unit
 */
export function formatHealthValue(value: number, unit: string, decimals: number = 1): string {
  const formatted = value.toFixed(decimals);
  return `${formatted} ${unit}`;
}

/**
 * Calculate average from array of numbers
 */
export function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

/**
 * Filter out outliers from data (using IQR method)
 */
export function filterOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  
  return values.filter(v => v >= lowerBound && v <= upperBound);
}

/**
 * Parse WebView message safely
 */
export function parseWebViewMessage(data: string): any | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Safe JSON stringify (handles circular references)
 */
export function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }
      seen.add(value);
    }
    return value;
  });
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Get localized health metric name
 */
export function getLocalizedMetricName(metricType: string): string {
  const names: Record<string, string> = {
    steps: 'Steps',
    heart_rate: 'Heart Rate',
    resting_heart_rate: 'Resting Heart Rate',
    heart_rate_variability: 'Heart Rate Variability',
    sleep: 'Sleep',
    sleep_deep: 'Deep Sleep',
    sleep_rem: 'REM Sleep',
    sleep_light: 'Light Sleep',
    sleep_awake: 'Time Awake',
    workout: 'Workout',
    active_calories: 'Active Calories',
    basal_calories: 'Basal Calories',
    total_calories: 'Total Calories',
    distance: 'Distance',
    flights_climbed: 'Flights Climbed',
    oxygen_saturation: 'Oxygen Saturation',
    respiratory_rate: 'Respiratory Rate',
    body_temperature: 'Body Temperature',
    blood_pressure_systolic: 'Blood Pressure (Systolic)',
    blood_pressure_diastolic: 'Blood Pressure (Diastolic)',
  };
  return names[metricType] || metricType;
}