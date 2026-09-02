"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { BuilderFlow, BuilderMode, CurrentPc, ProductType, RecommendationFilters, ShoppingIntent } from "./types";

export interface NovaProductContext {
  slug: string;
  name: string;
  type: string;
}

export interface NovaSession {
  shoppingIntent?: ShoppingIntent;
  filters: RecommendationFilters | null;
  currentBuild: string[];
  selectedProduct: NovaProductContext | null;
  selectedComponentType?: ProductType;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  builderMode?: BuilderMode;
  builderFlow?: BuilderFlow;
  currentPc?: CurrentPc;
  upgradeGoal?: string;
}

interface NovaContextValue {
  open: boolean;
  session: NovaSession;
  openNova: (intent?: ShoppingIntent) => void;
  closeNova: () => void;
  setIntent: (intent: ShoppingIntent) => void;
  setProductContext: (product: NovaProductContext | null) => void;
  patchSession: (value: Partial<NovaSession>) => void;
}

const NovaContext = createContext<NovaContextValue | null>(null);

export function NovaProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<NovaSession>({ filters: null, currentBuild: [], selectedProduct: null, conversation: [] });
  const openNova = useCallback((intent?: ShoppingIntent) => { if (intent) setSession((current) => ({ ...current, shoppingIntent: intent })); setOpen(true); }, []);
  const closeNova = useCallback(() => setOpen(false), []);
  const setIntent = useCallback((intent: ShoppingIntent) => setSession((current) => ({ ...current, shoppingIntent: intent })), []);
  const setProductContext = useCallback((product: NovaProductContext | null) => setSession((current) => ({ ...current, selectedProduct: product })), []);
  const patchSession = useCallback((value: Partial<NovaSession>) => setSession((current) => ({ ...current, ...value })), []);
  const value = useMemo<NovaContextValue>(() => ({
    open,
    session,
    openNova, closeNova, setIntent, setProductContext, patchSession,
  }), [closeNova, open, openNova, patchSession, session, setIntent, setProductContext]);
  return <NovaContext.Provider value={value}>{children}</NovaContext.Provider>;
}

export function useNova() {
  const context = useContext(NovaContext);
  if (!context) throw new Error("useNova debe usarse dentro de NovaProvider");
  return context;
}
