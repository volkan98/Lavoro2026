import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StepIndicator } from './StepIndicator';
import { useCVContext } from '@/contexts/CVContext';
import { useAuth } from '@/hooks/useAuth';
import { useBlacklist } from '@/lib/blacklist';
import { BlacklistModal } from '@/components/blacklist/BlacklistModal';
import { AccountDetailsModal } from '@/components/auth/AccountDetailsModal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, Sparkles, User, ShieldBan, CheckCircle2 } from 'lucide-react';
import { BUILD_VERSION } from '@/lib/version';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { currentStep, setCurrentStep } = useCVContext();
  const { user, signOut } = useAuth();
  const { blacklist } = useBlacklist();
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border shadow-xs sticky top-0 z-40">
        <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="p-1.5 sm:p-2 bg-primary rounded-lg shrink-0">
                <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground truncate">
                  AI Job Agent
                </h1>
                <p className="text-[11px] sm:text-xs text-muted-foreground hidden sm:block truncate">
                  Candidature intelligenti per Svizzera & Italia (Permesso G)
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Blacklist Quick Action Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBlacklistOpen(true)}
                className="h-8 sm:h-9 px-2 sm:px-3 text-xs flex items-center gap-1.5 border-border/80 hover:bg-muted/80"
                title="Gestisci Blacklist Email e Domini esclusi"
              >
                <ShieldBan className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="hidden sm:inline">Blacklist</span>
                {(blacklist || []).length > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 h-4 text-[10px] font-mono">
                    {(blacklist || []).length}
                  </Badge>
                )}
              </Button>

              {user ? (
                <>
                  {/* Active User Pill - Clickable to see sync status & account details */}
                  <button
                    onClick={() => setAccountOpen(true)}
                    className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-full text-xs text-foreground transition-all cursor-pointer"
                    title="Account attivo - Clicca per dettagli sincronizzazione e profilo"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse"></span>
                    <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-medium max-w-[100px] sm:max-w-[150px] md:max-w-[200px] truncate">
                      {user.email || user.user_metadata?.full_name}
                    </span>
                  </button>

                  <Button variant="ghost" size="sm" onClick={handleLogout} className="h-8 sm:h-9 px-2 sm:px-2.5 text-xs text-muted-foreground hover:text-foreground">
                    <LogOut className="h-3.5 w-3.5 sm:mr-1" />
                    <span className="hidden sm:inline">Esci</span>
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => navigate('/auth')} className="h-8 sm:h-9 text-xs">
                  Accedi
                </Button>
              )}
            </div>
          </div>
        </div>
        <StepIndicator currentStep={currentStep} onStepClick={setCurrentStep} />
      </header>

      {/* Account Details & Sync Status Modal */}
      <AccountDetailsModal open={accountOpen} onOpenChange={setAccountOpen} />

      {/* Blacklist Modal */}
      <BlacklistModal open={blacklistOpen} onOpenChange={setBlacklistOpen} />

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-3 sm:px-4 py-4 sm:py-6 md:py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-3 sm:py-4">
        <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <p className="text-xs text-muted-foreground">
            © 2024 AI Job Agent • Supporto Permesso G Svizzera & Frontalieri • Powered by Google Gemini
          </p>
          <span className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 px-2 py-0.5 rounded border border-border/40">
            Build: {BUILD_VERSION}
          </span>
        </div>
      </footer>
    </div>
  );
}
