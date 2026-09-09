import { scopedStorageKey } from '@/lib/api/client';
import { requireUid } from '@/lib/api/client';
import { useState, useEffect, useCallback } from 'react';
import { useCVContext } from '@/contexts/CVContext';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { aiAgent, EmailTemplate as AIEmailTemplate } from '@/lib/api/ai-agent';
import { useEmailOAuth, EmailProvider } from '@/hooks/useEmailOAuth';
import { getVerifiedCvAttachment, StoredCVAttachment } from '@/lib/cvStorage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { 
  Mail, 
  Send, 
  RefreshCw, 
  ArrowLeft,
  ArrowRight,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Paperclip,
  User,
  Loader2,
  Sparkles,
  Ban,
  Copy,
  ExternalLink,
  History,
  Unlink,
  ShieldAlert,
  ShieldBan,
  Timer,
  Shield,
  FileText
} from 'lucide-react';
import { useBlacklist } from '@/lib/blacklist';
import { BlacklistModal } from '@/components/blacklist/BlacklistModal';

// Rimuove i tag HTML (es. <b>) per i client che mostrano solo testo semplice
const toPlainText = (value: string) =>
  (value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

type EmailStyle = 'breve' | 'standard' | 'formale';

interface LocalEmailTemplate {
  oggetto: string;
  corpo: string;
  firma: string;
  matchPoints?: string[];
}

export function EmailComposer() {
  const { user } = useAuth();
  const { cvData, cvFile, cvFileState, aziendeSelezionate, logInvii, addLogInvio, setCurrentStep } = useCVContext();
  const { profile } = useUserProfile();
  const { toast } = useToast();
  const { 
    connectedProviders, 
    isLoading: isOAuthLoading, 
    isConnecting,
    connect, 
    disconnect, 
    sendEmail: sendOAuthEmail, 
    isConnected, 
    getConnectedEmail,
    getActiveProvider 
  } = useEmailOAuth();
  
  const [emailStyle, setEmailStyle] = useState<EmailStyle>('standard');
  const [currentEmail, setCurrentEmail] = useState<LocalEmailTemplate | null>(null);
  const [selectedAziendaId, setSelectedAziendaId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachCV, setAttachCV] = useState(true);
  const [isBlacklistModalOpen, setIsBlacklistModalOpen] = useState(false);
  const { isBlacklisted, addToBlacklist, removeFromBlacklist, blacklist } = useBlacklist();
  const [verifiedCv, setVerifiedCv] = useState<{
    status: 'idle' | 'checking' | 'ready' | 'error';
    attachment?: StoredCVAttachment;
    error?: string;
  }>({ status: 'idle' });

  // Monitor and verify CV file attachment readiness
  useEffect(() => {
    let isCancelled = false;
    const verifyCv = async () => {
      setVerifiedCv(prev => ({ ...prev, status: 'checking' }));
      try {
        const res = await getVerifiedCvAttachment(cvFileState, cvData, profile);
        if (isCancelled) return;
        if (res.ok) {
          setVerifiedCv({
            status: 'ready',
            attachment: res.attachment,
          });
        } else {
          setVerifiedCv({
            status: 'error',
            error: res.error,
          });
        }
      } catch (err: any) {
        if (!isCancelled) {
          setVerifiedCv({
            status: 'error',
            error: err?.message || 'Errore verifica CV',
          });
        }
      }
    };

    verifyCv();
    return () => {
      isCancelled = true;
    };
  }, [cvFileState, cvData, profile]);

  const [duplicateWarning, setDuplicateWarning] = useState<{
    isDuplicate: boolean;
    type?: string;
    lastDate?: string;
    originalCompany?: string;
  } | null>(null);

  // Anti-spam tracking
  const GMAIL_HOURLY_LIMIT = 15;
  const GMAIL_DAILY_LIMIT = 80;
  const COOLDOWN_MINUTES = 10; // Pausa consigliata dopo X email
  const COOLDOWN_THRESHOLD = 8; // Dopo quante email suggerire pausa
  
  const [sendTimestamps, setSendTimestamps] = useState<number[]>(() => {
    const saved = localStorage.getItem(scopedStorageKey('email_send_timestamps'));
    return saved ? JSON.parse(saved) : [];
  });
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(() => {
    const saved = localStorage.getItem(scopedStorageKey('email_cooldown_until'));
    return saved ? Number(saved) : null;
  });
  const [cooldownDismissed, setCooldownDismissed] = useState(false);

  // Clean old timestamps and persist
  useEffect(() => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const cleaned = sendTimestamps.filter(t => t > oneDayAgo);
    if (cleaned.length !== sendTimestamps.length) {
      setSendTimestamps(cleaned);
    }
    localStorage.setItem(scopedStorageKey('email_send_timestamps'), JSON.stringify(cleaned));
  }, [sendTimestamps]);

  useEffect(() => {
    if (cooldownUntil) {
      localStorage.setItem(scopedStorageKey('email_cooldown_until'), String(cooldownUntil));
    } else {
      localStorage.removeItem(scopedStorageKey('email_cooldown_until'));
    }
  }, [cooldownUntil]);

  const getHourlySentCount = useCallback(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return sendTimestamps.filter(t => t > oneHourAgo).length;
  }, [sendTimestamps]);

  const getDailySentCount = useCallback(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return sendTimestamps.filter(t => t > oneDayAgo).length;
  }, [sendTimestamps]);

  const getSessionSentCount = useCallback(() => {
    // Count sent in the last burst (consecutive sends within 2 min gaps)
    const now = Date.now();
    let count = 0;
    const sorted = [...sendTimestamps].sort((a, b) => b - a);
    for (const t of sorted) {
      if (now - t < 60 * 60 * 1000) count++;
      else break;
    }
    return count;
  }, [sendTimestamps]);

  const isCooldownActive = cooldownUntil && Date.now() < cooldownUntil && !cooldownDismissed;
  const hourlySent = getHourlySentCount();
  const dailySent = getDailySentCount();
  const hourlyProgress = (hourlySent / GMAIL_HOURLY_LIMIT) * 100;
  const isNearLimit = hourlySent >= GMAIL_HOURLY_LIMIT - 3;
  const isAtLimit = hourlySent >= GMAIL_HOURLY_LIMIT;
  const shouldSuggestCooldown = hourlySent >= COOLDOWN_THRESHOLD && !isCooldownActive;
  
  const getSpamRiskLevel = (): 'safe' | 'caution' | 'warning' | 'danger' | 'blocked' => {
    if (isAtLimit) return 'blocked';
    if (hourlySent >= GMAIL_HOURLY_LIMIT - 2) return 'danger';
    if (hourlySent >= GMAIL_HOURLY_LIMIT - 5) return 'warning';
    if (hourlySent >= 5) return 'caution';
    return 'safe';
  };

  const spamRisk = getSpamRiskLevel();
  
  const recordSend = () => {
    const now = Date.now();
    setSendTimestamps(prev => [...prev, now]);
    
    // Auto-cooldown after threshold
    if (hourlySent + 1 >= COOLDOWN_THRESHOLD) {
      setCooldownUntil(now + COOLDOWN_MINUTES * 60 * 1000);
      setCooldownDismissed(false);
    }
  };

  // Cooldown timer
  const [cooldownRemaining, setCooldownRemaining] = useState('');
  useEffect(() => {
    if (!cooldownUntil || cooldownDismissed) return;
    const interval = setInterval(() => {
      const remaining = cooldownUntil - Date.now();
      if (remaining <= 0) {
        setCooldownUntil(null);
        setCooldownRemaining('');
      } else {
        const min = Math.floor(remaining / 60000);
        const sec = Math.floor((remaining % 60000) / 1000);
        setCooldownRemaining(`${min}:${sec.toString().padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil, cooldownDismissed]);

  const selectedAzienda = aziendeSelezionate.find(a => a.id === selectedAziendaId);

  // Check for duplicates when selecting a company
  useEffect(() => {
    const checkDuplicate = async () => {
      if (!selectedAzienda?.email) {
        setDuplicateWarning(null);
        return;
      }

      const result = await aiAgent.checkDuplicate(
        selectedAzienda.email,
        selectedAzienda.nome,
        true
      );

      if (result.isDuplicate) {
        setDuplicateWarning({
          isDuplicate: true,
          type: result.duplicateType,
          lastDate: result.lastSentDate,
          originalCompany: result.originalCompany,
        });
      } else {
        setDuplicateWarning(null);
      }
    };

    checkDuplicate();
  }, [selectedAzienda]);

  // Set first company as selected
  useEffect(() => {
    if (aziendeSelezionate.length > 0 && !selectedAziendaId) {
      setSelectedAziendaId(aziendeSelezionate[0].id);
    }
  }, [aziendeSelezionate, selectedAziendaId]);

  // Generate email when company or style changes
  const handleGenerateEmail = async () => {
    if (!cvData || !selectedAzienda) return;

    setIsGenerating(true);
    
    try {
      const company = {
        name: selectedAzienda.nome,
        sector: selectedAzienda.settore,
        city: selectedAzienda.citta,
        website: selectedAzienda.sito,
      };

      const result = await aiAgent.generateEmail(
        company,
        {
          nome: cvData.nome,
          cognome: cvData.cognome,
          email: cvData.email,
          telefono: cvData.telefono,
          citta: cvData.citta,
          cap: cvData.cap,
          profilo: cvData.profilo,
          competenze: cvData.competenze,
          esperienze: cvData.esperienze,
          istruzione: cvData.istruzione,
          lingue: cvData.lingue,
          statoPermesso: cvData.statoPermesso,
          permessoG: cvData.permessoG,
          sintesiBreve: cvData.sintesiBreve,
          sintesiCompleta: cvData.sintesiCompleta,
        },
        emailStyle,
        undefined,
        ''
      );

      if (result.data) {
        setCurrentEmail({
          oggetto: result.data.oggetto,
          corpo: result.data.corpo,
          firma: result.data.firma,
          matchPoints: result.data.matchPoints,
        });

        toast({
          title: 'Email generata!',
          description: `Email ${emailStyle} personalizzata per ${selectedAzienda.nome}`,
        });
      }
    } catch (error: any) {
      console.warn('Notice in generating email:', error);
      // Factual, concise fallback template (100-160 words, clean signature on separate lines)
      const fullName = [cvData.nome, cvData.cognome].filter(Boolean).join(' ') || profile?.full_name || '';
      const role = cvData.profilo || profile?.title || '';
      const city = cvData.citta || profile?.city || '';
      const phone = cvData.telefono || profile?.phone || '';
      const email = cvData.email || profile?.email || '';

      const fallbackCorpo = `Gentile Responsabile delle Risorse Umane di <b>${selectedAzienda.nome}</b>,<br><br>desidero sottoporre la mia candidatura spontanea per il vostro organico a ${selectedAzienda.citta || 'sede'}.<br><br>Opero come <b>${role}</b>${cvData.competenze && cvData.competenze.length > 0 ? ` con competenze in ${cvData.competenze.slice(0, 3).join(', ')}` : ''}.<br><br>In allegato trasmetto il mio Curriculum Vitae aggiornato per una vostra valutazione. Resto a completa disposizione per un colloquio conoscitivo.<br><br>Cordiali saluti,`;

      const fallbackFirma = [
        fullName,
        role,
        email ? `Email: ${email}` : '',
        phone ? `Tel: ${phone}` : '',
        city ? `Località: ${city}` : '',
      ].filter(Boolean).join('\n');

      setCurrentEmail({
        oggetto: `Candidatura spontanea – ${role} – ${fullName}`,
        corpo: fallbackCorpo,
        firma: fallbackFirma,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Reset email and auto-generate when company changes
  useEffect(() => {
    if (selectedAzienda && cvData) {
      setCurrentEmail(null);
      handleGenerateEmail();
    }
  }, [selectedAziendaId, emailStyle]);

  const handleConnectEmail = async (provider: EmailProvider) => {
    await connect(provider);
  };

  // Pre-send validation criteria
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isDestinatarioOk = Boolean(selectedAzienda?.email && emailRegex.test(selectedAzienda.email.trim()));
  const isOggettoOk = Boolean(currentEmail?.oggetto && currentEmail.oggetto.trim().length > 0);
  const plainCorpo = currentEmail?.corpo ? toPlainText(currentEmail.corpo).trim() : '';
  const wordCount = plainCorpo ? plainCorpo.split(/\s+/).filter(Boolean).length : 0;
  const isCorpoOk = Boolean(plainCorpo.length >= 25 && wordCount >= 30);
  const plainFirma = currentEmail?.firma ? currentEmail.firma.trim() : '';
  const isFirmaOk = Boolean(plainFirma.length >= 5);
  const isCvAttachmentOk = attachCV ? (verifiedCv.status === 'ready' && !!verifiedCv.attachment?.base64) : true;
  const isCurrentCompanyBlacklisted = selectedAzienda?.email ? isBlacklisted(selectedAzienda.email).isBlacklisted : false;
  const currentBlacklistReason = selectedAzienda?.email ? isBlacklisted(selectedAzienda.email).reason : undefined;
  const isPreSendValid = isDestinatarioOk && isOggettoOk && isCorpoOk && isFirmaOk && isCvAttachmentOk && !isCurrentCompanyBlacklisted;

  const handleSendEmail = async () => {
    if (!selectedAzienda || !currentEmail) return;

    // 0. Verifica Blacklist
    const blacklistCheck = isBlacklisted(selectedAzienda.email);
    if (blacklistCheck.isBlacklisted) {
      toast({
        title: 'Invio bloccato dalla Blacklist',
        description: `Impossibile inviare: ${blacklistCheck.reason || 'questo indirizzo o dominio è presente nella Blacklist'}.`,
        variant: 'destructive',
      });
      return;
    }

    // 1. Destinatario valido
    if (!selectedAzienda.email || !emailRegex.test(selectedAzienda.email.trim())) {
      toast({
        title: 'Destinatario non valido',
        description: 'L\'indirizzo email dell\'azienda destinataria non è valido o è mancante.',
        variant: 'destructive',
      });
      return;
    }

    // 2. Oggetto non vuoto
    if (!currentEmail.oggetto || !currentEmail.oggetto.trim()) {
      toast({
        title: 'Oggetto mancante',
        description: 'L\'email richiede un oggetto non vuoto prima di poter essere inviata.',
        variant: 'destructive',
      });
      return;
    }

    // 3. Corpo dell'email valido
    const plainTextBody = toPlainText(currentEmail.corpo).trim();
    if (!plainTextBody || plainTextBody.length < 20) {
      toast({
        title: 'Corpo email non valido',
        description: 'Il corpo dell\'email è troppo breve o vuoto.',
        variant: 'destructive',
      });
      return;
    }

    // 4. Firma con i dati del candidato
    if (!currentEmail.firma || currentEmail.firma.trim().length < 5) {
      toast({
        title: 'Firma mancante',
        description: 'La firma del candidato con i contatti è obbligatoria.',
        variant: 'destructive',
      });
      return;
    }

    // 5. Verifica e allegato CV (TASSATIVO)
    let attachmentPayload = verifiedCv.attachment;
    if (!attachmentPayload) {
      // Tentativo di recupero o generazione istantanea dal profilo
      const checkRes = await getVerifiedCvAttachment(cvFileState, cvData, profile);
      if (checkRes.ok && checkRes.attachment) {
        attachmentPayload = checkRes.attachment;
      }
    }

    if (!attachmentPayload || !attachmentPayload.base64 || attachmentPayload.base64.length < 50) {
      toast({
        title: 'Invio bloccato',
        description: 'Impossibile inviare la candidatura: il CV non è stato allegato correttamente.',
        variant: 'destructive',
      });
      return;
    }

    const activeProvider = getActiveProvider();
    if (!activeProvider) {
      toast({
        title: 'Account non connesso',
        description: 'Connetti Gmail o Outlook per inviare email.',
        variant: 'destructive',
      });
      return;
    }

    if (duplicateWarning?.isDuplicate) {
      const formattedDate = duplicateWarning.lastDate ? (() => {
        try {
          const d = new Date(duplicateWarning.lastDate);
          return !isNaN(d.getTime()) ? ` il ${d.toLocaleDateString('it-IT')}` : '';
        } catch { return ''; }
      })() : '';
      toast({
        title: 'Attenzione',
        description: `Hai già contattato questa azienda${formattedDate}`,
        variant: 'destructive',
      });
      return;
    }
    
    setIsSending(true);
    
    try {
      // Signature with proper line-breaks for HTML email so lines don't get squashed
      const formattedFirmaHtml = currentEmail.firma
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('<br>');
      const fullBodyHtml = `${currentEmail.corpo}<br><br>${formattedFirmaHtml}`;

      const result = await sendOAuthEmail(
        activeProvider,
        selectedAzienda.email,
        currentEmail.oggetto,
        fullBodyHtml,
        attachmentPayload.filename,
        {
          filename: attachmentPayload.filename,
          mimeType: attachmentPayload.mimeType || 'application/pdf',
          base64: attachmentPayload.base64,
        }
      );

      if (!result.success) {
        throw new Error(result.error);
      }

      // Record the sent email in database
      await aiAgent.recordSentEmail(
        null,
        selectedAzienda.nome,
        selectedAzienda.email,
        currentEmail.oggetto,
        fullBodyHtml,
        'v1',
        requireUid(user?.id)
      );

      // Track for anti-spam
      recordSend();
      addLogInvio({
        id: Date.now().toString(),
        data: new Date(),
        destinatario: selectedAzienda.nome,
        emailDestinatario: selectedAzienda.email,
        oggetto: currentEmail.oggetto,
        stato: 'inviato',
      });

      toast({
        title: 'Candidatura inviata con successo!',
        description: activeProvider === 'gmail' 
          ? `L'email con il CV allegato (${attachmentPayload.filename}) è stata spedita a ${selectedAzienda.nome} (${selectedAzienda.email}) dal tuo account Gmail. La trovi nella cartella Posta Inviata!`
          : `Email inviata a ${selectedAzienda.nome} tramite Outlook con CV allegato.`,
      });
      
      // Move to next company
      const currentIndex = aziendeSelezionate.findIndex(a => a.id === selectedAziendaId);
      if (currentIndex < aziendeSelezionate.length - 1) {
        setSelectedAziendaId(aziendeSelezionate[currentIndex + 1].id);
        setCurrentEmail(null); // Reset to trigger new generation
      }
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast({
        title: 'Errore invio',
        description: error.message || 'Impossibile inviare l\'email.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  if (!cvData) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Nessun CV caricato.</p>
        <Button onClick={() => setCurrentStep(0)} className="mt-4">
          Carica CV
        </Button>
      </div>
    );
  }

  if (aziendeSelezionate.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Nessuna azienda selezionata.</p>
        <Button onClick={() => setCurrentStep(2)} className="mt-4">
          Trova Aziende
        </Button>
      </div>
    );
  }

  const sentCount = logInvii.filter(l => l.stato === 'inviato').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-center sm:text-left space-y-1">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground flex items-center justify-center sm:justify-start gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            AI Email Personalizzate
          </h2>
          <p className="text-muted-foreground text-sm">
            L'AI genera email uniche per ogni azienda basate sul tuo CV
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsBlacklistModalOpen(true)}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 shrink-0 h-9"
          title="Gestisci la Blacklist delle aziende escluse"
        >
          <ShieldBan className="h-4 w-4 mr-1.5" />
          Blacklist ({blacklist.length})
        </Button>
      </div>

      {/* Email Connection */}
      {isConnecting && (
        <Alert className="bg-primary/5 border-primary/20">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
          <AlertDescription>
            Connessione in corso...
          </AlertDescription>
        </Alert>
      )}

      {!isConnecting && connectedProviders.length === 0 && (
        <Alert className="bg-primary/5 border-primary/20">
          <Mail className="h-4 w-4 text-primary" />
          <AlertDescription>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <span>Collega il tuo account email per inviare direttamente dall'app</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => handleConnectEmail('gmail')} disabled={isOAuthLoading}>
                  {isOAuthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connetti Gmail'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleConnectEmail('outlook')} disabled={isOAuthLoading}>
                  {isOAuthLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connetti Outlook'}
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!isConnecting && connectedProviders.length > 0 && (
        <Alert className="bg-green-500/10 border-green-500/30">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <span className="text-green-700">
                Connesso a {(connectedProviders || []).map(p => 
                  `${p.provider === 'gmail' ? 'Gmail' : 'Outlook'} (${p.email})`
                ).join(', ')}. 
                Inviate: {sentCount} / Rimanenti: {Math.max(0, (aziendeSelezionate || []).length - sentCount)}
              </span>
              <div className="flex gap-2">
                {(connectedProviders || []).map(p => (
                  <Button 
                    key={p.provider}
                    size="sm" 
                    variant="outline" 
                    onClick={() => disconnect(p.provider as EmailProvider)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Unlink className="h-4 w-4 mr-1" />
                    Disconnetti {p.provider === 'gmail' ? 'Gmail' : 'Outlook'}
                  </Button>
                ))}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Company List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Aziende ({(aziendeSelezionate || []).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[400px]">
              <div className="space-y-1 p-4">
                {(aziendeSelezionate || []).map(azienda => {
                  const sentLog = (logInvii || []).find(l => l.emailDestinatario === azienda.email);
                  const isSelected = azienda.id === selectedAziendaId;
                  
                  return (
                    <button
                      key={azienda.id}
                      onClick={() => {
                        setSelectedAziendaId(azienda.id);
                        setCurrentEmail(null);
                      }}
                      className={`w-full text-left p-3 rounded-lg transition-all ${
                        isSelected 
                          ? 'bg-primary/10 border border-primary' 
                          : 'hover:bg-accent border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {azienda.nome}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {azienda.email}
                          </p>
                        </div>
                        {sentLog && (
                          <Badge 
                            variant={sentLog.stato === 'inviato' ? 'default' : 'destructive'}
                            className="shrink-0 ml-2"
                          >
                            {sentLog.stato === 'inviato' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Email Editor */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Email AI
              </CardTitle>
              <Tabs value={emailStyle} onValueChange={v => {
                setEmailStyle(v as EmailStyle);
                setCurrentEmail(null);
              }}>
                <TabsList>
                  <TabsTrigger value="breve">Breve</TabsTrigger>
                  <TabsTrigger value="standard">Standard</TabsTrigger>
                  <TabsTrigger value="formale">Formale</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {duplicateWarning?.isDuplicate && (
              <Alert variant="destructive">
                <Ban className="h-4 w-4" />
                <AlertDescription>
                  <strong>Già contattata!</strong> Hai inviato a {duplicateWarning.type === 'exact_email' ? 'questa email' : 'questo dominio'} 
                  {duplicateWarning.lastDate && (() => {
                    try {
                      const d = new Date(duplicateWarning.lastDate);
                      return !isNaN(d.getTime()) ? ` il ${d.toLocaleDateString('it-IT')}` : '';
                    } catch { return ''; }
                  })()}
                  {duplicateWarning.originalCompany && ` (${duplicateWarning.originalCompany})`}
                </AlertDescription>
              </Alert>
            )}

            {selectedAzienda && (
              <>
                <div className="flex items-center gap-2 p-3 bg-accent rounded-lg">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">A:</span>
                  <span className="font-medium">{selectedAzienda.email}</span>
                  <Badge variant="secondary" className="ml-auto">
                    {selectedAzienda.settore}
                  </Badge>
                </div>

                {isGenerating ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-muted-foreground">L'AI sta generando un'email personalizzata...</p>
                  </div>
                ) : currentEmail ? (
                  <>
                    {Array.isArray(currentEmail.matchPoints) && currentEmail.matchPoints.length > 0 && (
                      <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                        <p className="text-sm font-medium text-green-700 mb-2">Punti di match trovati:</p>
                        <div className="flex flex-wrap gap-2">
                          {currentEmail.matchPoints.map((point, i) => (
                            <Badge key={i} variant="outline" className="text-green-700 border-green-500/50">
                              ✓ {point}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">
                        Oggetto
                      </label>
                      <Input
                        value={currentEmail.oggetto}
                        onChange={e => setCurrentEmail({ ...currentEmail, oggetto: e.target.value })}
                      />
                    </div>

                    {/* Email Visual Preview Card */}
                    <div className="rounded-lg border bg-card p-4 space-y-3 font-sans shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">Destinatario:</span>
                          <span className="font-medium text-foreground">{selectedAzienda.email}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[11px]">
                            {wordCount} parole
                          </Badge>
                          {wordCount >= 100 && wordCount <= 160 ? (
                            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[11px]">
                              ✓ Lunghezza ottimale (100-160 parole)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-400 text-[11px]">
                              {wordCount < 100 ? 'Email breve' : 'Email più lunga di 160 parole'}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                          Oggetto dell'email
                        </label>
                        <Input
                          value={currentEmail.oggetto}
                          onChange={e => setCurrentEmail({ ...currentEmail, oggetto: e.target.value })}
                          className="font-medium text-sm"
                          placeholder="Inserisci l'oggetto dell'email..."
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Anteprima Corpo Email
                          </label>
                          <Badge variant="outline" className="text-[10px]">HTML</Badge>
                        </div>
                        <div 
                          className="min-h-[140px] p-3.5 border rounded-md bg-muted/20 text-sm leading-relaxed text-foreground"
                          dangerouslySetInnerHTML={{ 
                            __html: currentEmail.corpo
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/&lt;b&gt;/g, '<b>')
                              .replace(/&lt;\/b&gt;/g, '</b>')
                              .replace(/\n/g, '<br>')
                          }}
                        />
                        <Textarea
                          value={currentEmail.corpo}
                          onChange={e => setCurrentEmail({ ...currentEmail, corpo: e.target.value })}
                          rows={4}
                          className="font-sans text-xs mt-1.5"
                          placeholder="Modifica il testo o codice sorgente dell'email..."
                        />
                      </div>

                      {/* Clean Signature on Separate Lines */}
                      <div className="space-y-1 border-t pt-3">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                          Firma del candidato (righe separate e formattazione pulita)
                        </label>
                        <div className="p-3 bg-muted/30 border rounded-md text-xs space-y-1 text-foreground">
                          {currentEmail.firma.split('\n').filter(Boolean).map((line, idx) => (
                            <div key={idx} className={idx === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                              {line}
                            </div>
                          ))}
                        </div>
                        <Textarea
                          value={currentEmail.firma}
                          onChange={e => setCurrentEmail({ ...currentEmail, firma: e.target.value })}
                          rows={4}
                          className="text-xs mt-1.5"
                          placeholder="Firma candidato su righe separate..."
                        />
                      </div>

                      {/* CV Attachment Status Card */}
                      <div className="border-t pt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg bg-accent/40 border">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Paperclip className="h-4 w-4 text-primary shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">Allegato Curriculum Vitae</span>
                              {verifiedCv.status === 'ready' && verifiedCv.attachment ? (
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-xs">
                                  ✓ Pronto per l'invio
                                </Badge>
                              ) : verifiedCv.status === 'checking' ? (
                                <Badge variant="secondary" className="text-xs">
                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  Verifica file...
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">
                                  Non allegabile
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {verifiedCv.attachment ? `${verifiedCv.attachment.filename} (${Math.round((verifiedCv.attachment.base64.length * 0.75) / 1024)} KB)` : 'Nessun file CV pronto per l\'allegato'}
                            </p>
                          </div>
                        </div>

                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={attachCV && verifiedCv.status === 'ready'}
                            disabled={verifiedCv.status !== 'ready'}
                            onChange={(e) => setAttachCV(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-background after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                        </label>
                      </div>
                    </div>

                    {/* Pre-Send Validation Checklist */}
                    <div className="rounded-lg border bg-muted/25 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Shield className="h-3.5 w-3.5 text-primary" />
                          Validazione Prima dell'Invio
                        </span>
                        <Badge 
                          variant={isPreSendValid ? 'default' : 'secondary'} 
                          className={isPreSendValid ? 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs' : 'text-xs'}
                        >
                          {isPreSendValid ? '✓ Tutti i 5 requisiti soddisfatti' : 'Verifica requisiti in corso'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {/* 1. Destinatario */}
                        <div className={`flex items-center gap-2 p-2 rounded-md border ${isDestinatarioOk ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                          {isDestinatarioOk ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                          <span className="truncate">Destinatario: {selectedAzienda.email}</span>
                        </div>

                        {/* 2. Oggetto */}
                        <div className={`flex items-center gap-2 p-2 rounded-md border ${isOggettoOk ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                          {isOggettoOk ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                          <span className="truncate">Oggetto: {currentEmail.oggetto ? 'Definito' : 'Vuoto'}</span>
                        </div>

                        {/* 3. Corpo email */}
                        <div className={`flex items-center gap-2 p-2 rounded-md border ${isCorpoOk ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                          {isCorpoOk ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                          <span className="truncate">Corpo email: {wordCount} parole {wordCount >= 100 && wordCount <= 160 ? '(ottimale)' : ''}</span>
                        </div>

                        {/* 4. Firma candidato */}
                        <div className={`flex items-center gap-2 p-2 rounded-md border ${isFirmaOk ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                          {isFirmaOk ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                          <span className="truncate">Firma candidato: {isFirmaOk ? 'Presente' : 'Mancante'}</span>
                        </div>

                        {/* 5. CV allegato */}
                        <div className={`flex items-center gap-2 p-2 rounded-md border sm:col-span-2 ${isCvAttachmentOk ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                          {isCvAttachmentOk ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                          <span className="truncate">
                            CV allegato: {verifiedCv.attachment ? `${verifiedCv.attachment.filename} (${Math.round((verifiedCv.attachment.base64.length * 0.75) / 1024)} KB) allegato` : 'Non allegato o mancante'}
                          </span>
                        </div>
                      </div>

                      {!isPreSendValid && (
                        <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>
                            L'invio è bloccato finché tutti i requisiti obbligatori non risultano verificati.
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Send Email Button - OAuth */}
                    {connectedProviders.length > 0 && (
                      <Button 
                        className="w-full text-base py-5"
                        onClick={handleSendEmail}
                        disabled={isSending || duplicateWarning?.isDuplicate || isAtLimit || !isPreSendValid}
                      >
                        {isSending ? (
                          <>
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            Invio candidatura in corso...
                          </>
                        ) : (
                          <>
                            <Send className="h-5 w-5 mr-2" />
                            Invia Candidatura tramite {getActiveProvider() === 'gmail' ? 'Gmail' : 'Outlook'}
                          </>
                        )}
                      </Button>
                    )}

                    {/* Copy / Mailto buttons */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          const fullEmail = toPlainText(`${currentEmail.corpo}\n\n${currentEmail.firma}`);
                          navigator.clipboard.writeText(fullEmail);
                          toast({
                            title: 'Copiato!',
                            description: 'Email copiata negli appunti. Incollala nel tuo client.',
                          });
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copia Email
                      </Button>
                      
                      <Button
                        variant="outline"
                        onClick={() => {
                          const subject = encodeURIComponent(toPlainText(currentEmail.oggetto));
                          const body = encodeURIComponent(toPlainText(`${currentEmail.corpo}\n\n${currentEmail.firma}`));
                          window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${selectedAzienda?.email}&su=${subject}&body=${body}`, '_blank');
                        }}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Apri Gmail
                      </Button>
                      
                      <Button
                        variant="outline"
                        onClick={() => {
                          const subject = encodeURIComponent(toPlainText(currentEmail.oggetto));
                          const body = encodeURIComponent(toPlainText(`${currentEmail.corpo}\n\n${currentEmail.firma}`));
                          window.open(`mailto:${selectedAzienda?.email}?subject=${subject}&body=${body}`, '_blank');
                        }}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Apri Client Email
                      </Button>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <Button variant="outline" onClick={handleGenerateEmail} disabled={isGenerating}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                        Rigenera
                      </Button>
                      <Button 
                        className="flex-1"
                        onClick={async () => {
                          // Mark as sent manually
                          if (!selectedAzienda?.email || !currentEmail) return;
                          
                          setIsSending(true);
                          try {
                            await aiAgent.recordSentEmail(
                              null,
                              selectedAzienda.nome,
                              selectedAzienda.email,
                              currentEmail.oggetto,
                              currentEmail.corpo,
                              'manual',
                              requireUid(user?.id)
                            );

                            // Track for anti-spam
                            recordSend();

                            addLogInvio({
                              id: Date.now().toString(),
                              data: new Date(),
                              destinatario: selectedAzienda.nome,
                              emailDestinatario: selectedAzienda.email,
                              oggetto: currentEmail.oggetto,
                              stato: 'inviato',
                            });

                            toast({
                              title: 'Marcato come inviato!',
                              description: `${selectedAzienda.nome} aggiunto alla lista "Già inviato".`,
                            });
                            
                            // Move to next company
                            const currentIndex = aziendeSelezionate.findIndex(a => a.id === selectedAziendaId);
                            if (currentIndex < aziendeSelezionate.length - 1) {
                              setSelectedAziendaId(aziendeSelezionate[currentIndex + 1].id);
                              setCurrentEmail(null);
                            }
                          } catch (error: any) {
                            toast({
                              title: 'Errore',
                              description: error.message,
                              variant: 'destructive',
                            });
                          } finally {
                            setIsSending(false);
                          }
                        }}
                        disabled={isSending || duplicateWarning?.isDuplicate}
                      >
                        {isSending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Salvataggio...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Marca come Inviato
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <Button onClick={handleGenerateEmail}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Genera Email AI
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Send History */}
      {logInvii.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Storico Invii ({logInvii.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logInvii.slice(0, 5).map(log => (
                <div 
                  key={log.id} 
                  className="flex items-center justify-between p-3 bg-accent/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {log.stato === 'inviato' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    <div>
                      <p className="font-medium text-foreground">{log.destinatario}</p>
                      <p className="text-xs text-muted-foreground">{log.emailDestinatario}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {(() => {
                        try {
                          const dateObj = typeof log.data === 'string' ? new Date(log.data) : log.data;
                          return dateObj instanceof Date && !isNaN(dateObj.getTime())
                            ? dateObj.toLocaleDateString('it-IT', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Recente';
                        } catch (e) {
                          return 'Recente';
                        }
                      })()}
                    </p>
                    <Badge variant={log.stato === 'inviato' ? 'default' : 'destructive'}>
                      {log.stato}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 🛡️ Anti-Spam Gmail Alert */}
      <Card className={`border-2 ${
        spamRisk === 'blocked' ? 'border-destructive bg-destructive/5' :
        spamRisk === 'danger' ? 'border-orange-500 bg-orange-500/5' :
        spamRisk === 'warning' ? 'border-yellow-500 bg-yellow-500/5' :
        'border-green-500/30 bg-green-500/5'
      }`}>
        <CardContent className="pt-5 pb-4 space-y-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className={`h-5 w-5 ${
              spamRisk === 'blocked' ? 'text-destructive' :
              spamRisk === 'danger' ? 'text-orange-500' :
              spamRisk === 'warning' ? 'text-yellow-600' :
              'text-green-600'
            }`} />
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">
                Protezione Anti-Spam Gmail
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {spamRisk === 'blocked' 
                  ? '⛔ Limite orario raggiunto! Attendi prima di inviare altre email.'
                  : spamRisk === 'danger'
                  ? '🔴 Quasi al limite! Rallenta gli invii per evitare blocchi.'
                  : spamRisk === 'warning'
                  ? '🟡 Attenzione: stai inviando molte email. Considera una pausa.'
                  : spamRisk === 'caution'
                  ? '🟢 Ritmo ok, ma monitora il contatore.'
                  : '✅ Tutto in regola. Invii sicuri.'}
              </p>
            </div>
            <Badge variant={spamRisk === 'blocked' || spamRisk === 'danger' ? 'destructive' : 'secondary'}>
              {hourlySent}/{GMAIL_HOURLY_LIMIT} /ora
            </Badge>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Invii ultima ora</span>
              <span>{hourlySent} di {GMAIL_HOURLY_LIMIT} (giornaliere: {dailySent}/{GMAIL_DAILY_LIMIT})</span>
            </div>
            <Progress 
              value={Math.min(hourlyProgress, 100)} 
              className={`h-2.5 ${
                spamRisk === 'blocked' ? '[&>div]:bg-destructive' :
                spamRisk === 'danger' ? '[&>div]:bg-orange-500' :
                spamRisk === 'warning' ? '[&>div]:bg-yellow-500' :
                '[&>div]:bg-green-500'
              }`}
            />
          </div>

          {/* Cooldown suggestion */}
          {isCooldownActive && (
            <Alert className="bg-orange-500/10 border-orange-500/30">
              <Timer className="h-4 w-4 text-orange-500" />
              <AlertDescription className="flex items-center justify-between">
                <span className="text-sm">
                  <strong>Pausa consigliata:</strong> attendi {cooldownRemaining} prima di continuare per evitare il blocco Gmail.
                </span>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => setCooldownDismissed(true)}
                  className="shrink-0 ml-2 text-xs"
                >
                  Ignora
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {isAtLimit && (
            <Alert variant="destructive">
              <Ban className="h-4 w-4" />
              <AlertTitle>Invio bloccato</AlertTitle>
              <AlertDescription>
                Hai raggiunto il limite di {GMAIL_HOURLY_LIMIT} email/ora. 
                Attendi che il contatore si resetti per evitare che Gmail blocchi il tuo account.
              </AlertDescription>
            </Alert>
          )}

          {/* Tips */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Email singole (no CC/BCC)
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Pausa auto ogni {COOLDOWN_THRESHOLD} email
            </div>
            <div className="flex items-center gap-1.5">
              <Ban className="h-3.5 w-3.5" />
              Blocco duplicati attivo
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep(2)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Modifica Aziende
        </Button>
        <Button variant="outline" onClick={() => setCurrentStep(4)}>
          <History className="h-4 w-4 mr-2" />
          Vedi Già Inviato
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
