"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useNova } from "@/lib/nova-context";
import { NovaChat } from "./nova-chat";

export function NovaLauncher() {
  const { openNova, session } = useNova();
  return <button className="nova-launcher" onClick={() => openNova(session.shoppingIntent)} aria-label="Abrir asistente Nova"><span>✦</span><small>Nova</small></button>;
}

export function NovaDrawer() {
  const { open, closeNova, session } = useNova();
  return <aside className={`nova-drawer ${open ? "is-open" : ""}`} aria-hidden={!open}>
    <div className="nova-drawer-header"><div><span className="mini-avatar">✦</span><div><strong>Nova</strong><small>Tu asesora tecnológica</small></div></div><button onClick={closeNova} aria-label="Cerrar Nova">×</button></div>
    <NovaChat compact context={session} />
  </aside>;
}

export function NovaAssistant() {
  const pathname = usePathname();
  if (pathname === "/nova") return null;
  return <><NovaLauncher /><Suspense fallback={null}><NovaDrawer /></Suspense></>;
}
