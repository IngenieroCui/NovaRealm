"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch, PRODUCT_TYPE_LABELS } from "@/lib/api";
import type { Product, ProductType } from "@/lib/types";
import { ProductCard } from "./product-card";
import { CardSkeletons } from "./loading";

type CatalogContext = "all" | "components" | "systems";
type StockFilter = "all" | "available" | "sold-out";
type SpecificationKey = "ramGb" | "storageGb" | "vramGb" | "cpuScore" | "gpuScore";

type SpecificationFilter = { key: SpecificationKey; label: string; suffix: string };

const specificationFilters: SpecificationFilter[] = [
  { key: "ramGb", label: "RAM mínima", suffix: "GB" },
  { key: "storageGb", label: "Almacenamiento mínimo", suffix: "GB" },
  { key: "vramGb", label: "VRAM mínima", suffix: "GB" },
  { key: "cpuScore", label: "Rendimiento de CPU", suffix: "/ 100" },
  { key: "gpuScore", label: "Rendimiento de GPU", suffix: "/ 100" },
];

const productTypes = Object.keys(PRODUCT_TYPE_LABELS) as ProductType[];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CO");
}

function numberOrUndefined(value: string) {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) ? number : undefined;
}

function getContext(searchParams: ReturnType<typeof useSearchParams>): CatalogContext {
  if (searchParams.get("context") === "components") return "components";
  if (searchParams.get("context") === "systems") return "systems";
  return "all";
}

function typesFromUrl(searchParams: ReturnType<typeof useSearchParams>) {
  const types = searchParams.getAll("type").flatMap((value) => value.split(","))
    .filter((value): value is ProductType => productTypes.includes(value as ProductType));
  return [...new Set(types)];
}

export function CatalogView() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [stock, setStock] = useState<StockFilter>("all");
  const [minimums, setMinimums] = useState<Record<SpecificationKey, string>>({ ramGb: "", storageGb: "", vramGb: "", cpuScore: "", gpuScore: "" });
  const [sort, setSort] = useState("featured");
  const [resolution, setResolution] = useState("");
  const [refreshRate, setRefreshRate] = useState("");
  const context = getContext(searchParams);
  const selectedTypes = typesFromUrl(searchParams);

  useEffect(() => {
    apiFetch<Product[]>("/products").then(setProducts).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  const productsInContext = useMemo(() => {
    if (context === "components") return products.filter((product) => product.type !== "PREBUILT_PC");
    if (context === "systems") return products.filter((product) => product.type === "PREBUILT_PC");
    return products;
  }, [context, products]);

  const availableTypes = useMemo(() => productTypes.filter((type) => productsInContext.some((product) => product.type === type)), [productsInContext]);
  const priceBounds = useMemo(() => {
    const prices = productsInContext.map((product) => product.price);
    return { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 };
  }, [productsInContext]);
  const visibleSpecificationFilters = useMemo(() => {
    if (!selectedTypes.length) return [];
    return specificationFilters.filter(({ key }) => selectedTypes.some((type) => productsInContext.some((product) => product.type === type && product[key] !== null)));
  }, [productsInContext, selectedTypes]);
  const showMonitorFilters = selectedTypes.includes("MONITOR");

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    const minPrice = numberOrUndefined(priceMin);
    const maxPrice = numberOrUndefined(priceMax);

    return productsInContext
      .filter((product) => !selectedTypes.length || selectedTypes.includes(product.type))
      .filter((product) => minPrice === undefined || product.price >= minPrice)
      .filter((product) => maxPrice === undefined || product.price <= maxPrice)
      .filter((product) => stock === "all" || (stock === "available" ? product.stock > 0 : product.stock === 0))
      .filter((product) => visibleSpecificationFilters.every(({ key }) => {
        const minimum = numberOrUndefined(minimums[key]);
        return minimum === undefined || (product[key] !== null && product[key] >= minimum);
      }))
      .filter((product) => !resolution || product.technicalSpecs?.resolution === resolution)
      .filter((product) => !refreshRate || (product.technicalSpecs?.refreshHz !== undefined && Number(product.technicalSpecs.refreshHz) >= Number(refreshRate)))
      .filter((product) => !term || [product.name, product.cpu, product.gpu, product.description, PRODUCT_TYPE_LABELS[product.type], ...product.features]
        .filter((value): value is string => Boolean(value)).some((value) => normalize(value).includes(term)))
      .sort((a, b) => {
        if (sort === "price-asc") return a.price - b.price;
        if (sort === "price-desc") return b.price - a.price;
        if (sort === "name") return a.name.localeCompare(b.name, "es");
        return Number(b.type === "PREBUILT_PC") - Number(a.type === "PREBUILT_PC") || a.price - b.price;
      });
  }, [minimums, priceMax, priceMin, productsInContext, refreshRate, resolution, search, selectedTypes, sort, stock, visibleSpecificationFilters]);

  const activeFilterCount = [search, priceMin, priceMax, resolution, refreshRate, ...Object.values(minimums)].filter(Boolean).length + selectedTypes.length + Number(stock !== "all");

  function toggleType(type: ProductType) {
    const nextTypes = selectedTypes.includes(type) ? selectedTypes.filter((item) => item !== type) : [...selectedTypes, type];
    updateTypes(nextTypes);
  }

  function updateTypes(types: ProductType[]) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("type");
    types.forEach((type) => params.append("type", type));
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function clearFilters() {
    setSearch(""); updateTypes([]); setPriceMin(""); setPriceMax(""); setStock("all");
    setMinimums({ ramGb: "", storageGb: "", vramGb: "", cpuScore: "", gpuScore: "" }); setResolution(""); setRefreshRate("");
  }

  return <div className="catalog-page">
    <section className="catalog-hero"><div className="shell"><span className="eyebrow">CATÁLOGO NOVAREALM</span><h1>Hardware elegido con criterio.</h1><p>Explora por intención: equipos completos, componentes o periféricos.</p><div className="catalog-sections"><a className={context === "systems" ? "active" : ""} href="/productos?context=systems">🖥️ Equipos</a><a className={context === "components" && !selectedTypes.some((type) => ["MONITOR", "KEYBOARD", "MOUSE", "HEADSET"].includes(type)) ? "active" : ""} href="/productos?context=components&type=CPU&type=GPU&type=RAM&type=MOTHERBOARD&type=STORAGE&type=PSU&type=CASE&type=COOLING">🧩 Componentes</a><a className={context === "components" && selectedTypes.some((type) => ["MONITOR", "KEYBOARD", "MOUSE", "HEADSET"].includes(type)) ? "active" : ""} href="/productos?context=components&type=MONITOR&type=KEYBOARD&type=MOUSE&type=HEADSET">⌨️ Periféricos</a></div></div></section>
    <section className="shell catalog-layout">
      <aside className="filters-panel" aria-label="Filtros del catálogo">
        <div className="filter-heading"><h2>Filtros{activeFilterCount ? <span className="filter-count">{activeFilterCount}</span> : null}</h2><button type="button" onClick={clearFilters}>Limpiar</button></div>
        <label className="field"><span>Buscar</span><div className="search-input"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, marca o característica" /></div></label>
        <fieldset className="filter-group"><legend>Tipo de producto</legend><div className="filter-options">{availableTypes.map((type) => <label key={type} className="filter-option"><input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => toggleType(type)} /><span>{PRODUCT_TYPE_LABELS[type]}</span></label>)}</div></fieldset>
        <fieldset className="filter-group"><legend>Precio (COP)</legend><div className="filter-number-grid"><label><span>Desde</span><input type="number" min={priceBounds.min} value={priceMin} onChange={(event) => setPriceMin(event.target.value)} placeholder={priceBounds.min ? new Intl.NumberFormat("es-CO").format(priceBounds.min) : "0"} /></label><label><span>Hasta</span><input type="number" min={priceBounds.min} value={priceMax} onChange={(event) => setPriceMax(event.target.value)} placeholder={priceBounds.max ? new Intl.NumberFormat("es-CO").format(priceBounds.max) : ""} /></label></div></fieldset>
        <label className="field"><span>Disponibilidad</span><select value={stock} onChange={(event) => setStock(event.target.value as StockFilter)}><option value="all">Todos los productos</option><option value="available">Disponibles</option><option value="sold-out">Agotados</option></select></label>
        {visibleSpecificationFilters.length ? <fieldset className="filter-group"><legend>Especificaciones mínimas</legend><div className="filter-number-grid">{visibleSpecificationFilters.map(({ key, label, suffix }) => <label key={key}><span>{label}</span><div className="number-with-suffix"><input type="number" min="0" value={minimums[key]} onChange={(event) => setMinimums((current) => ({ ...current, [key]: event.target.value }))} /><small>{suffix}</small></div></label>)}</div></fieldset> : null}
        {showMonitorFilters ? <fieldset className="filter-group"><legend>Monitor</legend><label className="field"><span>Resolución</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}><option value="">Cualquiera</option><option value="1080p">1080p</option><option value="1440p">1440p</option><option value="4k">4K</option></select></label><label className="field"><span>Refresh rate mínimo</span><div className="number-with-suffix"><input type="number" min="0" value={refreshRate} onChange={(event) => setRefreshRate(event.target.value)} /><small>Hz</small></div></label></fieldset> : null}
        <div className="filter-help"><span>✦</span><h3>¿No sabes qué elegir?</h3><p>Nova compara por ti según tus juegos, programas y presupuesto.</p><a href="/nova">Hablar con Nova →</a></div>
      </aside>
      <div className="catalog-content"><div className="catalog-toolbar"><p><strong>{filtered.length}</strong> productos encontrados</p><label>Ordenar por <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Recomendados</option><option value="price-asc">Menor precio</option><option value="price-desc">Mayor precio</option><option value="name">Nombre</option></select></label></div>{loading ? <CardSkeletons count={8} /> : error ? <div className="empty-state"><span>!</span><h3>No se pudo conectar con el catálogo</h3><p>{error}</p></div> : filtered.length ? <div className="product-grid catalog-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <div className="empty-state"><span>⌕</span><h3>No encontramos coincidencias</h3><p>Prueba ajustando uno de los criterios o limpia los filtros.</p></div>}</div>
    </section>
  </div>;
}
