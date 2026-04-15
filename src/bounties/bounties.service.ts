import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { AgreementsService } from "../agreements/agreements.service";
import {
  CreateBountyDto,
  LinkContractToBountyDto,
  SubmitToBountyDto,
  ValidateSubmissionDto,
} from "./dto/bounties.dto";

export type BountyStatus =
  | "draft"
  | "open"
  | "funded"
  | "in_progress"
  | "validating"
  | "completed"
  | "cancelled";

export type SubmissionStatus = "pending" | "approved" | "rejected";

export interface Bounty {
  id: string;
  agreement_id: string | null;
  title: string;
  description: string;
  amount: string;
  asset: string;
  slug: string;
  created_by: string;
  status: BountyStatus;
  required_validations: number;
  deadline: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BountyValidator {
  id: string;
  bounty_id: string;
  wallet_address: string;
  added_at: string;
}

export interface BountySubmission {
  id: string;
  bounty_id: string;
  submitter_wallet: string;
  submission_url: string;
  notes: string;
  status: SubmissionStatus;
  validations: { wallet: string; approved: boolean; timestamp: string }[];
  submitted_at: string;
  resolved_at: string | null;
}

@Injectable()
export class BountiesService {
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

  private generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 30);
    const hash = Math.random().toString(36).substring(2, 6);
    return `${base}-${hash}`;
  }

  async create(userId: string, dto: CreateBountyDto) {
    await this.assertActorWallet(userId, dto.created_by);

    const slug = this.generateSlug(dto.title);
    const requiredValidations =
      dto.required_validations || Math.ceil(dto.validators.length / 2);

    // Create agreement first
    const { agreement, error: agreementError } = await this.agreements.create(
      userId,
      {
        title: dto.title,
        description: dto.description,
        amount: dto.amount,
        asset: dto.asset,
        agreement_type: "bounty",
        created_by: dto.created_by,
        participants: [
          { wallet_address: dto.created_by, role: "payer" },
          ...dto.validators.map((v) => ({
            wallet_address: v,
            role: "validator" as const,
          })),
        ],
        metadata: { is_bounty: true, slug },
      }
    );

    if (agreementError || !agreement) {
      return { bounty: null, error: agreementError || "Failed to create agreement" };
    }

    // Create bounty
    const { data: bounty, error: bountyError } = await this.supabase
      .getClient()
      .from("bounties")
      .insert({
        agreement_id: agreement.id,
        title: dto.title,
        description: dto.description,
        amount: dto.amount,
        asset: dto.asset || "USDC",
        slug,
        created_by: dto.created_by,
        status: "draft",
        required_validations: requiredValidations,
        deadline: dto.deadline || null,
        metadata: dto.metadata || {},
      })
      .select()
      .single();

    if (bountyError) {
      return { bounty: null, error: bountyError.message };
    }

    // Add validators
    const validators = dto.validators.map((wallet) => ({
      bounty_id: bounty.id,
      wallet_address: wallet,
    }));

    await this.supabase.getClient().from("bounty_validators").insert(validators);

    return { bounty: bounty as Bounty, error: null };
  }

  async getBySlug(slug: string) {
    const { data: bounty, error: bountyError } = await this.supabase
      .getClient()
      .from("bounties")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();

    if (bountyError || !bounty) {
      return { bounty: null, error: bountyError?.message || "Bounty not found" };
    }

    const { data: validators } = await this.supabase
      .getClient()
      .from("bounty_validators")
      .select("*")
      .eq("bounty_id", bounty.id);

    const { data: submissions } = await this.supabase
      .getClient()
      .from("bounty_submissions")
      .select("*")
      .eq("bounty_id", bounty.id)
      .order("submitted_at", { ascending: false });

    return {
      bounty: {
        ...bounty,
        validators: validators || [],
        submissions: submissions || [],
      },
      error: null,
    };
  }

  async getById(bountyId: string) {
    const { data: bounty, error: bountyError } = await this.supabase
      .getClient()
      .from("bounties")
      .select("*")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError || !bounty) {
      throw new NotFoundException("Bounty not found");
    }

    const { data: validators } = await this.supabase
      .getClient()
      .from("bounty_validators")
      .select("*")
      .eq("bounty_id", bounty.id);

    const { data: submissions } = await this.supabase
      .getClient()
      .from("bounty_submissions")
      .select("*")
      .eq("bounty_id", bounty.id)
      .order("submitted_at", { ascending: false });

    return {
      bounty: {
        ...bounty,
        validators: validators || [],
        submissions: submissions || [],
      },
      error: null,
    };
  }

  async updateStatus(bountyId: string, status: BountyStatus) {
    const { error } = await this.supabase
      .getClient()
      .from("bounties")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", bountyId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, error: null };
  }

  async linkContract(
    userId: string,
    bountyId: string,
    dto: LinkContractToBountyDto
  ) {
    await this.assertActorWallet(userId, dto.actor_wallet);

    const { data: bounty, error: fetchError } = await this.supabase
      .getClient()
      .from("bounties")
      .select("agreement_id")
      .eq("id", bountyId)
      .maybeSingle();

    if (fetchError || !bounty?.agreement_id) {
      throw new NotFoundException("Bounty not found");
    }

    // Link contract to agreement
    const result = await this.agreements.linkContract(userId, bounty.agreement_id, {
      contract_id: dto.contract_id,
      actor_wallet: dto.actor_wallet,
    });

    if (result.error) {
      return { success: false, error: result.error };
    }

    await this.updateStatus(bountyId, "funded");

    return { success: true, error: null };
  }

  async submitToBounty(
    userId: string,
    bountyId: string,
    dto: SubmitToBountyDto
  ) {
    await this.assertActorWallet(userId, dto.submitter_wallet);

    const { data: bounty, error: bountyError } = await this.supabase
      .getClient()
      .from("bounties")
      .select("status")
      .eq("id", bountyId)
      .maybeSingle();

    if (bountyError || !bounty) {
      throw new NotFoundException("Bounty not found");
    }

    const validStatuses: BountyStatus[] = ["open", "funded", "in_progress"];
    if (!validStatuses.includes(bounty.status as BountyStatus)) {
      throw new BadRequestException("Bounty is not accepting submissions");
    }

    const { data: submission, error } = await this.supabase
      .getClient()
      .from("bounty_submissions")
      .insert({
        bounty_id: bountyId,
        submitter_wallet: dto.submitter_wallet,
        submission_url: dto.submission_url,
        notes: dto.notes || "",
        status: "pending",
        validations: [],
      })
      .select()
      .single();

    if (error) {
      return { submission: null, error: error.message };
    }

    await this.updateStatus(bountyId, "in_progress");

    return { submission: submission as BountySubmission, error: null };
  }

  async validateSubmission(
    userId: string,
    submissionId: string,
    dto: ValidateSubmissionDto
  ) {
    await this.assertActorWallet(userId, dto.validator_wallet);

    const { data: submission, error: fetchError } = await this.supabase
      .getClient()
      .from("bounty_submissions")
      .select("*, bounty:bounties(required_validations)")
      .eq("id", submissionId)
      .maybeSingle();

    if (fetchError || !submission) {
      throw new NotFoundException("Submission not found");
    }

    const validations =
      (submission.validations as {
        wallet: string;
        approved: boolean;
        timestamp: string;
      }[]) || [];

    if (validations.some((v) => v.wallet === dto.validator_wallet)) {
      throw new BadRequestException(
        "You have already validated this submission"
      );
    }

    validations.push({
      wallet: dto.validator_wallet,
      approved: dto.approved,
      timestamp: new Date().toISOString(),
    });

    const approvals = validations.filter((v) => v.approved).length;
    const rejections = validations.filter((v) => !v.approved).length;
    const requiredValidations = submission.bounty?.required_validations || 1;

    let newStatus: SubmissionStatus = "pending";
    let completed = false;

    if (approvals >= requiredValidations) {
      newStatus = "approved";
      completed = true;
    } else if (rejections >= requiredValidations) {
      newStatus = "rejected";
    }

    const { error: updateError } = await this.supabase
      .getClient()
      .from("bounty_submissions")
      .update({
        validations,
        status: newStatus,
        resolved_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", submissionId);

    if (updateError) {
      return { success: false, completed: false, error: updateError.message };
    }

    if (completed) {
      await this.updateStatus(submission.bounty_id, "completed");
    } else if (newStatus === "pending") {
      await this.updateStatus(submission.bounty_id, "validating");
    }

    return { success: true, completed, error: null };
  }

  async getBountiesByCreator(userId: string, walletAddress: string) {
    await this.assertActorWallet(userId, walletAddress);

    const { data, error } = await this.supabase
      .getClient()
      .from("bounties")
      .select("*")
      .eq("created_by", walletAddress)
      .order("created_at", { ascending: false });

    if (error) {
      return { bounties: [], error: error.message };
    }

    return { bounties: (data as Bounty[]) || [], error: null };
  }

  async getBountiesForValidator(userId: string, walletAddress: string) {
    await this.assertActorWallet(userId, walletAddress);

    const { data: validatorRecords, error: valError } = await this.supabase
      .getClient()
      .from("bounty_validators")
      .select("bounty_id")
      .eq("wallet_address", walletAddress);

    if (valError || !validatorRecords?.length) {
      return { bounties: [], error: valError?.message || null };
    }

    const bountyIds = validatorRecords.map((r) => r.bounty_id);

    const { data: bounties, error: bountyError } = await this.supabase
      .getClient()
      .from("bounties")
      .select("*")
      .in("id", bountyIds)
      .order("created_at", { ascending: false });

    if (bountyError) {
      return { bounties: [], error: bountyError.message };
    }

    return { bounties: (bounties as Bounty[]) || [], error: null };
  }

  async getOpenBounties() {
    const { data, error } = await this.supabase
      .getClient()
      .from("bounties")
      .select("*")
      .in("status", ["open", "funded"])
      .order("created_at", { ascending: false });

    if (error) {
      return { bounties: [], error: error.message };
    }

    return { bounties: (data as Bounty[]) || [], error: null };
  }
}
