import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUserCtx } from '../auth/current-user.decorator';
import { KycService } from './kyc.service';
import { CreateKycSessionDto } from './dto/kyc.dto';

@ApiTags('kyc')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('session')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a KYC verification session' })
  async createSession(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateKycSessionDto) {
    return await this.kycService.createSession(user.userId, dto);
  }

  @Get('status/:userId')
  @ApiOperation({ summary: 'Retrieve KYC verification status' })
  @ApiParam({ name: 'userId', description: 'User UUID', format: 'uuid' })
  async getStatus(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() user: AuthUserCtx,
  ) {
    // Basic authorization: can only read your own status unless you are admin.
    // For simplicity of this feature branch, we restrict to self.
    if (userId !== user.userId) {
      throw new ForbiddenException('You can only view your own KYC status');
    }
    return await this.kycService.getStatus(userId);
  }
}
