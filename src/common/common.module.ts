import { Module } from '@nestjs/common';
import { ApiClientModule } from './api/api-client.module';

@Module({
  imports: [ApiClientModule],
  exports: [ApiClientModule],
})
export class CommonModule {}
