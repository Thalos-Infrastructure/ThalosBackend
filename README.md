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
- `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`: transactional email via Resend. Los nombres (`EMAIL_FROM`, `EMAIL_REPLY_TO`) coinciden con el frontend (`lib/email/resend.ts`) para mantener la configuración sincronizada. Hay defaults razonables en `NotificationsService` si no se setean; sobreescribilos cuando migres a un nuevo dominio verificado.
- El backend carga `.env.local` además de `.env` (en ese orden) vía `ConfigModule.forRoot({ envFilePath: [".env.local", ".env"] })`.

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
| `POST /v1/internal/notifications/*` | Header `x-thalos-internal-secret` | Disparo manual de notificaciones (`agreement-created`, `agreement-funded`, `evidence-submitted`, `milestone-approved`, `dispute-opened`, `dispute-resolved`, `agreement-completed`, `custom`) |
| `POST /v1/trustless/prepare` | Bearer JWT app | Mismo relay que arriba; respuesta incluye `unsignedTransaction` cuando TW la envía |
| `GET|POST|PATCH /v1/agreements/*` | Bearer JWT app | CRUD acuerdos en Supabase |
| `GET /v1/users/search` | Bearer JWT | Búsqueda de perfiles |
| `GET|POST|DELETE /v1/contacts` | Bearer JWT | Contactos |

El navegador debe llamar al front en `/api/thalos/...` y `/api/trustless/relay` para no exponer secretos ni pelear CORS.

## Tests

```bash
pnpm test          # corre los specs (jest + ts-jest)
pnpm run build     # typecheck + build (excluye *spec.ts via tsconfig.build.json)
```

Los specs viven junto a sus módulos (`*.spec.ts`) y están excluidos de `nest build`. El typecheck completo (sources + specs) se hace con `tsconfig.spec.json`.

## Documentación de alcance

Ver [docs/SCOPE.md](docs/SCOPE.md).
