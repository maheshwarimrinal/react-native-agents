// index.js
import { AppRegistry } from 'react-native';
import * as Sentry from '@sentry/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from './src/App';
import { name as appName } from './app.json';

async function bootstrap() {
  // Read saved preferences before anything else so the theme is right on first paint.
  const prefs = JSON.parse((await AsyncStorage.getItem('prefs')) ?? '{}');

  if (__DEV__) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 1.0,
      sendDefaultPii: true,
      integrations: [Sentry.reactNativeTracingIntegration()],
    });

    Sentry.setUser({
      id: prefs.userId,
      email: prefs.email,
      username: prefs.displayName,
    });
  }

  AppRegistry.registerComponent(appName, () => App);
}

bootstrap();
