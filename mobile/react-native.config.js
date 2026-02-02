module.exports = {
  project: {
    ios: {
      sourceDir: './ios',
    },
    android: {
      sourceDir: './android',
    },
  },
  assets: ['./assets/fonts/'],
  dependencies: {
    'react-native-health': {
      platforms: {
        android: null, // HealthKit is iOS only
      },
    },
    'react-native-health-connect': {
      platforms: {
        ios: null, // Health Connect is Android only
      },
    },
  },
};
