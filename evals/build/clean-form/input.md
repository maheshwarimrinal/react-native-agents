# Request

Review the sign-in form below. It was produced by the build agent in a previous
session. If it is correct, say so; if not, say what is wrong.

# Project context

```jsonc
// package.json (excerpt)
{
  "dependencies": {
    "react-native": "0.87.0",
    "expo": "~57.0.0",
    "react-hook-form": "^7.53.0",
    "@hookform/resolvers": "^3.9.0",
    "zod": "^3.23.0",
    "react-native-keyboard-controller": "^1.14.0",
    "react-native-safe-area-context": "^5.0.0"
  }
}
```

# The code

```tsx
// src/features/auth/screens/SignInScreen.tsx
import { useRef } from 'react';
import { TextInput } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { Button } from '@/shared/ui/Button';
import { TextField } from '@/shared/ui/TextField';
import { spacing } from '@/shared/theme/tokens';
import { signIn, ValidationError } from '../api/auth';

const SignInSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
type Values = z.infer<typeof SignInSchema>;

export function SignInScreen() {
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(SignInSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: Values) => {
    try {
      await signIn(values);
    } catch (err) {
      if (err instanceof ValidationError) {
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof Values, { message });
        }
        setFocus(Object.keys(err.fields)[0] as keyof Values);
        return;
      }
      setError('root', { message: 'Could not sign you in. Check your connection and try again.' });
    }
  };

  return (
    <KeyboardAwareScrollView
      bottomOffset={spacing.xl}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
    >
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            label="Email address"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.email?.message}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            ref={passwordRef}
            label="Password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSubmit(onSubmit)}
          />
        )}
      />

      {errors.root && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {errors.root.message}
        </Text>
      )}

      <Button
        title="Sign in"
        onPress={handleSubmit(onSubmit)}
        loading={isSubmitting}
        disabled={isSubmitting}
      />
    </KeyboardAwareScrollView>
  );
}
```
