import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

// Prevent transient network errors from any unhandled promise rejection
// (e.g. background axios calls) from tripping the React error overlay.
// We log them so devs can still see them in the console.
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason || {};
    const isNetErr =
      reason.name === "AxiosError" ||
      reason.message === "Network Error" ||
      reason.code === "ERR_NETWORK" ||
      reason.code === "ECONNABORTED";
    if (isNetErr) {
      console.warn("[net] swallowed:", reason.message || reason);
      event.preventDefault();
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
