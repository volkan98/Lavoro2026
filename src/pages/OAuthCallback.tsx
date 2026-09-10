import { apiFetch, safeJsonResponse } from '@/lib/api/client';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completamento autenticazione in corso...');

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');
      const error = searchParams.get('error');
      const state = searchParams.get('state') || 'gmail';

      if (error) {
        setStatus('error');
        setMessage(`Errore durante l'autenticazione: ${error}`);
        return;
      }

      if (!code) {
        setStatus('error');
        setMessage('Nessun codice di autorizzazione ricevuto da Google.');
        return;
      }

      try {
        const response = await apiFetch('/api/oauth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, provider: state }),
        });

        const data = await safeJsonResponse(response);
        if (data.success) {
          setStatus('success');
          setMessage('Account Gmail collegato con successo!');
          setTimeout(() => {
            navigate('/?step=4');
          }, 1500);
        } else {
          setStatus('error');
          setMessage(data.error || 'Errore durante lo scambio del token.');
        }
      } catch (err: any) {
        setStatus('error');
        setMessage(err.message || 'Errore di connessione al server.');
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Connessione Gmail</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center text-center space-y-4 py-6">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="text-muted-foreground">{message}</p>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle2 className="h-10 w-10 text-green-500 animate-bounce" />
              <p className="text-foreground font-medium">{message}</p>
              <p className="text-xs text-muted-foreground">Reindirizzamento all'applicazione...</p>
            </>
          )}
          {status === 'error' && (
            <>
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-destructive font-medium">{message}</p>
              <Button onClick={() => navigate('/')} className="mt-4">
                Torna all'applicazione
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
