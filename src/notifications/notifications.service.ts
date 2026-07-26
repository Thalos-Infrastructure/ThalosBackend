import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Resend } from 'resend';
import { AgreementEventName } from '../events/agreement-events';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AgreementCreatedData,
  AgreementFundedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
  DisputeOpenedData,
  DisputeResolvedData,
  AgreementCompletedData,
} from './types/notification-data.types';
import {
  agreementCreatedTemplate,
  agreementFundedTemplate,
  evidenceSubmittedTemplate,
  milestoneApprovedTemplate,
  disputeOpenedTemplate,
  disputeResolvedTemplate,
  agreementCompletedTemplate,
} from './templates';
import {
  DISPUTE_OPENED,
  DISPUTE_RESOLVED,
  type DisputeOpenedEventPayload,
  type DisputeResolvedEventPayload,
} from '../common/constants/notification-events';

/**
 * Fallback sender address used when EMAIL_FROM is not configured.
 *
 * Keeping the same domain as the historical default so existing Resend
 * domain verifications continue to work out-of-the-box. Override by setting
 * EMAIL_FROM (and optionally EMAIL_REPLY_TO) in the environment.
 *
 * Variable names intentionally match the Thalos frontend
 * (`lib/email/resend.ts` → `EMAIL_FROM`, `EMAIL_REPLY_TO`).
 */
const DEFAULT_FROM_EMAIL = 'Thalos <notifications@thalosplatform.xyz>';
const DEFAULT_REPLY_TO = 'Thalos <no-reply@thalosplatform.xyz>';

/**
 * Read an env var via ConfigService, trimming whitespace, falling back to
 * `fallback` when unset or blank. Centralised so tests can rely on the same
 * parsing rules as production.
 */
function pickFromEnv(config: ConfigService, key: string, fallback: string): string {
  const raw = config.get<string>(key);
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private resend: Resend;
  private fromEmail = DEFAULT_FROM_EMAIL;
  private replyTo = DEFAULT_REPLY_TO;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.fromEmail = pickFromEnv(this.configService, 'EMAIL_FROM', DEFAULT_FROM_EMAIL);
    this.replyTo = pickFromEnv(this.configService, 'EMAIL_REPLY_TO', DEFAULT_REPLY_TO);
  }

  onModuleInit() {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not configured - email notifications disabled');
      return;
    }
    this.resend = new Resend(apiKey);
    this.logger.log('Resend email client initialized');
  }

  /**
   * Get email address for a wallet from profiles table
   */
  private async getEmailForWallet(wallet: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .getClient()
      .from('profiles')
      .select('email')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (error || !data?.email) {
      this.logger.debug(`No email found for wallet ${wallet}`);
      return null;
    }
    return data.email as string;
  }

  /**
   * Get emails for all participants of an agreement
   */
  private async getParticipantEmails(
    agreementId: string,
    excludedWallet?: string,
  ): Promise<string[]> {
    let query = this.supabase
      .getClient()
      .from('agreement_participants')
      .select('wallet_address')
      .eq('agreement_id', agreementId);

    if (excludedWallet) {
      query = query.neq('wallet_address', excludedWallet);
    }

    const { data: participants, error } = await query;

    if (error || !participants?.length) {
      return [];
    }

    const emails: string[] = [];
    for (const p of participants) {
      const email = await this.getEmailForWallet(p.wallet_address);
      if (email) {
        emails.push(email);
      }
    }
    return emails;
  }

  /**
   * Send email using Resend. Mirrors the frontend payload shape (`replyTo`
   * always present, never undefined, so Resend's API contract is satisfied
   * even when only `from` is overridden).
   */
  private async sendEmail(to: string | string[], subject: string, html: string): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn('Resend not configured, skipping email');
      return false;
    }

    const recipients = Array.isArray(to) ? to : [to];
    if (recipients.length === 0) {
      this.logger.debug('No recipients, skipping email');
      return false;
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: recipients,
        subject,
        html,
        replyTo: this.replyTo,
      });

      if (error) {
        this.logger.error(`Failed to send email: ${error.message}`);
        return false;
      }

      this.logger.log(`Email sent to ${recipients.length} recipient(s): ${subject}`);
      return true;
    } catch (err) {
      this.logger.error('Error sending email', err);
      return false;
    }
  }

  @OnEvent(AgreementEventName.EvidenceSubmitted)
  async handleEvidenceSubmitted(data: EvidenceSubmittedData): Promise<void> {
    try {
      await this.notifyEvidenceSubmitted(data, data.submittedByWallet);
    } catch (error) {
      this.logger.error('Failed to handle evidence submitted event', error);
    }
  }

  @OnEvent(AgreementEventName.MilestoneApproved)
  async handleMilestoneApproved(data: MilestoneApprovedData): Promise<void> {
    try {
      await this.notifyMilestoneApproved(data);
    } catch (error) {
      this.logger.error('Failed to handle milestone approved event', error);
    }
  }

  /**
   * Notify when a new agreement is created
   */
  async notifyAgreementCreated(data: AgreementCreatedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) return;

    const html = agreementCreatedTemplate(data);
    await this.sendEmail(emails, `New Agreement Created: ${data.title}`, html);
  }

  /**
   * Notify when an agreement is funded
   */
  async notifyAgreementFunded(data: AgreementFundedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) return;

    const html = agreementFundedTemplate(data);
    await this.sendEmail(emails, `Agreement Funded: ${data.title}`, html);
  }

  /**
   * Notify when evidence is submitted for a milestone
   */
  async notifyEvidenceSubmitted(
    data: EvidenceSubmittedData,
    excludedWallet?: string,
  ): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId, excludedWallet);
    if (emails.length === 0) return;

    const html = evidenceSubmittedTemplate(data);
    await this.sendEmail(emails, `Evidence Submitted: ${data.agreementTitle}`, html);
  }

  /**
   * Notify when a milestone is approved
   */
  async notifyMilestoneApproved(data: MilestoneApprovedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) return;

    const html = milestoneApprovedTemplate(data);
    await this.sendEmail(emails, `Milestone Approved: ${data.milestoneDescription}`, html);
  }

  /**
   * Notify when a dispute is opened
   */
  async notifyDisputeOpened(data: DisputeOpenedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) return;

    const html = disputeOpenedTemplate(data);
    await this.sendEmail(emails, `Dispute Opened: ${data.agreementTitle}`, html);
  }

  /**
   * Notify when a dispute is resolved
   */
  async notifyDisputeResolved(data: DisputeResolvedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) return;

    const html = disputeResolvedTemplate(data);
    await this.sendEmail(emails, `Dispute Resolved: ${data.agreementTitle}`, html);
  }

  /**
   * Notify when an agreement is completed
   */
  async notifyAgreementCompleted(data: AgreementCompletedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) return;

    const html = agreementCompletedTemplate(data);
    await this.sendEmail(emails, `Agreement Completed: ${data.title}`, html);
  }

  /**
   * Send a custom notification to specific wallets
   */
  async sendCustomNotification(wallets: string[], subject: string, html: string): Promise<void> {
    const emails: string[] = [];
    for (const wallet of wallets) {
      const email = await this.getEmailForWallet(wallet);
      if (email) emails.push(email);
    }

    if (emails.length === 0) return;
    await this.sendEmail(emails, subject, html);
  }

  @OnEvent(DISPUTE_OPENED)
  async handleDisputeOpened(payload: DisputeOpenedEventPayload): Promise<void> {
    const { data: agreement } = await this.supabase
      .getClient()
      .from('agreements')
      .select('title, amount, asset')
      .eq('id', payload.agreementId)
      .maybeSingle();

    if (!agreement) {
      this.logger.warn(`Agreement ${payload.agreementId} not found for dispute notification`);
      return;
    }

    const { data: openerProfile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('display_name')
      .eq('wallet_address', payload.openedByWallet)
      .maybeSingle();

    await this.notifyDisputeOpened({
      agreementId: payload.agreementId,
      agreementTitle: (agreement as { title: string }).title,
      disputeReason: payload.reason,
      openedByWallet: payload.openedByWallet,
      openedByName: openerProfile ? openerProfile.display_name : undefined,
    });
  }

  @OnEvent(DISPUTE_RESOLVED)
  async handleDisputeResolved(payload: DisputeResolvedEventPayload): Promise<void> {
    const { data: agreement } = await this.supabase
      .getClient()
      .from('agreements')
      .select('title, amount, asset')
      .eq('id', payload.agreementId)
      .maybeSingle();

    if (!agreement) {
      this.logger.warn(
        `Agreement ${payload.agreementId} not found for dispute resolution notification`,
      );
      return;
    }

    const ag = agreement;

    const totalAmount = parseFloat(ag.amount);
    const refundAmount = ((totalAmount * payload.payerPercentage) / 100).toFixed(2);
    const releaseAmount = ((totalAmount * payload.payeePercentage) / 100).toFixed(2);

    await this.notifyDisputeResolved({
      agreementId: payload.agreementId,
      agreementTitle: ag.title,
      resolution: payload.resolutionNotes || 'Dispute has been resolved',
      resolvedByWallet: payload.resolvedByWallet,
      refundAmount,
      releaseAmount,
      asset: ag.asset,
    });
  }
}
