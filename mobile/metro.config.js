/**
 * Metro configuration for React Native
 * https://github.com/facebook/react-native
 *
 * @format
 */

const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Ensure native modules are properly resolved for iOS
    sourceExts: ['js', 'jsx', 'json', 'ts', 'tsx', 'cjs', 'mjs'],
    assetExts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ttf', 'otf'],
  },
  server: {
    // iOS simulator port configuration
    port: 8081,
  },
  transformer: {
    // Enable hermes for iOS
    hermesParser: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
