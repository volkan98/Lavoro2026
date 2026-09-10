import { requireUid } from '@/lib/api/client';
import { useState, useEffect, useCallback } from 'react';
import { aiAgent, type SentEmailRecord } from '@/lib/api/ai-agent';
import { useCVContext } from '@/contexts/CVContext';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { connectGmailAccount, hasGmailReadScope } from '@/lib/workspaceAuth';
import { 
  History, 
  Search, 
  Building2, 
  Mail, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  ArrowLeft, 
  RotateCcw, 
  FileText,
  AlertTriangle,
  CloudCheck,
  Sparkles,
  Inbox
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { ManualAddModal } from './ManualAddModal';

export type CloudSyncStatus = 'loading' | 'cloud_connected' | 'cloud_delayed' | 'offline' | 'error';

export function SentEmailsHistory() {
  const { user, loading: authLoading } = useAuth();
  const { setCurrentStep } = useCVContext();
  const { toast } = useToast();
  
  const [sentEmails, setSentEmails] = useState<SentEmailRecord[]>([]);
  const [filteredEmails, setFilteredEmails] = useState<SentEmailRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReconciling, setIsReconciling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<CloudSyncStatus>('loading');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  // Realtime subscription to Firestore (Single Source of Truth)
  useEffect(() => {
    if (authLoading || !user?.id) return;

    const activeUserId = requireUid(user.id);
    let isSubscribed = true;

    // Check if browser is offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setCloudSyncStatus('offline');
      setIsLoading(false);
      return;
    }

    setCloudSyncStatus('loading');
    setIsLoading(true);

    // Watchdog timer: If Firestore takes > 2500ms, mark as cloud_delayed without cancelling the subscription!
    const delayTimer = setTimeout(() => {
      if (isSubscribed) {
        setCloudSyncStatus((prev) => (prev === 'loading' ? 'cloud_delayed' : prev));
      }
    }, 2500);

    // Subscribe to live Firestore updates
    const unsubscribe = aiAgent.subscribeSentEmails(
      activeUserId,
      (cloudRecords) => {
        if (!isSubscribed) return;
        clearTimeout(delayTimer);
        setSentEmails(cloudRecords);
        setCloudSyncStatus('cloud_connected');
        setIsLoading(false);
        setLoadError(null);
      },
      (err) => {
        if (!isSubscribed) return;
        clearTimeout(delayTimer);
        console.error('[SentEmailsHistory] Firestore subscription error:', err);
        setCloudSyncStatus('error');
        setLoadError('Errore durante la connessione a Firestore. Riprova più tardi.');
        setIsLoading(false);
      }
    );

    // Also listen to browser online/offline events
    const handleOnline = () => {
      setCloudSyncStatus('loading');
    };
    const handleOffline = () => {
      setCloudSyncStatus('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      isSubscribed = false;
      clearTimeout(delayTimer);
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [authLoading, user?.id]);

  const handleManualRefresh = async () => {
    if (!user?.id) return;
    setIsLoading(true);
    try {
      const activeUserId = requireUid(user.id);
      const emails = await aiAgent.getSentEmails(activeUserId, { timeoutMs: 15000 });
      if (Array.isArray(emails)) {
        setSentEmails(emails);
        setCloudSyncStatus('cloud_connected');
        setLoadError(null);
      }
    } catch (err: any) {
      console.error('[SentEmailsHistory] Manual refresh error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Reconciliation handler with Gmail (Purely Additive Recovery Tool)
  const handleReconcileWithGmail = async () => {
    if (!user?.id) {
      toast({
        title: 'Utente non autenticato',
        description: 'Effettua l’accesso per sincronizzare con Gmail.',
        variant: 'destructive',
      });
      return;
    }

    setIsReconciling(true);
    try {
      const activeUserId = requireUid(user.id);
      let res = await aiAgent.reconcileWithGmail(activeUserId);

      // If read permission was missing, trigger OAuth consent and retry
      if (res.needsReadAuth) {
        toast({
          title: 'Autorizzazione richiesta',
          description: 'Autorizza l’accesso in lettura a Gmail per recuperare le email inviate.',
        });
        const authRes = await connectGmailAccount(true);
        if (!authRes.success) {
          throw new Error(authRes.error || 'Autorizzazione Gmail non concessa');
        }
        // Retry reconciliation with newly granted permissions
        res = await aiAgent.reconcileWithGmail(activeUserId);
      }

      if (!res.success) {
        throw new Error(res.error || 'Errore sconosciuto durante la sincronizzazione');
      }

      let syncMsg = '';
      if (res.reconciledCount > 0) {
        syncMsg = `Aggiunte ${res.reconciledCount} email inviate mancanti da Firestore.`;
      } else {
        syncMsg = `Tutte le email inviate negli ultimi 3 giorni (${res.totalSentFound} verificate) sono già presenti nello storico.`;
      }

      toast({
        title: 'Sincronizzazione completata',
        description: syncMsg,
      });

      // Refresh list to show newly reconciled records
      await handleManualRefresh();
    } catch (err: any) {
      console.error('[SentEmailsHistory] Reconciliation failed:', err);
      toast({
        title: 'Sincronizzazione non riuscita',
        description: err?.message || 'Impossibile recuperare le email inviate da Gmail.',
        variant: 'destructive',
      });
    } finally {
      setIsReconciling(false);
    }
  };

  // Filter emails when filters change
  useEffect(() => {
    let filtered = Array.isArray(sentEmails) ? [...sentEmails] : [];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(e => 
        (e.company_name || (e as any).companyName || '').toLowerCase().includes(term) ||
        (e.email || '').toLowerCase().includes(term) ||
        (e.domain || '').toLowerCase().includes(term) ||
        (e.subject || '').toLowerCase().includes(term)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(e => e.status === statusFilter);
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date();
      const filterDate = new Date();
      
      switch (dateFilter) {
        case 'today':
          filterDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          filterDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          filterDate.setMonth(now.getMonth() - 1);
          break;
      }
      
      filtered = filtered.filter(e => {
        const d = new Date(e.sent_at || (e as any).sentAt || 0);
        return d >= filterDate;
      });
    }

    setFilteredEmails(filtered);
  }, [sentEmails, searchTerm, statusFilter, dateFilter]);

  const handleDelete = async (id: string) => {
    try {
      const activeUserId = requireUid(user?.id);
      const res = await aiAgent.deleteSentEmail(id, activeUserId);
      if (!res.success) throw new Error(res.error);

      setSentEmails(prev => prev.filter(e => e.id !== id && e.message_id !== id));
      toast({
        title: 'Rimosso',
        description: 'Il record è stato rimosso dallo storico Firestore. Potrai reinviare a questo contatto.',
      });
    } catch (error: any) {
      toast({
        title: 'Errore',
        description: 'Impossibile rimuovere il record.',
        variant: 'destructive',
      });
    }
  };

  const safeSentList = Array.isArray(sentEmails) ? sentEmails : [];
  const uniqueDomains = [...new Set(safeSentList.map(e => e?.domain).filter(Boolean))];
  const stats = {
    total: safeSentList.length,
    sent: safeSentList.filter(e => e.status === 'sent').length,
    error: safeSentList.filter(e => e.status === 'error').length,
    domains: uniqueDomains.length,
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-center md:text-left space-y-1">
          <div className="flex items-center justify-center md:justify-start gap-2.5 flex-wrap">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
              <History className="h-6 w-6 text-primary" />
              Email Già Inviate
            </h2>
            {cloudSyncStatus === 'cloud_connected' && (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs flex items-center gap-1.5 py-0.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cloud Firestore Connesso ({stats.total})
              </Badge>
            )}
            {cloudSyncStatus === 'cloud_delayed' && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs flex items-center gap-1.5 py-0.5">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Sincronizzazione Cloud in corso...
              </Badge>
            )}
            {cloudSyncStatus === 'offline' && (
              <Badge variant="outline" className="bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30 text-xs flex items-center gap-1.5 py-0.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Dispositivo Offline (Copia locale)
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Storico permanente delle candidature inviate sincronizzato in tempo reale con Firestore e Gmail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleManualRefresh}
            disabled={isLoading}
            className="text-xs h-9 gap-1.5"
            title="Forza aggiornamento da Firestore"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Aggiorna
          </Button>
          <ManualAddModal onSuccess={() => handleManualRefresh()} />
        </div>
      </div>

      {/* Cloud Delayed banner */}
      {cloudSyncStatus === 'cloud_delayed' && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-amber-600 dark:text-amber-400 text-sm">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
            <span>Connessione a Firestore in corso... I dati del database cloud sovrascriveranno automaticamente la visualizzazione non appena ricevuti.</span>
          </div>
          <Button size="sm" variant="outline" onClick={handleManualRefresh} className="h-7 text-xs border-amber-500/40 shrink-0">
            Forza Lettura Cloud
          </Button>
        </div>
      )}

      {/* Real Offline banner */}
      {cloudSyncStatus === 'offline' && (
        <div className="p-3 bg-slate-500/10 border border-slate-500/30 rounded-xl flex items-center justify-between text-slate-600 dark:text-slate-400 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Dispositivo offline: visualizzazione temporanea della copia locale. La sincronizzazione riprenderà automaticamente al ripristino della rete.</span>
          </div>
        </div>
      )}

      {/* Error banner */}
      {cloudSyncStatus === 'error' && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl flex items-center justify-between text-destructive text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{loadError || 'Errore di connessione con Firestore cloud.'}</span>
          </div>
          <Button size="sm" variant="outline" onClick={handleManualRefresh} className="h-7 text-xs border-destructive/40 shrink-0">
            Riprova
          </Button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border shadow-sm">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Totale inviate</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{stats.sent}</p>
            <p className="text-sm text-muted-foreground">Inviate con successo</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-destructive">{stats.error}</p>
            <p className="text-sm text-muted-foreground">Errori</p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-sm">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-foreground">{stats.domains}</p>
            <p className="text-sm text-muted-foreground">Domini unici</p>
          </CardContent>
        </Card>
      </div>

      {/* Gmail Reconciliation Banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl text-primary shrink-0">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm">Recupero e Sincronizzazione Gmail</h4>
              <p className="text-xs text-muted-foreground">
                Recupera e riconcilia con Firestore le email inviate negli ultimi 3 giorni.
              </p>
            </div>
          </div>
          <Button
            onClick={handleReconcileWithGmail}
            disabled={isReconciling || authLoading}
            className="w-full sm:w-auto shrink-0 shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isReconciling ? 'animate-spin' : ''}`} />
            {isReconciling ? 'Sincronizzazione in corso...' : 'Sincronizza con Gmail'}
          </Button>
        </CardContent>
      </Card>

      {/* Filters and search */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca azienda, email, dominio o oggetto..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Stato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="sent">Inviati</SelectItem>
                  <SelectItem value="error">Errori</SelectItem>
                  <SelectItem value="manual">Manuali</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Data" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutto</SelectItem>
                  <SelectItem value="today">Oggi</SelectItem>
                  <SelectItem value="week">Ultima settimana</SelectItem>
                  <SelectItem value="month">Ultimo mese</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={handleManualRefresh} title="Ricarica storico">
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email List */}
      <div className="space-y-3">
        {isLoading ? (
          <Card className="p-8 text-center border-border">
            <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">Caricamento dello storico da Firestore...</p>
          </Card>
        ) : loadError && sentEmails.length === 0 ? (
          <Card className="p-8 text-center border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">Errore di connessione</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">{loadError}</p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={handleManualRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Riprova Caricamento
              </Button>
              <Button onClick={handleReconcileWithGmail}>
                <Mail className="h-4 w-4 mr-2" />
                Recupera da Gmail
              </Button>
            </div>
          </Card>
        ) : filteredEmails.length === 0 ? (
          <Card className="p-8 text-center border-border">
            <Inbox className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-medium mb-1">
              {sentEmails.length === 0 
                ? 'Nessuna email nello storico locale.' 
                : 'Nessun risultato con i filtri selezionati.'}
            </p>
            {sentEmails.length === 0 && (
              <p className="text-muted-foreground text-sm mb-4">
                Se hai inviato email ieri dal tuo account Gmail, usa il pulsante &quot;Sincronizza con Gmail&quot; in alto per recuperarle automaticamente.
              </p>
            )}
            {sentEmails.length === 0 && (
              <Button onClick={handleReconcileWithGmail} disabled={isReconciling}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isReconciling ? 'animate-spin' : ''}`} />
                Sincronizza Ora da Gmail
              </Button>
            )}
          </Card>
        ) : (
          filteredEmails.map(email => (
            <Card key={email.id} className="hover:bg-accent/20 transition-colors border-border">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="pt-1">
                      {email.status === 'sent' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : email.status === 'error' ? (
                        <XCircle className="h-5 w-5 text-destructive" />
                      ) : (
                        <Mail className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">
                          {email.company_name || (email as any).companyName || 'Azienda'}
                        </h3>
                        {email.domain && (
                          <Badge variant="outline" className="text-xs">
                            {email.domain}
                          </Badge>
                        )}
                        {email.source === 'gmail_recovery' && (
                          <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                            Recuperata da Gmail
                          </Badge>
                        )}
                        {email.source === 'manual' && (
                          <Badge variant="secondary" className="text-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30">
                            Aggiunta Manualmente
                          </Badge>
                        )}
                        {email.syncStatus === 'pending' && (
                          <Badge variant="secondary" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                            In attesa di sync cloud
                          </Badge>
                        )}
                        {(email.cv_version || (email.attachments && email.attachments.length > 0)) && (
                          <Badge variant="outline" className="text-xs flex items-center gap-1 text-muted-foreground">
                            <FileText className="h-3 w-3" />
                            {email.cv_version || email.attachments?.[0]}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {email.email}
                      </p>
                      <p className="text-xs text-foreground/80 mt-1 font-medium line-clamp-1">
                        {email.subject}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-medium text-foreground">
                        {(() => {
                          try {
                            const d = new Date(email.sent_at || (email as any).sentAt);
                            return !isNaN(d.getTime()) ? d.toLocaleDateString('it-IT', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            }) : 'N/D';
                          } catch { return 'N/D'; }
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          try {
                            const d = new Date(email.sent_at || (email as any).sentAt);
                            return !isNaN(d.getTime()) ? d.toLocaleTimeString('it-IT', {
                              hour: '2-digit',
                              minute: '2-digit',
                            }) : '';
                          } catch { return ''; }
                        })()}
                      </p>
                    </div>
                    
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" title="Rimuovi record per poter reinviare">
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Rimuovere questo record dallo storico?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Rimuovendo questo record dallo storico Firestore potrai reinviare un&apos;email a <strong>{email.email}</strong>.
                            L&apos;azienda non risulterà più bloccata.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annulla</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(email.id)}>
                            Rimuovi
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(3)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Torna a Email
        </Button>
        <Button onClick={() => setCurrentStep(2)}>
          <Building2 className="h-4 w-4 mr-2" />
          Trova Nuove Aziende
        </Button>
      </div>
    </div>
  );
}
