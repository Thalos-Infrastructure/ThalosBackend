# Alcance implementado (decisiones cerradas)

Este documento fija las decisiones del plan sin modificar el archivo de plan original.

| Tema | Decisión |
|------|----------|
| «Personas conectadas» | **Directorio buscable** (perfiles en Supabase). Sin presencia WebSocket en esta fase. |
| Nest vs Next | **Híbrido**: Trustless Work se invoca desde el navegador vía **ruta API en Next** que reenvía a Nest con secreto interno (así usuarios solo-wallet no exponen claves). Acuerdos, búsqueda de usuarios y contactos se exponen en Nest con **JWT de aplicación** (`JWT_SECRET`, mismo que `/api/auth/me`). |
| Nombre / apellido | Sin migración SQL: búsqueda sobre **`display_name`**, `email` y `wallet_address` (paridad con `searchThalosUsers`). |
| Trustless Work | El **usuario sigue firmando** en el cliente (XDR); Nest solo añade `x-api-key` y reenvía a la API de Trustless Work. |

Variables relevantes: ver [`.env.example`](../.env.example) en la raíz del backend.
