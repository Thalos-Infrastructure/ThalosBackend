import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiClientModule } from '../common/api/api-client.module';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { AgreementActivityService } from './agreement-activity.service';

@Module({
  imports: [AuthModule, ApiClientModule],
  controllers: [AgreementsController],
  providers: [AgreementsService, AgreementActivityService],
  exports: [AgreementsService, AgreementActivityService],
})
export class AgreementsModule {}
