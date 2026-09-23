import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "./chain/config.ts";
import { App } from "./App.tsx";
import "./styles.css";

/**
 * Retries are for a network that hiccupped, not for an answer we did not like.
 *
 * The per-query rules matter more than the default: a 404 for a bad address is a fact and retrying
 * it three times only delays telling the person.
 */
const queries = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const root = document.getElementById("root");
if (!root) throw new Error("no #root to mount into");

createRoot(root).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queries}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
