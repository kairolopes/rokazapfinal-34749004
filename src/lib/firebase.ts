import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { initializeFirestore, getFirestore, memoryLocalCache, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBXrP5X9rxmg9Sz77N5McQNtH5K4Sn_i_0",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rokazap.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rokazap",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rokazap.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1088612807685",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1088612807685:web:f85e3254092c4b399f186c",
};

export function isFirebaseConfigured(): boolean {
  const forceDemo = String(import.meta.env.VITE_FORCE_DEMO || '').toLowerCase() === 'true';
  if (forceDemo) return false;
  return Object.values(firebaseConfig).every(
    (v) =>
      typeof v === 'string' &&
      v.trim().length > 0 &&
      !v.includes('SUA_') &&
      !v.includes('SEU_')
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

if (isFirebaseConfigured()) {
  // HMR safety: reuse existing app if already initialized
  const existingApps = getApps();
  app = existingApps.length > 0 ? existingApps[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { localCache: memoryLocalCache() });
  } catch {
    // Already initialized (HMR reload) — reuse existing instance
    db = getFirestore(app);
  }
  storage = getStorage(app);
} else {
  console.warn('⚠️ Firebase não configurado. App rodando em modo demo com dados mockados.');
}

export { auth, db, storage };
export default app;
