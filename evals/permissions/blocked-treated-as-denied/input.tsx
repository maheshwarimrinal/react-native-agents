// "Users say the Allow Camera button does nothing."
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PERMISSIONS, RESULTS, check, request } from 'react-native-permissions';

export function ReceiptScanner() {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    check(PERMISSIONS.IOS.CAMERA).then((s) => setGranted(s === RESULTS.GRANTED));
  }, []);

  async function onAllowPress() {
    const result = await request(PERMISSIONS.IOS.CAMERA);
    setGranted(result === RESULTS.GRANTED);
  }

  if (!granted) {
    return (
      <View>
        <Text>Camera permission denied.</Text>
        <Pressable onPress={onAllowPress}>
          <Text>Allow camera access</Text>
        </Pressable>
      </View>
    );
  }

  return <Scanner />;
}
