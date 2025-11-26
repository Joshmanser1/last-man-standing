import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// === Sentry (v8) setup ===
import * as Sentry from "@sentry/react";

// Initialize Sentry only in production and only if a DSN is present
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (import.meta.env.PROD && SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.3,
    environment: import.meta.env.MODE || "production",
    release: `fantasy-command-centre@${import.meta.env.VITE_APP_VERSION || "1.0.0"}`,
  });

  // Expose for console testing
  (window as any).Sentry = Sentry;
}

const rootElement = document.getElementById("root") as HTMLElement;

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Something went wrong 😬</h2>
          <p>The team’s been notified — please refresh the page.</p>
        </div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
