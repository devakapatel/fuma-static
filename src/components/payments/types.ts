export type PaymentPurpose = 'ai';

export type PaymentStatus = 'created' | 'paid' | 'expired' | 'failed' | 'refunded';

export interface AiPlan {
  id: string;
  label: string;
  amount: number;
  days: number;
  blurb: string;
}

export interface PaymentsConfig {
  currency: string;
  configured: boolean;
  testMode: boolean;
  aiPlans: AiPlan[];
}

export interface PaymentIntent {
  id: string;
  purpose: PaymentPurpose;
  planId: string | null;
  label: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  details?: Record<string, string>;
}
