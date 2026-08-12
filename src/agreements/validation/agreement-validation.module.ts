import { Module } from '@nestjs/common';
import { AgreementValidationService } from './agreement-validation.service';

@Module({
  providers: [AgreementValidationService],
  exports: [AgreementValidationService],
})
export class AgreementValidationModule {}
