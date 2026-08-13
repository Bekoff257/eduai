"use client";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";

/** POSTs the given ID token to the server so it can verify it and persist
 * it in an httpOnly cookie (see src/app/api/auth/session/route.ts). Every
 * sign-in/sign-up flow must call this — Firebase's browser SDK alone only
 * gives the browser a client-side session; the server never sees it until
 * this runs. */
async function syncSessionCookie(idToken: string): Promise<void> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    throw new Error("Failed to establish a server session.");
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  const idToken = await credential.user.getIdToken();
  await syncSessionCookie(idToken);
}

export async function signUpWithPassword(email: string, password: string): Promise<string> {
  const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
  const idToken = await credential.user.getIdToken();
  await syncSessionCookie(idToken);
  return credential.user.uid;
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(getFirebaseAuth());
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
}
