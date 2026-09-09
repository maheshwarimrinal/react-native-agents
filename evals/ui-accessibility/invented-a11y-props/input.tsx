// SignupForm.tsx — form validation with "accessible" error handling.
// Reviewer note: the author read web ARIA guidance and carried it across.
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

export function SignupForm({ onSubmit }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  return (
    <View>
      <Text nativeID="emailLabel">Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        accessibilityLabel="Email"
        accessibilityLabelledBy="emailLabel"
        accessibilityInvalid={!!errors.email}
        accessibilityRequired={true}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      {errors.email && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {errors.email}
        </Text>
      )}

      <Text nativeID="pwLabel">Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        accessibilityLabel="Password"
        aria-invalid={!!errors.password}
        aria-describedby="pwHelp"
        accessibilityState={{ invalid: !!errors.password, disabled: submitting }}
      />
      <Text nativeID="pwHelp">At least 8 characters</Text>

      <Pressable
        onPress={() => {
          setSubmitting(true);
          onSubmit({ email, password }).finally(() => setSubmitting(false));
        }}
        role="header"
        accessibilityState={{ busy: submitting }}
      >
        <Text>Create account</Text>
      </Pressable>
    </View>
  );
}
