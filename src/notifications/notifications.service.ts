import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AgreementCreatedData,
  AgreementFundedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
  MilestoneReleasedData,
  DisputeOpenedData,
  DisputeResolvedData,
  AgreementCompletedData,
} from './types/notification-data.types';
import {
  agreementCreatedTemplate,
  agreementFundedTemplate,
  evidenceSubmittedTemplate,
  milestoneApprovedTemplate,
  milestoneReleasedTemplate,
  disputeOpenedTemplate,
  disputeResolvedTemplate,
  agreementCompletedTemplate,
} from './templates';
import type {
  DisputeOpenedEventPayload,
  DisputeResolvedEventPayload,
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
 * The domain part of an `EMAIL_FROM`, which may be a bare address or the
 * `Name <address>` form. Resend verifies domains, not addresses.
 */
function senderDomainOf(from: string): string {
  const address = from.includes('<') ? from.slice(from.indexOf('<') + 1, from.indexOf('>')) : from;
  return address.split('@').pop()?.trim().toLowerCase() ?? '';
}

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
    // Deliberately not awaited: a slow provider must not hold up boot. The
    // result is a log line, not a gate.
    void this.verifyEmailSetup();
  }

  /**
   * Say out loud, at boot, whether this service can actually send email.
   *
   * `new Resend(key)` validates nothing, so the old
   * `Resend email client initialized` was printed just the same with a dead
   * key — which is exactly what happened: production ran for months with an
   * invalid key, rejecting every send, and the only trace was a per-send error
   * line nobody was reading.
   *
   * Listing domains is the cheapest call that exercises the key and, in the
   * same response, says whether the sender's domain is verified. An
   * unverified domain is refused by Resend just as firmly as a bad key.
   */
  private async verifyEmailSetup(): Promise<void> {
    try {
      const { data, error } = await this.resend.domains.list();

      if (error) {
        this.logger.error(
          `Resend rejected the API key (${error.message}). No email will be sent until RESEND_API_KEY is replaced.`,
        );
        return;
      }

      const domains = data?.data ?? [];
      const senderDomain = senderDomainOf(this.fromEmail);
      const match = domains.find((d) => d.name?.toLowerCase() === senderDomain);

      if (!match) {
        this.logger.error(
          `Resend accepted the API key, but "${senderDomain}" (from EMAIL_FROM) is not one of its domains ` +
            `[${domains.map((d) => d.name).join(', ') || 'none'}]. Sends from that address will be refused.`,
        );
        return;
      }

      if (match.status !== 'verified') {
        this.logger.error(
          `Resend domain "${senderDomain}" is "${match.status}", not verified. Sends will be refused until its DNS records are confirmed.`,
        );
        return;
      }

      this.logger.log(`Resend ready: API key valid, "${senderDomain}" verified`);
    } catch (err) {
      // Reaching Resend is not a precondition for the app to run, so this is
      // reported and dropped.
      this.logger.error('Could not verify the Resend setup at startup', err);
    }
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
   * Record what happened with a notification, so "are the emails going out?"
   * is a query instead of an investigation.
   *
   * Never throws and never blocks the caller: a logging table that can break
   * sending is worse than no logging table. A failure to write the row is
   * itself logged and dropped.
   */
  private async recordNotification(entry: {
    status: 'sent' | 'failed' | 'skipped';
    eventType: string;
    subject?: string;
    recipients?: string[];
    agreementId?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      const rows = (entry.recipients?.length ? entry.recipients : [null]).map((email) => ({
        agreement_id: entry.agreementId ?? null,
        event_type: entry.eventType,
        channel: 'email',
        recipient_email: email,
        subject: entry.subject ?? null,
        status: entry.status,
        error_message: entry.errorMessage ?? null,
      }));

      const { error } = await this.supabase.getClient().from('notification_logs').insert(rows);
      if (error) {
        this.logger.warn(`Could not record notification: ${error.message}`);
      }
    } catch (err) {
      this.logger.warn('Could not record notification', err);
    }
  }

  /**
   * Send email using Resend. Mirrors the frontend payload shape (`replyTo`
   * always present, never undefined, so Resend's API contract is satisfied
   * even when only `from` is overridden).
   *
   * Every outcome is recorded in `notification_logs`, including the ones that
   * never reach the provider. "No recipients" and "the key is dead" both used
   * to look identical from outside: nothing happened, and nothing said why.
   */
  private async sendEmail(
    to: string | string[],
    subject: string,
    html: string,
    context: { eventType: string; agreementId?: string } = { eventType: 'unknown' },
  ): Promise<boolean> {
    const recipients = Array.isArray(to) ? to : [to];

    if (!this.resend) {
      this.logger.warn('Resend not configured, skipping email');
      await this.recordNotification({
        ...context,
        status: 'skipped',
        subject,
        recipients,
        errorMessage: 'RESEND_API_KEY not configured',
      });
      return false;
    }

    if (recipients.length === 0) {
      this.logger.debug('No recipients, skipping email');
      await this.recordNotification({
        ...context,
        status: 'skipped',
        subject,
        errorMessage: 'No recipient had an email address on their profile',
      });
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
        await this.recordNotification({
          ...context,
          status: 'failed',
          subject,
          recipients,
          errorMessage: error.message,
        });
        return false;
      }

      this.logger.log(`Email sent to ${recipients.length} recipient(s): ${subject}`);
      await this.recordNotification({ ...context, status: 'sent', subject, recipients });
      return true;
    } catch (err) {
      this.logger.error('Error sending email', err);
      await this.recordNotification({
        ...context,
        status: 'failed',
        subject,
        recipients,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Notify when a new agreement is created
   */
  async notifyAgreementCreated(data: AgreementCreatedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'agreement_created',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = agreementCreatedTemplate(data);
    await this.sendEmail(emails, `New Agreement Created: ${data.title}`, html, {
      eventType: 'agreement_created',
      agreementId: data.agreementId,
    });
  }

  /**
   * Notify when an agreement is funded
   */
  async notifyAgreementFunded(data: AgreementFundedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'agreement_funded',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = agreementFundedTemplate(data);
    await this.sendEmail(emails, `Agreement Funded: ${data.title}`, html, {
      eventType: 'agreement_funded',
      agreementId: data.agreementId,
    });
  }

  /**
   * Notify when evidence is submitted for a milestone
   */
  async notifyEvidenceSubmitted(
    data: EvidenceSubmittedData,
    excludedWallet?: string,
  ): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId, excludedWallet);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'evidence_submitted',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = evidenceSubmittedTemplate(data);
    await this.sendEmail(emails, `Evidence Submitted: ${data.agreementTitle}`, html, {
      eventType: 'evidence_submitted',
      agreementId: data.agreementId,
    });
  }

  /**
   * Notify when a milestone is approved
   */
  async notifyMilestoneApproved(data: MilestoneApprovedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'milestone_approved',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = milestoneApprovedTemplate(data);
    await this.sendEmail(emails, `Milestone Approved: ${data.milestoneDescription}`, html, {
      eventType: 'milestone_approved',
      agreementId: data.agreementId,
    });
  }

  /**
   * Notify when escrow funds for a milestone are released on-chain.
   */
  async notifyMilestoneReleased(data: MilestoneReleasedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'milestone_released',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = milestoneReleasedTemplate(data);
    await this.sendEmail(emails, `Payment Released: ${data.milestoneDescription}`, html, {
      eventType: 'milestone_released',
      agreementId: data.agreementId,
    });
  }

  /**
   * Notify when a dispute is opened
   */
  async notifyDisputeOpened(data: DisputeOpenedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'dispute_opened',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = disputeOpenedTemplate(data);
    await this.sendEmail(emails, `Dispute Opened: ${data.agreementTitle}`, html, {
      eventType: 'dispute_opened',
      agreementId: data.agreementId,
    });
  }

  /**
   * Notify when a dispute is resolved
   */
  async notifyDisputeResolved(data: DisputeResolvedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'dispute_resolved',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = disputeResolvedTemplate(data);
    await this.sendEmail(emails, `Dispute Resolved: ${data.agreementTitle}`, html, {
      eventType: 'dispute_resolved',
      agreementId: data.agreementId,
    });
  }

  /**
   * Notify when an agreement is completed
   */
  async notifyAgreementCompleted(data: AgreementCompletedData): Promise<void> {
    const emails = await this.getParticipantEmails(data.agreementId);
    if (emails.length === 0) {
      // Recorded, not just dropped: "nobody has an email on file" is the
      // most common reason a notification never arrives, and it used to
      // leave no trace at all.
      await this.recordNotification({
        eventType: 'agreement_completed',
        agreementId: data.agreementId,
        status: 'skipped',
        errorMessage: 'No participant had an email address on their profile',
      });
      return;
    }

    const html = agreementCompletedTemplate(data);
    await this.sendEmail(emails, `Agreement Completed: ${data.title}`, html, {
      eventType: 'agreement_completed',
      agreementId: data.agreementId,
    });
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

    if (emails.length === 0) {
      await this.recordNotification({
        eventType: 'custom',
        status: 'skipped',
        subject,
        errorMessage: 'None of the given wallets had an email address',
      });
      return;
    }
    await this.sendEmail(emails, subject, html, { eventType: 'custom' });
  }

  /**
   * Enrich a raw dispute-opened domain event and send the notification email.
   * Invoked by NotificationsListener (no @OnEvent here — avoids double-fire).
   */
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

  /**
   * Enrich a raw dispute-resolved domain event and send the notification email.
   * Invoked by NotificationsListener (no @OnEvent here — avoids double-fire).
   */
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
