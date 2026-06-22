import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { InternalTrustlessController } from "./internal-trustless.controller";
import { TrustlessPublicController } from "./trustless-public.controller";
import { EscrowsController } from "./escrows.controller";

@Module({
  imports: [AuthModule, CommonModule],
  controllers: [
    InternalTrustlessController,
    TrustlessPublicController,
    EscrowsController,
  ],
})
export class InternalTrustlessModule {}
