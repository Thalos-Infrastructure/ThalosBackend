import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AgreementsController } from "./agreements.controller";
import { AgreementsService } from "./agreements.service";

@Module({
  imports: [AuthModule],
  controllers: [AgreementsController],
  providers: [AgreementsService],
})
export class AgreementsModule {}
