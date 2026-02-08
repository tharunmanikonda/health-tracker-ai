import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {WebAppContainer} from './WebAppContainer';
import {
  addMeal,
  addWorkout,
  createEmptyPlanner,
  loadPlanner,
  removeMeal,
  removeWorkout,
  savePlanner,
  toggleWorkout,
  updateDayNotes,
} from '../services/plannerStorage';
import {isFeatureEnabled} from '../config/featureFlags';
import {analyticsService} from '../services/analytics';
import {STORAGE_KEYS} from '../utils/constants';
import type {MealType, PlannerDayKey, WeeklyPlanner} from '../types/planner';

interface TodaySummary {
  steps: number;
  activeCalories: number;
  workouts: number;
  sleepHours: number;
}

interface MobilePriorityShellProps {
  isDarkMode: boolean;
  hasPermissions: boolean;
  isSyncing: boolean;
  todaySummary: TodaySummary;
  onManualSync: () => Promise<void> | void;
  onRequestPermissions: () => Promise<void> | void;
  onOpenScanner: () => void;
}

type AppTab = 'home' | 'planner' | 'mirror' | 'settings';

const DAYS: Array<{key: PlannerDayKey; short: string; full: string}> = [
  {key: 'mon', short: 'MON', full: 'Monday'},
  {key: 'tue', short: 'TUE', full: 'Tuesday'},
  {key: 'wed', short: 'WED', full: 'Wednesday'},
  {key: 'thu', short: 'THU', full: 'Thursday'},
  {key: 'fri', short: 'FRI', full: 'Friday'},
  {key: 'sat', short: 'SAT', full: 'Saturday'},
  {key: 'sun', short: 'SUN', full: 'Sunday'},
];

const QUICK_WORKOUTS = ['Strength 45m', 'Run 30m', 'Mobility 15m'];
const QUICK_MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function getTodayDayKey(): PlannerDayKey {
  const index = new Date().getDay();
  if (index === 0) return 'sun';
  if (index === 1) return 'mon';
  if (index === 2) return 'tue';
  if (index === 3) return 'wed';
  if (index === 4) return 'thu';
  if (index === 5) return 'fri';
  return 'sat';
}

function formatSyncLabel(lastSyncAt: string | null): string {
  if (!lastSyncAt) return 'Never synced';

  const date = new Date(lastSyncAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  return `Last sync ${date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
}

function MobilePriorityShell({
  isDarkMode,
  hasPermissions,
  isSyncing,
  todaySummary,
  onManualSync,
  onRequestPermissions,
  onOpenScanner,
}: MobilePriorityShellProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [planner, setPlanner] = useState<WeeklyPlanner>(createEmptyPlanner());
  const [plannerLoading, setPlannerLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<PlannerDayKey>(getTodayDayKey());
  const [customWorkout, setCustomWorkout] = useState('');
  const [customMeal, setCustomMeal] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const showMirrorTab = isFeatureEnabled('WEB_MIRROR_TAB');

  const palette = useMemo(
    () =>
      isDarkMode
        ? {
            bg: '#070C17',
            surface: '#111827',
            surfaceSoft: '#0F172A',
            border: 'rgba(148, 163, 184, 0.22)',
            text: '#F8FAFC',
            textMuted: '#94A3B8',
            primary: '#3B82F6',
            success: '#10B981',
            warning: '#F59E0B',
            danger: '#EF4444',
          }
        : {
            bg: '#F4F7FB',
            surface: '#FFFFFF',
            surfaceSoft: '#EEF2F7',
            border: 'rgba(15, 23, 42, 0.12)',
            text: '#0F172A',
            textMuted: '#64748B',
            primary: '#2563EB',
            success: '#059669',
            warning: '#D97706',
            danger: '#DC2626',
          },
    [isDarkMode],
  );

  const styles = useMemo(() => createStyles(palette), [palette]);

  const selectedDayMeta = DAYS.find((day) => day.key === selectedDay) ?? DAYS[0];
  const selectedPlan = planner.days[selectedDay];

  const loadLastSyncLabel = useCallback(async () => {
    try {
      const value = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC_TIME);
      setLastSyncAt(value);
    } catch (error) {
      console.warn('[MobilePriorityShell] failed to load sync time:', error);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setPlannerLoading(true);
      try {
        const loaded = await loadPlanner();
        setPlanner(loaded);
        setPlannerError(null);
      } catch (error) {
        console.warn('[MobilePriorityShell] planner load failed:', error);
        setPlanner(createEmptyPlanner());
        setPlannerError('Unable to load saved planner. Started with a clean plan.');
      }
      setPlannerLoading(false);
    })();
    void loadLastSyncLabel();
  }, [loadLastSyncLabel]);

  useEffect(() => {
    if (!isSyncing) {
      void loadLastSyncLabel();
    }
  }, [isSyncing, loadLastSyncLabel]);

  useEffect(() => {
    if (activeTab === 'mirror' && !showMirrorTab) {
      setActiveTab('home');
    }
  }, [activeTab, showMirrorTab]);

  useEffect(() => {
    const screenId =
      activeTab === 'home'
        ? 'M-HOME'
        : activeTab === 'planner'
          ? 'M-PLANNER'
          : activeTab === 'mirror'
            ? 'M-MIRROR'
            : 'M-SET';

    const flowId =
      activeTab === 'home'
        ? 'F-003'
        : activeTab === 'planner'
          ? 'F-001'
          : activeTab === 'mirror'
            ? 'F-MIRROR'
            : 'F-SET';

    analyticsService.track('screen_viewed', {
      screen_id: screenId,
      flow_id: flowId,
      source: 'mobile',
      has_permissions: hasPermissions,
    });
  }, [activeTab, hasPermissions]);

  const updatePlanner = useCallback(async (next: WeeklyPlanner) => {
    setPlanner(next);
    try {
      await savePlanner(next);
      setPlannerError(null);
      analyticsService.track('action_succeeded', {
        screen_id: 'M-PLANNER',
        flow_id: 'F-001',
        action: 'planner_save',
        source: 'mobile',
      });
    } catch (error) {
      console.warn('[MobilePriorityShell] planner save failed:', error);
      setPlannerError('Could not save latest planner change. Please try again.');
      analyticsService.track('action_failed', {
        screen_id: 'M-PLANNER',
        flow_id: 'F-001',
        action: 'planner_save',
        source: 'mobile',
        error_message: String(error),
      });
    }
  }, []);

  const addQuickWorkout = useCallback(
    async (title: string) => {
      analyticsService.track('primary_action_tapped', {
        screen_id: 'M-PLANNER',
        flow_id: 'F-001',
        action: 'planner_quick_add_workout',
        source: 'manual',
        day: selectedDay,
        item: title,
      });
      const next = addWorkout(planner, selectedDay, title);
      await updatePlanner(next);
    },
    [planner, selectedDay, updatePlanner],
  );

  const addCustomWorkout = useCallback(async () => {
    if (!customWorkout.trim()) return;
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-PLANNER',
      flow_id: 'F-001',
      action: 'planner_custom_add_workout',
      source: 'manual',
      day: selectedDay,
    });
    const next = addWorkout(planner, selectedDay, customWorkout);
    await updatePlanner(next);
    setCustomWorkout('');
  }, [customWorkout, planner, selectedDay, updatePlanner]);

  const addQuickMeal = useCallback(
    async (type: MealType) => {
      analyticsService.track('primary_action_tapped', {
        screen_id: 'M-PLANNER',
        flow_id: 'F-002',
        action: 'planner_quick_add_meal',
        source: 'manual',
        day: selectedDay,
        meal_type: type,
      });
      const next = addMeal(planner, selectedDay, type);
      await updatePlanner(next);
    },
    [planner, selectedDay, updatePlanner],
  );

  const addCustomMeal = useCallback(async () => {
    if (!customMeal.trim()) return;
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-PLANNER',
      flow_id: 'F-002',
      action: 'planner_custom_add_meal',
      source: 'manual',
      day: selectedDay,
    });
    const next = addMeal(planner, selectedDay, 'snack', customMeal);
    await updatePlanner(next);
    setCustomMeal('');
  }, [customMeal, planner, selectedDay, updatePlanner]);

  const handleTabChange = useCallback((tab: AppTab) => {
    if (tab === 'mirror' && !showMirrorTab) {
      return;
    }
    analyticsService.track('primary_action_tapped', {
      screen_id: 'shell',
      flow_id: 'F-NAV',
      action: 'tab_change',
      source: 'manual',
      target_tab: tab,
    });
    setActiveTab(tab);
  }, [showMirrorTab]);

  const handleManualSyncTap = useCallback(async () => {
    const startedAt = Date.now();
    analyticsService.track('primary_action_tapped', {
      screen_id: activeTab === 'settings' ? 'M-SET' : 'M-HOME',
      flow_id: 'F-003',
      action: 'manual_sync',
      source: 'manual',
    });
    try {
      await onManualSync();
      analyticsService.track('action_succeeded', {
        screen_id: activeTab === 'settings' ? 'M-SET' : 'M-HOME',
        flow_id: 'F-003',
        action: 'manual_sync',
        source: 'manual',
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      analyticsService.track('action_failed', {
        screen_id: activeTab === 'settings' ? 'M-SET' : 'M-HOME',
        flow_id: 'F-003',
        action: 'manual_sync',
        source: 'manual',
        latency_ms: Date.now() - startedAt,
        error_message: String(error),
      });
    }
  }, [activeTab, onManualSync]);

  const handleRequestPermissionsTap = useCallback(async () => {
    analyticsService.track('primary_action_tapped', {
      screen_id: activeTab === 'settings' ? 'M-SET' : 'M-HOME',
      flow_id: 'F-SET',
      action: 'request_permissions',
      source: 'manual',
    });
    try {
      await onRequestPermissions();
      analyticsService.track('action_succeeded', {
        screen_id: activeTab === 'settings' ? 'M-SET' : 'M-HOME',
        flow_id: 'F-SET',
        action: 'request_permissions',
        source: 'manual',
      });
    } catch (error) {
      analyticsService.track('action_failed', {
        screen_id: activeTab === 'settings' ? 'M-SET' : 'M-HOME',
        flow_id: 'F-SET',
        action: 'request_permissions',
        source: 'manual',
        error_message: String(error),
      });
    }
  }, [activeTab, onRequestPermissions]);

  const handleOpenScannerTap = useCallback((source: string) => {
    analyticsService.track('primary_action_tapped', {
      screen_id: source,
      flow_id: 'F-004',
      action: 'open_scanner',
      source: 'manual',
    });
    onOpenScanner();
  }, [onOpenScanner]);

  const handleResetPlanner = useCallback(async () => {
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-PLANNER',
      flow_id: 'F-PLAN-RESET',
      action: 'planner_reset_week',
      source: 'manual',
    });
    await updatePlanner(createEmptyPlanner());
  }, [updatePlanner]);

  const handleDaySelect = useCallback((day: PlannerDayKey) => {
    setSelectedDay(day);
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-PLANNER',
      flow_id: 'F-PLAN-DAY-SWITCH',
      action: 'planner_day_selected',
      source: 'manual',
      day,
    });
  }, []);

  const handleToggleWorkout = useCallback(async (workoutId: string) => {
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-PLANNER',
      flow_id: 'F-001',
      action: 'planner_toggle_workout',
      source: 'manual',
      day: selectedDay,
    });
    await updatePlanner(toggleWorkout(planner, selectedDay, workoutId));
  }, [planner, selectedDay, updatePlanner]);

  const handleRemoveWorkout = useCallback(async (workoutId: string) => {
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-PLANNER',
      flow_id: 'F-001',
      action: 'planner_remove_workout',
      source: 'manual',
      day: selectedDay,
    });
    await updatePlanner(removeWorkout(planner, selectedDay, workoutId));
  }, [planner, selectedDay, updatePlanner]);

  const handleRemoveMeal = useCallback(async (mealId: string) => {
    analyticsService.track('primary_action_tapped', {
      screen_id: 'M-PLANNER',
      flow_id: 'F-002',
      action: 'planner_remove_meal',
      source: 'manual',
      day: selectedDay,
    });
    await updatePlanner(removeMeal(planner, selectedDay, mealId));
  }, [planner, selectedDay, updatePlanner]);

  const renderHome = (): React.ReactElement => {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>HealthSync Mobile</Text>
          <Text style={styles.heroSubtitle}>Mobile-first dashboard powered by HealthKit and Health Connect</Text>
          <Text style={styles.heroMeta}>{formatSyncLabel(lastSyncAt)}</Text>
        </View>

        {!hasPermissions && (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>Health access not enabled</Text>
            <Text style={styles.warningBody}>Enable permissions so app data stays real-time and accurate.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => void handleRequestPermissionsTap()}>
              <Text style={styles.primaryButtonText}>Enable Health Access</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.grid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Steps</Text>
            <Text style={styles.metricValue}>{todaySummary.steps.toLocaleString()}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Active Cal</Text>
            <Text style={styles.metricValue}>{Math.round(todaySummary.activeCalories)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Workouts</Text>
            <Text style={styles.metricValue}>{todaySummary.workouts}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Sleep (h)</Text>
            <Text style={styles.metricValue}>{todaySummary.sleepHours.toFixed(1)}</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryButton} onPress={() => void handleManualSyncTap()} disabled={isSyncing}>
            <Text style={styles.primaryButtonText}>{isSyncing ? 'Syncing...' : 'Sync Now'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => handleOpenScannerTap('M-HOME')}>
            <Text style={styles.secondaryButtonText}>Open Scanner</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inlineActionsRow}>
          <TouchableOpacity style={styles.inlineActionButton} onPress={() => handleTabChange('planner')}>
            <Text style={styles.inlineActionText}>Go to Planner</Text>
          </TouchableOpacity>
          {showMirrorTab && (
            <TouchableOpacity style={styles.inlineActionButton} onPress={() => handleTabChange('mirror')}>
              <Text style={styles.inlineActionText}>Open Web Mirror</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderPlanner = (): React.ReactElement => {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Weekly Planner</Text>
          <Text style={styles.sectionSubtitle}>One-tap add for workouts and meals</Text>
        </View>

        {plannerError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerTitle}>Planner sync warning</Text>
            <Text style={styles.errorBannerText}>{plannerError}</Text>
            <View style={styles.inlineActionsRow}>
              <TouchableOpacity style={styles.inlineActionButton} onPress={() => void handleResetPlanner()}>
                <Text style={styles.inlineActionText}>Reset Week</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.inlineActionButton} onPress={() => setPlannerError(null)}>
                <Text style={styles.inlineActionText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayTabsRow}>
          {DAYS.map((day) => {
            const isActive = selectedDay === day.key;
            const dayPlan = planner.days[day.key];
            const itemCount = dayPlan.workouts.length + dayPlan.meals.length;
            return (
              <TouchableOpacity
                key={day.key}
                style={[styles.dayTab, isActive ? styles.dayTabActive : null]}
                onPress={() => handleDaySelect(day.key)}>
                <Text style={[styles.dayTabText, isActive ? styles.dayTabTextActive : null]}>{day.short}</Text>
                <Text style={[styles.dayTabMeta, isActive ? styles.dayTabMetaActive : null]}>{itemCount}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.planCard}>
          <View style={styles.planCardHeader}>
            <Text style={styles.planDayLabel}>{selectedDayMeta.full}</Text>
            <Text style={styles.planMetaText}>
              {selectedPlan.workouts.length} workouts · {selectedPlan.meals.length} meals
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Workouts</Text>
            <View style={styles.quickRow}>
              {QUICK_WORKOUTS.map((item) => (
                <TouchableOpacity key={item} style={styles.quickChip} onPress={() => void addQuickWorkout(item)}>
                  <Text style={styles.quickChipText}>+ {item}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Custom workout"
                placeholderTextColor={palette.textMuted}
                value={customWorkout}
                onChangeText={setCustomWorkout}
                onSubmitEditing={() => void addCustomWorkout()}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.inlineActionButton} onPress={() => void addCustomWorkout()}>
                <Text style={styles.inlineActionText}>Add</Text>
              </TouchableOpacity>
            </View>

            {selectedPlan.workouts.length === 0 ? (
              <Text style={styles.emptyText}>No workouts yet. Tap a quick chip to add in one tap.</Text>
            ) : (
              <View style={styles.itemList}>
                {selectedPlan.workouts.map((workout) => (
                  <View key={workout.id} style={styles.itemRow}>
                    <TouchableOpacity
                      style={styles.toggleButton}
                      onPress={() => void handleToggleWorkout(workout.id)}>
                      <Text style={styles.toggleText}>{workout.completed ? 'Done' : 'Open'}</Text>
                    </TouchableOpacity>
                    <Text style={[styles.itemTitle, workout.completed ? styles.itemTitleDone : null]}>{workout.title}</Text>
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => void handleRemoveWorkout(workout.id)}>
                      <Text style={styles.removeButtonText}>Del</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Meals</Text>
            <View style={styles.quickRow}>
              {QUICK_MEALS.map((type) => (
                <TouchableOpacity key={type} style={styles.quickChip} onPress={() => void addQuickMeal(type)}>
                  <Text style={styles.quickChipText}>+ {type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Custom meal (defaults to Snack)"
                placeholderTextColor={palette.textMuted}
                value={customMeal}
                onChangeText={setCustomMeal}
                onSubmitEditing={() => void addCustomMeal()}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.inlineActionButton} onPress={() => void addCustomMeal()}>
                <Text style={styles.inlineActionText}>Add</Text>
              </TouchableOpacity>
            </View>

            {selectedPlan.meals.length === 0 ? (
              <Text style={styles.emptyText}>No meals yet. Use quick add to reduce clicks.</Text>
            ) : (
              <View style={styles.itemList}>
                {selectedPlan.meals.map((meal) => (
                  <View key={meal.id} style={styles.itemRow}>
                    <View style={styles.typePill}>
                      <Text style={styles.typePillText}>{meal.type.slice(0, 3).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.itemTitle}>{meal.title}</Text>
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => void handleRemoveMeal(meal.id)}>
                      <Text style={styles.removeButtonText}>Del</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Notes</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              multiline
              placeholder="Plan notes, reminders, prep steps"
              placeholderTextColor={palette.textMuted}
              value={selectedPlan.notes}
              onChangeText={(value) => void updatePlanner(updateDayNotes(planner, selectedDay, value))}
            />
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Week Overview</Text>
          {DAYS.filter((day) => day.key !== selectedDay).map((day) => {
            const dayPlan = planner.days[day.key];
            return (
              <TouchableOpacity key={day.key} style={styles.overviewRow} onPress={() => handleDaySelect(day.key)}>
                <Text style={styles.overviewDay}>{day.full}</Text>
                <Text style={styles.overviewMeta}>
                  {dayPlan.workouts.length} workouts · {dayPlan.meals.length} meals
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  };

  const renderMirror = (): React.ReactElement => {
    return (
      <View style={styles.mirrorContainer}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Web Mirror</Text>
          <Text style={styles.sectionSubtitle}>Secondary view only. Mobile UI remains source of truth.</Text>
        </View>
        <View style={styles.mirrorFrame}>
          <WebAppContainer
            onMessage={() => {}}
            onScanRequested={() => handleOpenScannerTap('M-MIRROR')}
          />
        </View>
      </View>
    );
  };

  const renderSettings = (): React.ReactElement => {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Health Access</Text>
          <Text style={styles.blockBody}>{hasPermissions ? 'Granted' : 'Not granted'}</Text>
          {!hasPermissions && (
            <TouchableOpacity style={styles.primaryButton} onPress={() => void handleRequestPermissionsTap()}>
              <Text style={styles.primaryButtonText}>Grant Permissions</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Sync</Text>
          <Text style={styles.blockBody}>{formatSyncLabel(lastSyncAt)}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void handleManualSyncTap()} disabled={isSyncing}>
            <Text style={styles.secondaryButtonText}>{isSyncing ? 'Syncing...' : 'Run Manual Sync'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Priority Mode</Text>
          <Text style={styles.blockBody}>
            Mobile-first mode enabled. Web is an optional mirror and no longer the primary interface.
          </Text>
        </View>
      </ScrollView>
    );
  };

  const renderCurrentTab = (): React.ReactElement => {
    if (plannerLoading) {
      return (
        <View style={styles.loaderContainer}>
          <Text style={styles.loaderText}>Loading mobile experience...</Text>
        </View>
      );
    }

    if (activeTab === 'home') return renderHome();
    if (activeTab === 'planner') return renderPlanner();
    if (activeTab === 'mirror') return renderMirror();
    return renderSettings();
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>HealthSync</Text>
        <TouchableOpacity style={styles.headerSyncBtn} onPress={() => void handleManualSyncTap()} disabled={isSyncing}>
          <Text style={styles.headerSyncBtnText}>{isSyncing ? 'Syncing' : 'Sync'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>{renderCurrentTab()}</View>

      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabItem} onPress={() => handleTabChange('home')}>
          <Text style={[styles.tabText, activeTab === 'home' ? styles.tabTextActive : null]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => handleTabChange('planner')}>
          <Text style={[styles.tabText, activeTab === 'planner' ? styles.tabTextActive : null]}>Planner</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => handleOpenScannerTap('M-SCAN')}>
          <Text style={styles.tabText}>Scan</Text>
        </TouchableOpacity>
        {showMirrorTab && (
          <TouchableOpacity style={styles.tabItem} onPress={() => handleTabChange('mirror')}>
            <Text style={[styles.tabText, activeTab === 'mirror' ? styles.tabTextActive : null]}>Mirror</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.tabItem} onPress={() => handleTabChange('settings')}>
          <Text style={[styles.tabText, activeTab === 'settings' ? styles.tabTextActive : null]}>Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function createStyles(colors: {
  bg: string;
  surface: string;
  surfaceSoft: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
}) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
    },
    headerSyncBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surfaceSoft,
    },
    headerSyncBtnText: {
      color: colors.text,
      fontWeight: '600',
      fontSize: 12,
    },
    content: {
      flex: 1,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
      gap: 12,
      paddingBottom: 26,
    },
    sectionHeader: {
      marginBottom: 8,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
    },
    sectionSubtitle: {
      color: colors.textMuted,
      marginTop: 4,
      fontSize: 13,
    },
    heroCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 6,
    },
    heroTitle: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
    },
    heroSubtitle: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    heroMeta: {
      color: colors.primary,
      marginTop: 6,
      fontSize: 12,
      fontWeight: '600',
    },
    warningCard: {
      backgroundColor: colors.surface,
      borderColor: colors.warning,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    warningTitle: {
      color: colors.warning,
      fontSize: 16,
      fontWeight: '700',
    },
    warningBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    errorBanner: {
      backgroundColor: colors.surface,
      borderColor: colors.danger,
      borderWidth: 1,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    errorBannerTitle: {
      color: colors.danger,
      fontSize: 16,
      fontWeight: '700',
    },
    errorBannerText: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    metricCard: {
      width: '48%',
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    metricLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 8,
    },
    metricValue: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '700',
    },
    actionRow: {
      flexDirection: 'row',
      gap: 10,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
    secondaryButton: {
      flex: 1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    secondaryButtonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    inlineActionsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    inlineActionButton: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSoft,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inlineActionText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    dayTabsRow: {
      gap: 8,
      paddingBottom: 8,
    },
    dayTab: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      minWidth: 64,
      alignItems: 'center',
      gap: 2,
    },
    dayTabActive: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceSoft,
    },
    dayTabText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '700',
    },
    dayTabTextActive: {
      color: colors.primary,
    },
    dayTabMeta: {
      color: colors.textMuted,
      fontSize: 11,
    },
    dayTabMetaActive: {
      color: colors.primary,
    },
    planCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      gap: 14,
    },
    planCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    planDayLabel: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
    },
    planMetaText: {
      color: colors.textMuted,
      fontSize: 12,
    },
    block: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 10,
    },
    blockTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    blockBody: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    quickRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    quickChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingVertical: 7,
      paddingHorizontal: 10,
      backgroundColor: colors.surfaceSoft,
    },
    quickChipText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    input: {
      flex: 1,
      minHeight: 42,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSoft,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
    },
    notesInput: {
      minHeight: 92,
      textAlignVertical: 'top',
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 12,
    },
    itemList: {
      gap: 8,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 8,
      backgroundColor: colors.surfaceSoft,
    },
    toggleButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: colors.surface,
      minWidth: 56,
      alignItems: 'center',
    },
    toggleText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    itemTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    itemTitleDone: {
      color: colors.textMuted,
      textDecorationLine: 'line-through',
    },
    removeButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.danger,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    removeButtonText: {
      color: colors.danger,
      fontSize: 11,
      fontWeight: '700',
    },
    typePill: {
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    typePillText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    overviewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSoft,
      padding: 10,
    },
    overviewDay: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    overviewMeta: {
      color: colors.textMuted,
      fontSize: 12,
    },
    mirrorContainer: {
      flex: 1,
      padding: 12,
      gap: 10,
    },
    mirrorFrame: {
      flex: 1,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    loaderContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loaderText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    tabBar: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      paddingVertical: 8,
      paddingHorizontal: 6,
    },
    tabItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 40,
    },
    tabText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    tabTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
  });
}

export default MobilePriorityShell;
