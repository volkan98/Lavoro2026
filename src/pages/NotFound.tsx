import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
        <p className="text-xl text-foreground font-semibold mb-2">Pagina non trovata</p>
        <p className="text-sm text-muted-foreground mb-6">
          La pagina che stai cercando non esiste o è stata spostata.
        </p>
        <Button asChild>
          <Link to="/">Torna alla Home</Link>
        </Button>
      </div>
    </div>
  );
}
