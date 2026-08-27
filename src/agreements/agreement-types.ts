/**
 * Agreement type vocabulary (`agreements.agreement_type`).
 *
 * `single` / `multi` are the only values this service ever writes — the
 * validator ties them to the milestone count (one milestone → `single`, many →
 * `multi`) and `MilestoneSyncService` maps them onto Trustless Work's
 * `single-release` / `multi-release` service types.
 *
 * `standard` and `bounty` are legacy values that predate the Nest backend and
 * are still accepted by the Postgres CHECK constraint on the column, so rows
 * carrying them exist and must stay filterable.
 */

export const AGREEMENT_TYPES = ['single', 'multi', 'standard', 'bounty'] as const;

export type AgreementType = (typeof AGREEMENT_TYPES)[number];

export function isAgreementType(value: unknown): value is AgreementType {
  return (AGREEMENT_TYPES as readonly unknown[]).includes(value);
}
