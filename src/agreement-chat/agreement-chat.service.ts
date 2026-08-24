import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { SendMessageDto } from './dto/agreement-chat.dto';
import {
  resolveUserWallets,
  userCanAccessAgreement,
} from '../common/wallets/resolve-user-wallets';

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

  private async assertActorWallet(userId: string, actorWallet: string) {
    const wallets = await resolveUserWallets(this.supabase.getClient(), userId);
    if (!wallets.includes(actorWallet)) {
      throw new ForbiddenException('sender_wallet does not match authenticated user');
    }
  }

  private async assertCanAccessAgreement(userId: string, agreementId: string): Promise<void> {
    const client = this.supabase.getClient();

    const { data: agreement, error: aErr } = await client
      .from('agreements')
      .select('id, created_by')
      .eq('id', agreementId)
      .maybeSingle();
    if (aErr || !agreement) throw new NotFoundException('Agreement not found');

    const createdBy = (agreement as { created_by: string }).created_by;
    const allowed = await userCanAccessAgreement(client, userId, agreementId, createdBy);
    if (!allowed) {
      throw new ForbiddenException('Not a participant of this agreement');
    }
  }

  async getMessages(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);

    const { data, error } = await this.supabase
      .getClient()
      .from('agreement_messages')
      .select('*')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new BadRequestException(`Failed to retrieve messages: ${error.message}`);
    }

    return { messages: (data as AgreementMessage[]) || [], error: null };
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    await this.assertCanAccessAgreement(userId, dto.agreement_id);
    await this.assertActorWallet(userId, dto.sender_wallet);

    if (!dto.message.trim()) {
      throw new BadRequestException('Message cannot be empty');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('agreement_messages')
      .insert({
        agreement_id: dto.agreement_id,
        sender_id: userId,
        sender_wallet: dto.sender_wallet,
        message: dto.message.trim(),
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Failed to send message: ${error.message}`);
    }

    return { message: data as AgreementMessage, error: null };
  }
}
