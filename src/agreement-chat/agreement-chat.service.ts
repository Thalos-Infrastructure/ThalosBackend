import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { SendMessageDto, type MessageKind } from './dto/agreement-chat.dto';
import { resolveUserWallets, userCanAccessAgreement } from '../common/wallets/resolve-user-wallets';
import { FilesService, toPublicFile, type PublicFile } from '../files/files.service';

export interface AgreementMessage {
  id: string;
  agreement_id: string;
  sender_id: string | null;
  sender_wallet: string;
  message: string;
  created_at: string;
  read_at?: string | null;
  kind: MessageKind;
  event_type: string | null;
  metadata: Record<string, unknown>;
  /** Always present, empty when the message is plain text. */
  attachments?: PublicFile[];
}

export const SYSTEM_SENDER_WALLET = 'system';

const EVENT_COPY: Record<string, string> = {
  'agreement.created': 'Agreement created',
  'agreement.funded': 'Escrow funded',
  'agreement.completed': 'Agreement completed',
  'evidence.submitted': 'Evidence submitted',
  'milestone.approved': 'Milestone approved',
  'milestone.released': 'Milestone released',
  'dispute.opened': 'Dispute opened',
  'dispute.resolved': 'Dispute resolved',
  'dispute.proposal': 'Settlement proposed',
  'dispute.proposal_accepted': 'Settlement accepted by both parties',
};

function eventLine(eventType: string, metadata: Record<string, unknown>): string {
  const base = EVENT_COPY[eventType] ?? eventType;
  const payer = metadata.payerPercentage;
  const payee = metadata.payeePercentage;
  if (
    typeof payer === 'number' &&
    typeof payee === 'number' &&
    (eventType === 'dispute.proposal' ||
      eventType === 'dispute.proposal_accepted' ||
      eventType === 'dispute.resolved')
  ) {
    return `${base} (${payer}% payer / ${payee}% payee)`;
  }
  return base;
}

@Injectable()
export class AgreementChatService {
  private readonly logger = new Logger(AgreementChatService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly files: FilesService,
  ) {}

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

    const messages = ((data as AgreementMessage[]) || []).map((m) => ({
      ...m,
      kind: m.kind ?? 'user',
      event_type: m.event_type ?? null,
      metadata: m.metadata ?? {},
    }));
    const wallets = new Set(
      (await resolveUserWallets(this.supabase.getClient(), userId)).map((w) => w.toLowerCase()),
    );
    const unread_count = messages.filter(
      (m) =>
        (m.kind ?? 'user') === 'user' &&
        !m.read_at &&
        !wallets.has((m.sender_wallet ?? '').toLowerCase()),
    ).length;
    return { messages: await this.withAttachments(messages), unread_count, error: null };
  }

  /**
   * The other party's user messages become read only when this user actually
   * has the thread open. Listing while the panel is closed must not stamp
   * `read_at`, or there is never an unread badge.
   */
  async markRead(userId: string, agreementId: string) {
    await this.assertCanAccessAgreement(userId, agreementId);
    const wallets = new Set(
      (await resolveUserWallets(this.supabase.getClient(), userId)).map((w) => w.toLowerCase()),
    );

    const { data, error } = await this.supabase
      .getClient()
      .from('agreement_messages')
      .select('id, sender_wallet, read_at, kind')
      .eq('agreement_id', agreementId)
      .is('read_at', null);

    if (error) {
      throw new BadRequestException(`Failed to mark messages read: ${error.message}`);
    }

    const ids = ((data as Array<Pick<AgreementMessage, 'id' | 'sender_wallet' | 'kind'>>) || [])
      .filter(
        (m) => (m.kind ?? 'user') === 'user' && !wallets.has((m.sender_wallet ?? '').toLowerCase()),
      )
      .map((m) => m.id);

    if (ids.length === 0) return { marked: 0, error: null };

    const { error: updateError } = await this.supabase
      .getClient()
      .from('agreement_messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', ids);

    if (updateError) {
      throw new BadRequestException(`Failed to mark messages read: ${updateError.message}`);
    }
    return { marked: ids.length, error: null };
  }

  /**
   * Fill in each message's attachments with one query for the whole page,
   * rather than one per message.
   */
  private async withAttachments(messages: AgreementMessage[]): Promise<AgreementMessage[]> {
    if (messages.length === 0) return messages;

    const { data, error } = await this.supabase
      .getClient()
      .from('agreement_message_attachments')
      .select('message_id, files(id, file_name, content_type, size_bytes, sha256_hex)')
      .in(
        'message_id',
        messages.map((m) => m.id),
      );

    if (error) {
      // The conversation is still readable without them; losing the whole
      // thread because an attachment row failed to load would be worse.
      this.logger.warn(`Could not load attachments: ${error.message}`);
      return messages.map((m) => ({ ...m, attachments: [] }));
    }

    interface FileRow {
      id: string;
      file_name: string;
      content_type: string;
      size_bytes: number;
      sha256_hex: string | null;
    }
    // PostgREST types an embedded relation as an array even when it resolves
    // to a single row, and returns it either way depending on the query.
    type AttachmentRow = { message_id: string; files: FileRow | FileRow[] | null };

    const byMessage = new Map<string, PublicFile[]>();
    for (const row of (data ?? []) as unknown as AttachmentRow[]) {
      const embedded = Array.isArray(row.files) ? row.files : row.files ? [row.files] : [];
      if (embedded.length === 0) continue;

      const list = byMessage.get(row.message_id) ?? [];
      for (const file of embedded) {
        list.push({
          id: file.id,
          name: file.file_name,
          contentType: file.content_type,
          sizeBytes: file.size_bytes,
          sha256: file.sha256_hex ?? null,
        });
      }
      byMessage.set(row.message_id, list);
    }

    return messages.map((m) => ({ ...m, attachments: byMessage.get(m.id) ?? [] }));
  }

  async sendMessage(userId: string, dto: SendMessageDto) {
    await this.assertCanAccessAgreement(userId, dto.agreement_id);
    await this.assertActorWallet(userId, dto.sender_wallet);

    const attachmentIds = dto.attachment_ids ?? [];
    const text = dto.message?.trim() ?? '';

    // A screenshot on its own is a message; an empty one is not.
    if (!text && attachmentIds.length === 0) {
      throw new BadRequestException('Message cannot be empty');
    }

    // Resolved before the message exists: this both checks the caller may read
    // every file and refuses ids belonging to another agreement, which would
    // otherwise pull a stranger's file into this conversation.
    const files = await this.files.readableFiles(userId, attachmentIds);
    for (const file of files) {
      if (file.agreement_id && file.agreement_id !== dto.agreement_id) {
        throw new BadRequestException('An attachment belongs to a different agreement');
      }
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('agreement_messages')
      .insert({
        agreement_id: dto.agreement_id,
        sender_id: userId,
        sender_wallet: dto.sender_wallet,
        message: text,
        kind: 'user',
        event_type: null,
        metadata: {},
      })
      .select()
      .single();

    if (error) {
      throw new BadRequestException(`Failed to send message: ${error.message}`);
    }

    const message = data as AgreementMessage;

    if (attachmentIds.length > 0) {
      const { error: linkError } = await this.supabase
        .getClient()
        .from('agreement_message_attachments')
        .insert(attachmentIds.map((file_id) => ({ message_id: message.id, file_id })));

      if (linkError) {
        throw new BadRequestException(`Failed to attach the files: ${linkError.message}`);
      }
    }

    message.attachments = files.map(toPublicFile);
    return { message, error: null };
  }

  /**
   * Lifecycle line in the chat. Not callable from the HTTP send path:
   * participants cannot invent an "escrow funded" message.
   */
  async appendEvent(
    agreementId: string,
    eventType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await this.supabase
      .getClient()
      .from('agreement_messages')
      .insert({
        agreement_id: agreementId,
        sender_id: null,
        sender_wallet: SYSTEM_SENDER_WALLET,
        message: eventLine(eventType, metadata),
        kind: 'event',
        event_type: eventType,
        metadata,
      });

    if (error) {
      throw new BadRequestException(`Failed to record chat event: ${error.message}`);
    }
  }
}
