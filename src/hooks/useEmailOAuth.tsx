import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { connectGmailAccount, disconnectGmailAccount, sendViaGmailApi, getCachedGmailToken, getCachedGmailEmail, initWorkspaceAuth } from '@/lib/workspaceAuth';
import { getVerifiedCvAttachment } from '@/lib/cvStorage';
export type EmailProvider = 'gmail' | 'outlook';
export interface ConnectedProvider { provider: EmailProvider; email: string; connected: boolean }
export function useEmailOAuth() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [connectedProviders, setProviders] = useState<ConnectedProvider[]>([]);
  const [isLoading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    const email = getCachedGmailEmail();
    setProviders(user && email && getCachedGmailToken() ? [{ provider: 'gmail', email, connected: true }] : []);
  }, [user?.id]);
  useEffect(() => {
    const unsubscribe = initWorkspaceAuth(() => { void refresh(); }, () => setProviders([]));
    void refresh();
    window.addEventListener('gmail-authorization-changed', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 30000);
    return () => { unsubscribe(); clearInterval(timer); window.removeEventListener('gmail-authorization-changed', refresh); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  const connect = async (provider: EmailProvider) => {
    setLoading(true);
    try {
      if (provider !== 'gmail') throw new Error('Autorizzazione Outlook non configurata.');
      const result = await connectGmailAccount(true);
      if (!result.success) throw new Error(result.error);
      await refresh(); toast({ title: 'Gmail autorizzato', description: result.email });
    } catch (e: any) { toast({ title: 'Autorizzazione non riuscita', description: e.message, variant: 'destructive' }); }
    finally { setLoading(false); }
  };
  const disconnect = async (_provider: EmailProvider) => { await disconnectGmailAccount(); await refresh(); };
  const sendEmail = async (provider: EmailProvider, to: string, subject: string, body: string, _path?: string, attachmentData?: { filename: string; mimeType: string; base64: string }) => {
    if (provider !== 'gmail') return { success: false, error: 'Provider email non autorizzato' };
    const verified = attachmentData ? { ok: true, attachment: attachmentData } : await getVerifiedCvAttachment();
    if (!verified.ok) return { success: false, error: 'Il CV originale non è disponibile' };
    return sendViaGmailApi({ to, subject, bodyHtml: body, attachment: verified.attachment });
  };
  return { connectedProviders, isLoading, isConnecting: isLoading, connect, disconnect, sendEmail, refresh,
    isConnected: (provider: EmailProvider) => connectedProviders.some(p => p.provider === provider && p.connected),
    getConnectedEmail: (provider: EmailProvider) => connectedProviders.find(p => p.provider === provider)?.email,
    getActiveProvider: (): EmailProvider | null => connectedProviders[0]?.provider || null };
}
