"use client";

import { FormEvent, useMemo, useState } from "react";
import { apiFetch, formatMoney, PRODUCT_TYPE_LABELS } from "@/lib/api";
import type { Product, ProductType, Workload } from "@/lib/types";

const productTypes: ProductType[] = [
  "PREBUILT_PC",
  "CPU",
  "GPU",
  "RAM",
  "MOTHERBOARD",
  "STORAGE",
  "PSU",
  "CASE",
  "COOLING",
];
type StockFilter = "all" | "available" | "sold-out";
type StatusFilter = "all" | "active" | "inactive";
type WorkloadNumericField =
  | "cpuWeight"
  | "gpuWeight"
  | "ramWeight"
  | "storageWeight"
  | "vramWeight"
  | "minimumCpuScore"
  | "recommendedCpuScore"
  | "minimumGpuScore"
  | "recommendedGpuScore"
  | "minimumRamGb"
  | "recommendedRamGb"
  | "minimumVramGb"
  | "recommendedVramGb";
type CloudinaryUploadSignature = {
  apiKey: string;
  cloudName: string;
  folder: string;
  signature: string;
  timestamp: number;
};

const workloadNumericFields: Array<{
  field: WorkloadNumericField;
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
}> = [
  {
    field: "cpuWeight",
    label: "Peso CPU",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.3,
  },
  {
    field: "gpuWeight",
    label: "Peso GPU",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.35,
  },
  {
    field: "ramWeight",
    label: "Peso RAM",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.2,
  },
  {
    field: "storageWeight",
    label: "Peso almacenamiento",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.05,
  },
  {
    field: "vramWeight",
    label: "Peso VRAM",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.1,
  },
  {
    field: "minimumCpuScore",
    label: "CPU mínimo",
    min: 0,
    max: 100,
    defaultValue: 40,
  },
  {
    field: "recommendedCpuScore",
    label: "CPU recomendado",
    min: 0,
    max: 100,
    defaultValue: 70,
  },
  {
    field: "minimumGpuScore",
    label: "GPU mínimo",
    min: 0,
    max: 100,
    defaultValue: 40,
  },
  {
    field: "recommendedGpuScore",
    label: "GPU recomendado",
    min: 0,
    max: 100,
    defaultValue: 70,
  },
  {
    field: "minimumRamGb",
    label: "RAM mínima (GB)",
    min: 1,
    max: 512,
    defaultValue: 16,
  },
  {
    field: "recommendedRamGb",
    label: "RAM recomendada (GB)",
    min: 1,
    max: 512,
    defaultValue: 32,
  },
  {
    field: "minimumVramGb",
    label: "VRAM mínima (GB)",
    min: 0,
    max: 128,
    defaultValue: 4,
  },
  {
    field: "recommendedVramGb",
    label: "VRAM recomendada (GB)",
    min: 0,
    max: 128,
    defaultValue: 8,
  },
];

function optionalNumber(data: FormData, name: string) {
  const value = String(data.get(name) ?? "").trim();
  return value ? Number(value) : undefined;
}

function optionalText(data: FormData, name: string) {
  const value = String(data.get(name) ?? "").trim();
  return value || undefined;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO");
}

async function uploadProductImage(file: File, adminKey: string) {
  if (!file.type.startsWith("image/"))
    throw new Error("Selecciona un archivo de imagen válido.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("La imagen no puede superar 10 MB.");

  const credentials = await apiFetch<CloudinaryUploadSignature>(
    "/admin/media/cloudinary-signature",
    {
      method: "POST",
      headers: { "x-admin-key": adminKey },
    },
  );
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", credentials.apiKey);
  form.append("timestamp", String(credentials.timestamp));
  form.append("folder", credentials.folder);
  form.append("signature", credentials.signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${credentials.cloudName}/image/upload`,
    {
      method: "POST",
      body: form,
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    secure_url?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.secure_url) {
    throw new Error(
      payload?.error?.message ?? "No fue posible subir la imagen a Cloudinary.",
    );
  }
  return payload.secure_url;
}

export function AdminPanel() {
  const [adminKey, setAdminKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [workloads, setWorkloads] = useState<Workload[]>([]);
  const [tab, setTab] = useState<"products" | "workloads">("products");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(key: string) {
    setLoading(true);
    setError("");
    try {
      const headers = { "x-admin-key": key };
      const [productData, workloadData] = await Promise.all([
        apiFetch<Product[]>("/admin/products", { headers }),
        apiFetch<Workload[]>("/admin/workloads", { headers }),
      ]);
      setProducts(productData);
      setWorkloads(workloadData);
      setAdminKey(key);
    } catch (reason) {
      setError((reason as Error).message);
      setAdminKey("");
    } finally {
      setLoading(false);
    }
  }

  function login(event: FormEvent) {
    event.preventDefault();
    if (keyInput) void load(keyInput);
  }

  if (!adminKey)
    return (
      <section className="admin-login">
        <div className="admin-login-card">
          <div className="nova-avatar">✦</div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Gestiona NovaRealm</h1>
          <p>Introduce la clave de administración para continuar.</p>
          <form onSubmit={login}>
            <label className="field">
              <span>Clave de administración</span>
              <input
                type="password"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="••••••••••••"
                autoFocus
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button
              className="button button-dark button-full"
              disabled={!keyInput || loading}
            >
              {loading ? "Verificando…" : "Entrar"}
            </button>
          </form>
        </div>
      </section>
    );

  return (
    <section className="admin-page">
      <div className="shell">
        <div className="admin-heading">
          <div>
            <span className="eyebrow">PANEL DE CONTROL</span>
            <h1>Catálogo NovaRealm</h1>
            <p>Cambia precios, stock y criterios sin tocar el frontend.</p>
          </div>
          <button
            className="button button-outline"
            onClick={() => setAdminKey("")}
          >
            Cerrar sesión
          </button>
        </div>
        <div className="admin-tabs">
          <button
            className={tab === "products" ? "active" : ""}
            onClick={() => setTab("products")}
          >
            Productos <span>{products.length}</span>
          </button>
          <button
            className={tab === "workloads" ? "active" : ""}
            onClick={() => setTab("workloads")}
          >
            Workloads <span>{workloads.length}</span>
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
        {tab === "products" ? (
          <ProductsAdmin
            products={products}
            adminKey={adminKey}
            onChange={setProducts}
            onError={setError}
          />
        ) : (
          <WorkloadsAdmin
            workloads={workloads}
            adminKey={adminKey}
            onChange={setWorkloads}
            onError={setError}
          />
        )}
      </div>
    </section>
  );
}

function ProductsAdmin({
  products,
  adminKey,
  onChange,
  onError,
}: {
  products: Product[];
  adminKey: string;
  onChange: (items: Product[]) => void;
  onError: (message: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newProductType, setNewProductType] =
    useState<ProductType>("PREBUILT_PC");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"ALL" | ProductType>("ALL");
  const [stock, setStock] = useState<StockFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const filteredProducts = useMemo(() => {
    const term = normalize(search.trim());
    const min = priceMin ? Number(priceMin) : undefined;
    const max = priceMax ? Number(priceMax) : undefined;
    return products.filter((product) => {
      const text = [
        product.name,
        product.slug,
        product.description,
        product.cpu,
        product.gpu,
        PRODUCT_TYPE_LABELS[product.type],
        ...product.features,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ");
      return (
        (!term || normalize(text).includes(term)) &&
        (type === "ALL" || product.type === type) &&
        (stock === "all" ||
          (stock === "available" ? product.stock > 0 : product.stock === 0)) &&
        (status === "all" ||
          (status === "active" ? product.active : !product.active)) &&
        (min === undefined || product.price >= min) &&
        (max === undefined || product.price <= max)
      );
    });
  }, [priceMax, priceMin, products, search, status, stock, type]);

  const activeFilterCount =
    [search, priceMin, priceMax].filter(Boolean).length +
    Number(type !== "ALL") +
    Number(stock !== "all") +
    Number(status !== "all");

  function clearFilters() {
    setSearch("");
    setType("ALL");
    setStock("all");
    setStatus("all");
    setPriceMin("");
    setPriceMax("");
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError("");
    const data = new FormData(event.currentTarget);
    const type = newProductType;
    const features = optionalText(data, "features")
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    let imageUrl = optionalText(data, "imageUrl");
    try {
      if (imageFile) {
        setUploadingImage(true);
        imageUrl = await uploadProductImage(imageFile, adminKey);
      }
    } catch (reason) {
      onError((reason as Error).message);
      return;
    } finally {
      setUploadingImage(false);
    }
    const base = {
      name: optionalText(data, "name"),
      slug: optionalText(data, "slug"),
      description: optionalText(data, "description"),
      type,
      price: Number(data.get("price")),
      stock: Number(data.get("stock")),
      imageUrl:
        imageUrl ??
        (type === "PREBUILT_PC"
          ? "/products/pc-cyan.svg"
          : "/products/component.svg"),
      ...(features?.length ? { features } : {}),
    };
    const specifications =
      type === "PREBUILT_PC"
        ? {
            cpu: optionalText(data, "cpu"),
            gpu: optionalText(data, "gpu"),
            ramGb: optionalNumber(data, "ramGb"),
            storageGb: optionalNumber(data, "storageGb"),
            vramGb: optionalNumber(data, "vramGb"),
            cpuScore: optionalNumber(data, "cpuScore"),
            gpuScore: optionalNumber(data, "gpuScore"),
            productivityScore: optionalNumber(data, "productivityScore"),
            upgradeabilityScore: optionalNumber(data, "upgradeabilityScore"),
          }
        : type === "CPU"
          ? {
              cpu: optionalText(data, "cpu"),
              cpuScore: optionalNumber(data, "cpuScore"),
            }
          : type === "GPU"
            ? {
                gpu: optionalText(data, "gpu"),
                gpuScore: optionalNumber(data, "gpuScore"),
                vramGb: optionalNumber(data, "vramGb"),
              }
            : type === "RAM"
              ? {
                  ramGb: optionalNumber(data, "ramGb"),
                }
              : type === "STORAGE"
                ? {
                    storageGb: optionalNumber(data, "storageGb"),
                  }
                : {};

    try {
      const created = await apiFetch<Product>("/admin/products", {
        method: "POST",
        headers: { "x-admin-key": adminKey },
        body: JSON.stringify({ ...base, ...specifications }),
      });
      onChange([...products, created]);
      setImageFile(null);
      setShowCreate(false);
    } catch (reason) {
      onError((reason as Error).message);
    }
  }

  return (
    <div>
      <div className="admin-actions">
        <p>
          Los ajustes por aplicación se calculan desde el hardware del PC y los
          requisitos de cada workload.
        </p>
        <button
          className="button button-accent"
          onClick={() => setShowCreate(!showCreate)}
        >
          + Nuevo producto
        </button>
      </div>
      {showCreate && (
        <form className="admin-create-form" onSubmit={create}>
          <h2>Crear producto</h2>
          <p className="form-hint">
            Selecciona el tipo primero: sólo aparecerán las especificaciones que
            le corresponden. Los PCs deben tener un perfil técnico completo para
            entrar en recomendaciones.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>Nombre</span>
              <input name="name" required />
            </label>
            <label className="field">
              <span>Slug</span>
              <input name="slug" required pattern="[a-z0-9-]+" />
            </label>
            <label className="field">
              <span>Tipo</span>
              <select
                name="type"
                value={newProductType}
                onChange={(event) =>
                  setNewProductType(event.target.value as ProductType)
                }
              >
                {productTypes.map((item) => (
                  <option key={item} value={item}>
                    {PRODUCT_TYPE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Precio</span>
              <input name="price" type="number" min="0" required />
            </label>
            <label className="field">
              <span>Stock</span>
              <input name="stock" type="number" min="0" required />
            </label>
            <label className="field">
              <span>Foto del producto (Cloudinary)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) =>
                  setImageFile(event.target.files?.[0] ?? null)
                }
              />
              <small>
                {imageFile
                  ? `${imageFile.name} · se subirá al guardar`
                  : "Opcional · PNG, JPG, WEBP o GIF, hasta 10 MB."}
              </small>
            </label>
            <label className="field">
              <span>URL o identificador existente (opcional)</span>
              <input
                name="imageUrl"
                placeholder="cloudinary:novarealm/products/equipo"
                disabled={Boolean(imageFile)}
              />
            </label>
            <ProductSpecifications type={newProductType} />
            <label className="field full">
              <span>Características (separadas por coma)</span>
              <input name="features" placeholder="Garantía, Wi-Fi, RGB" />
            </label>
            <label className="field full">
              <span>Descripción</span>
              <textarea name="description" required />
            </label>
          </div>
          <button className="button button-dark" disabled={uploadingImage}>
            {uploadingImage ? "Subiendo imagen…" : "Crear en catálogo"}
          </button>
        </form>
      )}
      <div className="admin-product-filters">
        <div className="admin-filter-heading">
          <strong>
            Filtrar inventario
            {activeFilterCount ? <span>{activeFilterCount}</span> : null}
          </strong>
          <button type="button" onClick={clearFilters}>
            Limpiar
          </button>
        </div>
        <div className="admin-filter-grid">
          <label>
            <span>Buscar</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, slug o componente"
            />
          </label>
          <label>
            <span>Tipo</span>
            <select
              value={type}
              onChange={(event) =>
                setType(event.target.value as "ALL" | ProductType)
              }
            >
              <option value="ALL">Todos los tipos</option>
              {productTypes.map((item) => (
                <option key={item} value={item}>
                  {PRODUCT_TYPE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Stock</span>
            <select
              value={stock}
              onChange={(event) => setStock(event.target.value as StockFilter)}
            >
              <option value="all">Todos</option>
              <option value="available">Disponible</option>
              <option value="sold-out">Agotado</option>
            </select>
          </label>
          <label>
            <span>Estado</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as StatusFilter)
              }
            >
              <option value="all">Todos</option>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>
          <label>
            <span>Precio desde</span>
            <input
              type="number"
              min="0"
              value={priceMin}
              onChange={(event) => setPriceMin(event.target.value)}
            />
          </label>
          <label>
            <span>Precio hasta</span>
            <input
              type="number"
              min="0"
              value={priceMax}
              onChange={(event) => setPriceMax(event.target.value)}
            />
          </label>
        </div>
      </div>
      <p className="admin-results">
        <strong>{filteredProducts.length}</strong> de {products.length}{" "}
        productos
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Precio</th>
              <th>Stock</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => (
              <ProductAdminRow
                key={product.id}
                product={product}
                adminKey={adminKey}
                onSaved={(saved) =>
                  onChange(
                    products.map((item) =>
                      item.id === saved.id ? saved : item,
                    ),
                  )
                }
                onError={onError}
              />
            ))}
          </tbody>
        </table>
        {!filteredProducts.length && (
          <div className="admin-empty">
            No hay productos que cumplan esos filtros.
          </div>
        )}
      </div>
    </div>
  );
}

function ProductSpecifications({ type }: { type: ProductType }) {
  if (type === "PREBUILT_PC")
    return (
      <>
        <label className="field">
          <span>Procesador</span>
          <input name="cpu" required />
        </label>
        <label className="field">
          <span>Tarjeta gráfica</span>
          <input name="gpu" required />
        </label>
        <label className="field">
          <span>RAM (GB)</span>
          <input name="ramGb" type="number" min="1" required />
        </label>
        <label className="field">
          <span>Almacenamiento (GB)</span>
          <input name="storageGb" type="number" min="64" required />
        </label>
        <label className="field">
          <span>VRAM (GB)</span>
          <input name="vramGb" type="number" min="1" required />
        </label>
        <ScoreFields />
      </>
    );
  if (type === "CPU")
    return (
      <>
        <label className="field">
          <span>Modelo de CPU</span>
          <input name="cpu" placeholder="Ej. Ryzen 7 7700" />
        </label>
        <ScoreFields cpuOnly />
      </>
    );
  if (type === "GPU")
    return (
      <>
        <label className="field">
          <span>Modelo de GPU</span>
          <input name="gpu" placeholder="Ej. RTX 5070" />
        </label>
        <label className="field">
          <span>VRAM (GB)</span>
          <input name="vramGb" type="number" min="1" />
        </label>
        <ScoreFields gpuOnly />
      </>
    );
  if (type === "RAM")
    return (
      <label className="field">
        <span>Capacidad (GB)</span>
        <input name="ramGb" type="number" min="1" required />
      </label>
    );
  if (type === "STORAGE")
    return (
      <label className="field">
        <span>Capacidad (GB)</span>
        <input name="storageGb" type="number" min="64" required />
      </label>
    );
  return (
    <p className="form-hint full">
      Este tipo no tiene especificaciones numéricas obligatorias. Puedes
      documentar sus detalles en las características y la descripción.
    </p>
  );
}

function ScoreFields({
  gpuOnly = false,
  cpuOnly = false,
}: {
  gpuOnly?: boolean;
  cpuOnly?: boolean;
}) {
  return (
    <>
      {!gpuOnly && (
        <label className="field">
          <span>Puntaje de CPU (0–100)</span>
          <input name="cpuScore" type="number" min="0" max="100" />
          <small>
            Se completa solo si el procesador existe como componente; si no,
            indícalo.
          </small>
        </label>
      )}
      {!cpuOnly && (
        <label className="field">
          <span>Puntaje de GPU (0–100)</span>
          <input name="gpuScore" type="number" min="0" max="100" />
          <small>
            Se completa solo si la GPU existe como componente; si no, indícalo.
          </small>
        </label>
      )}
      {!cpuOnly && !gpuOnly && (
        <label className="field">
          <span>Margen de actualización (0–100)</span>
          <input
            name="upgradeabilityScore"
            type="number"
            min="0"
            max="100"
            required
          />
        </label>
      )}
    </>
  );
}

function ProductAdminRow({
  product,
  adminKey,
  onSaved,
  onError,
}: {
  product: Product;
  adminKey: string;
  onSaved: (item: Product) => void;
  onError: (message: string) => void;
}) {
  const [price, setPrice] = useState(product.price);
  const [stock, setStock] = useState(product.stock);
  const [active, setActive] = useState(product.active);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const saved = await apiFetch<Product>(`/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "x-admin-key": adminKey },
        body: JSON.stringify({ price, stock, active }),
      });
      onSaved(saved);
    } catch (reason) {
      onError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <tr>
      <td>
        <strong>{product.name}</strong>
        <small>{product.cpu ?? product.gpu ?? product.slug}</small>
      </td>
      <td>
        <span className="type-chip">{PRODUCT_TYPE_LABELS[product.type]}</span>
      </td>
      <td>
        <input
          type="number"
          value={price}
          onChange={(event) => setPrice(Number(event.target.value))}
        />
        <small>{formatMoney(price)}</small>
      </td>
      <td>
        <input
          className="stock-input"
          type="number"
          value={stock}
          onChange={(event) => setStock(Number(event.target.value))}
        />
      </td>
      <td>
        <label className="switch">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          <span />
        </label>
      </td>
      <td>
        <button
          className="save-button"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "…" : "Guardar"}
        </button>
      </td>
    </tr>
  );
}

function WorkloadsAdmin({
  workloads,
  adminKey,
  onChange,
  onError,
}: {
  workloads: Workload[];
  adminKey: string;
  onChange: (items: Workload[]) => void;
  onError: (message: string) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onError("");
    const data = new FormData(event.currentTarget);
    const numericValues = Object.fromEntries(
      workloadNumericFields.map(({ field }) => [
        field,
        Number(data.get(field)),
      ]),
    );
    const body = {
      slug: data.get("slug"),
      name: data.get("name"),
      type: data.get("type"),
      description: data.get("description"),
      ...numericValues,
    };
    try {
      const item = await apiFetch<Workload>("/admin/workloads", {
        method: "POST",
        headers: { "x-admin-key": adminKey },
        body: JSON.stringify(body),
      });
      onChange([...workloads, item]);
      setShowCreate(false);
    } catch (reason) {
      onError((reason as Error).message);
    }
  }
  return (
    <div>
      <div className="admin-actions">
        <p>
          Define aquí qué recurso importa y qué mínimo/recomendado exige cada
          programa. El motor calcula los porcentajes de todos los PCs
          automáticamente.
        </p>
        <button
          className="button button-accent"
          onClick={() => setShowCreate(!showCreate)}
        >
          + Nuevo workload
        </button>
      </div>
      {showCreate && (
        <form className="admin-create-form" onSubmit={create}>
          <h2>Crear workload</h2>
          <div className="form-grid">
            <label className="field">
              <span>Nombre</span>
              <input name="name" required />
            </label>
            <label className="field">
              <span>Slug</span>
              <input name="slug" required pattern="[a-z0-9-]+" />
            </label>
            <label className="field">
              <span>Tipo</span>
              <select name="type">
                <option>GAME</option>
                <option>CREATIVE</option>
                <option>PROFESSIONAL</option>
                <option>DEVELOPMENT</option>
                <option>AI</option>
              </select>
            </label>
            <label className="field full">
              <span>Descripción</span>
              <input name="description" required />
            </label>
            <WorkloadConfigurationFields />
          </div>
          <p className="form-hint">
            Los cinco pesos deben sumar 1. Los objetivos recomendados no pueden
            ser menores que los mínimos.
          </p>
          <button className="button button-dark">Crear workload</button>
        </form>
      )}
      <div className="workload-admin-grid">
        {workloads.map((workload) => (
          <WorkloadAdminCard
            key={workload.id}
            workload={workload}
            adminKey={adminKey}
            onSaved={(saved) =>
              onChange(
                workloads.map((item) => (item.id === saved.id ? saved : item)),
              )
            }
            onError={onError}
          />
        ))}
      </div>
    </div>
  );
}

function WorkloadConfigurationFields({
  draft,
  onNumberChange,
}: {
  draft?: Workload;
  onNumberChange?: (field: WorkloadNumericField, value: string) => void;
}) {
  return (
    <>
      {workloadNumericFields.map(
        ({ field, label, min, max, step, defaultValue }) => (
          <label className="field" key={field}>
            <span>{label}</span>
            <input
              name={field}
              type="number"
              min={min}
              max={max}
              step={step}
              required
              {...(draft
                ? {
                    value: draft[field],
                    onChange: (event) =>
                      onNumberChange?.(field, event.target.value),
                  }
                : { defaultValue })}
            />
          </label>
        ),
      )}
    </>
  );
}

function WorkloadAdminCard({
  workload,
  adminKey,
  onSaved,
  onError,
}: {
  workload: Workload;
  adminKey: string;
  onSaved: (item: Workload) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(workload);
  const [saving, setSaving] = useState(false);
  function number(field: WorkloadNumericField, value: string) {
    setDraft({ ...draft, [field]: Number(value) });
  }
  async function save() {
    setSaving(true);
    try {
      const numericValues = Object.fromEntries(
        workloadNumericFields.map(({ field }) => [field, draft[field]]),
      );
      const body = {
        name: draft.name,
        description: draft.description,
        ...numericValues,
      };
      const saved = await apiFetch<Workload>(
        `/admin/workloads/${workload.id}`,
        {
          method: "PATCH",
          headers: { "x-admin-key": adminKey },
          body: JSON.stringify(body),
        },
      );
      onSaved(saved);
    } catch (reason) {
      onError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <article className="workload-admin-card">
      <div>
        <span className="type-chip">{workload.type}</span>
        <strong>{workload.name}</strong>
        <small>{workload.slug}</small>
      </div>
      <WorkloadConfigurationFields draft={draft} onNumberChange={number} />
      <button
        className="save-button"
        onClick={() => void save()}
        disabled={saving}
      >
        {saving ? "Guardando…" : "Guardar perfil"}
      </button>
    </article>
  );
}
