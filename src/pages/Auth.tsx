import * as React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Briefcase, Mail, Lock, User, MapPin, Sparkles, CheckCircle2, UserPlus, LogIn, ArrowRight } from 'lucide-react';

export default function Auth() {
  // Sign In form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Sign Up form state
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regCity, setRegCity] = useState('');
  
  const [loading, setLoading] = useState(false);
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) return;
    setLoading(true);
    try {
      await signIn(loginEmail, loginPassword);
      toast({
        title: 'Accesso completato',
        description: `Benvenuto/a su AI Job Agent!`,
      });
      navigate('/');
    } catch (error: any) {
      toast({
        title: 'Errore durante l\'accesso',
        description: error?.message || 'Verifica i dati inseriti.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regEmail) {
      toast({
        title: 'Email richiesta',
        description: 'Inserisci un indirizzo email valido.',
        variant: 'destructive',
      });
      return;
    }
    setLoading(true);
    try {
      await signUp({
        email: regEmail,
        password: regPassword,
        fullName: regFullName || regEmail.split('@')[0],
        city: regCity || '',
      });
      toast({
        title: 'Account creato con successo!',
        description: 'Il tuo profilo è pronto. Puoi ora iniziare a caricare il tuo CV.',
      });
      navigate('/');
    } catch (error: any) {
      toast({
        title: 'Errore registrazione',
        description: error?.message || 'Impossibile creare l\'account.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
      toast({
        title: 'Accesso completato',
        description: 'Autenticazione con account Google riuscita!',
      });
      navigate('/');
    } catch (error: any) {
      toast({
        title: 'Accesso Google non riuscito',
        description: error?.message || 'Impossibile completare l\'accesso con Google. Verifica i permessi popup o accedi con email.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Header Brand */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
          <Briefcase className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold font-serif text-foreground">AI Job Agent</h1>
          <p className="text-xs md:text-sm text-muted-foreground">Candidature intelligenti per Svizzera & Italia (Permesso G)</p>
        </div>
      </div>

      <Card className="w-full max-w-md shadow-xl border-border/70">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-xl">Gestione Account</CardTitle>
          <CardDescription>
            Accedi al tuo profilo esistente o crea un nuovo account per gestire le candidature
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="login" className="flex items-center gap-1.5">
                <LogIn className="w-4 h-4" />
                <span>Accedi</span>
              </TabsTrigger>
              <TabsTrigger value="register" className="flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" />
                <span>Crea Account</span>
              </TabsTrigger>
            </TabsList>

            {/* TAB ACCEDI */}
            <TabsContent value="login" className="space-y-4">
              <form onSubmit={handleLogin} className="space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email" className="text-xs font-medium">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="es. mario.rossi@gmail.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="pl-9 h-10"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="login-password" className="text-xs font-medium">Password (Opzionale)</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="pl-9 h-10"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-10 text-sm font-medium mt-2" disabled={loading}>
                  <Sparkles className="w-4 h-4 mr-2" />
                  {loading ? 'Accesso in corso...' : 'Accedi al Profilo'}
                </Button>
              </form>
            </TabsContent>

            {/* TAB CREA ACCOUNT */}
            <TabsContent value="register" className="space-y-4">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reg-name" className="text-xs font-medium">Nome e Cognome</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-name"
                      placeholder="es. Mario Rossi"
                      value={regFullName}
                      onChange={(e) => setRegFullName(e.target.value)}
                      className="pl-9 h-10"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-email" className="text-xs font-medium">Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="es. nome.cognome@email.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="pl-9 h-10"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-city" className="text-xs font-medium">Città / Zona di Residenza</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-city"
                      placeholder="es. Como (Frontaliere Ticino) o Lugano"
                      value={regCity}
                      onChange={(e) => setRegCity(e.target.value)}
                      className="pl-9 h-10"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="reg-password" className="text-xs font-medium">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="reg-password"
                      type="password"
                      placeholder="Crea una password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="pl-9 h-10"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-10 text-sm font-medium mt-3" disabled={loading}>
                  <UserPlus className="w-4 h-4 mr-2" />
                  {loading ? 'Creazione in corso...' : 'Crea Nuovo Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-4 pt-3 border-t border-border/60 space-y-2">
            <Button
              variant="outline"
              size="default"
              className="w-full h-11 text-xs sm:text-sm font-medium border-border/80 hover:bg-muted/80 flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
              onClick={handleGoogleLogin}
              disabled={loading}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Accedi con Account Google / Gmail</span>
            </Button>
            <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1.5 pt-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              Tutti i dati, CV e candidature restano sempre salvati e sincronizzati
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
