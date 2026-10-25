import { IsIn, IsString, IsUUID, Matches } from 'class-validator';

/** Currencies Lendara's sandbox supports. */
const FIAT_CURRENCIES = ['CRC', 'ARS', 'CLP'] as const;

export class CreateLendaraSessionDto {
  @IsUUID()
  agreement_id: string;

  @IsIn(FIAT_CURRENCIES)
  fiat_currency: string;

  /** Fiat amount, as a decimal string. Lendara takes it as a string. */
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount must be a positive decimal' })
  amount: string;
}

export class VerifyLendaraSessionDto {
  @IsUUID()
  agreement_id: string;

  /**
   * The session, not a wallet: the destination is recomputed server-side, so
   * nothing the client sends can redirect where the money is expected.
   */
  @IsString()
  session_id: string;
}
