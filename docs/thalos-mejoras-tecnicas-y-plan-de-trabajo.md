# Thalos: mejoras técnicas y plan de trabajo

## 1. Objetivo

Thalos debe ser una plataforma de acuerdos construida sobre **Trustless Work**, con una experiencia accesible para usuarios Web2 y herramientas robustas de comunicación, evidencia y resolución de disputas.

- **Trustless Work:** escrow, funding, milestones, aprobaciones, release y settlement.
- **Thalos:** onboarding, chat, evidencia, timeline, coordinación y disputas escaladas.
- **Lendara:** onboarding Web2 y obtención simplificada de USDC.
- **Soroban:** registro verificable de evidencias, votos y resoluciones escaladas.
- **Pollar:** login, identidad y wallet custodial.

Thalos no debe reemplazar ni duplicar el escrow de Trustless Work.

---

## 2. Arquitectura objetivo

```text
Usuario Web2
    |
    v
Pollar: login + wallet custodial
    |
    v
Thalos: acuerdo + chat + evidencias + disputas
    |                         |
    v                         v
Lendara                  Soroban
Obtener USDC              Registro verificable
    |                     de evidencias y votos
    v                         |
Trustless Work <-------------+
Escrow + funding + settlement
```

| Sistema | Responsabilidad |
|---|---|
| Pollar | Autenticación, sesión y custodia de la wallet |
| Lendara | Onboarding y entrega de USDC a la wallet |
| Trustless Work | Escrow, funding, milestones, aprobación y settlement |
| Thalos | Experiencia del acuerdo, comunicación, evidencia y coordinación |
| Soroban | Registro on-chain de commitments, votos y resoluciones escaladas |

---

## 3. Mejora 1: onboarding Web2 con Lendara

### Problema

Un usuario Web2 normalmente no tiene wallet Stellar, USDC, trustline ni conocimiento de XDR o redes blockchain.

### Solución

Lendara debe aparecer como una opción de onboarding dentro del paso de funding:

1. El usuario inicia sesión en Thalos mediante Pollar.
2. Pollar proporciona la wallet custodial.
3. El usuario llega a un acuerdo pendiente de funding.
4. Thalos muestra **Obtener USDC**.
5. El backend crea una sesión de Lendara para la wallet del approver.
6. El usuario completa el flujo de sandbox.
7. Lendara envía USDC a la wallet custodial.
8. Lendara devuelve un transaction ID.
9. Thalos verifica la transacción.
10. El usuario vuelve al acuerdo.
11. Trustless Work construye la operación de funding.
12. Pollar firma la operación.
13. Trustless Work confirma el funding on-chain.

### Distinción fundamental

- Lendara **entrega USDC a la wallet**.
- Trustless Work **deposita USDC en el escrow**.

Recibir USDC desde Lendara no significa que el escrow esté fondeado.

### Reglas técnicas

- La API key de Lendara solo debe estar en el backend.
- La wallet destino debe derivarse del usuario autenticado y del acuerdo.
- El frontend no debe poder sustituir arbitrariamente la wallet destino.
- El transaction ID debe verificarse antes de mostrar el resultado como exitoso.
- El issuer de Lendara debe compararse con el issuer que espera Trustless Work.
- El acuerdo solo puede pasar a `funded` después de la confirmación on-chain de Trustless Work.

---

## 4. Mejora 2: chat por acuerdo

El chat debe estar asociado a un `agreementId` y ser el centro operativo del acuerdo.

### Funciones

- Mensajes entre empresa y proveedor.
- Mensajes del sistema.
- Comentarios relacionados con milestones.
- Subida de archivos y evidencias.
- Estado confirmado del escrow.
- Siguiente acción requerida.
- Timeline del acuerdo.
- Apertura de disputa simple.
- Solicitud de escalamiento.
- Participación de árbitros en disputas complejas.

### Eventos del timeline

- Acuerdo creado.
- Funding pendiente.
- Funding confirmado.
- Evidencia enviada.
- Milestone enviado.
- Cambios solicitados.
- Disputa abierta.
- Disputa escalada.
- Comité asignado.
- Voto registrado.
- Resolución registrada.
- Settlement pendiente.
- Settlement confirmado.

Un mensaje normal nunca debe modificar el escrow. Las operaciones críticas deben ser acciones explícitas procesadas por el backend:

- Abrir disputa.
- Enviar evidencia.
- Aceptar resolución.
- Escalar disputa.
- Votar.
- Ejecutar settlement.

---

## 5. Mejora 3: evidencia privada con registro on-chain

La información sensible debe permanecer fuera de la cadena.

### Fuera de Stellar

- Archivos originales.
- Mensajes completos.
- Datos personales.
- Metadata privada.
- Permisos de acceso.

### En Soroban

- `agreementId`.
- `disputeId`.
- Identificador del escrow de Trustless Work.
- Hash del acuerdo.
- Hash del archivo o paquete de evidencias.
- Tipo de evidencia.
- Actor que realizó la acción.
- Versión del paquete.
- Ledger o timestamp.
- Referencia de la transacción de settlement.

### Flujo

1. El usuario sube el archivo desde el chat.
2. El backend valida tipo, tamaño y permisos.
3. El archivo se guarda en almacenamiento privado.
4. El backend calcula un hash SHA-256.
5. El hash se relaciona con el acuerdo, milestone o disputa.
6. Soroban registra el commitment.
7. El chat muestra el estado del registro.

Para la primera versión, conviene agrupar archivos y mensajes en un `evidence bundle` y registrar un solo hash o Merkle root por paquete.

---

## 6. Mejora 4: disputa simple con Trustless Work

Este debe ser el primer modelo de disputa.

```text
Acuerdo activo
    -> Disputa abierta
    -> Negociación en el chat
    -> Evidencias compartidas
    -> Resolución propuesta
    -> Ambas partes aceptan
    -> Trustless Work ejecuta el settlement
    -> Settlement confirmado
```

### Posibles resultados

- Release al service provider.
- Refund al approver.
- Release de un milestone.
- Solicitud de cambios.
- Cierre sin movimiento financiero, si Trustless Work lo permite.

### Reglas

- Una parte puede abrir la disputa.
- Ninguna parte puede resolverla unilateralmente.
- La resolución necesita aceptación explícita de ambas partes.
- El backend ejecuta la acción correspondiente en Trustless Work.
- La disputa solo se cierra después de confirmar la transacción.
- El chat registra quién propuso, quién aceptó y qué transacción se ejecutó.

Estados sugeridos:

```text
none -> open -> negotiation -> resolved_by_parties -> settlement_pending -> settlement_confirmed
```

---

## 7. Mejora 5: disputa escalada con Soroban

Se utiliza cuando las partes no logran resolver el conflicto directamente.

### Modelo inicial

- Tres árbitros.
- Quorum de dos votos.
- Árbitros preconfigurados en testnet.
- Resolución inmutable después de alcanzar quorum.
- Trustless Work conserva la custodia de los fondos.

### Flujo

```text
Disputa abierta
    -> Negociación
    -> Solicitud de escalamiento
    -> Comité asignado
    -> Periodo de evidencias
    -> Votación
    -> Quorum alcanzado
    -> Resolución final en Soroban
    -> Settlement en Trustless Work
    -> Confirmación on-chain
```

### Datos registrados en Soroban

- `disputeId`.
- `agreementId`.
- Escrow ID de Trustless Work.
- Participantes autorizados.
- Árbitros.
- Quorum requerido.
- Deadline.
- Hashes de evidencias.
- Votos.
- Resultado.
- Referencia de la transacción final.

### Resultados iniciales

- `provider_release`.
- `approver_refund`.
- `no_action`.

Los releases parciales y `split_settlement` deben quedar para una etapa posterior.

### Contrato reutilizable: `DisputeRegistry`

Operaciones principales:

```text
open_dispute()
add_evidence_commitment()
submit_vote()
finalize_resolution()
link_settlement_transaction()
```

Estados:

```text
none -> open -> negotiation -> escalated -> evidence -> voting -> resolved -> linked
```

### Reglas de seguridad

- Solo participantes autorizados pueden abrir una disputa.
- Solo árbitros registrados pueden votar.
- Cada árbitro puede votar una sola vez.
- No se puede votar después del cierre.
- No se puede finalizar sin quorum.
- Una disputa resuelta no puede modificarse.
- Una resolución no puede ejecutarse dos veces.
- El escrow externo queda vinculado permanentemente.
- La transacción de Trustless Work se registra solo después de confirmarse.

El contrato no debe custodiar fondos ni reemplazar Trustless Work.

---

## 8. Fuentes de verdad

| Elemento | Fuente de verdad |
|---|---|
| Escrow y fondos | Trustless Work / Stellar |
| Funding confirmado | Trustless Work validado on-chain |
| Mensajes y archivos | Backend Thalos |
| Hashes de evidencia | Soroban |
| Disputa simple | Thalos + Trustless Work |
| Votos y quorum | Soroban |
| Settlement final | Trustless Work / Stellar |
| Timeline | Backend con eventos confirmados |

---

## 9. Cómo empezar a trabajar

### Fase 0: definición técnica

1. Confirmar que Trustless Work V1 seguirá siendo la versión utilizada.
2. Documentar endpoints de creación, funding, evidencia, aprobación, release, disputa y sync.
3. Definir el modelo de datos del chat.
4. Definir permisos por acuerdo.
5. Definir estados de disputa simple y escalada.
6. Confirmar la integración de Lendara en sandbox.
7. Definir qué datos se registrarán como hashes en Soroban.
8. Definir los árbitros de testnet.

**Resultado:** contrato técnico aprobado por frontend, backend y producto.

### Fase 1: estabilizar Trustless Work

1. Confirmar creación del escrow.
2. Confirmar funding con la wallet custodial de Pollar.
3. Completar firma, envío y sincronización on-chain.
4. Confirmar estados `pending`, `confirmed` y `failed`.
5. Probar single-release y multi-release.
6. Verificar roles, receiver, issuer y platform address.
7. Confirmar que la wallet no se desconecte durante funding.

Esta fase es obligatoria. El chat y las disputas dependen del estado correcto del acuerdo.

### Fase 2: implementar el chat

#### Backend

- Mensajes por `agreementId`.
- Validación de participantes.
- Persistencia y paginación.
- Mensajes del sistema.
- Eventos para timeline.

#### Frontend

- Conversación dentro del detalle del acuerdo.
- Estados de carga y error.
- Envío de mensajes.
- Actualización periódica o tiempo real.
- Timeline.
- Acciones de funding, evidencia y disputa.

**Resultado:** chat funcional conectado al lifecycle del acuerdo.

### Fase 3: evidencias y commitments

1. Implementar upload privado.
2. Validar tamaño, tipo y permisos.
3. Calcular el hash en backend.
4. Asociar evidencia con acuerdo, milestone y disputa.
5. Crear bundles de evidencia.
6. Registrar su hash en Soroban.
7. Mostrar el estado del commitment en el chat.

### Fase 4: disputa simple

1. Abrir la disputa desde el chat.
2. Permitir negociación y evidencias.
3. Crear una propuesta de resolución.
4. Solicitar aceptación de ambas partes.
5. Ejecutar la acción compatible de Trustless Work.
6. Esperar confirmación on-chain.
7. Cerrar la disputa y registrar el evento.

### Fase 5: disputa escalada

1. Solicitar escalamiento.
2. Asignar tres árbitros.
3. Registrar la disputa en Soroban.
4. Registrar commitments de evidencia.
5. Abrir la votación.
6. Validar un voto por árbitro.
7. Finalizar con quorum 2 de 3.
8. Registrar la resolución inmutable.
9. Preparar la acción de Trustless Work.
10. Confirmar el settlement.
11. Vincular la transacción final con la disputa.

### Fase 6: integrar Lendara

1. Crear el endpoint backend para iniciar la sesión.
2. Asociar la sesión con usuario, acuerdo y approver.
3. Abrir el widget desde funding.
4. Recibir el transaction ID.
5. Verificar la transacción.
6. Actualizar el balance disponible.
7. Regresar al acuerdo.
8. Continuar con funding de Trustless Work.

Lendara debe integrarse después de estabilizar wallet y funding.

---

## 10. PRs recomendados

### PR 1 — Backend: contrato y estado del acuerdo

- Separar creación, funding y sync.
- Confirmar Trustless Work como fuente financiera.
- Validar estados `pending`, `confirmed` y `failed`.
- Probar single-release y multi-release.

### PR 2 — Backend y frontend: chat por acuerdo

- Mensajes persistidos.
- Permisos.
- Timeline.
- Estados de carga y error.

### PR 3 — Backend y frontend: evidencias privadas

- Upload.
- Hash.
- Permisos.
- Asociación con acuerdo y milestone.

### PR 4 — Soroban: `DisputeRegistry` inicial

- Abrir disputa.
- Registrar evidencia.
- Emitir eventos.
- Tests en testnet.

### PR 5 — Backend y frontend: disputa simple

- Abrir desde el chat.
- Negociar.
- Aceptar resolución.
- Ejecutar Trustless Work.
- Confirmar settlement.

### PR 6 — Soroban: comité y quorum

- Árbitros.
- Votos.
- Quorum 2 de 3.
- Resolución inmutable.

### PR 7 — Backend y frontend: disputa escalada

- Solicitud de escalamiento.
- Vista para árbitros.
- Votación.
- Lectura de resolución.
- Conexión con Trustless Work.

### PR 8 — Lendara: onboarding y funding assistant

- Crear sesión.
- Abrir widget.
- Validar transaction ID.
- Regresar al acuerdo.

### PR 9 — Demo y documentación

- Flujo completo reproducible.
- Hashes de transacciones.
- Guía de instalación.
- Modelo de amenazas.
- Limitaciones conocidas.

---

## 11. Prioridad para HackMeridian

Si el tiempo es limitado, el orden recomendado es:

1. Trustless Work funcionando correctamente.
2. Chat por acuerdo funcional.
3. Evidencia privada con hash.
4. Disputa simple desde el chat.
5. `DisputeRegistry` mínimo en Soroban.
6. Comité con quorum.
7. Lendara como onboarding Web2.

Si no alcanza el tiempo para todo, conservar primero el flujo base, el chat y la disputa simple. Lendara puede presentarse como integración de onboarding y el comité como una demo de testnet.

---

## 12. Demo recomendada

1. Un usuario Web2 inicia sesión en Thalos.
2. Lendara permite obtener USDC.
3. Trustless Work crea y fondea el escrow.
4. Las partes se comunican en el chat.
5. El proveedor sube evidencia.
6. El archivo permanece privado y su hash se registra en Soroban.
7. Las partes abren una disputa simple.
8. Las partes aceptan una resolución.
9. Trustless Work confirma el settlement.
10. Si no hay acuerdo, la disputa se escala.
11. El comité vota 2 de 3.
12. Soroban registra la resolución.
13. Trustless Work ejecuta el settlement final.

---

## 13. Mensaje central

> **Trustless Work maneja el dinero. Thalos maneja la relación, la evidencia y la resolución. Lendara incorpora usuarios Web2 a Stellar. Soroban hace verificable y reutilizable la disputa compleja.**
