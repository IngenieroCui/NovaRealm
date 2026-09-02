import { Suspense } from "react";
import { CatalogView } from "@/components/catalog-view";
import { PageLoading } from "@/components/loading";

export default function ComponentesPage() {
  return <Suspense fallback={<PageLoading />}><CatalogView catalogContext="components" /></Suspense>;
}
