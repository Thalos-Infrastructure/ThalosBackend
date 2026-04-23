import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUserCtx } from "../auth/current-user.decorator";
import { ContactsService } from "./contacts.service";
import { AddContactDto } from "./dto/add-contact.dto";

@ApiTags("contacts")
@ApiBearerAuth("bearer")
@Controller("contacts")
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@CurrentUser() user: AuthUserCtx) {
    return this.contacts.list(user.userId);
  }

  @Post()
  add(
    @CurrentUser() user: AuthUserCtx,
    @Body() dto: AddContactDto,
  ) {
    const base =
      process.env.THALOS_APP_PUBLIC_URL ||
      process.env.THALOS_CORS_ORIGIN?.split(",")[0]?.trim() ||
      "http://localhost:3000";
    return this.contacts.add(user.userId, dto, base);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUserCtx, @Param("id") id: string) {
    return this.contacts.remove(user.userId, id);
  }
}
