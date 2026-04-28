import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InternalTrustlessController } from "./internal-trustless.controller";
import { InternalTrustlessService } from "./internal-trustless.service";
import { TrustlessPublicController } from "./trustless-public.controller";
import { EscrowsController } from "./escrows.controller";

@Module({
  imports: [AuthModule],
  controllers: [
    InternalTrustlessController,
    TrustlessPublicController,
    EscrowsController,
  ],
  providers: [InternalTrustlessService],
  exports: [InternalTrustlessService],
})
export class InternalTrustlessModule {}
