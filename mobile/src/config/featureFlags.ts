export const FEATURE_FLAGS = {
  MOBILE_PRIORITY_SHELL: true,
  MOBILE_HOME_V1: true,
  MOBILE_PLANNER_V1: true,
  MOBILE_SETTINGS_V1: true,
  NATIVE_SCANNER_PRIMARY: true,
  WEB_MIRROR_TAB: true,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  return FEATURE_FLAGS[flag];
}

