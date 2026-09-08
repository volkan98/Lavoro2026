import { useState, useId, FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useBlacklist } from '@/lib/blacklist';
import {
  ShieldBan,
  Search,
  Plus,
  Trash2,
  Globe,
  Mail,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

interface BlacklistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPattern?: string;
}

export function BlacklistModal({ open, onOpenChange, initialPattern }: BlacklistModalProps) {
  const { toast } = useToast();
  const {
    blacklist,
    searchQuery,
    setSearchQuery,
    filteredBlacklist,
    addToBlacklist,
    removeFromBlacklist,
  } = useBlacklist();

  const [inputPattern, setInputPattern] = useState(initialPattern || '');
  const [inputNotes, setInputNotes] = useState('');
  const [selectedType, setSelectedType] = useState<'auto' | 'email' | 'domain'>('auto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const patternInputId = useId();
  const notesInputId = useId();
  const searchInputId = useId();

  // Auto detect type based on input
  const detectedType = (() => {
    if (selectedType !== 'auto') return selectedType;
    const clean = inputPattern.trim().toLowerCase();
    if (clean.includes('@') && !clean.startsWith('@')) return 'email';
    return 'domain';
  })();

  const handleAdd = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!inputPattern.trim()) {
      toast({
        title: 'Campo obbligatorio',
        description: 'Inserisci un indirizzo email o un dominio da bloccare.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await addToBlacklist(inputPattern, inputNotes);
      if (res.success) {
        if (res.alreadyExisted) {
          toast({
            title: 'Già presente',
            description: `"${res.entry?.pattern}" è già presente nella Blacklist.`,
          });
        } else {
          toast({
            title: 'Regola aggiunta alla Blacklist',
            description: `${res.entry?.type === 'domain' ? 'Dominio' : 'Email'} "${res.entry?.pattern}" bloccato. Non riceverà candidature.`,
          });
          setInputPattern('');
          setInputNotes('');
        }
      } else {
        toast({
          title: 'Errore',
          description: 'Impossibile aggiungere la regola.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (id: string, pattern: string) => {
    await removeFromBlacklist(id);
    toast({
      title: 'Regola rimossa',
      description: `"${pattern}" è stato sbloccato dalla Blacklist.`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-4 sm:p-6 w-[95vw] sm:w-full">
        <DialogHeader className="space-y-1.5 pb-2 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-destructive/10 text-destructive rounded-lg shrink-0">
              <ShieldBan className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                Blacklist Email & Domini
                <Badge variant="secondary" className="text-xs font-mono">
                  {blacklist.length} {blacklist.length === 1 ? 'regola' : 'regole'}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Gli indirizzi o domini in lista non riceveranno MAI email o candidature automatiche.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Add Entry Form */}
        <form onSubmit={handleAdd} className="space-y-3 pt-2 bg-muted/30 p-3 sm:p-4 rounded-xl border border-border/50">
          <div className="flex items-center justify-between">
            <Label htmlFor={patternInputId} className="text-xs font-medium text-foreground">
              Aggiungi nuovo blocco
            </Label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedType('auto')}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  selectedType === 'auto' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Auto ({detectedType === 'domain' ? 'Dominio' : 'Email'})
              </button>
              <button
                type="button"
                onClick={() => setSelectedType('email')}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  selectedType === 'email' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Email
              </button>
              <button
                type="button"
                onClick={() => setSelectedType('domain')}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  selectedType === 'domain' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Dominio
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <Input
                id={patternInputId}
                placeholder="es. info@azienda.ch o @azienda.ch o azienda.ch"
                value={inputPattern}
                onChange={(e) => setInputPattern(e.target.value)}
                className="h-10 text-sm bg-background"
              />
            </div>
            <div>
              <Input
                id={notesInputId}
                placeholder="Nota (opzionale)"
                value={inputNotes}
                onChange={(e) => setInputNotes(e.target.value)}
                className="h-10 text-sm bg-background"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>
                <strong>Esempio:</strong> <code className="bg-muted px-1 rounded">@azienda.ch</code> blocca tutte le email di quel dominio.
              </span>
            </div>
            <Button
              type="submit"
              disabled={isSubmitting || !inputPattern.trim()}
              className="h-10 px-4 min-h-[44px] sm:min-h-[40px] text-sm shrink-0 w-full sm:w-auto"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Aggiungi alla Blacklist
            </Button>
          </div>
        </form>

        {/* Search & List of Blacklist Rules */}
        <div className="flex-1 flex flex-col min-h-0 space-y-2 pt-2">
          <div className="flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id={searchInputId}
                placeholder="Cerca nella blacklist per email o dominio..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-xs bg-background"
              />
            </div>
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery('')}
                className="h-9 px-2 text-xs"
              >
                Reset
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1 border rounded-lg bg-card min-h-[220px] max-h-[340px]">
            {filteredBlacklist.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto stroke-1" />
                <p className="text-sm font-medium text-muted-foreground">
                  {searchQuery ? 'Nessun risultato corrispondente alla ricerca' : 'Nessuna regola in Blacklist'}
                </p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {searchQuery
                    ? 'Prova con un termine di ricerca diverso o aggiungi una nuova regola.'
                    : 'Aggiungi email o domini che vuoi escludere per sempre dalle candidature.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {filteredBlacklist.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/40 transition-colors gap-3"
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className="mt-0.5 p-1.5 rounded-md bg-muted text-muted-foreground shrink-0">
                        {item.type === 'domain' ? (
                          <Globe className="h-4 w-4 text-primary" />
                        ) : (
                          <Mail className="h-4 w-4 text-blue-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground truncate">
                            {item.type === 'domain' ? `@${item.pattern}` : item.pattern}
                          </span>
                          <Badge
                            variant={item.type === 'domain' ? 'default' : 'secondary'}
                            className="text-[10px] px-1.5 py-0 h-4"
                          >
                            {item.type === 'domain' ? 'Intero dominio' : 'Singola email'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          {item.notes && (
                            <span className="text-foreground/80 italic truncate max-w-[200px] sm:max-w-xs">
                              “{item.notes}”
                            </span>
                          )}
                          <span>
                            Aggiunto:{' '}
                            {(() => {
                              try {
                                const d = new Date(item.addedAt);
                                return !isNaN(d.getTime())
                                  ? d.toLocaleDateString('it-IT', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      year: 'numeric',
                                    })
                                  : 'N/D';
                              } catch {
                                return 'N/D';
                              }
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(item.id, item.pattern)}
                      className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 min-h-[40px] min-w-[40px]"
                      title="Rimuovi dalla blacklist"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Rimuovi</span>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredBlacklist.length} di {blacklist.length} visualizzate
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            Chiudi
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
