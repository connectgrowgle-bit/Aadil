/**
 * The permission catalogue. This is the single source of truth for what
 * `key`s exist — the seed script writes exactly these rows into
 * `permissions`, and `can()` (see can.ts) only ever checks membership
 * against rows actually in the database, never against this array
 * directly, so a change here requires re-seeding to take effect (by
 * design: the database, not the deploy, is what's authoritative at
 * request time — Rule 12).
 *
 * `service.pricing` is deliberately separate from `service.edit`: someone
 * trusted to fix a tagline is not thereby trusted to reprice the
 * catalogue (Phase 9).
 */
export const PERMISSIONS = [
  // Auth / user administration
  { key: "users.view", description: "View user accounts" },
  { key: "users.suspend", description: "Suspend or reinstate a user account" },
  { key: "users.impersonate", description: "Sign in as another user for support purposes" },
  { key: "roles.manage", description: "Create/edit roles and their permission assignments" },

  // Service catalogue
  { key: "service.view", description: "View the service catalogue" },
  { key: "service.edit", description: "Edit service copy, descriptions, and metadata" },
  { key: "service.pricing", description: "Change plan prices (writes a price-history row)" },
  { key: "service.publish", description: "Publish or unpublish a service" },

  // Client orders
  { key: "order.view.own", description: "View one's own orders" },
  { key: "order.view.any", description: "View any client's orders" },
  { key: "order.assign", description: "Assign staff to an order" },
  { key: "order.advance_stage", description: "Advance an order to its next workflow stage" },
  { key: "order.cancel", description: "Cancel an order" },

  // CRM
  { key: "crm.view", description: "View CRM contacts and pipeline" },
  { key: "crm.edit", description: "Edit CRM contact details, notes, and tasks" },
  { key: "crm.assign", description: "Reassign a CRM contact's owner" },

  // Affiliate programme
  { key: "affiliate.view.own", description: "View one's own affiliate dashboard" },
  { key: "affiliate.view.any", description: "View any affiliate's account" },
  { key: "affiliate.kyc.review", description: "Approve or reject affiliate KYC submissions" },
  { key: "affiliate.suspend", description: "Suspend or terminate an affiliate" },
  { key: "affiliate.commission.adjust", description: "Write a manual commission adjustment entry" },
  { key: "payout.request", description: "Request a payout of one's own available commission" },
  { key: "payout.approve", description: "Approve a requested affiliate payout" },
  { key: "payout.view.any", description: "View any affiliate's payouts" },
  { key: "commission_policy.edit", description: "Change commission rate, hold period, fee, or TDS settings" },

  // Payments
  { key: "payment.view.any", description: "View payment and payment-transaction records" },
  { key: "webhook.view", description: "View the webhook event inbox" },

  // Training portal
  { key: "training.view.published", description: "View published training courses" },
  { key: "training.author", description: "Create/edit draft training content" },
  { key: "training.publish", description: "Publish training courses, modules, and lessons" },

  // Support
  { key: "support.ticket.view.own", description: "View one's own support tickets" },
  { key: "support.ticket.view.any", description: "View any support ticket" },
  { key: "support.ticket.respond", description: "Respond to a support ticket" },
  { key: "support.ticket.assign", description: "Assign a support ticket to staff" },

  // Platform settings & audit
  { key: "settings.view", description: "View platform settings" },
  { key: "settings.edit", description: "Change platform settings (writes settings_history)" },
  { key: "audit.view", description: "View the audit log" },
  { key: "admin.mfa.enforce", description: "Require MFA enrollment for a staff account" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ROLES: Record<string, { name: string; permissions: PermissionKey[] }> = {
  SUPER_ADMIN: {
    name: "Super Admin",
    permissions: PERMISSIONS.map((p) => p.key),
  },
  ADMIN: {
    name: "Admin",
    permissions: [
      "users.view",
      "users.suspend",
      "service.view",
      "service.edit",
      "service.pricing",
      "service.publish",
      "order.view.any",
      "order.assign",
      "order.advance_stage",
      "order.cancel",
      "crm.view",
      "crm.edit",
      "crm.assign",
      "affiliate.view.any",
      "affiliate.kyc.review",
      "affiliate.suspend",
      "affiliate.commission.adjust",
      "payout.approve",
      "payout.view.any",
      "commission_policy.edit",
      "payment.view.any",
      "webhook.view",
      "training.author",
      "training.publish",
      "support.ticket.view.any",
      "support.ticket.respond",
      "support.ticket.assign",
      "settings.view",
      "settings.edit",
      "audit.view",
      "admin.mfa.enforce",
    ],
  },
  OPS_STAFF: {
    name: "Operations Staff",
    permissions: [
      "order.view.any",
      "order.advance_stage",
      "crm.view",
      "crm.edit",
      "training.view.published",
      "support.ticket.view.any",
      "support.ticket.respond",
    ],
  },
  AFFILIATE_MANAGER: {
    name: "Affiliate Manager",
    permissions: [
      "affiliate.view.any",
      "affiliate.kyc.review",
      "affiliate.suspend",
      "affiliate.commission.adjust",
      "payout.approve",
      "payout.view.any",
      "crm.view",
    ],
  },
  SUPPORT_AGENT: {
    name: "Support Agent",
    permissions: [
      "support.ticket.view.any",
      "support.ticket.respond",
      "order.view.any",
      "crm.view",
    ],
  },
  CLIENT: {
    name: "Client",
    permissions: ["order.view.own", "support.ticket.view.own", "training.view.published"],
  },
  AFFILIATE: {
    name: "Affiliate",
    permissions: ["affiliate.view.own", "payout.request", "training.view.published"],
  },
};
