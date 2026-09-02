import { registerRootComponent } from 'expo';
import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { createElement } from 'react';

import App from './App';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

function Root() {
  return publishableKey ? (
    createElement(ClerkProvider, { publishableKey, tokenCache, children: createElement(App) })
  ) : (
    createElement(App)
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
