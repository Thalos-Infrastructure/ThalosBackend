import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUserCtx } from "../auth/current-user.decorator";
import { AgreementChatService } from "./agreement-chat.service";
import { SendMessageDto } from "./dto/agreement-chat.dto";

@Controller("agreements")
@UseGuards(JwtAuthGuard)
export class AgreementChatController {
  constructor(private readonly chat: AgreementChatService) {}

  @Get(":agreementId/messages")
  getMessages(
    @CurrentUser() user: AuthUserCtx,
    @Param("agreementId") agreementId: string
  ) {
    return this.chat.getMessages(user.userId, agreementId);
  }

  @Post(":agreementId/messages")
  sendMessage(
    @CurrentUser() user: AuthUserCtx,
    @Param("agreementId") agreementId: string,
    @Body() dto: Omit<SendMessageDto, "agreement_id">
  ) {
    return this.chat.sendMessage(user.userId, {
      ...dto,
      agreement_id: agreementId,
    } as SendMessageDto);
  }
}
