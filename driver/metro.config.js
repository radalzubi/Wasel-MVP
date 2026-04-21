// Metro config for the driver app inside the Wasel npm workspace.
//
//   1. watchFolders — Metro watches packages/shared for hot reload
//   2. nodeModulesPaths — Metro prefers driver/node_modules, then workspace root
//   3. resolveRequest — intercepts react/react-native resolution to guarantee
//      a single instance even when @wasel/shared traversal would find the
//      hoisted workspace-root copy first
//
// Docs: https://docs.expo.dev/guides/monorepos/
// Metro config for the driver app inside the Wasel npm workspace.
// See rider/metro.config.js for the full singleton-resolution rationale —
// both apps use the identical strategy (prefer workspace-root, explicit
// fs.existsSync probe, no throw/catch control flow).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Only watch packages/ (shared libs) — NOT the whole workspace root.
// Watching workspaceRoot includes both node_modules trees (300k+ files)
// and makes Metro's initial file scan take several minutes.
config.watchFolders = [...(config.watchFolders || []), path.resolve(workspaceRoot, 'packages')];
config.resolver.nodeModulesPaths = [
  path.resolve(workspaceRoot, 'node_modules'),
  path.resolve(projectRoot, 'node_modules'),
];

const SINGLETON_MODULES = [
  'react',
  'react-native',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETON_MODULES.includes(moduleName)) {
    const pkgRoot = moduleName.split('/')[0];
    const candidatePkgJson = path.join(workspaceRoot, 'node_modules', pkgRoot, 'package.json');
    if (fs.existsSync(candidatePkgJson)) {
      return {
        filePath: require.resolve(moduleName, {
          paths: [path.join(workspaceRoot, 'node_modules')],
        }),
        type: 'sourceFile',
      };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
