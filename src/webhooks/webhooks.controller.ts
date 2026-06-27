import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  UnauthorizedException,
  Logger,
  BadRequestException,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import type { TrustlessWorkEventDto } from './dto/trustless-work-event.dto';

@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('trustless-work')
  @HttpCode(200)
  async handleTrustlessWork(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-trustless-signature') signatureHeader: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const rawBody = req.rawBody ?? Buffer.from('');

    if (!signatureHeader) {
      throw new UnauthorizedException('Missing x-trustless-signature header');
    }

    const valid = this.webhooksService.verifySignature(rawBody, signatureHeader);
    if (!valid) {
      this.logger.warn('Webhook rejected: invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let payload: TrustlessWorkEventDto;
    try {
      payload = JSON.parse(rawBody.toString('utf-8')) as TrustlessWorkEventDto;
    } catch {
      throw new BadRequestException('Malformed JSON payload');
    }

    if (!payload.event || !payload.contractId) {
      throw new BadRequestException('Payload must include event and contractId');
    }

    const result = await this.webhooksService.handleEvent(payload);
    return { ok: result.handled, reason: result.reason };
  }
}
