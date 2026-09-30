# Escrow V1 — auditoría y contrato (PR1)

Checklist de backend alineado al plan Manu + skill Trustless Work **V1** (producción).
Sin cambiar aún el flujo create/fund/confirm; documentar y verificar.

## Constantes canónicas

| Campo | Valor | Notas |
|-------|--------|------|
| `platformAddress` | `GBMJTAVJFAKMKLXYXGXACBFGIFS62A7DT46PFHQ3W4RG7CG4HVESSNRY` | Override: `PLATFORM_ADDRESS` / FE `NEXT_PUBLIC_PLATFORM_ADDRESS` |
| `disputeResolver` | `GB6MP3L6UGIDY6O6MXNLSKHLXT2T2TCMPZIZGUTOGYKOLHW7EORWMFCK` | Override: `DISPUTE_RESOLVER` |
| USDC issuer testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `STELLAR_NETWORK=testnet` |
| USDC issuer mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | `STELLAR_NETWORK=mainnet` |

Fuente FE: `ThalosFrontend/lib/config.ts`  
Fuente BE: `ThalosBackend/src/internal-trustless/escrow-write.helper.ts`

## Endpoints (Nest relay → TW V1)

| Acción | Nest (aprox.) | TW path |
|--------|---------------|---------|
| Create single | `POST /escrows/create` (+ type) | `/deployer/single-release` o `/escrow/single-release/v1/...` según relay |
| Create multi | idem | multi-release deployer |
| Fund | `POST /escrows/fund` | `.../fund-escrow` |
| Approve | approve-milestone | `.../approve-milestone` |
| Evidence / status | change-milestone-status | `.../change-milestone-status` |
| Release single | release | `.../release-funds` |
| Release multi | release + milestoneIndex **string** | `.../release-milestone-funds` |
| Dispute single | dispute (sin milestoneIndex) | `.../dispute-escrow` |
| Dispute multi | dispute + milestoneIndex string | `.../dispute-milestone` |
| Submit XDR | send-transaction | `/helper/send-transaction` |

Verificar en código: `escrow-write.helper.ts`, `escrows.controller.ts`.

## Roles V1 (quién firma qué)

| Acción | Rol / firmante |
|--------|----------------|
| Deploy | `signer` (deploy) — no otorga rol en el escrow |
| Fund | Cualquier depositor on-chain; **producto Thalos**: UI solo approver |
| Evidence / status | `serviceProvider` |
| Approve | `approver` |
| Release | `releaseSigner` |
| Open dispute | approver, serviceProvider, releaseSigner, receiver, platform — **no** disputeResolver |
| Resolve dispute | `disputeResolver` |

## Reglas a verificar en auditoría

- [ ] `platformAddress` inyectado = constante canónica (no hardcodes viejos FE/BE).
- [ ] Issuer USDC = red activa (`STELLAR_NETWORK`).
- [ ] `receiver` single = service provider (o el party acordado); multi = receiver **por milestone**.
- [ ] Single y multi usan paths separados.
- [ ] Create/deploy **no** marca el acuerdo Nest como `funded`.
- [ ] Confirmar funded con query TW (`validateOnChain=true`) / balance on-chain, no solo respuesta HTTP del deploy.
- [ ] Dispute V1: **sin** `reason` en payload TW (motivo solo en Thalos DB/chat).
- [ ] `amount` number; `milestoneIndex` string.

## Siguiente (PR2)

Separar create / fund / confirm; exponer `pending | confirmed | failed` al FE; permitir que el approver fondee aunque no haya creado el escrow.
