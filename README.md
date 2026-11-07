# NovaRealm

NovaRealm mantiene su catálogo, fitScore y flujo comercial en NestJS. Nova usa
un proveedor configurable: Ollama para desarrollo o Cloudflare Workers AI en
producción. Los datos viven en libSQL/Turso, sin archivos persistentes en
Vercel.

## Desarrollo local

Requiere Node.js 22+, npm y Ollama si se usará Nova.

```powershell
cd back-nova-realm
Copy-Item .env.example .env
npm install
npm run db:seed
npm run start:dev
```

En otra terminal:

```powershell
cd front-nova-realm
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abre `http://localhost:3000`. Para Ollama:

```powershell
ollama pull qwen3.5:4b
ollama serve
```

La configuración local mínima del backend es:

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
DATABASE_URL=file:./data/novarealm.db
FRONTEND_URL=http://localhost:3000
ADMIN_API_KEY=cambia-esta-clave
```

`data/novarealm.db` se conserva como respaldo. Si se omite `DATABASE_URL` en
local, el backend conserva la compatibilidad con `DATABASE_PATH`; Vercel exige
`DATABASE_URL` para evitar usar un archivo efímero.

## Turso/libSQL

1. Crea una base de datos en Turso y obtiene su URL y token.
2. Configura en `back-nova-realm/.env` o en las variables de Vercel:

```dotenv
DATABASE_URL=libsql://tu-base-tu-organizacion.turso.io
DATABASE_AUTH_TOKEN=tu-token-de-turso
```

3. Ejecuta el seed contra esa base:

```powershell
cd back-nova-realm
npm run db:seed
```

El comando crea las tablas, inserta el catálogo demo en una base vacía e inserta
workloads que aún no existan sin sobrescribir cambios hechos desde admin.

## Cloudflare Workers AI

Configura en el backend, nunca en `NEXT_PUBLIC_*`:

```dotenv
AI_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=tu-account-id
CLOUDFLARE_AI_TOKEN=tu-workers-ai-token
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct
```

El token debe tener permisos de Workers AI. Nova llama directamente al endpoint
`/accounts/{ACCOUNT_ID}/ai/run/{MODEL}` con Bearer token. Si el proveedor está
inaccesible, los endpoints de Nova devuelven un `503` controlado; catálogo,
recomendaciones y administración siguen disponibles. El modelo configurado debe
admitir `messages`; para la interpretación estructurada conviene usar uno con
JSON mode.

## Variables de entorno

Backend (`back-nova-realm/.env`):

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto local de Nest, por defecto `3001` |
| `FRONTEND_URL` | Origen u orígenes CORS separados por coma |
| `DATABASE_URL` | URL `libsql://...` de Turso o `file:./data/novarealm.db` local |
| `DATABASE_AUTH_TOKEN` | Token de Turso; vacío para `file:` local |
| `ADMIN_API_KEY` | Clave para `/api/admin/*` |
| `AI_PROVIDER` | `ollama` o `cloudflare` |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` | Configuración local de Ollama |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_AI_MODEL`, `CLOUDFLARE_AI_TIMEOUT_MS` | Workers AI; el token es privado y nunca debe usar prefijo `NEXT_PUBLIC_` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_FOLDER` | Cargas de imágenes existentes |

Frontend (`front-nova-realm/.env.local`):

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
NEXT_PUBLIC_CONTACT_EMAIL=hola@novarealm.co
NEXT_PUBLIC_SUPPORT_EMAIL=soporte@novarealm.co
NEXT_PUBLIC_WHATSAPP_NUMBER=573001234568
NEXT_PUBLIC_PHONE_LABEL=+57 300 123 4567
```

Solo `NEXT_PUBLIC_*` llega al navegador. No pongas tokens de Turso, Cloudflare,
Cloudinary ni `ADMIN_API_KEY` allí.

## Despliegue en Vercel

### Backend Nest

1. Importa el repositorio como un proyecto nuevo de Vercel con `back-nova-realm`
   como **Root Directory**.
2. Usa `npm run build` como Build Command e instala con `npm install`.
3. Agrega las variables de producción: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`,
   `AI_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`,
   `CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_AI_MODEL`, `FRONTEND_URL` y una
   `ADMIN_API_KEY` fuerte. Conserva las variables Cloudinary si usas imágenes.
4. Despliega. Las funciones `api/index.ts` y `api/[...path].ts` inicializan la
   app Nest y exponen las rutas existentes, por ejemplo
   `https://tu-api.vercel.app/api/products`.

### Frontend Next

1. Importa el mismo repositorio como otro proyecto de Vercel con
   `front-nova-realm` como **Root Directory**.
2. Define `NEXT_PUBLIC_API_URL=https://tu-api.vercel.app/api` y las variables
   públicas de contacto o Cloudinary que necesites.
3. Despliega y copia el dominio del frontend en `FRONTEND_URL` del backend.
   Para previews u otros dominios, sepáralos con comas.

`NEXT_PUBLIC_API_URL` se incorpora durante el build de Next, así que vuelve a
desplegar el frontend después de cambiarla.

## Verificación

```powershell
cd back-nova-realm
npm run build
npm test -- --runInBand
npm run db:seed

cd ../front-nova-realm
npm run build
```

Con `AI_PROVIDER=ollama`, prueba Nova con Ollama encendido. Con
`AI_PROVIDER=cloudflare`, prueba en `/nova` un mensaje como: `Quiero un PC para
Blender y Warzone por 5 millones`. Nova interpreta, aplica filtros sobre PCs
reales, conserva fitScore y devuelve una explicación basada en resultados
verificados.
