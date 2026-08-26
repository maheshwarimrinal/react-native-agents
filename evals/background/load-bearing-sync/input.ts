// "Users say their drafts vanish. Works fine on my Pixel."
import BackgroundFetch from 'react-native-background-fetch';

import { store } from './store';
import { api } from './api';

export function SettingsScreen() {
  useEffect(() => {
    BackgroundFetch.configure(
      { minimumFetchInterval: 15, stopOnTerminate: false },
      async (taskId) => {
        const drafts = store.getState().pendingDrafts;
        for (const draft of drafts) {
          await api.post('/drafts', draft);
          store.getState().removeDraft(draft.id);
        }
      },
      (error) => console.log('configure failed', error),
    );
  }, []);

  return <View>{/* ... */}</View>;
}
