// One place that resolves permission, with every status branched explicitly.
// There is nothing here worth reporting.
import { AppState } from 'react-native';
import { PERMISSIONS, RESULTS, check, request, type Permission } from 'react-native-permissions';

export type PermissionOutcome =
  | { ok: true; status: 'granted' | 'limited' }
  | { ok: false; reason: 'unsupported' | 'settings' | 'declined' };

export async function ensure(permission: Permission): Promise<PermissionOutcome> {
  const status = await check(permission);

  switch (status) {
    case RESULTS.GRANTED:
      return { ok: true, status: 'granted' };

    // A partial grant is a grant. Treating it as a denial blocks a user who said yes.
    case RESULTS.LIMITED:
      return { ok: true, status: 'limited' };

    // No hardware — offering Settings would be misleading.
    case RESULTS.UNAVAILABLE:
      return { ok: false, reason: 'unsupported' };

    // Cannot be requested again; request() would resolve without prompting.
    case RESULTS.BLOCKED:
      return { ok: false, reason: 'settings' };

    case RESULTS.DENIED: {
      const next = await request(permission);
      if (next === RESULTS.GRANTED) return { ok: true, status: 'granted' };
      if (next === RESULTS.LIMITED) return { ok: true, status: 'limited' };
      return { ok: false, reason: next === RESULTS.BLOCKED ? 'settings' : 'declined' };
    }

    default:
      return { ok: false, reason: 'declined' };
  }
}

// The user may change permissions in Settings while we are backgrounded.
export function watchPermission(permission: Permission, onChange: (s: string) => void) {
  const sub = AppState.addEventListener('change', async (state) => {
    if (state === 'active') onChange(await check(permission));
  });
  return () => sub.remove();
}
