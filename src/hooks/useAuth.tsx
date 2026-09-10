import { useState, useEffect, createContext, useContext, ReactNode, Fragment } from 'react';
import { auth, logFirebaseConfigDiagnostics } from '@/lib/firebase';
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, signOut as firebaseSignOut } from 'firebase/auth';
import { clearGmailToken } from '@/lib/workspaceAuth';

export interface AuthUser {
  id: string; // Always firebaseUser.uid, retained as 'id' for existing component callers.
  email: string;
  user_metadata?: { full_name?: string; city?: string; target_role?: string };
}
export interface AuthSession { user: AuthUser; access_token: string }
interface SignUpParams { email: string; password?: string; fullName?: string; city?: string }
interface AuthContextType {
  user: AuthUser | null; session: AuthSession | null; loading: boolean;
  signIn: (email: string, password?: string) => Promise<void>;
  signUp: (params: SignUpParams) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Old local sessions/passwords are never authentication credentials.
    try {
      localStorage.removeItem('ais_job_outreach_active_session');
      localStorage.removeItem('ais_job_outreach_accounts_db');
    } catch { /* Login does not depend on browser cache access. */ }
    let revision = 0;
    const unsubscribe = onIdTokenChanged(auth, async firebaseUser => {
      const current = ++revision;
      setLoading(true);
      if (!firebaseUser) {
        clearGmailToken(); setUser(null); setSession(null); setLoading(false); return;
      }
      try {
        const token = await firebaseUser.getIdToken();
        if (current !== revision || auth.currentUser?.uid !== firebaseUser.uid) return;
        const canonical = { id: firebaseUser.uid, email: firebaseUser.email || '',
          user_metadata: { full_name: firebaseUser.displayName || '' } };
        setUser(canonical); setSession({ user: canonical, access_token: token });
        logFirebaseConfigDiagnostics();
      } catch {
        if (current === revision) { setUser(null); setSession(null); }
      } finally { if (current === revision) setLoading(false); }
    });
    return () => { revision++; unsubscribe(); };
  }, []);
  const signIn = async (email: string, password?: string) => {
    if (!password) throw new Error('Inserisci la password del tuo account Firebase.');
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };
  const signUp = async ({ email, password, fullName }: SignUpParams) => {
    if (!password) throw new Error('Inserisci una password.');
    const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (fullName?.trim()) await updateProfile(result.user, { displayName: fullName.trim() });
  };
  const signInWithGoogle = async () => {
    // Application login never grants or simulates Gmail authorization.
    await signInWithPopup(auth, new GoogleAuthProvider());
  };
  const signOut = async () => { clearGmailToken(); await firebaseSignOut(auth); };
  return <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signInWithGoogle, signOut }}>
    <Fragment key={user?.id || 'signed-out'}>{children}</Fragment>
  </AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth requires AuthProvider');
  return value;
}
