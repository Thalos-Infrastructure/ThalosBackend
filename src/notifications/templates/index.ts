import {
  AgreementCreatedData,
  AgreementFundedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
  DisputeOpenedData,
  DisputeResolvedData,
  AgreementCompletedData,
} from "../types/notification-data.types";
import { baseTemplate, formatWallet, formatAmount } from "./base.template";

export function agreementCreatedTemplate(data: AgreementCreatedData): string {
  const content = `
    <h2 style="color: #FFFFFF; margin: 0 0 16px;">New Agreement Created</h2>
    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      A new agreement has been created and you have been added as a participant.
    </p>

    <div style="background: #1a2540; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <h3 style="color: #FFFFFF; margin: 0 0 12px; font-size: 18px;">${data.title}</h3>
      ${data.description ? `<p style="color: rgba(255,255,255,0.6); margin: 0 0 16px;">${data.description}</p>` : ""}

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55); width: 120px;">Amount:</td>
          <td style="padding: 8px 0; color: #FFFFFF; font-weight: 600;">${formatAmount(data.amount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Created by:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.createdByName || formatWallet(data.createdByWallet)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Participants:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.participantWallets.length} participant(s)</td>
        </tr>
      </table>
    </div>

    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      The agreement is now pending funding. Once funded, work can begin on the agreed terms.
    </p>

    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}"
       style="display: inline-block; background: #F0B400; color: #0C1220; padding: 12px 24px;
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function agreementFundedTemplate(data: AgreementFundedData): string {
  const content = `
    <h2 style="color: #FFFFFF; margin: 0 0 16px;">Agreement Funded</h2>
    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      Great news! The agreement has been funded and is now active.
    </p>

    <div style="background: #1a2540; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #F0B400;">
      <h3 style="color: #FFFFFF; margin: 0 0 12px; font-size: 18px;">${data.title}</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55); width: 120px;">Amount:</td>
          <td style="padding: 8px 0; color: #F0B400; font-weight: 600;">${formatAmount(data.amount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Funded by:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.fundedByName || formatWallet(data.fundedByWallet)}</td>
        </tr>
        ${data.transactionSignature ? `
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Transaction:</td>
          <td style="padding: 8px 0;">
            <a href="https://solscan.io/tx/${data.transactionSignature}"
               style="color: #F0B400; text-decoration: none;">
              View on Solscan
            </a>
          </td>
        </tr>
        ` : ""}
      </table>
    </div>

    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      Work can now begin. Funds are held securely in the smart contract escrow until milestones are approved.
    </p>

    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}"
       style="display: inline-block; background: #F0B400; color: #0C1220; padding: 12px 24px;
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function evidenceSubmittedTemplate(data: EvidenceSubmittedData): string {
  const content = `
    <h2 style="color: #FFFFFF; margin: 0 0 16px;">Evidence Submitted</h2>
    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      New evidence has been submitted for milestone review.
    </p>

    <div style="background: #1a2540; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #F0B400;">
      <h3 style="color: #FFFFFF; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55); width: 120px;">Milestone:</td>
          <td style="padding: 8px 0; color: #FFFFFF; font-weight: 600;">#${data.milestoneIndex + 1} - ${data.milestoneDescription}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Submitted by:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.submittedByName || formatWallet(data.submittedByWallet)}</td>
        </tr>
        ${data.evidenceDescription ? `
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Description:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.evidenceDescription}</td>
        </tr>
        ` : ""}
      </table>
    </div>

    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      Please review the submitted evidence and approve the milestone if the work meets the agreed requirements.
    </p>

    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}"
       style="display: inline-block; background: #F0B400; color: #0C1220; padding: 12px 24px;
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      Review Evidence
    </a>
  `;
  return baseTemplate(content);
}

export function milestoneApprovedTemplate(data: MilestoneApprovedData): string {
  const content = `
    <h2 style="color: #FFFFFF; margin: 0 0 16px;">Milestone Approved</h2>
    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      A milestone has been approved and payment has been released.
    </p>

    <div style="background: #1a2540; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #F0B400;">
      <h3 style="color: #FFFFFF; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55); width: 120px;">Milestone:</td>
          <td style="padding: 8px 0; color: #FFFFFF; font-weight: 600;">#${data.milestoneIndex + 1} - ${data.milestoneDescription}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Amount:</td>
          <td style="padding: 8px 0; color: #F0B400; font-weight: 600;">${formatAmount(data.milestoneAmount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Approved by:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.approvedByName || formatWallet(data.approvedByWallet)}</td>
        </tr>
      </table>
    </div>

    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      The payment for this milestone has been automatically released from escrow.
    </p>

    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}"
       style="display: inline-block; background: #F0B400; color: #0C1220; padding: 12px 24px;
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function disputeOpenedTemplate(data: DisputeOpenedData): string {
  const content = `
    <h2 style="color: #FFFFFF; margin: 0 0 16px;">Dispute Opened</h2>
    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      A dispute has been opened on an agreement you are participating in.
    </p>

    <div style="background: #1a2540; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #ef4444;">
      <h3 style="color: #FFFFFF; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55); width: 120px;">Opened by:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.openedByName || formatWallet(data.openedByWallet)}</td>
        </tr>
        ${data.milestoneDescription ? `
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Milestone:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">#${(data.milestoneIndex ?? 0) + 1} - ${data.milestoneDescription}</td>
        </tr>
        ` : ""}
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Reason:</td>
          <td style="padding: 8px 0; color: #ef4444; font-weight: 500;">${data.disputeReason}</td>
        </tr>
      </table>
    </div>

    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      Funds in escrow are now frozen until the dispute is resolved. Both parties should work towards a resolution.
    </p>

    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}"
       style="display: inline-block; background: #F0B400; color: #0C1220; padding: 12px 24px;
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Dispute
    </a>
  `;
  return baseTemplate(content);
}

export function disputeResolvedTemplate(data: DisputeResolvedData): string {
  const content = `
    <h2 style="color: #FFFFFF; margin: 0 0 16px;">Dispute Resolved</h2>
    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      The dispute has been resolved and funds have been distributed accordingly.
    </p>

    <div style="background: #1a2540; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #F0B400;">
      <h3 style="color: #FFFFFF; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55); width: 120px;">Resolution:</td>
          <td style="padding: 8px 0; color: #FFFFFF; font-weight: 600;">${data.resolution}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Resolved by:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${data.resolvedByName || formatWallet(data.resolvedByWallet)}</td>
        </tr>
        ${data.releaseAmount ? `
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Released:</td>
          <td style="padding: 8px 0; color: #F0B400; font-weight: 600;">${formatAmount(data.releaseAmount, data.asset || "USDC")}</td>
        </tr>
        ` : ""}
        ${data.refundAmount ? `
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Refunded:</td>
          <td style="padding: 8px 0; color: #F0B400; font-weight: 600;">${formatAmount(data.refundAmount, data.asset || "USDC")}</td>
        </tr>
        ` : ""}
      </table>
    </div>

    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}"
       style="display: inline-block; background: #F0B400; color: #0C1220; padding: 12px 24px;
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function agreementCompletedTemplate(data: AgreementCompletedData): string {
  const completedDate = new Date(data.completedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
    <h2 style="color: #FFFFFF; margin: 0 0 16px;">Agreement Completed</h2>
    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      Congratulations! The agreement has been successfully completed.
    </p>

    <div style="background: #1a2540; border-radius: 8px; padding: 20px; margin-bottom: 24px; border: 1px solid #F0B400;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 48px; color: #F0B400;">&#10003;</span>
      </div>

      <h3 style="color: #FFFFFF; margin: 0 0 12px; font-size: 18px; text-align: center;">${data.title}</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55); width: 120px;">Total Amount:</td>
          <td style="padding: 8px 0; color: #F0B400; font-weight: 600;">${formatAmount(data.totalAmount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: rgba(255,255,255,0.55);">Completed on:</td>
          <td style="padding: 8px 0; color: #FFFFFF;">${completedDate}</td>
        </tr>
      </table>
    </div>

    <p style="color: rgba(255,255,255,0.8); margin: 0 0 24px;">
      All milestones have been approved and all payments have been released. Thank you for using Thalos!
    </p>

    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}"
       style="display: inline-block; background: #F0B400; color: #0C1220; padding: 12px 24px;
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}
