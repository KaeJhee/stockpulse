import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import { useEffect, useState } from "react";
import { MotionProvider } from "@/components/hud";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route component={Dashboard} />
    </Switch>
  );
}

function App() {
  const [, setMounted] = useState(false);

  useEffect(() => {
    // Ghost HUD is dark-first; honor a saved "paper" (light) choice.
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("ghost.theme");
    } catch {
      /* storage unavailable */
    }
    if (saved === "light") document.documentElement.classList.remove("dark");
    else document.documentElement.classList.add("dark");
    setMounted(true);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </MotionProvider>
    </QueryClientProvider>
  );
}

export default App;
