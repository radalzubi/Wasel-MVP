// Metro config for the rider app inside the Wasel npm workspace.
//
//   1. watchFolders tells Metro to watch packages/shared so hot reload
//      picks up edits to shared code.
//   2. nodeModulesPaths tells Metro to resolve from rider/node_modules
//      first, then the workspace root (where npm hoists @wasel/shared and
//      other shared deps). Metro's default hierarchical lookup is left ON
//      so nested deps like expo-router/node_modules/@expo/metro-runtime
//      still resolve correctly.
//
// Docs: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
