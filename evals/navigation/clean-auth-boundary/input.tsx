// Auth boundary expressed in the tree, intent preserved across login.
// There is nothing here worth reporting.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';

import { navigationRef, navigate } from './navigationRef';
import { resolveTarget, type Target } from './resolveTarget';
import { useAuth } from './auth';

const STATE_VERSION = 3;

export function Root() {
  const { status } = useAuth();
  const pending = useRef<Target | null>(null);
  const [navReady, setNavReady] = useState(false);

  const handle = useCallback(
    (url: string) => {
      const target = resolveTarget(url);
      if (!target) return;
      if (target.requiresAuth && status !== 'authenticated') {
        pending.current = target;
        return;
      }
      if (navReady) navigate(target);
      else pending.current = target;
    },
    [status, navReady],
  );

  useEffect(() => {
    Linking.getInitialURL().then((url) => { if (url) handle(url); });
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [handle]);

  useEffect(() => {
    if (navReady && status !== 'loading' && pending.current) {
      const target = pending.current;
      if (!target.requiresAuth || status === 'authenticated') {
        pending.current = null;
        navigate(target);
      }
    }
  }, [navReady, status]);

  if (status === 'loading') return <SplashScreen />;

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => setNavReady(true)}
      onStateChange={(s) => persistState({ version: STATE_VERSION, state: s })}
    >
      {status === 'authenticated' ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
