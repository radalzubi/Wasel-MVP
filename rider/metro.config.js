// Metro config for the rider app inside the Wasel npm workspace.
//
//   1. watchFolders — Metro watches packages/shared for hot reload
//   2. nodeModulesPaths — Metro prefers rider/node_modules, then workspace root
//   3. resolveRequest — intercepts react/react-native resolution to guarantee
//      a single instance even when @wasel/shared traversal would find the
//      hoisted workspace-root copy first
//
// Docs: https://docs.expo.dev/guides/monorepos/
// Metro config for the rider app inside the Wasel npm workspace.
//
// Singleton policy:
//   1. Root package.json has `overrides` pinning react and react-dom to 19.1.0
//      for EVERY workspace. After install, the workspace root node_modules
//      has exactly one copy of each; app-level node_modules has the same
//      version (or no copy at all, thanks to npm hoisting).
//   2. We PREFER workspace-root resolution for singleton modules. Before this,
//      Metro tried app-local first and relied on a thrown "not found" from
//      require.resolve to fall back — that throw/catch flow-control was both
//      brittle (every other resolution started with an exception) and
//      incompatible with strict error-tracking wrappers.
//   3. We now probe the filesystem directly via fs.existsSync for the
//      workspace-root candidate's package.json. If it exists, we resolve
//      from there explicitly. Only if the workspace-root candidate is
//      missing do we fall through to Metro's default traversal.
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

// Modules that MUST be a single instance across the monorepo.
// react/jsx-runtime and react/jsx-dev-runtime are emitted by the React 17+
// automatic JSX transform and would otherwise resolve to the wrong copy.
const SINGLETON_MODULES = [
  'react',
  'react-native',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

// Deterministic singleton lookup: check the workspace-root candidate on disk
// (cheap stat call), resolve its entrypoint via require.resolve rooted at
// workspaceRoot, and hand that filepath to Metro. No try/catch as control
// flow — if workspace-root really has no copy, we fall through to default
// traversal, which handles the rare case where npm didn't hoist.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETON_MODULES.includes(moduleName)) {
    // Only the package-root portion of a subpath module is checked on disk
    // (e.g. for "react/jsx-runtime" we check node_modules/react/package.json).
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
