import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { AgreementActivityService } from './agreement-activity.service';
import { AgreementSyncModule } from './sync/agreement-sync.module';
import { AgreementValidationModule } from './validation/agreement-validation.module';
import { MilestoneSyncModule } from './milestone-sync/milestone-sync.module';

@Module({
  imports: [AuthModule, AgreementSyncModule, AgreementValidationModule, MilestoneSyncModule],
  controllers: [AgreementsController],
  providers: [AgreementsService, AgreementActivityService],
  exports: [AgreementsService, AgreementActivityService],
})
export class AgreementsModule {}
