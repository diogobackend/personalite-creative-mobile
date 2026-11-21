import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

export default function RootLayout() {
  useEffect(() => { void SplashScreen.hideAsync(); }, []);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="cadastro" />
      <Stack.Screen name="home" />
    </Stack>
  );
}
