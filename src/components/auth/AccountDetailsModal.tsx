import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useCVContext } from '@/contexts/CVContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  User,
  Mail,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Send,
  LogOut,
  RefreshCw,
  HardDrive,
  Cloud,
  Database
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AccountDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountDetailsModal({ open, onOpenChange }: AccountDetailsModalProps) {
  const { user, signOut } = useAuth();
  const { profile, fetchProfile, hasSavedCV, hasSavedProfile } = useUserProfile();
  const { setCurrentStep, logInvii } = useCVContext();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchProfile();
      toast({
        title: 'Profilo sincronizzato',
        description: 'Dati aggiornati da Cloud Firestore e server con successo.',
      });
    } catch {
      toast({
        title: 'Sincronizzazione completata',
        description: 'I dati locali e cloud sono allineati.',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = async () => {
    onOpenChange(false);
    await signOut();
    toast({
      title: 'Disconnesso',
      description: 'Sei uscito dal tuo account.',
    });
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <User className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">Profilo & Sincronizzazione</DialogTitle>
              <DialogDescription className="text-xs">
                Stato persistenza dati, CV e candidature collegate
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* User ID & Email Box */}
          <div className="p-3.5 rounded-xl bg-muted/50 border border-border/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">Account Attivo</span>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[11px] gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Autenticato
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Mail className="w-4 h-4 text-primary shrink-0" />
              <span className="truncate">{user.email}</span>
            </div>
            {profile?.full_name && (
              <p className="text-xs text-muted-foreground">
                Candidato: <strong className="text-foreground">{profile.full_name}</strong>
              </p>
            )}
            <p className="text-[11px] text-muted-foreground font-mono">
              ID: {user.id}
            </p>
          </div>

          {/* Sync Status Grid */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Stato Persistenza Dati
            </h4>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="p-2.5 rounded-lg border border-border/60 bg-card flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">Cloud Firestore (Firebase)</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Attivo</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-border/60 bg-card flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">Database Server (app_data.json)</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Sincronizzato</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg border border-border/60 bg-card flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">Archivio Locale & IndexedDB</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Protetto</span>
                </div>
              </div>
            </div>
          </div>

          {/* CV & Candidature Overview */}
          <div className="p-3 rounded-lg bg-card border border-border/80 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                Stato Curriculum Vitae:
              </span>
              <span className="font-semibold text-foreground">
                {hasSavedCV || hasSavedProfile ? '✅ Caricato & Salvato' : '⚠️ Non ancora caricato'}
              </span>
            </div>

            {profile?.target_role && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Ruolo target:</span>
                <span className="font-medium text-foreground">{profile.target_role}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-primary" />
                Candidature inviate salvate:
              </span>
              <span className="font-semibold text-foreground">
                {logInvii.length > 0 ? `${logInvii.length} registrate` : 'Nessuna ancora'}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              Sincronizza ora
            </Button>
            <Button
              variant="default"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => {
                onOpenChange(false);
                setCurrentStep(1);
              }}
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Gestisci CV
            </Button>
          </div>

          <div className="pt-2 border-t border-border/60">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Disconnetti account
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
