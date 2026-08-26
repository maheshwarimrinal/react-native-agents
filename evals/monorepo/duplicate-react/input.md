pnpm workspace. `apps/mobile` imports `@acme/ui` and `@acme/shared`.

Everything worked until we added `@acme/ui`. Now any screen using a hook from it throws:

```
Invalid hook call. Hooks can only be called inside of the body of a function component.
```

We've checked — we're not calling hooks conditionally, and the components are function components.
The same components work fine in `apps/web`.

`apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
module.exports = getDefaultConfig(__dirname);
```

We have no `.npmrc`.
