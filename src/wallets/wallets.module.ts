import { Module } from "@nestjs/common";
import { WalletsController } from "./wallets.controller";
import { WalletsService } from "./wallets.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
