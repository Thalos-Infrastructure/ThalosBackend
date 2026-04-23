import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { AgreementsModule } from "../agreements/agreements.module";
import { DisputesController } from "./disputes.controller";
import { DisputesService } from "./disputes.service";

@Module({
  imports: [SupabaseModule, AgreementsModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
