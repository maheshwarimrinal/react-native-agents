# Permissions and Opt-In

## Ask at the wrong moment and you never get another chance

On iOS the system prompt appears **once**. If the user declines, your code can request again and
it will resolve without showing anything. Recovery means the user going to Settings, which
essentially nobody does.

So the timing of that single prompt is one of the highest-leverage decisions in the feature.

**Do not ask on first launch.** It is the moment the user has least context and least reason to
agree.

**Ask when the value is obvious** — just after they place an order and would want delivery updates,
after they follow someone, when they explicitly enable an alert. The request should feel like a
consequence of something they just chose.

**Pre-permission prompts help.** Ask in your own UI first, in your own words. If they decline your
prompt, the system prompt is never spent, and you can ask again later. If they accept, the system
prompt is a formality.

```tsx
// Your own screen first — this one is repeatable. The system one is not.
const wants = await showValueExplainer();
if (wants) {
  await messaging().requestPermission();
}
```

## Android 13+ is a runtime permission

Notifications were free on Android until API 33. Now `POST_NOTIFICATIONS` must be declared **and**
requested at runtime.

Unlike iOS, Android permits re-prompting until the user selects "don't allow" twice, at which point
it becomes permanent for practical purposes. So the platforms have genuinely different budgets: one
prompt on iOS, roughly two on Android.

An app that only declares the permission works on Android 12 and displays nothing on 13+, which
looks like a device-specific bug.

## Check status, do not assume

```ts
const status = await messaging().hasPermission();
```

Three states matter and they are not interchangeable: **not yet asked**, **granted**, **denied**.
Code that treats "not granted" as "ask again" will call a request that silently does nothing on iOS
and give the user no path forward.

If permission is denied and the feature needs it, the honest UI is to say so and offer a link to
Settings:

```ts
Linking.openSettings();
```

## Provisional authorisation (iOS)

iOS supports delivering notifications quietly without a prompt — they arrive in the notification
centre without alerting, and the user can promote them to prominent delivery.

This is worth knowing because it converts an all-or-nothing decision into an earned one. The
tradeoff is real: quiet notifications are seen far less. Suited to apps where notifications prove
their value over time, less so where the first notification is the urgent one.

## Granular opt-in beats one switch

Users who cannot turn off the one category that annoys them turn off everything — and on iOS, at
the OS level, which you cannot recover from.

Per-category preferences, mapped to Android notification channels, let someone keep the
notifications they want. This is a retention decision more than a technical one: a user who
disables notifications at the OS level is gone for good, while a user who mutes one category is
still reachable.

## Respect the answer

Do not re-prompt after a denial, do not gate core functionality behind notifications, and do not
use a silent push to work around a lack of permission. Beyond the user-hostility, these are the
behaviours that draw store review attention — hand anything questionable to `rn-store-submission`.
