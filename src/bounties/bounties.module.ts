import { Module } from "@nestjs/common";
import { SupabaseModule } from "../supabase/supabase.module";
import { AgreementsModule } from "../agreements/agreements.module";
import { BountiesController } from "./bounties.controller";
import { BountiesService } from "./bounties.service";

@Module({
  imports: [SupabaseModule, AgreementsModule],
  controllers: [BountiesController],
  providers: [BountiesService],
  exports: [BountiesService],
})
export class BountiesModule {}
