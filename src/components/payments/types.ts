export type PaymentPurpose = 'ai' | 'donation' | 'ad';

export type PaymentStatus = 'created' | 'paid' | 'expired' | 'failed' | 'refunded';

export interface AiPlan {
  id: string;
  label: string;
  amount: number;
  days: number;
}

export interface AdPlan {
  id: string;
  label: string;
  amount: number;
  durationDays: number;
  blurb: string;
}

export interface PaymentsConfig {
  currency: string;
  configured: boolean;
  testMode: boolean;
  aiPlans: AiPlan[];
  donation: {
    min: number;
    max: number;
    presets: number[];
  };
  adPlans: AdPlan[];
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
