import * as admin from 'firebase-admin';

let initialized = false;

export function initializeFirebase(): admin.app.App | null {
  if (initialized) return admin.app();

  try {
    const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (b64) {
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
      admin.initializeApp({ credential: admin.credential.cert(json) });
      initialized = true;
      console.log('[firebase] initialized via FIREBASE_SERVICE_ACCOUNT_BASE64');
      return admin.app();
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
      initialized = true;
      console.log('[firebase] initialized via GOOGLE_APPLICATION_CREDENTIALS');
      return admin.app();
    }

    console.warn('[firebase] no credentials supplied — auth middleware will operate in soft mode');
    return null;
  } catch (err) {
    console.error('[firebase] initialization failed:', (err as Error).message);
    return null;
  }
}

export function isFirebaseReady(): boolean {
  return initialized;
}

export function firebaseAuth(): admin.auth.Auth | null {
  if (!initialized) return null;
  return admin.auth();
}
