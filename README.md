# Thalos Backend (NestJS)

API para acuerdos en Supabase, contactos, búsqueda de perfiles y relay interno hacia Trustless Work (clave solo en servidor).

## Requisitos

- Node.js 20+
- pnpm o npm
- Proyecto Supabase con las tablas usadas por el frontend (`agreements`, `agreement_participants`, `agreement_activity`, `profiles`, `contacts`, `auth_users`, …)

## Variables de entorno

Copiá `.env.example` a `.env` y completá valores. `JWT_SECRET` debe coincidir con el del frontend (`ThalosFrontend`).

- `SUPABASE_URL`: misma URL pública del proyecto (sin depender de `NEXT_PUBLIC` en Nest).
- `THALOS_INTERNAL_SECRET`: compartido con Next en `THALOS_INTERNAL_SECRET` para `/api/trustless/relay`.

## Arranque

```bash
pnpm install
pnpm run start:dev
```

Por defecto escucha en el puerto **3001**.

## Rutas principales

| Prefijo | Auth | Descripción |
|--------|------|-------------|
| `POST /v1/internal/trustless/relay` | Header `x-thalos-internal-secret` | Proxy hacia Trustless Work (solo servidor Next) |
| `POST /v1/trustless/prepare` | Bearer JWT app | Mismo relay que arriba; respuesta incluye `unsignedTransaction` cuando TW la envía |
| `GET|POST|PATCH /v1/agreements/*` | Bearer JWT app | CRUD acuerdos en Supabase |
| `GET /v1/users/search` | Bearer JWT | Búsqueda de perfiles |
| `GET|POST|DELETE /v1/contacts` | Bearer JWT | Contactos |

El navegador debe llamar al front en `/api/thalos/...` y `/api/trustless/relay` para no exponer secretos ni pelear CORS.

## Documentación de alcance

Ver [docs/SCOPE.md](docs/SCOPE.md).
