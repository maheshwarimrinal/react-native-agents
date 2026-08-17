// "Push works when the app is open but not when it's closed."
import { useEffect } from 'react';
import messaging from '@react-native-firebase/messaging';
import { NavigationContainer } from '@react-navigation/native';

import { navigate } from './navigation';
import { api } from './api';

export default function App() {
  useEffect(() => {
    async function setup() {
      await messaging().requestPermission();
      const token = await messaging().getToken();
      api.post('/devices', { token });

      messaging().setBackgroundMessageHandler(async (msg) => {
        await handleData(msg.data);
      });

      messaging().onNotificationOpenedApp((msg) => {
        navigate(msg.data.deepLink);
      });
    }
    setup();
  }, []);

  return <NavigationContainer>{/* ... */}</NavigationContainer>;
}
