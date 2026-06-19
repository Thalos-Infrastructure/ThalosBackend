# Thalos Backend (NestJS)

API para acuerdos en Supabase, contactos, búsqueda de perfiles y relay interno hacia Trustless Work (clave solo en servidor).

## Requisitos

- Node.js 20+
- pnpm o npm
- Proyecto Supabase con las tablas usadas por el frontend (`agreements`, `agreement_participants`, `agreement_activity`, `profiles`, `contacts`, `auth_users`, …). Migraciones recomendadas: `009_agreements_contract_id.sql`, `010_agreements_nest_columns.sql` (columnas y checks que espera Nest).

## Variables de entorno

Copiá `.env.example` a `.env` y completá valores. `JWT_SECRET` debe coincidir con el del frontend (`ThalosFrontend`).

- `SUPABASE_URL`: misma URL pública del proyecto (sin depender de `NEXT_PUBLIC` en Nest).
- `THALOS_INTERNAL_SECRET`: compartido con Next en `THALOS_INTERNAL_SECRET` para `/api/trustless/relay`.
- `TRUSTLESSWORK_API_URL` / `TRUSTLESSWORK_API_KEY`: API de Trustless Work; la clave vive **solo** acá.
- `PLATFORM_ADDRESS`, `DISPUTE_RESOLVER`, `TRUSTLINE_USDC_ADDRESS` (opcionales): config de plataforma para crear escrows; tienen defaults de testnet.

## Arranque

```bash
pnpm install
pnpm run start:dev
```

Por defecto escucha en el puerto **3001**.

- **Documentación interactiva (Swagger UI):** `http://localhost:3001/v1/docs`
- **OpenAPI JSON:** `http://localhost:3001/v1/docs-json`
- **Raíz del API (punteros):** `GET http://localhost:3001/v1`

## Rutas principales

| Prefijo | Auth | Descripción |
|--------|------|-------------|
| `POST /v1/internal/trustless/relay` | Header `x-thalos-internal-secret` | Proxy hacia Trustless Work (solo servidor Next) |
| `POST /v1/trustless/prepare` | Bearer JWT app | Mismo relay que arriba; respuesta incluye `unsignedTransaction` cuando TW la envía |
| `GET /v1/escrows/by-signer/:address` · `GET /v1/escrows/by-role` | Bearer JWT app | Lectura de escrows (relay a TW) |
| `POST /v1/escrows/{create,fund,approve-milestone,change-milestone-status,release,dispute}` | Bearer JWT app | Escrituras de escrow; devuelven `unsignedTransaction` para firmar en el cliente. Validan que el firmante == wallet del JWT |
| `POST /v1/escrows/send-transaction` | Bearer JWT app | Envía a la red el XDR ya firmado |
| `GET|POST|PATCH /v1/agreements/*` | Bearer JWT app | CRUD acuerdos en Supabase |
| `GET /v1/users/search` | Bearer JWT | Búsqueda de perfiles |
| `GET|POST|DELETE /v1/contacts` | Bearer JWT | Contactos |

El navegador debe llamar al front en `/api/thalos/...` y `/api/trustless/relay` para no exponer secretos ni pelear CORS.

## Documentación de alcance

Ver [docs/SCOPE.md](docs/SCOPE.md).
