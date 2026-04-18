'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { api, SchoolContractPublic } from '@/lib/api';

export default function ContractSigningPage() {
  const params = useParams();
  const token = params.token as string;

  const [contract, setContract] = useState<SchoolContractPublic | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Signing form
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  const primaryColor = contract?.schoolTeam?.brandColors?.primary || '#1a3e72';
  const secondaryColor = contract?.schoolTeam?.brandColors?.secondary || '#c4a34d';

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await api.getContractByToken(token);
        if (res.data) {
          setContract(res.data);
          if (res.data.status === 'SIGNED') {
            setSigned(true);
          }
        }
      } catch {
        setError('Invalid or expired contract link.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [token]);

  async function handleSign(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!signerName.trim() || !signerEmail.trim()) {
      setError('Please enter your full name and email address.');
      return;
    }
    if (!agreed) {
      setError('Please confirm you have read and agree to the terms.');
      return;
    }

    setIsSigning(true);
    try {
      await api.signContract(token, {
        signedByName: signerName.trim(),
        signedByEmail: signerEmail.trim(),
      });
      setSigned(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to sign contract. Please try again.');
    } finally {
      setIsSigning(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function formatCents(cents: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  // ----- Loading -----
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="animate-spin w-10 h-10 border-3 border-green-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // ----- Error / not found -----
  if (!contract) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-950">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Contract Not Found</h1>
          <p className="text-gray-400">{error || 'This contract link is invalid or has expired.'}</p>
          <p className="text-gray-500 text-sm mt-4">
            Contact PPL at{' '}
            <a href="mailto:info@pitchingperformancelab.com" className="text-green-400 hover:underline">
              info@pitchingperformancelab.com
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ----- Already signed -----
  if (signed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: `linear-gradient(135deg, ${primaryColor}20 0%, #0a0a0a 50%, ${secondaryColor}20 100%)` }}>
        <div className="w-full max-w-lg text-center">
          <div className="flex items-center justify-center gap-4 mb-8">
            {contract.schoolTeam.brandLogoUrl ? (
              <img src={contract.schoolTeam.brandLogoUrl} alt={contract.schoolTeam.name} className="w-14 h-14 rounded-lg object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-lg flex items-center justify-center text-white font-bold text-xl" style={{ backgroundColor: primaryColor }}>
                {contract.schoolTeam.name.charAt(0)}
              </div>
            )}
            <span className="text-gray-500 text-2xl font-light">&times;</span>
            <div className="w-14 h-14 rounded-full flex items-center justify-center bg-gradient-to-br from-green-600 to-green-500">
              <span className="text-white text-xl font-bold">P</span>
            </div>
          </div>

          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6" style={{ backgroundColor: `${primaryColor}20` }}>
            <svg className="w-10 h-10" style={{ color: secondaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-white mb-2">Contract Signed</h1>
          <p className="text-gray-400 mb-4">
            {contract.signedByName ? `Signed by ${contract.signedByName}` : 'This contract has been signed'}{contract.signedAt ? ` on ${formatDate(contract.signedAt)}` : ''}.
          </p>

          <div className="rounded-lg border border-gray-700 p-4 text-left">
            <h3 className="font-semibold text-white mb-1">{contract.title}</h3>
            <div className="text-sm text-gray-400 space-y-1">
              <p>Period: {formatDate(contract.startDate)} &ndash; {formatDate(contract.endDate)}</p>
              {contract.totalValueCents && (
                <p>Total Value: {formatCents(contract.totalValueCents)}</p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-600 mt-8">
            Powered by <span className="text-green-500 font-medium">Pitching Performance Lab</span>
          </p>
        </div>
      </div>
    );
  }

  // ----- Voided or Expired -----
  if (contract.status === 'VOIDED' || contract.status === 'EXPIRED') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-950">
        <div className="w-full max-w-md text-center">
          <h1 className="text-xl font-bold text-white mb-2">
            Contract {contract.status === 'VOIDED' ? 'Voided' : 'Expired'}
          </h1>
          <p className="text-gray-400">
            This contract is no longer available for signing. Please contact PPL for an updated agreement.
          </p>
          <p className="text-gray-500 text-sm mt-4">
            <a href="mailto:info@pitchingperformancelab.com" className="text-green-400 hover:underline">
              info@pitchingperformancelab.com
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ----- Main signing form -----
  return (
    <div className="min-h-screen px-4 py-8" style={{ background: `linear-gradient(135deg, ${primaryColor}15 0%, #0a0a0a 40%, ${secondaryColor}10 100%)` }}>
      <div className="w-full max-w-2xl mx-auto">
        {/* Dual branding header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-6">
            {contract.schoolTeam.brandLogoUrl ? (
              <img src={contract.schoolTeam.brandLogoUrl} alt={contract.schoolTeam.name} className="w-16 h-16 rounded-lg object-cover shadow-lg" />
            ) : (
              <div className="w-16 h-16 rounded-lg flex items-center justify-center text-white font-bold text-2xl shadow-lg" style={{ backgroundColor: primaryColor }}>
                {contract.schoolTeam.name.charAt(0)}
              </div>
            )}
            <span className="text-gray-500 text-3xl font-light">&times;</span>
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br from-green-600 to-green-500 shadow-lg">
              <span className="text-white text-2xl font-bold">P</span>
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-1">Partnership Agreement</h1>
          <p className="text-gray-400">
            <span style={{ color: primaryColor }}>{contract.schoolTeam.name}</span> &amp; Pitching Performance Lab
          </p>
        </div>

        {/* Contract details card */}
        <div className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">{contract.title}</h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">Start Date</span>
              <p className="text-sm text-gray-300 mt-0.5">{formatDate(contract.startDate)}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500 uppercase tracking-wide">End Date</span>
              <p className="text-sm text-gray-300 mt-0.5">{formatDate(contract.endDate)}</p>
            </div>
            {contract.totalValueCents && (
              <div>
                <span className="text-xs text-gray-500 uppercase tracking-wide">Total Value</span>
                <p className="text-sm text-gray-300 mt-0.5">{formatCents(contract.totalValueCents)}</p>
              </div>
            )}
          </div>

          {/* Terms */}
          <div>
            <span className="text-xs text-gray-500 uppercase tracking-wide block mb-2">Terms &amp; Conditions</span>
            <div className="rounded-lg border border-gray-700 bg-gray-950/50 p-4 max-h-80 overflow-y-auto">
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {contract.terms}
              </div>
            </div>
          </div>
        </div>

        {/* Signing form */}
        <form onSubmit={handleSign} className="rounded-xl border border-gray-700/50 bg-gray-900/50 p-6">
          <h3 className="text-base font-semibold text-white mb-4">Sign This Agreement</h3>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Full Legal Name *</label>
              <input
                type="text"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                required
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Email Address *</label>
              <input
                type="email"
                value={signerEmail}
                onChange={e => setSignerEmail(e.target.value)}
                placeholder="jane@school.edu"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-700 bg-gray-900/50 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                required
              />
            </div>
          </div>

          {/* Agreement checkbox */}
          <label className="flex items-start gap-3 mb-6 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-gray-600 text-green-500 focus:ring-green-500 bg-gray-800"
            />
            <span className="text-sm text-gray-400">
              I have read and agree to the terms and conditions outlined above. By signing, I confirm I am authorized to enter into this agreement on behalf of {contract.schoolTeam.name}.
            </span>
          </label>

          {/* Sign preview */}
          {signerName && (
            <div className="mb-6 p-4 rounded-lg border border-gray-700 bg-gray-950/30 text-center">
              <p className="text-xs text-gray-500 mb-1">Digital Signature</p>
              <p className="text-2xl font-serif italic text-white">{signerName}</p>
              <p className="text-xs text-gray-500 mt-1">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSigning || !agreed}
            className="w-full py-4 rounded-lg text-white font-semibold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            style={{
              background: agreed
                ? `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 150%)`
                : '#374151',
            }}
          >
            {isSigning ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Signing...
              </span>
            ) : (
              'Sign Agreement'
            )}
          </button>
        </form>

        {/* PPL footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-600">
            Powered by <span className="text-green-500 font-medium">Pitching Performance Lab</span>
          </p>
        </div>
      </div>
    </div>
  );
}
