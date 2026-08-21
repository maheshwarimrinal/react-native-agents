// "Deep links work fine in testing but users say the link just opens the app."
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';

import { navigationRef, navigate } from './navigationRef';
import { useAuth } from './auth';

export function Root() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      const path = url.split('acme.com')[1];
      if (path?.startsWith('/order/')) {
        navigate('Order', { id: path.replace('/order/', '') });
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      {isAuthenticated ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
