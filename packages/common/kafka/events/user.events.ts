// Contract cho các event thay đổi tài khoản; chỉ chứa snapshot tối thiểu để notification-service gửi email.
// Event không mang token, mật khẩu, hash hoặc thông tin credential của user.

import { UserStatus } from '../../enums/user-status.enum';
import { UserRole } from '../../enums/user-role.enum';
import { IntegrationEventEnvelope } from '../contracts';

export const UserEvents = {
    STATUS_CHANGED: 'user.status-changed',
    ROLE_CHANGED: 'user.role-changed',
} as const;

export type UserEventType = (typeof UserEvents)[keyof typeof UserEvents];

export interface UserStatusChangedPayload {
    userId: string;
    email: string;
    name: string;
    previousStatus: UserStatus;
    status: UserStatus;
    reason: string;
}

export type UserStatusChangedEvent = IntegrationEventEnvelope<
    typeof UserEvents.STATUS_CHANGED,
    UserStatusChangedPayload
>;

export interface UserRoleChangedPayload {
    userId: string;
    email: string;
    name: string;
    previousRole: UserRole;
    role: UserRole;
    reason: string;
}

export type UserRoleChangedEvent = IntegrationEventEnvelope<
    typeof UserEvents.ROLE_CHANGED,
    UserRoleChangedPayload
>;
