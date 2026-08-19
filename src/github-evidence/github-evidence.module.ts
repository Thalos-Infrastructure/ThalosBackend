import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { GitHubEvidenceController } from './github-evidence.controller';
import { GitHubEvidenceService } from './github-evidence.service';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [GitHubEvidenceController],
  providers: [GitHubEvidenceService],
  exports: [GitHubEvidenceService],
})
export class GitHubEvidenceModule {}
