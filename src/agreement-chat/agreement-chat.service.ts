import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { SendMessageDto } from "./dto/agreement-chat.dto";

export interface AgreementMessage {
  id: string;
  agreement_id: string;
  sender_id: string;
  sender_wallet: string;
  message: string;
  created_at: string;
}

@Injectable()
export class AgreementChatService {
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
      throw new ForbiddenException(
        "sender_wallet does not match authenticated user"
      );
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

  async getMessages(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { data, error } = await this.supabase
      .getClient()
      .from("agreement_messages")
      .select("*")
      .eq("agreement_id", agreementId)
      .order("created_at", { ascending: true });

    if (error) {
      return { messages: [], error: error.message };
    }

    return { messages: (data as AgreementMessage[]) || [], error: null };
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    await this.assertCanAccessAgreement(userId, dto.agreement_id);
    await this.assertActorWallet(userId, dto.sender_wallet);

    if (!dto.message.trim()) {
      return { message: null, error: "Message cannot be empty" };
    }

    const { data, error } = await this.supabase
      .getClient()
      .from("agreement_messages")
      .insert({
        agreement_id: dto.agreement_id,
        sender_id: userId,
        sender_wallet: dto.sender_wallet,
        message: dto.message.trim(),
      })
      .select()
      .single();

    if (error) {
      return { message: null, error: error.message };
    }

    return { message: data as AgreementMessage, error: null };
  }
}
