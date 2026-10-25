import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { RampsService } from './ramps.service';
import { CreateLendaraSessionDto, VerifyLendaraSessionDto } from './dto/lendara.dto';

@ApiTags('ramps')
@ApiBearerAuth('bearer')
@Controller('ramps/lendara')
@UseGuards(JwtAuthGuard)
export class RampsController {
  constructor(private readonly ramps: RampsService) {}

  /**
   * POST /v1/ramps/lendara/session
   *
   * Returns the widget URL. The Lendara API key stays here, and the
   * destination wallet is derived from the caller and the agreement — the
   * body carries neither.
   */
  @Post('session')
  @ApiOperation({ summary: 'Crear sesión de on-ramp de Lendara para un acuerdo' })
  async createSession(@CurrentUser() user: AuthUserCtx, @Body() dto: CreateLendaraSessionDto) {
    const session = await this.ramps.createSession(user.userId, {
      agreementId: dto.agreement_id,
      fiatCurrency: dto.fiat_currency,
      amount: dto.amount,
    });
    return { session, error: null };
  }

  /**
   * POST /v1/ramps/lendara/verify
   *
   * The widget's own callback is not proof: it runs in the browser. This reads
   * the transaction back from Lendara and checks it landed in the wallet this
   * agreement expects before anything is called successful.
   */
  @Post('verify')
  @ApiOperation({ summary: 'Verificar que el depósito llegó a la wallet esperada' })
  async verify(@CurrentUser() user: AuthUserCtx, @Body() dto: VerifyLendaraSessionDto) {
    const result = await this.ramps.verify(user.userId, {
      agreementId: dto.agreement_id,
      sessionId: dto.session_id,
    });
    return { ...result, error: null };
  }
}
