// Metro config for the driver app inside the Wasel npm workspace.
//
//   1. watchFolders — Metro watches packages/shared for hot reload
//   2. nodeModulesPaths — Metro prefers driver/node_modules, then workspace root
//   3. resolveRequest — intercepts react/react-native resolution to guarantee
//      a single instance even when @wasel/shared traversal would find the
//      hoisted workspace-root copy first
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

// Guarantee a single React/RN instance across the monorepo.
// Without this, Metro's traversal finds the npm-hoisted copy at the workspace
// root (react@19.2.5) before @wasel/shared can resolve to the app's own copy
// (react@19.1.0) — producing the "useState of null / invalid hook call" crash.
//
// resolveRequest intercepts EVERY module resolution call before traversal,
// unlike extraNodeModules which is only a fallback and does not override
// traversal-based resolution from files inside packages/shared/.
//
// Also covers react/jsx-runtime and react/jsx-dev-runtime which are emitted
// by the React 17+ automatic JSX transform and would otherwise resolve to the
// wrong copy as well.
const SINGLETON_MODULES = [
  'react',
  'react-native',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETON_MODULES.includes(moduleName)) {
    try {
      return {
        filePath: require.resolve(moduleName, {
          paths: [path.resolve(projectRoot, 'node_modules')],
        }),
        type: 'sourceFile',
      };
    } catch {
      // Fall through to normal resolution if local copy doesn't exist
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
