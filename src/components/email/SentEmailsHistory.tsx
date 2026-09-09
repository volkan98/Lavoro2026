import { requireUid } from '@/lib/api/client';
import { useState, useEffect } from 'react';
import { aiAgent } from '@/lib/api/ai-agent';
import { useCVContext } from '@/contexts/CVContext';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  History, 
  Search, 
  Filter, 
  Calendar,
  Building2,
  Mail,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowLeft,
  Trash2,
  RotateCcw,
  ExternalLink
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

interface SentEmail {
  id: string;
  company_name: string;
  email: string;
  domain: string;
  subject: string;
  status: string;
  sent_at: string;
  created_at: string;
}

export function SentEmailsHistory() {
  const { user } = useAuth();
  const { setCurrentStep } = useCVContext();
  const { toast } = useToast();
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [filteredEmails, setFilteredEmails] = useState<SentEmail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  const fetchSentEmails = async () => {
    setIsLoading(true);
    try {
      const activeUserId = requireUid(user?.id);
      const emails = await aiAgent.getSentEmails(activeUserId);
      const list = Array.isArray(emails) ? emails : [];
      setSentEmails(list);
      setFilteredEmails(list);
    } catch (error) {
      console.error('Error fetching sent emails:', error);
      setSentEmails([]);
      setFilteredEmails([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSentEmails();
  }, [user?.id]);

  // Filter emails when filters change
  useEffect(() => {
    let filtered = Array.isArray(sentEmails) ? [...sentEmails] : [];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(e => 
        (e.company_name || '').toLowerCase().includes(term) ||
        (e.email || '').toLowerCase().includes(term) ||
        (e.domain || '').toLowerCase().includes(term)
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
      
      filtered = filtered.filter(e => new Date(e.sent_at) >= filterDate);
    }

    setFilteredEmails(filtered);
  }, [sentEmails, searchTerm, statusFilter, dateFilter]);

  const handleDelete = async (id: string) => {
    try {
      const activeUserId = requireUid(user?.id);
      const res = await aiAgent.deleteSentEmail(id, activeUserId);
      if (!res.success) throw new Error(res.error);

      setSentEmails(prev => prev.filter(e => e.id !== id));
      toast({
        title: 'Rimosso',
        description: 'Il record è stato rimosso. Potrai reinviare a questo contatto.',
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
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground flex items-center justify-center gap-2">
          <History className="h-6 w-6 text-primary" />
          Email Già Inviate
        </h2>
        <p className="text-muted-foreground">
          Storico completo delle email inviate. Rimuovi i record per poter reinviare.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Totale inviate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{stats.sent}</p>
            <p className="text-sm text-muted-foreground">Inviate con successo</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-destructive">{stats.error}</p>
            <p className="text-sm text-muted-foreground">Errori</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-foreground">{stats.domains}</p>
            <p className="text-sm text-muted-foreground">Domini unici</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca azienda, email o dominio..."
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
              <Button variant="outline" size="icon" onClick={fetchSentEmails}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email List */}
      <div className="space-y-3">
        {isLoading ? (
          <Card className="p-8 text-center">
            <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Caricamento...</p>
          </Card>
        ) : filteredEmails.length === 0 ? (
          <Card className="p-8 text-center">
            <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {sentEmails.length === 0 
                ? 'Nessuna email inviata ancora.' 
                : 'Nessun risultato con i filtri selezionati.'}
            </p>
          </Card>
        ) : (
          filteredEmails.map(email => (
            <Card key={email.id} className="hover:bg-accent/30 transition-colors">
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
                          {email.company_name}
                        </h3>
                        <Badge variant="outline" className="text-xs">
                          {email.domain}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {email.email}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {email.subject}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">
                        {(() => {
                          try {
                            const d = new Date(email.sent_at);
                            return !isNaN(d.getTime()) ? d.toLocaleDateString('it-IT', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit',
                            }) : 'N/D';
                          } catch { return 'N/D'; }
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          try {
                            const d = new Date(email.sent_at);
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
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Rimuovere questo record?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Rimuovendo questo record potrai reinviare un'email a <strong>{email.email}</strong>.
                            L'azienda non sarà più bloccata.
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
