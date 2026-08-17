// index.ts — module scope, before AppRegistry.registerComponent.
// There is nothing here worth reporting.
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';

import App from './src/App';
import { name as appName } from './app.json';
import { handleDataMessage } from './src/push/handleDataMessage';

// Registered at module scope so it exists when the app is killed — the case
// this handler is for.
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  try {
    await handleDataMessage(remoteMessage.data);
  } catch (error) {
    reportError(error, { source: 'backgroundMessageHandler' });
  }
});

// Channels must exist before any notification can be posted to them; posting
// to an undeclared channel is dropped silently on Android 8+.
notifee
  .createChannel({ id: 'default', name: 'General', importance: AndroidImportance.HIGH })
  .catch((error) => reportError(error, { source: 'createChannel' }));

AppRegistry.registerComponent(appName, () => App);
