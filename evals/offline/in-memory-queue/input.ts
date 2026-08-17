// "Some users say their expense claims disappear."
import NetInfo from '@react-native-community/netinfo';
import { api } from './api';

let pending: Claim[] = [];

export async function submitClaim(claim: Claim) {
  const { isConnected } = await NetInfo.fetch();

  if (!isConnected) {
    pending.push(claim);
    return { queued: true };
  }

  await api.post('/claims', claim);
  return { queued: false };
}

NetInfo.addEventListener(async (state) => {
  if (!state.isConnected) return;
  for (const claim of pending) {
    await api.post('/claims', claim);
  }
  pending = [];
});
