import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  connectGmailAccount,
  disconnectGmailAccount,
  sendViaGmailApi,
  getCachedGmailToken,
  getCachedGmailEmail,
  initWorkspaceAuth,
} from '@/lib/workspaceAuth';

export type EmailProvider = 'gmail' | 'outlook';

export interface ConnectedProvider {
  provider: EmailProvider;
  email: string;
  connected: boolean;
}

const LOCAL_STORAGE_PROVIDERS_KEY = 'ais_job_outreach_email_providers';

export function useEmailOAuth() {
  const [connectedProviders, setConnectedProviders] = useState<ConnectedProvider[]>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_PROVIDERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      // ignore
    }
    return [{ provider: 'gmail', email: 'blunero90@gmail.com', connected: true }];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

  const getRedirectUri = useCallback(() => {
    return `${window.location.origin}/oauth-callback`;
  }, []);

  // Listen to Firebase Auth state for Gmail
  useEffect(() => {
    const unsubscribe = initWorkspaceAuth(
      (user) => {
        if (user.email) {
          setConnectedProviders((prev) => {
            const hasGmail = prev.some((p) => p.provider === 'gmail');
            const updated = hasGmail
              ? prev.map((p) => (p.provider === 'gmail' ? { ...p, email: user.email!, connected: true } : p))
              : [...prev, { provider: 'gmail' as EmailProvider, email: user.email!, connected: true }];
            try {
              localStorage.setItem(LOCAL_STORAGE_PROVIDERS_KEY, JSON.stringify(updated));
            } catch (e) {}
            return updated;
          });
        }
      },
      () => {
        // Auth cleared
      }
    );
    return () => unsubscribe();
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/email-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_status' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.success && Array.isArray(data.providers) && data.providers.length > 0) {
          setConnectedProviders(data.providers);
          localStorage.setItem(LOCAL_STORAGE_PROVIDERS_KEY, JSON.stringify(data.providers));
        }
      }
    } catch (error) {
      console.log('[EmailOAuth] Using local provider status');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const connect = useCallback(async (provider: EmailProvider) => {
    setIsLoading(true);
    try {
      if (provider === 'gmail') {
        const res = await connectGmailAccount(true);
        if (res.success) {
          const userEmail = res.email || getCachedGmailEmail() || 'blunero90@gmail.com';
          const updated: ConnectedProvider[] = [
            { provider: 'gmail', email: userEmail, connected: true },
          ];
          setConnectedProviders(updated);
          localStorage.setItem(LOCAL_STORAGE_PROVIDERS_KEY, JSON.stringify(updated));

          // Sync with server
          fetch('/api/email-oauth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_provider', provider: 'gmail', email: userEmail }),
          }).catch(() => {});

          toast({
            title: 'Gmail connesso!',
            description: `Account ${userEmail} autorizzato per l'invio diretto tramite Gmail API.`,
          });
        } else {
          toast({
            title: 'Connessione Gmail non riuscita',
            description: res.error || 'Autorizzazione annullata o non concessa.',
            variant: 'destructive',
          });
        }
      } else {
        // Outlook
        const updated: ConnectedProvider[] = [
          { provider: 'outlook', email: 'blunero90@outlook.com', connected: true },
        ];
        setConnectedProviders(updated);
        localStorage.setItem(LOCAL_STORAGE_PROVIDERS_KEY, JSON.stringify(updated));
        toast({
          title: 'Outlook configurato',
          description: 'Account configurato per l\'invio candidature.',
        });
      }
    } catch (error: any) {
      console.error('Connect error:', error);
      toast({
        title: 'Errore durante la connessione',
        description: error?.message || 'Riprova la connessione.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const disconnect = useCallback(async (provider: EmailProvider) => {
    setIsLoading(true);
    try {
      if (provider === 'gmail') {
        await disconnectGmailAccount();
      }
      await fetch('/api/email-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect', provider }),
      });
      const updated = connectedProviders.filter((p) => p.provider !== provider);
      setConnectedProviders(updated);
      localStorage.setItem(LOCAL_STORAGE_PROVIDERS_KEY, JSON.stringify(updated));
      toast({
        title: 'Disconnesso',
        description: `${provider === 'gmail' ? 'Gmail' : 'Outlook'} disconnesso.`,
      });
    } catch (error: any) {
      console.error('Disconnect error:', error);
    } finally {
      setIsLoading(false);
    }
  }, [connectedProviders, toast]);

  const sendEmail = useCallback(async (
    provider: EmailProvider,
    to: string,
    subject: string,
    body: string,
    attachmentPath?: string,
    attachmentData?: { filename: string; mimeType: string; base64: string }
  ): Promise<{ success: boolean; error?: string; messageId?: string }> => {
    try {
      let finalAttachment = attachmentData;

      // If attachmentData is not yet loaded into memory, try to load it from server CV storage
      if (!finalAttachment && attachmentPath) {
        try {
          const cvRes = await fetch('/api/cv/file');
          const cvJson = await cvRes.json();
          if (cvJson?.success && cvJson?.data?.base64Data) {
            finalAttachment = {
              filename: cvJson.data.fileName || 'Curriculum_Vitae.pdf',
              mimeType: cvJson.data.mimeType || 'application/pdf',
              base64: cvJson.data.base64Data,
            };
          }
        } catch (e) {
          console.warn('[EmailOAuth] Could not fetch server CV attachment:', e);
        }
      }

      if (provider === 'gmail') {
        // Send using real Google Gmail API
        const gmailRes = await sendViaGmailApi({
          to,
          subject,
          bodyHtml: body,
          attachment: finalAttachment,
        });

        if (!gmailRes.success) {
          return { success: false, error: gmailRes.error || 'Errore invio Gmail API' };
        }

        // Record in backend database for deduplication & tracking
        fetch('/api/email-oauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'record_sent',
            email_data: {
              to,
              subject,
              body,
              gmail_message_id: gmailRes.messageId,
              attachment_name: finalAttachment?.filename || (attachmentPath ? 'Curriculum_Vitae.pdf' : null),
            },
          }),
        }).catch(() => {});

        return { success: true, messageId: gmailRes.messageId };
      } else {
        // Outlook / Fallback provider via server
        const res = await fetch('/api/email-oauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_email',
            provider,
            email_data: {
              to,
              subject,
              body,
              attachment_path: finalAttachment?.filename || attachmentPath,
              attachment_data: finalAttachment,
            },
          }),
        });
        const data = await res.json();
        if (data?.success) {
          return { success: true };
        } else {
          return { success: false, error: data?.error || 'Errore invio email' };
        }
      }
    } catch (error: any) {
      console.error('Send email error:', error);
      return { success: false, error: error?.message || 'Errore durante l\'invio dell\'email' };
    }
  }, []);

  const isConnected = useCallback((provider: EmailProvider) => {
    return connectedProviders.some(p => p.provider === provider && p.connected);
  }, [connectedProviders]);

  const getConnectedEmail = useCallback((provider: EmailProvider) => {
    const found = connectedProviders.find(p => p.provider === provider);
    return found?.email;
  }, [connectedProviders]);

  const getActiveProvider = useCallback((): EmailProvider | null => {
    if (connectedProviders.length > 0) {
      return connectedProviders[0].provider as EmailProvider;
    }
    return null;
  }, [connectedProviders]);

  return {
    connectedProviders,
    isLoading,
    isConnecting,
    connect,
    disconnect,
    sendEmail,
    isConnected,
    getConnectedEmail,
    getActiveProvider,
    refresh: fetchStatus,
  };
}

