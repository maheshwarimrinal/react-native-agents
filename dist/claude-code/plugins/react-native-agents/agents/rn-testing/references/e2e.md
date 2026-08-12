# End-to-End Testing

E2E is the only layer that proves the app actually launches, talks to its backend, and completes
a journey on a real device. It's also slow, expensive, and prone to flakiness — so keep the suite
small and the flows critical.

## Maestro vs Detox

| | Maestro | Detox |
|---|---|---|
| Tests written in | YAML | JavaScript |
| Setup cost | Low — works on a release build with no code changes | Higher — requires instrumenting the app build |
| Synchronisation | Built-in retry/wait heuristics | Grey-box: waits for the app's actual idle state |
| Speed | Slower per step | Faster, more deterministic |
| Flakiness | Low for simple flows | Very low when configured right |
| Debuggability | Maestro Studio is excellent | Standard JS debugging |
| Best for | Most teams; quick smoke suites; non-engineers can read them | Large suites, complex sync, teams already invested |

**Recommendation for most projects: start with Maestro.** The setup cost is close to zero and it
runs against your real release binary, which is what you actually ship. Move to Detox if you need
tighter synchronisation control or a very large suite.

## Maestro

```yaml
# .maestro/checkout.yaml
appId: com.example.app
name: Complete checkout
---
- launchApp:
    clearState: true                # deterministic start — do this in every flow
- tapOn: "Sign in"
- tapOn:
    id: "email-input"
- inputText: "test@example.com"
- tapOn:
    id: "password-input"
- inputText: "${MAESTRO_TEST_PASSWORD}"
- tapOn: "Continue"
- assertVisible: "Your feed"

- tapOn:
    text: "Add to cart"
    index: 0
- tapOn:
    id: "cart-tab"
- assertVisible:
    text: "1 item"
- tapOn: "Checkout"
- assertVisible: "Order confirmed"
- takeScreenshot: checkout-success
```

```bash
maestro test .maestro/                    # run all flows
maestro studio                            # interactive selector explorer — use this to author
maestro test --format junit --output r.xml .maestro/
```

Useful constructs: `runFlow` for shared sub-flows (login), `repeat`, `retry`,
`assertNotVisible`, `scrollUntilVisible`, `swipe`, `evalScript`, and `env` for parameterising.

## Detox

```js
describe('Checkout', () => {
  beforeAll(async () => { await device.launchApp({ delete: true, permissions: { notifications: 'YES' } }); });
  beforeEach(async () => { await device.reloadReactNative(); });

  it('completes a purchase', async () => {
    await element(by.id('email-input')).typeText('test@example.com');
    await element(by.id('password-input')).typeText(process.env.TEST_PASSWORD);
    await element(by.text('Continue')).tap();

    await waitFor(element(by.id('feed'))).toBeVisible().withTimeout(10000);
    await element(by.id('add-to-cart-0')).tap();
    await element(by.id('cart-tab')).tap();
    await expect(element(by.text('1 item'))).toBeVisible();
  });
});
```

Detox's grey-box synchronisation waits for the JS thread, network, timers, and animations to
settle — which is why it's less flaky than black-box tools, and why an app with an infinite
animation or a polling loop will hang it. If Detox times out mysteriously, look for a
never-settling timer or animation.

## What to put in E2E

Only journeys where breakage is unacceptable:

1. Cold launch → app renders (catches the "white screen of death" that unit tests never will)
2. Sign up / sign in / sign out
3. The core value flow (checkout, post, book, send)
4. Payment, if you take money
5. Deep link → correct screen
6. Offline → reconnect

Six to twelve flows is a healthy suite for most apps. Everything else belongs one layer down.

## Beating flakiness

Flakiness is the reason E2E suites get abandoned. The causes, in order:

**1 — Waiting on time instead of state.**
```js
// ✗
await new Promise(r => setTimeout(r, 3000));
// ✓
await waitFor(element(by.id('feed'))).toBeVisible().withTimeout(10000);
```

**2 — Shared state between runs.** Always `clearState` / `delete: true`. A test that depends on
data left by a previous test will fail in isolation and in parallel.

**3 — Real backends.** A staging API that's slow, rate-limited, or has changing data makes tests
non-deterministic. Point E2E at a seeded environment or a mock server, with a small number of
smoke tests against real staging.

**4 — Animations.** Disable them in the test build:
```bash
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
```
Detox does this for you; Maestro benefits from it too.

**5 — Unstable selectors.** Text changes with copy edits and translations. Use `testID` for E2E
anchors specifically (this is the one place `testID` is clearly right), and keep them stable.
Establish a convention: `screen-element-purpose`.

**6 — Permission dialogs and system UI.** Pre-grant permissions at launch. Handle the OS
notification prompt, the keyboard, and system dialogs explicitly.

**Track flake rate.** Any test failing more than ~1% of runs gets fixed or quarantined this week.
Once the team learns to re-run CI reflexively, the suite has stopped providing signal.

## CI

```yaml
e2e-android:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@<sha>
    - uses: actions/setup-node@<sha>
      with: { node-version: 20, cache: npm }
    - run: npm ci
    - run: npx eas build --platform android --profile e2e --local --output app.apk
    - uses: reactivecircus/android-emulator-runner@<sha>
      with:
        api-level: 34
        arch: x86_64
        disable-animations: true
        script: |
          curl -Ls "https://get.maestro.mobile.dev" | bash
          $HOME/.maestro/bin/maestro test --format junit --output results.xml .maestro/
    - uses: actions/upload-artifact@<sha>
      if: always()
      with: { name: e2e-artifacts, path: |
          results.xml
          ~/.maestro/tests/**/*.png }
```

Notes:
- **Upload screenshots and video on failure.** Debugging an E2E failure without them is guesswork.
- **iOS E2E needs macOS runners** — significantly more expensive. Many teams run Android E2E on
  every PR and iOS nightly.
- **Don't run the full suite on every commit** if it takes more than ~15 minutes. Smoke on PR,
  full suite nightly and pre-release.
- **Maestro Cloud / EAS Workflows** run device tests without maintaining emulator infrastructure.

## Device matrix

Test on the extremes rather than the middle:
- Oldest OS version you support and the newest.
- Smallest screen (320–360dp) and a tablet.
- A genuinely low-end Android device — most of your users' hardware is slower than yours.

## Audit

```bash
ls .maestro/ e2e/ 2>/dev/null
rg 'setTimeout|sleep' .maestro/ e2e/ 2>/dev/null       # time-based waits
rg 'clearState|delete: true' .maestro/ e2e/ -c
rg 'testID' --type tsx -c                               # anchors available for E2E?
rg 'disable-animations|animator_duration_scale' .github/workflows/
```
