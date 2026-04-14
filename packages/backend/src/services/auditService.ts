import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

interface AuditLogParams {
  userId?: string;
  locationId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Create an audit log entry. Used to track schedule changes, booking events, etc.
 */
export async function createAuditLog(params: AuditLogParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId || null,
        locationId: params.locationId || null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId || null,
        changes: params.changes ? (params.changes as Prisma.InputJsonValue) : Prisma.JsonNull,
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (error) {
    // Don't let audit logging failures break the main flow
    console.error('Audit log failed:', error);
  }
}
