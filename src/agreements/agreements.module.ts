import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiClientModule } from '../common/api/api-client.module';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { AgreementsBackendClient } from './agreements-backend.client';

@Module({
  imports: [AuthModule, ApiClientModule],
  controllers: [AgreementsController],
  providers: [AgreementsService, AgreementsBackendClient],
  exports: [AgreementsService, AgreementsBackendClient],
})
export class AgreementsModule {}
