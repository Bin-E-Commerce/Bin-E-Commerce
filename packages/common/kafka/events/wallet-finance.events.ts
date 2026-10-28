// Sự kiện ví seller dùng chung giữa Order Service và Notification Service.
import type { IntegrationEventEnvelope } from '../contracts';

export const WalletFinanceEvents = {
    DEPOSIT_PAID: 'wallet.deposit.paid',
    DEPOSIT_FAILED: 'wallet.deposit.failed',
    WITHDRAWAL_REQUESTED: 'wallet.withdrawal.requested',
    WITHDRAWAL_PROCESSING: 'wallet.withdrawal.processing',
    WITHDRAWAL_PAID: 'wallet.withdrawal.paid',
    WITHDRAWAL_REJECTED: 'wallet.withdrawal.rejected',
} as const;

export type WalletFinanceEventName =
    (typeof WalletFinanceEvents)[keyof typeof WalletFinanceEvents];

export interface WalletFinanceChangedPayload {
    transactionId: string;
    shopId: string;
    sellerUserId: string;
    amount: string;
    status: 'PAID' | 'FAILED' | 'REQUESTED' | 'PROCESSING' | 'REJECTED';
    note: string | null;
}

export type WalletFinanceChangedEvent = IntegrationEventEnvelope<
    WalletFinanceEventName,
    WalletFinanceChangedPayload
>;
