import { Suspense } from "react";
import { PcBuilder } from "@/components/pc-builder";
import { PageLoading } from "@/components/loading";
export default function ConfiguratorPage() { return <Suspense fallback={<PageLoading label="Cargando configurador" />}><PcBuilder /></Suspense>; }
