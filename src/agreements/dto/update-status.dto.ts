import { IsIn, IsString } from 'class-validator';
import { AGREEMENT_STATUSES } from '../agreement-lifecycle';

export class UpdateAgreementStatusDto {
  @IsString()
  @IsIn([...AGREEMENT_STATUSES])
  status: string;

  @IsString()
  actor_wallet: string;
}
