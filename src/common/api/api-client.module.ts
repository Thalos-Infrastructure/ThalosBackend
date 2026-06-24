import { Module } from '@nestjs/common';
import { ApiClient } from './api-client';

@Module({
  providers: [ApiClient],
  exports: [ApiClient],
})
export class ApiClientModule {}
