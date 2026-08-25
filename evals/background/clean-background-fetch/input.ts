// index.ts — module scope. The task is an optimisation, never the guarantee.
// There is nothing here worth reporting.
import { AppRegistry, AppState } from 'react-native';
import BackgroundFetch from 'react-native-background-fetch';

import App from './src/App';
import { name as appName } from './app.json';
import { syncIfStale } from './src/sync';
import { report, track } from './src/telemetry';

// Registered at module scope so it exists when the OS decides to run it —
// inside a component it would only register if that screen were visited.
BackgroundFetch.configure(
  {
    // A floor on a discretionary schedule, not a promise. The app is correct
    // if this never fires: syncIfStale() also runs on every foreground.
    minimumFetchInterval: 15,
    stopOnTerminate: false,
    startOnBoot: true,
    requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
  },
  async (taskId) => {
    const started = Date.now();
    try {
      // One unit of work. A task killed part-way through a large sync
      // achieves nothing; a small one usually completes.
      await syncIfStale({ limit: 1 });
      track('background_task', { outcome: 'ok', ms: Date.now() - started });
    } catch (error) {
      track('background_task', { outcome: 'error' });
      report(error, { source: 'backgroundFetch' });
    } finally {
      // Every path. A missed completion makes the system schedule us less.
      BackgroundFetch.finish(taskId);
    }
  },
  (error) => report(error, { source: 'backgroundFetch.configure' }),
);

// The actual guarantee: whatever the OS did or did not do, we reconcile here.
AppState.addEventListener('change', (state) => {
  if (state === 'active') void syncIfStale();
});

AppRegistry.registerComponent(appName, () => App);
