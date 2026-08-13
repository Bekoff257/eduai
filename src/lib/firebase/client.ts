"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/**
 * Lazily initializes the Firebase client SDK on first use rather than at
 * module load. Next.js prerenders /login and /signup at build time, which
 * evaluates this module without real NEXT_PUBLIC_FIREBASE_* env vars
 * present — eager initializeApp()/getAuth() would throw during the build
 * itself. Deferring to first call (a real sign-in/sign-up attempt, which
 * only happens in the browser) keeps the build green without requiring
 * placeholder Firebase credentials.
 */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  return auth;
}
