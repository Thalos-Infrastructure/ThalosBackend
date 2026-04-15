import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { AgreementsService } from "../agreements/agreements.service";
import {
  OpenDisputeDto,
  AssignResolverDto,
  ResolveDisputeDto,
  CancelDisputeDto,
} from "./dto/disputes.dto";

export type DisputeStatus = "open" | "under_review" | "resolved" | "cancelled";

export interface Dispute {
  id: string;
  agreement_id: string;
  opened_by: string;
  reason: string;
  evidence_urls: string[];
  status: DisputeStatus;
  resolver_wallet: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface DisputeResolution {
  id: string;
  dispute_id: string;
  resolved_by: string;
  payer_percentage: number;
  payee_percentage: number;
  resolution_notes: string;
  created_at: string;
}

@Injectable()
export class DisputesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly agreements: AgreementsService
  ) {}

  private async walletForUserId(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from("auth_users")
      .select("wallet_public_key")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data?.wallet_public_key) return null;
    return data.wallet_public_key as string;
  }

  private async assertActorWallet(userId: string, actorWallet: string) {
    const w = await this.walletForUserId(userId);
    if (!w || w !== actorWallet) {
      throw new ForbiddenException("Wallet does not match authenticated user");
    }
  }

  private async assertCanAccessAgreement(
    userId: string,
    agreementId: string
  ): Promise<void> {
    const wallet = await this.walletForUserId(userId);
    if (!wallet) throw new ForbiddenException("No wallet on profile");

    const { data: agreement, error: aErr } = await this.supabase
      .getClient()
      .from("agreements")
      .select("id, created_by")
      .eq("id", agreementId)
      .maybeSingle();
    if (aErr || !agreement) throw new NotFoundException("Agreement not found");

    const createdBy = (agreement as { created_by: string }).created_by;
    if (createdBy === wallet || createdBy === userId) return;

    const { data: parts } = await this.supabase
      .getClient()
      .from("agreement_participants")
      .select("wallet_address")
      .eq("agreement_id", agreementId)
      .eq("wallet_address", wallet)
      .limit(1);
    if (!parts?.length) {
      throw new ForbiddenException("Not a participant of this agreement");
    }
  }

  private async logActivity(
    agreementId: string,
    actorWallet: string,
    action: string,
    details: Record<string, unknown> = {}
  ) {
    try {
      await this.supabase.getClient().from("agreement_activity").insert({
        agreement_id: agreementId,
        actor_wallet: actorWallet,
        action,
        details,
      });
    } catch (e) {
      console.error("logAgreementActivity", e);
    }
  }

  async openDispute(userId: string, dto: OpenDisputeDto) {
    await this.assertCanAccessAgreement(userId, dto.agreement_id);
    await this.assertActorWallet(userId, dto.opened_by);

    // Check if there's already an open dispute
    const { data: existingDispute } = await this.supabase
      .getClient()
      .from("disputes")
      .select("id")
      .eq("agreement_id", dto.agreement_id)
      .in("status", ["open", "under_review"])
      .maybeSingle();

    if (existingDispute) {
      return {
        dispute: null,
        error: "There is already an open dispute for this agreement",
      };
    }

    const { data: dispute, error } = await this.supabase
      .getClient()
      .from("disputes")
      .insert({
        agreement_id: dto.agreement_id,
        opened_by: dto.opened_by,
        reason: dto.reason,
        evidence_urls: dto.evidence_urls || [],
        status: "open",
      })
      .select()
      .single();

    if (error) {
      return { dispute: null, error: error.message };
    }

    // Update agreement status to disputed
    await this.supabase
      .getClient()
      .from("agreements")
      .update({ status: "disputed", updated_at: new Date().toISOString() })
      .eq("id", dto.agreement_id);

    await this.logActivity(dto.agreement_id, dto.opened_by, "dispute_opened", {
      dispute_id: dispute.id,
      reason: dto.reason,
    });

    return { dispute: dispute as Dispute, error: null };
  }

  async assignResolver(
    userId: string,
    disputeId: string,
    dto: AssignResolverDto
  ) {
    const { data: dispute, error: fetchError } = await this.supabase
      .getClient()
      .from("disputes")
      .select("agreement_id, status")
      .eq("id", disputeId)
      .maybeSingle();

    if (fetchError || !dispute) {
      throw new NotFoundException("Dispute not found");
    }

    await this.assertCanAccessAgreement(userId, dispute.agreement_id);

    if (dispute.status !== "open") {
      throw new BadRequestException(
        "Can only assign resolver to open disputes"
      );
    }

    const { error } = await this.supabase
      .getClient()
      .from("disputes")
      .update({
        resolver_wallet: dto.resolver_wallet,
        status: "under_review",
        updated_at: new Date().toISOString(),
      })
      .eq("id", disputeId);

    if (error) {
      return { success: false, error: error.message };
    }

    await this.logActivity(
      dispute.agreement_id,
      dto.resolver_wallet,
      "dispute_resolver_assigned",
      { dispute_id: disputeId, resolver_wallet: dto.resolver_wallet }
    );

    return { success: true, error: null };
  }

  async resolveDispute(
    userId: string,
    disputeId: string,
    dto: ResolveDisputeDto
  ) {
    await this.assertActorWallet(userId, dto.resolved_by);

    // Validate percentages
    if (dto.payer_percentage + dto.payee_percentage !== 100) {
      throw new BadRequestException("Percentages must sum to 100%");
    }

    const { data: dispute, error: fetchError } = await this.supabase
      .getClient()
      .from("disputes")
      .select("id, agreement_id, status, resolver_wallet")
      .eq("id", disputeId)
      .maybeSingle();

    if (fetchError || !dispute) {
      throw new NotFoundException("Dispute not found");
    }

    if (dispute.status === "resolved") {
      throw new BadRequestException("Dispute is already resolved");
    }

    // Create resolution
    const { data: resolution, error: resError } = await this.supabase
      .getClient()
      .from("dispute_resolutions")
      .insert({
        dispute_id: disputeId,
        resolved_by: dto.resolved_by,
        payer_percentage: dto.payer_percentage,
        payee_percentage: dto.payee_percentage,
        resolution_notes: dto.resolution_notes || "",
      })
      .select()
      .single();

    if (resError) {
      return { resolution: null, error: resError.message };
    }

    // Update dispute status
    await this.supabase
      .getClient()
      .from("disputes")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", disputeId);

    // Update agreement status
    await this.supabase
      .getClient()
      .from("agreements")
      .update({
        status: "resolved",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", dispute.agreement_id);

    await this.logActivity(
      dispute.agreement_id,
      dto.resolved_by,
      "dispute_resolved",
      {
        dispute_id: disputeId,
        payer_percentage: dto.payer_percentage,
        payee_percentage: dto.payee_percentage,
        resolution_notes: dto.resolution_notes,
      }
    );

    return { resolution: resolution as DisputeResolution, error: null };
  }

  async cancelDispute(userId: string, disputeId: string, dto: CancelDisputeDto) {
    await this.assertActorWallet(userId, dto.cancelled_by);

    const { data: dispute, error: fetchError } = await this.supabase
      .getClient()
      .from("disputes")
      .select("agreement_id, opened_by, status")
      .eq("id", disputeId)
      .maybeSingle();

    if (fetchError || !dispute) {
      throw new NotFoundException("Dispute not found");
    }

    if (dispute.opened_by !== dto.cancelled_by) {
      throw new ForbiddenException("Only the dispute opener can cancel it");
    }

    if (dispute.status === "resolved") {
      throw new BadRequestException("Cannot cancel a resolved dispute");
    }

    const { error } = await this.supabase
      .getClient()
      .from("disputes")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", disputeId);

    if (error) {
      return { success: false, error: error.message };
    }

    // Revert agreement status to active
    await this.supabase
      .getClient()
      .from("agreements")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", dispute.agreement_id);

    await this.logActivity(
      dispute.agreement_id,
      dto.cancelled_by,
      "dispute_cancelled",
      { dispute_id: disputeId }
    );

    return { success: true, error: null };
  }

  async getOpenDisputes(userId: string) {
    // This endpoint is for dispute resolvers - they can see all open disputes
    const { data, error } = await this.supabase
      .getClient()
      .from("disputes")
      .select(
        `
        *,
        agreement:agreements (
          id,
          title,
          amount,
          contract_id
        )
      `
      )
      .in("status", ["open", "under_review"])
      .order("created_at", { ascending: false });

    if (error) {
      return { disputes: [], error: error.message };
    }

    return { disputes: data || [], error: null };
  }

  async getDisputesByResolver(userId: string, resolverWallet: string) {
    await this.assertActorWallet(userId, resolverWallet);

    const { data, error } = await this.supabase
      .getClient()
      .from("disputes")
      .select(
        `
        *,
        agreement:agreements (
          id,
          title,
          amount,
          contract_id
        )
      `
      )
      .eq("resolver_wallet", resolverWallet)
      .order("created_at", { ascending: false });

    if (error) {
      return { disputes: [], error: error.message };
    }

    return { disputes: data || [], error: null };
  }

  async getDisputeById(userId: string, disputeId: string) {
    const { data: dispute, error: disputeError } = await this.supabase
      .getClient()
      .from("disputes")
      .select(
        `
        *,
        agreement:agreements (
          id,
          title,
          amount,
          contract_id
        )
      `
      )
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeError || !dispute) {
      throw new NotFoundException("Dispute not found");
    }

    // Check access
    await this.assertCanAccessAgreement(userId, dispute.agreement_id);

    // Get resolution if exists
    const { data: resolution } = await this.supabase
      .getClient()
      .from("dispute_resolutions")
      .select("*")
      .eq("dispute_id", disputeId)
      .maybeSingle();

    return {
      dispute,
      resolution: resolution as DisputeResolution | null,
      error: null,
    };
  }

  async getDisputesByAgreement(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { data, error } = await this.supabase
      .getClient()
      .from("disputes")
      .select("*")
      .eq("agreement_id", agreementId)
      .order("created_at", { ascending: false });

    if (error) {
      return { disputes: [], error: error.message };
    }

    return { disputes: (data as Dispute[]) || [], error: null };
  }
}
