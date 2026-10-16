import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { relayToTrustless } from './trustless-relay.helper';

/**
 * Evidence may only be submitted once the escrow holds funds.
 *
 * The Trustless Work contract does not enforce this: `change_milestone_status`
 * only checks that the caller is the service provider and that the escrow is not
 * released or resolved. Without this guard a provider can mark work delivered on
 * an escrow nobody funded (seen on testnet contract CA6DQZ…AG3F, 2026-10-16).
 *
 * Fails closed: if Trustless Work cannot tell us the balance, the evidence is
 * refused with 503 and the provider can retry, rather than letting it through.
 */
export async function assertEscrowFunded(contractId: string): Promise<void> {
  const res = await relayToTrustless('GET', 'helper/get-escrow-by-contract-ids', {
    'contractIds[]': contractId,
    validateOnChain: true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new ServiceUnavailableException(
      'Could not verify the escrow balance on Trustless Work. Try again in a moment.',
    );
  }

  const escrows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  const escrow = (escrows as Array<{ contractId?: string; balance?: unknown }>).find(
    (e) => e?.contractId === contractId,
  );
  if (!escrow) {
    throw new ServiceUnavailableException(
      `Escrow ${contractId} is not indexed on Trustless Work yet. Try again in a moment.`,
    );
  }

  const balance = Number(escrow.balance);
  if (!Number.isFinite(balance) || balance <= 0) {
    throw new BadRequestException(
      'This escrow has not been funded yet. Evidence can only be submitted after funding.',
    );
  }
}
