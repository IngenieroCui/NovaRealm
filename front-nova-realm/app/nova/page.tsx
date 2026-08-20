import { Suspense } from "react";
import { NovaChat } from "@/components/nova-chat";
import { PageLoading } from "@/components/loading";

export default function NovaPage() {
  return <Suspense fallback={<PageLoading label="Despertando a Nova" />}><NovaChat /></Suspense>;
}
