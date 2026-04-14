'use client';

import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

interface StripeCheckoutProps {
  clientSecret: string;
  planName: string;
  priceCents: number;
  billingDay: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Stripe Elements wrapper for payment during subscription.
 */
export default function StripeCheckout({
  clientSecret,
  planName,
  priceCents,
  billingDay,
  onSuccess,
  onCancel,
}: StripeCheckoutProps) {
  if (!stripePromise) {
    return (
      <div className="ppl-card text-center py-8">
        <p className="text-danger font-medium">
          Stripe is not configured. Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to your environment.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="ppl-card w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">Complete Payment</h2>
          <button onClick={onCancel} className="text-muted hover:text-foreground text-xl">
            &times;
          </button>
        </div>

        {/* Plan summary */}
        <div className="bg-background rounded-lg p-4 mb-5">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-semibold text-foreground">{planName}</p>
              <p className="text-xs text-muted mt-0.5">
                Billed weekly on {billingDay.toLowerCase()}s
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-ppl-light-green">
                ${(priceCents / 100).toFixed(0)}
              </p>
              <p className="text-xs text-muted">/week</p>
            </div>
          </div>
        </div>

        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: 'night',
              variables: {
                colorPrimary: '#95C83C',
                colorBackground: '#141414',
                colorText: '#F5F5F5',
                colorDanger: '#EF4444',
                fontFamily: 'Inter, -apple-system, sans-serif',
                borderRadius: '8px',
                spacingUnit: '4px',
              },
              rules: {
                '.Input': {
                  backgroundColor: '#0A0A0A',
                  border: '1px solid #2A2A2A',
                },
                '.Input:focus': {
                  borderColor: '#5E9E50',
                  boxShadow: '0 0 0 1px #5E9E50',
                },
                '.Label': {
                  color: '#888888',
                  fontSize: '13px',
                },
              },
            },
          }}
        >
          <CheckoutForm onSuccess={onSuccess} />
        </Elements>
      </div>
    </div>
  );
}

function CheckoutForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError('');

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/client/membership?payment=success`,
      },
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message || 'Payment failed. Please try again.');
      setIsProcessing(false);
    } else {
      // Payment succeeded without redirect
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />

      {error && (
        <div className="mt-3 p-2 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || isProcessing}
        className="ppl-btn ppl-btn-primary w-full justify-center mt-5 py-3"
      >
        {isProcessing ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Processing...
          </span>
        ) : (
          'Start Membership'
        )}
      </button>

      <p className="text-xs text-muted text-center mt-3">
        Your card will be charged weekly. You can request cancellation at any time.
      </p>
    </form>
  );
}
