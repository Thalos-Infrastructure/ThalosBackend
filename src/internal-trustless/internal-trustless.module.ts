import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InternalTrustlessController } from "./internal-trustless.controller";
import { InternalTrustlessService } from "./internal-trustless.service";
import { TrustlessPublicController } from "./trustless-public.controller";

@Module({
  imports: [AuthModule],
  controllers: [InternalTrustlessController, TrustlessPublicController],
  providers: [InternalTrustlessService],
  exports: [InternalTrustlessService],
})
export class InternalTrustlessModule {}
