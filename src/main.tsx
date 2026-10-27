import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/ErrorBoundary";
import "non.geist";
import "non.geist/mono";
import "./index.css";
import { Toaster } from "@/components/ui/sonner";
import { installFrontendErrorHooks } from "@/lib/frontendLog";
import { isMacPlatform } from "@/lib/platform";

installFrontendErrorHooks();

// Add platform class for platform-specific styles
try {
  if (isMacPlatform()) {
    document.body.classList.add("is-mac");
  }
} catch {
  // Ignore platform detection failure
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
      <Toaster />
    </AppErrorBoundary>
  </React.StrictMode>
);
