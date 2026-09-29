/**
 * Key storage. The key is a bearer credential, so it lives in the platform's
 * secure store on device and in localStorage only on web (where SecureStore
 * has no implementation and the web build exists for previews/tests).
 */

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const STORAGE_KEY = "agentic-inbox.session";

/** Extra safety net for web builds and any SecureStore failure. */
let memoryFallback: string | null = null;

function webStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export async function getStoredSession(): Promise<string | null> {
  if (Platform.OS === "web") {
    return webStorage()?.getItem(STORAGE_KEY) ?? memoryFallback;
  }
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return memoryFallback;
  }
}

export async function setStoredSession(value: string): Promise<void> {
  memoryFallback = value;
  if (Platform.OS === "web") {
    webStorage()?.setItem(STORAGE_KEY, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, value);
  } catch {
    // Memory fallback keeps the session for this launch.
  }
}

export async function clearStoredSession(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === "web") {
    webStorage()?.removeItem(STORAGE_KEY);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
