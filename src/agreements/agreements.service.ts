import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { CreateAgreementDto } from "./dto/create-agreement.dto";
import { LinkContractDto } from "./dto/link-contract.dto";
import { UpdateAgreementStatusDto } from "./dto/update-status.dto";
import { UpdateMilestoneDto } from "./dto/update-milestone.dto";

@Injectable()
export class AgreementsService {
  constructor(private readonly supabase: SupabaseService) {}

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
      throw new ForbiddenException("actor_wallet does not match authenticated user");
    }
  }

  /** Perfil opcional vinculado por wallet (tabla profiles). */
  private async profileIdByWallet(wallet: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from("profiles")
      .select("id")
      .eq("wallet_address", wallet)
      .maybeSingle();
    if (error || !data?.id) return null;
    return data.id as string;
  }

  private async assertCanAccessAgreement(
    userId: string,
    agreementId: string,
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

  async create(userId: string, dto: CreateAgreementDto) {
    await this.assertActorWallet(userId, dto.created_by);

    const createdByProfileId = await this.profileIdByWallet(dto.created_by);

    const agreementRow: Record<string, unknown> = {
      contract_id: dto.contract_id ?? null,
      title: dto.title,
      description: dto.description ?? null,
      amount: dto.amount,
      asset: dto.asset ?? "USDC",
      status: "pending",
      agreement_type: dto.agreement_type ?? "single",
      milestones: dto.milestones ?? [],
      metadata: dto.metadata ?? {},
      created_by: dto.created_by,
    };
    if (createdByProfileId) {
      agreementRow.created_by_profile_id = createdByProfileId;
    }

    const { data: agreement, error: agreementError } = await this.supabase
      .getClient()
      .from("agreements")
      .insert(agreementRow)
      .select()
      .single();

    if (agreementError) {
      return { agreement: null, error: agreementError.message };
    }

    const participants = await Promise.all(
      dto.participants.map(async (p) => {
        const row: Record<string, unknown> = {
          agreement_id: agreement.id,
          wallet_address: p.wallet_address,
          role: p.role,
        };
        const pid = p.profile_id ?? (await this.profileIdByWallet(p.wallet_address));
        if (pid) row.profile_id = pid;
        return row;
      }),
    );

    const { error: participantsError } = await this.supabase
      .getClient()
      .from("agreement_participants")
      .insert(participants);

    if (participantsError) {
      console.error("agreement_participants insert:", participantsError);
    }

    await this.logActivity(agreement.id, dto.created_by, "created", {
      title: dto.title,
      amount: dto.amount,
    });

    return { agreement, error: null };
  }

  async linkContract(
    userId: string,
    agreementId: string,
    dto: LinkContractDto,
  ) {
    await this.assertCanAccessAgreement(userId, agreementId);
    await this.assertActorWallet(userId, dto.actor_wallet);

    const { error } = await this.supabase
      .getClient()
      .from("agreements")
      .update({
        contract_id: dto.contract_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", agreementId);

    if (error) return { success: false, error: error.message };

    await this.logActivity(agreementId, dto.actor_wallet, "contract_linked", {
      contract_id: dto.contract_id,
    });
    return { success: true, error: null };
  }

  async updateStatus(
    userId: string,
    agreementId: string,
    dto: UpdateAgreementStatusDto,
  ) {
    await this.assertCanAccessAgreement(userId, agreementId);
    await this.assertActorWallet(userId, dto.actor_wallet);

    const updates: Record<string, unknown> = {
      status: dto.status,
      updated_at: new Date().toISOString(),
    };
    if (dto.status === "funded") {
      updates.funded_at = new Date().toISOString();
    } else if (dto.status === "completed" || dto.status === "resolved") {
      updates.completed_at = new Date().toISOString();
    }

    const { error } = await this.supabase
      .getClient()
      .from("agreements")
      .update(updates)
      .eq("id", agreementId);

    if (error) return { success: false, error: error.message };

    await this.logActivity(
      agreementId,
      dto.actor_wallet,
      `status_changed_to_${dto.status}`,
      { status: dto.status },
    );
    return { success: true, error: null };
  }

  async updateMilestone(
    userId: string,
    agreementId: string,
    dto: UpdateMilestoneDto,
  ) {
    await this.assertCanAccessAgreement(userId, agreementId);
    await this.assertActorWallet(userId, dto.actor_wallet);

    const { data: agreement, error: fetchError } = await this.supabase
      .getClient()
      .from("agreements")
      .select("milestones")
      .eq("id", agreementId)
      .single();

    if (fetchError || !agreement) {
      return { success: false, error: fetchError?.message || "Not found" };
    }

    const milestones = agreement.milestones as Array<{
      description: string;
      amount: string;
      status: string;
    }>;
    if (
      dto.milestone_index < 0 ||
      dto.milestone_index >= milestones.length
    ) {
      return { success: false, error: "Invalid milestone index" };
    }

    milestones[dto.milestone_index].status = dto.status;

    const { error: updateError } = await this.supabase
      .getClient()
      .from("agreements")
      .update({
        milestones,
        updated_at: new Date().toISOString(),
      })
      .eq("id", agreementId);

    if (updateError) return { success: false, error: updateError.message };

    await this.logActivity(
      agreementId,
      dto.actor_wallet,
      `milestone_${dto.status}`,
      {
        milestone_index: dto.milestone_index,
        milestone_description: milestones[dto.milestone_index].description,
      },
    );
    return { success: true, error: null };
  }

  async listByWallet(userId: string, wallet: string) {
    await this.assertActorWallet(userId, wallet);

    const { data: participations, error: partError } = await this.supabase
      .getClient()
      .from("agreement_participants")
      .select("agreement_id")
      .eq("wallet_address", wallet);

    if (partError) {
      return { agreements: [], error: partError.message };
    }
    if (!participations?.length) {
      return { agreements: [], error: null };
    }

    const ids = participations.map((p) => p.agreement_id);
    const { data: agreements, error: agError } = await this.supabase
      .getClient()
      .from("agreements")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });

    if (agError) return { agreements: [], error: agError.message };
    return { agreements: agreements ?? [], error: null };
  }

  async getById(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { data: agreement, error: agError } = await this.supabase
      .getClient()
      .from("agreements")
      .select("*")
      .eq("id", agreementId)
      .single();

    if (agError) {
      return { agreement: null, participants: [], error: agError.message };
    }

    const { data: participants, error: partError } = await this.supabase
      .getClient()
      .from("agreement_participants")
      .select("*")
      .eq("agreement_id", agreementId);

    if (partError) {
      return { agreement, participants: [], error: partError.message };
    }
    return { agreement, participants: participants ?? [], error: null };
  }

  async getByContractId(userId: string, contractId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from("agreements")
      .select("*")
      .eq("contract_id", contractId)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST116") return { agreement: null, error: null };
      return { agreement: null, error: error.message };
    }
    if (!data) return { agreement: null, error: null };

    await this.assertCanAccessAgreement(userId, data.id);
    return { agreement: data, error: null };
  }

  async getActivity(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { data, error } = await this.supabase
      .getClient()
      .from("agreement_activity")
      .select("*")
      .eq("agreement_id", agreementId)
      .order("created_at", { ascending: false });

    if (error) return { activities: [], error: error.message };
    return { activities: data ?? [], error: null };
  }

  private async logActivity(
    agreementId: string,
    actorWallet: string,
    action: string,
    details: Record<string, unknown> = {},
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
}
