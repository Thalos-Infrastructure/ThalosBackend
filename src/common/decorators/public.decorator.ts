import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'thalos:isPublic';

/**
 * Marks a route as reachable WITHOUT an app JWT. {@link JwtAuthGuard} reads this
 * metadata and short-circuits, so a `@Public()` handler stays open even inside a
 * controller guarded at class level.
 *
 * Use it only for data that is already public (e.g. on-chain escrow reads), and
 * always pair it with `ThrottlerGuard`: these handlers still spend our
 * server-side Trustless Work API key, so an open one is a quota drain.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
