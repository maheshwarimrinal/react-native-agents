// "Some users say they lost premium after reinstalling. Also our revenue looks off."
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestPurchase, finishTransaction, getProducts } from 'react-native-iap';

const PREMIUM_SKU = 'premium_monthly';

export async function buyPremium() {
  const result = await requestPurchase({ sku: PREMIUM_SKU });

  if (result) {
    await AsyncStorage.setItem('isPremium', 'true');
    await AsyncStorage.setItem('premiumUntil', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
    await finishTransaction({ purchase: result, isConsumable: false });
    unlockPremiumFeatures();
  }
}

export async function checkPremium(): Promise<boolean> {
  const flag = await AsyncStorage.getItem('isPremium');
  const until = Number(await AsyncStorage.getItem('premiumUntil') ?? 0);
  return flag === 'true' && Date.now() < until;
}

export function PaywallScreen() {
  return (
    <View>
      <Text>Go Premium — $9.99 / month</Text>
      <Pressable onPress={buyPremium}>
        <Text>Subscribe</Text>
      </Pressable>
    </View>
  );
}
