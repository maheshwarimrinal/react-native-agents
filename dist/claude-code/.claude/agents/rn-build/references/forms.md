# Building a Form

Don't hand-roll. `react-hook-form` + `zod` gives uncontrolled inputs (far fewer re-renders),
validation, and error state for a fraction of the code.

```tsx
// src/features/auth/screens/SignUpScreen.tsx
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const SignUpSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[0-9]/, 'Include at least one number'),
});
type SignUpValues = z.infer<typeof SignUpSchema>;

export function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(SignUpSchema),
    mode: 'onBlur',            // not onChange — validating every keystroke is hostile
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: SignUpValues) => {
    try {
      await signUp(values);
    } catch (err) {
      if (err instanceof ValidationError) {
        // Field-level errors from the server land on the right field.
        for (const [field, message] of Object.entries(err.fields)) {
          setError(field as keyof SignUpValues, { message });
        }
        setFocus(Object.keys(err.fields)[0] as keyof SignUpValues);
        return;
      }
      setError('root', { message: 'Could not create your account. Please try again.' });
    }
  };

  return (
    <KeyboardAwareScrollView
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
            autoComplete="new-password"
            textContentType="newPassword"
            autoCapitalize="none"
            autoCorrect={false}          // keeps it out of the keyboard dictionary
            returnKeyType="done"
            onSubmitEditing={handleSubmit(onSubmit)}
          />
        )}
      />

      {errors.root && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.formError}>
          {errors.root.message}
        </Text>
      )}

      <Button
        title="Create account"
        onPress={handleSubmit(onSubmit)}
        loading={isSubmitting}
        disabled={isSubmitting}     // double-submit on a slow network is a real bug
      />
    </KeyboardAwareScrollView>
  );
}
```

## The accessible field

```tsx
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, ...props },
  ref,
) {
  const id = useId();
  return (
    <View style={styles.field}>
      {/* A visible label, not a placeholder. Placeholders vanish on focus. */}
      <Text nativeID={`${id}-label`} style={styles.label}>{label}</Text>

      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityLabelledBy={`${id}-label`}   // Android
        accessibilityHint={hint}
        aria-invalid={Boolean(error)}
        style={[styles.input, error && styles.inputError]}
        placeholderTextColor={theme.textSecondary}
        {...props}
      />

      {error && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {error}
        </Text>
      )}
    </View>
  );
});
```

## Rules

**Placeholders are not labels.** They disappear the moment the user types, and usually fail
contrast. Every field gets a visible label.

**Validate on blur, not on change.** Showing "invalid email" after one character is hostile.
Revalidate on change *after* the first error, so the message clears as they fix it.

**Errors are specific and adjacent.** "Password must be at least 8 characters" — not "Invalid
input", and not a summary at the top of the form. Announce them with `role="alert"` or a live
region, or a screen reader user never learns why submission failed.

**Correct keyboard and autofill props.** This is accessibility as much as convenience — it's what
enables password managers and OTP autofill:

| Field | Props |
|---|---|
| Email | `keyboardType="email-address"` `autoComplete="email"` `textContentType="emailAddress"` `autoCapitalize="none"` |
| Password | `secureTextEntry` `autoComplete="current-password"` (or `new-password`) `autoCorrect={false}` |
| OTP | `keyboardType="number-pad"` `textContentType="oneTimeCode"` `autoComplete="sms-otp"` |
| Phone | `keyboardType="phone-pad"` `textContentType="telephoneNumber"` |
| Name | `autoComplete="name"` `textContentType="name"` |

**Chain focus.** `returnKeyType="next"` + `onSubmitEditing` moving to the next field. The last
field submits.

**Guard the submit.** Disable while in flight. Double submission on a slow network creates
duplicate orders, and it's the kind of bug that only shows up in production.

**Move focus to the first error** on failed submission, so screen reader and keyboard users aren't
stranded.

## Don't put form state in a global store

Form state is local by nature. Putting a draft in Redux or Zustand adds re-renders, persistence
you didn't want, and a stale-draft bug on the next mount. The exception is a genuine multi-screen
wizard — and even then, keep per-screen fields local and lift only the accumulated result.

## Checklist

- [ ] Visible label per field, not a placeholder
- [ ] Validation on blur; revalidate on change after the first error
- [ ] Specific error text, adjacent to the field, announced
- [ ] Correct `keyboardType` / `autoComplete` / `textContentType`
- [ ] Focus chaining; last field submits
- [ ] Submit disabled while in flight
- [ ] Server-side field errors mapped back onto fields
- [ ] Keyboard doesn't cover the focused input or the button
- [ ] `secureTextEntry` + `autoCorrect={false}` on sensitive fields
- [ ] Schema is the single source of truth for the type and the validation
