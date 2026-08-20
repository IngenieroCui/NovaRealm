# NovaRealm — MVP funcional

NovaRealm es una tienda demo de computadores y componentes con una asesora local, Nova. La conversación se interpreta con Ollama; los productos, precios, stock y porcentajes siempre salen del backend y de SQLite.

## Puesta en marcha

Requisitos: Node.js 22 o superior, npm y [Ollama](https://ollama.com/). No requiere Docker ni un servidor de base de datos.

### 1. Backend y base de datos

```powershell
cd back-nova-realm
Copy-Item .env.example .env
npm install
npm run seed
npm run start:dev
```

La API queda en `http://localhost:3001/api`. SQLite se crea en `back-nova-realm/data/novarealm.db`. El seed es idempotente y también se ejecuta automáticamente al primer inicio.

Para regenerar por completo los datos demo: detén el backend, elimina `data/novarealm.db`, `data/novarealm.db-shm` y `data/novarealm.db-wal`, y ejecuta `npm run seed` otra vez.

### 2. Ollama

```powershell
ollama pull qwen3.5:4b
ollama serve
```

El modelo se puede cambiar sin modificar código usando `OLLAMA_MODEL`. Si Ollama está apagado, catálogo, administración y recomendaciones estructuradas siguen funcionando; únicamente `/assistant/chat` y `/assistant/compare` devuelven un error amigable.

### 3. Frontend

En otra terminal:

```powershell
cd front-nova-realm
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abre `http://localhost:3000`.

Rutas principales:

- `/`: landing y consultas de ejemplo.
- `/productos`: catálogo, búsqueda, filtros y ordenamiento.
- `/productos/[slug]`: ficha de equipo.
- `/nova`: conversación, recomendaciones reales y comparador de 2–3 equipos.
- `/admin`: gestión básica de productos y workloads.

La clave del admin es `ADMIN_API_KEY`. Si no se define, el valor local de desarrollo es `novarealm-demo`.

## Variables de entorno

Backend (`back-nova-realm/.env`):

| Variable | Valor local | Uso |
| --- | --- | --- |
| `PORT` | `3001` | Puerto REST |
| `FRONTEND_URL` | `http://localhost:3000` | Orígenes CORS, separados por coma |
| `DATABASE_PATH` | `./data/novarealm.db` | Archivo SQLite |
| `ADMIN_API_KEY` | `cambia-esta-clave` | Protección de `/api/admin/*` |
| `CLOUDINARY_CLOUD_NAME` | *(vacío)* | Nombre del cloud usado para subir imágenes de productos |
| `CLOUDINARY_API_KEY` | *(vacío)* | API key de Cloudinary para firmar cargas |
| `CLOUDINARY_API_SECRET` | *(vacío)* | Secreto de Cloudinary; sólo vive en el backend |
| `CLOUDINARY_UPLOAD_FOLDER` | `novarealm/products` | Carpeta destino de las fotos de producto |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Servidor Ollama |
| `OLLAMA_MODEL` | `qwen3.5:4b` | Modelo local intercambiable |
| `OLLAMA_TIMEOUT_MS` | `45000` | Tiempo máximo por llamada |

Frontend (`front-nova-realm/.env.local`):

| Variable | Valor local | Uso |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api` | Dirección de la API |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | *(vacío)* | Nombre de tu cloud de Cloudinary; habilita valores `cloudinary:carpeta/imagen` en el catálogo |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hola@novarealm.co` | Correo público del footer |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `soporte@novarealm.co` | Correo de soporte del footer |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | `573001234567` | Número de WhatsApp, sólo dígitos con código de país |
| `NEXT_PUBLIC_PHONE_LABEL` | `+57 300 123 4567` | Texto visible para el teléfono |

Nunca coloques la clave admin ni secretos en variables `NEXT_PUBLIC_*`.

### Fotos de productos con Cloudinary

Configura `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` del backend con los valores de tu cuenta de Cloudinary; `CLOUDINARY_UPLOAD_FOLDER` es opcional. Reinicia la API. En `/admin`, al crear un producto, selecciona una foto: el navegador solicita una firma de corta duración protegida por la clave de administración y carga el archivo directamente a Cloudinary. La URL segura devuelta queda guardada en el catálogo.

La foto es opcional. Si no se adjunta una foto ni se indica una URL o identificador existente, el producto conserva el SVG básico actual (`pc-cyan.svg` para equipos y `component.svg` para componentes). El mismo fallback se usa si una imagen remota deja de cargar.

## Cómo funciona

```text
Mensaje del usuario
  → AiService / Ollama convierte texto en filtros validados
  → RecommendationService aplica stock, actividad, presupuesto y mínimos
  → calcula performanceFit, budgetFit, valueFit y upgradeabilityFit
  → clasifica alternativas únicas
  → Ollama explica únicamente el JSON real calculado por NestJS
```

La fórmula MVP está en `back-nova-realm/src/recommendations/recommendations.service.ts`. Es determinista y devuelve las categorías `BEST_MATCH`, `BEST_VALUE`, `BUDGET_OPTION` y `PREMIUM_OPTION`. Los multiplicadores de resolución/FPS son criterios internos del score, no benchmarks ni promesas de FPS.

Los datos demo iniciales están en `back-nova-realm/src/database/seed-data.ts`:

- 18 computadores prearmados.
- 10 procesadores, 12 tarjetas gráficas y componentes complementarios.
- 20 workloads entre juegos, creación, CAD, desarrollo, virtualización e IA local.

Todos los precios son demo en pesos colombianos.

## Endpoints

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/products` | Catálogo; acepta `search`, `type` o `types`, `minPrice`, `maxPrice`, mínimos de RAM/SSD/VRAM/rendimiento, `inStock` y `sort` |
| `GET` | `/api/products/:slug` | Detalle público |
| `GET` | `/api/workloads` | Lista de juegos y aplicaciones |
| `GET` | `/api/workloads/:slug` | Detalle del workload |
| `POST` | `/api/recommendations` | Recomendación determinista con filtros estructurados |
| `POST` | `/api/assistant/chat` | Interpretación, recomendación y explicación con Ollama |
| `POST` | `/api/assistant/compare` | Explicación de 2–3 resultados verificados |
| `GET/POST/PATCH` | `/api/admin/products` | Administración con header `x-admin-key` |
| `POST` | `/api/admin/media/cloudinary-signature` | Firma temporal para subir una foto a Cloudinary; requiere `x-admin-key` |
| `GET/POST/PATCH` | `/api/admin/workloads` | Administración con header `x-admin-key` |

Ejemplo sin IA:

```powershell
$body = @{
  budgetMax = 5000000
  resolution = "1440p"
  targetFps = 144
  workloads = @(
    @{ slug = "warzone"; importance = 0.6 }
    @{ slug = "blender"; importance = 0.4 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod http://localhost:3001/api/recommendations `
  -Method Post -ContentType "application/json" -Body $body
```

## Agregar y mantener datos

Para cambios normales usa `/admin`:

1. Crea el producto o workload.
2. Ajusta precio, stock y estado sin reiniciar.
3. Para un PC, completa CPU, GPU, RAM, almacenamiento, VRAM y scores internos 0–100.
4. Para un workload, define mínimos, recomendados y pesos que sumen `1`.

Para cambiar el catálogo base de una instalación nueva, edita `seed-data.ts`. El seed no sobrescribe registros existentes.

## Cómo escalarlo

- **Más atributos:** añade la columna en `DatabaseService`, DTOs y tipos; después úsala en `scoreWorkload`. Mientras el MVP use SQLite, documenta cada `ALTER TABLE` o recrea la base local. Al haber varios entornos, incorpora migraciones versionadas.
- **PostgreSQL/ORM:** las consultas están aisladas en `CatalogService`, `WorkloadsService` y `DatabaseService`. Sustituye esa capa por Prisma/Drizzle/TypeORM sin cambiar los contratos REST ni la UI.
- **Más reglas de recomendación:** crea una nueva versión de fórmula en `RecommendationsService`, mantenla determinista y devuelve la versión usada. No pases el cálculo al LLM.
- **Otro modelo/proveedor:** cambia `OLLAMA_MODEL`; para otro proveedor implementa la misma frontera que `AiService`, manteniendo validación y prompts en backend.
- **Autenticación real:** reemplaza `AdminGuard` por sesiones/JWT y usuarios antes de publicar. La API key actual es deliberadamente básica para el MVP.
- **Imágenes reales:** el formulario de `/admin` sube fotos a Cloudinary cuando el backend tiene sus variables `CLOUDINARY_*`. También se admite una URL completa, una ruta dentro de `public/products` o `cloudinary:carpeta/imagen` en `Product.imageUrl`; define `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` para esta última forma. Si falta o falla una imagen, la interfaz usa los recursos configurados en `front-nova-realm/lib/site-config.ts`.
- **Producción:** cambia SQLite por PostgreSQL si habrá escrituras concurrentes, establece secretos fuertes, HTTPS, CORS exacto, rate limiting y backups.

## Verificación

```powershell
cd back-nova-realm
npm run lint
npm test -- --runInBand
npm run build

cd ../front-nova-realm
npm run lint
npm run build
```

El MVP fue validado con casos de Valorant bajo 3 millones, Warzone 1440p con 5 millones, Blender + Premiere y Docker + máquinas virtuales. También se comprobó el fallback sin Ollama, DTOs inválidos y protección del admin.
