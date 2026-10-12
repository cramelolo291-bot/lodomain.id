import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { RequireAdmin } from "@/components/RequireAdmin";
import { Intro, shouldPlay } from "@/components/Intro";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import React, { StrictMode, useCallback, useEffect, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Chat = lazy(() => import("./pages/Chat.tsx"));
const Web = lazy(() => import("./pages/Web.tsx"));
const Panel = lazy(() => import("./pages/Panel.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Studio = lazy(() => import("./pages/Studio.tsx"));
const Projects = lazy(() => import("./pages/Projects.tsx"));
const Server = lazy(() => import("./pages/Server.tsx"));
const Infrastructure = lazy(() => import("./pages/Infrastructure.tsx"));
const Integrations = lazy(() => import("./pages/Integrations.tsx"));
const ModulePage = lazy(() => import("./pages/ModulePage.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="animate-pulse font-mono text-xs text-muted-foreground">loading…</div>
    </div>
  );
}

function App() {
  const [intro, setIntro] = useState(shouldPlay);
  const skipIntro = useCallback(() => setIntro(false), []);

  return (
    <>
      {intro && <Intro onDone={skipIntro} />}
      <BrowserRouter basename={import.meta.env.BASE_URL === "/" ? "/" : import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <RouteSyncer />
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<AuthPage redirectAfterAuth="/web" />} />

            {/* Public read-only reference dashboards */}
            <Route path="/panel" element={<Panel />} />
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Signed-in workspace routes */}
            <Route path="/chat" element={<RequireAuth><Chat /></RequireAuth>} />
            <Route path="/chat/:id" element={<RequireAuth><Chat /></RequireAuth>} />
            <Route path="/web" element={<RequireAuth><Web /></RequireAuth>} />
            <Route path="/web/:id" element={<RequireAuth><Web /></RequireAuth>} />
            <Route path="/studio" element={<RequireAuth><Studio /></RequireAuth>} />
            <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
            <Route path="/integrations" element={<RequireAuth><Integrations /></RequireAuth>} />
            <Route path="/messages" element={<RequireAuth><ModulePage module="messages" /></RequireAuth>} />
            <Route path="/browser" element={<RequireAuth><ModulePage module="browser" /></RequireAuth>} />
            <Route path="/security" element={<RequireAuth><ModulePage module="security" /></RequireAuth>} />
            <Route path="/cloud" element={<RequireAuth><ModulePage module="cloud" /></RequireAuth>} />
            <Route path="/reverse-engineering" element={<RequireAuth><ModulePage module="reverse-engineering" /></RequireAuth>} />
            <Route path="/deploy" element={<RequireAuth><ModulePage module="deploy" /></RequireAuth>} />
            <Route path="/design" element={<RequireAuth><ModulePage module="design" /></RequireAuth>} />

            {/* Admin-only operations */}
            <Route path="/server" element={<RequireAdmin><Server /></RequireAdmin>} />
            <Route path="/infrastructure" element={<RequireAdmin><Infrastructure /></RequireAdmin>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster />
    </>
  );
}

class ToolbarErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error) { console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message); }
  render() { return this.state.hasError ? null : this.props.children; }
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || "Unknown runtime error", stack: error.stack || "" };
  }
  componentDidCatch(err: Error) { console.error("[Preview] Root crash:", err); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Runtime error</p>
            <p className="mt-2 break-words text-xs text-muted-foreground">{this.state.message}</p>
            {this.state.stack && <pre className="mt-3 max-h-40 overflow-auto rounded border border-border/60 p-2 text-left font-mono text-[10px] leading-4 text-muted-foreground/80">{this.state.stack}</pre>}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage({ type: "iframe-route-change", path: location.pathname }, "*");
  }, [location.pathname]);
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary><VlyToolbar /></ToolbarErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
