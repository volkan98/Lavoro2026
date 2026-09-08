import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { auth, db } from '@/lib/firebase';
import { GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

export interface AuthUser {
  id: string; // Canonical identifier (firebaseUser.uid or usr_...)
  email: string;
  user_metadata?: {
    full_name?: string;
    city?: string;
    target_role?: string;
  };
}

export interface AuthSession {
  user: AuthUser;
  access_token: string;
}

interface SignUpParams {
  email: string;
  password?: string;
  fullName?: string;
  city?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  signIn: (email: string, password?: string) => Promise<void>;
  signUp: (params: SignUpParams) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_STORAGE_SESSION_KEY = 'ais_job_outreach_active_session';
const LOCAL_STORAGE_ACCOUNTS_KEY = 'ais_job_outreach_accounts_db';

interface StoredAccount {
  id: string;
  email: string;
  password?: string;
  fullName: string;
  city?: string;
  createdAt: string;
}

function getStoredAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_ACCOUNTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Filter out any stale dummy accounts
      if (Array.isArray(parsed)) {
        return parsed.filter((a: any) => a?.id !== 'user_blunero90');
      }
    }
  } catch (e) {
    console.error('Error reading accounts db:', e);
  }
  return [];
}

function saveStoredAccounts(accounts: StoredAccount[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.error('Error saving accounts:', e);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  // Subscribe to Firebase Auth state as primary identity source
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        const canonicalUser: AuthUser = {
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          user_metadata: {
            full_name: firebaseUser.displayName || '',
          },
        };

        // Try reading user profile details from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data?.profile?.full_name || data?.full_name) {
              canonicalUser.user_metadata = {
                full_name: data.profile?.full_name || data.full_name,
                city: data.profile?.city || data.city,
                target_role: data.profile?.target_role || data.target_role,
              };
            }
          }
        } catch {
          // Non-blocking
        }

        const token = await firebaseUser.getIdToken().catch(() => `token_${firebaseUser.uid}`);
        setUser(canonicalUser);
        setSession({ user: canonicalUser, access_token: token });
        localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(canonicalUser));
        setLoading(false);
      } else {
        // Check stored session
        try {
          const stored = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed?.id && parsed.id !== 'user_blunero90') {
              setUser(parsed);
              setSession({ user: parsed, access_token: `token_${parsed.id}` });
            } else {
              localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
              setUser(null);
              setSession(null);
            }
          } else {
            setUser(null);
            setSession(null);
          }
        } catch {
          setUser(null);
          setSession(null);
        } finally {
          setLoading(false);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, _password?: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      throw new Error('Inserisci un indirizzo email valido');
    }

    const accounts = getStoredAccounts();
    const existing = accounts.find((a) => a.email.toLowerCase() === cleanEmail);

    const userId = existing
      ? existing.id
      : `usr_${btoa(cleanEmail).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;

    const loggedUser: AuthUser = {
      id: userId,
      email: cleanEmail,
      user_metadata: {
        full_name: existing?.fullName || cleanEmail.split('@')[0],
        city: existing?.city || '',
      },
    };

    if (!existing) {
      accounts.push({
        id: loggedUser.id,
        email: cleanEmail,
        fullName: loggedUser.user_metadata?.full_name || '',
        city: loggedUser.user_metadata?.city,
        createdAt: new Date().toISOString(),
      });
      saveStoredAccounts(accounts);
    }

    // Persist to Firestore under users/{uid}
    try {
      const userRef = doc(db, 'users', loggedUser.id);
      await setDoc(
        userRef,
        {
          id: loggedUser.id,
          email: cleanEmail,
          full_name: loggedUser.user_metadata?.full_name || '',
          city: loggedUser.user_metadata?.city || '',
          lastLogin: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    } catch {
      // Non-blocking
    }

    // Sync to local server DB
    fetch('/api/user/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: loggedUser.id,
        email: cleanEmail,
        full_name: loggedUser.user_metadata?.full_name || '',
      }),
    }).catch(() => {});

    setUser(loggedUser);
    setSession({ user: loggedUser, access_token: `token_${loggedUser.id}` });
    localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(loggedUser));
  };

  const signUp = async ({ email, fullName, city }: SignUpParams) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      throw new Error('Inserisci un indirizzo email valido');
    }

    const userId = `usr_${btoa(cleanEmail).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;

    const newAuthUser: AuthUser = {
      id: userId,
      email: cleanEmail,
      user_metadata: {
        full_name: fullName || cleanEmail.split('@')[0],
        city: city || '',
      },
    };

    const accounts = getStoredAccounts().filter((a) => a.email.toLowerCase() !== cleanEmail);
    accounts.push({
      id: newAuthUser.id,
      email: cleanEmail,
      fullName: newAuthUser.user_metadata?.full_name || '',
      city: newAuthUser.user_metadata?.city,
      createdAt: new Date().toISOString(),
    });
    saveStoredAccounts(accounts);

    // Save to Firestore under users/{uid}
    try {
      const userRef = doc(db, 'users', newAuthUser.id);
      await setDoc(
        userRef,
        {
          id: newAuthUser.id,
          email: cleanEmail,
          full_name: newAuthUser.user_metadata?.full_name || '',
          city: newAuthUser.user_metadata?.city || '',
          createdAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    } catch {
      // Non-blocking
    }

    // Sync to local server DB
    fetch('/api/user/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: newAuthUser.id,
        email: cleanEmail,
        full_name: newAuthUser.user_metadata?.full_name || '',
        city: newAuthUser.user_metadata?.city || '',
      }),
    }).catch(() => {});

    setUser(newAuthUser);
    setSession({ user: newAuthUser, access_token: `token_${newAuthUser.id}` });
    localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(newAuthUser));
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    provider.addScope('https://www.googleapis.com/auth/gmail.send');

    // Sign in via Firebase Auth popup
    const res = await signInWithPopup(auth, provider);
    const googleUser = res.user;

    const canonicalUser: AuthUser = {
      id: googleUser.uid,
      email: googleUser.email || '',
      user_metadata: {
        full_name: googleUser.displayName || '',
      },
    };

    // Save user document in Firestore under users/{uid}
    try {
      const userRef = doc(db, 'users', googleUser.uid);
      await setDoc(
        userRef,
        {
          id: googleUser.uid,
          email: googleUser.email || '',
          full_name: googleUser.displayName || '',
          lastLogin: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    } catch {
      // Non-blocking
    }

    const token = await googleUser.getIdToken().catch(() => `token_${googleUser.uid}`);
    setUser(canonicalUser);
    setSession({ user: canonicalUser, access_token: token });
    localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(canonicalUser));
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth).catch(() => {});
      localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      setUser(null);
      setSession(null);
    } catch (e) {
      console.error('Error during sign out:', e);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
