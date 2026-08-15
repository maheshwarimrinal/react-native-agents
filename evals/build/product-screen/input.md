# Request

Build a `ProductDetailScreen` for our React Native app.

It should show a hero image, the product name, price, an "Add to cart" button, and a
"Save for later" icon button. The product is fetched by id from `GET /products/:id`.

# Project context

```jsonc
// package.json (excerpt)
{
  "dependencies": {
    "react-native": "0.87.0",
    "expo": "~57.0.0",
    "expo-router": "^4.0.0",
    "expo-image": "~2.0.0",
    "@tanstack/react-query": "^5.60.0",
    "react-native-safe-area-context": "^5.0.0",
    "zod": "^3.23.0",
    "zustand": "^5.0.0"
  }
}
```

```
src/
  shared/
    ui/           Button.tsx, Text.tsx, EmptyState.tsx, ErrorState.tsx, Skeleton.tsx
    theme/        index.ts (useTheme), tokens.ts (spacing, radius, typography)
    lib/          api.ts (axios instance)
  features/
    catalogue/
      api/        products.ts
      components/
```

```ts
// src/shared/theme/tokens.ts (excerpt)
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
```

Existing screens use `useTheme()` for colours and import spacing from tokens.
