'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { getSessionId } from '@/lib/session';

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [name, setName] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsJoining(true);

    // Ensure session ID exists
    getSessionId();
    
    // Store name temporarily if needed, or pass via URL/state
    localStorage.setItem('voterName', name);
    
    const formattedCode = decodeURIComponent(code).trim().toUpperCase();
    router.push(`/event/${formattedCode}`);
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="glass-panel p-8 rounded-3xl space-y-8 relative overflow-hidden">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-white">Join Event</h1>
            <p className="text-white/60 font-mono text-xl">{decodeURIComponent(code).trim().toUpperCase()}</p>
          </div>
          
          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                Your Name
              </label>
              <input
                type="text"
                placeholder="What should we call you?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={isJoining}
              className="w-full bg-white text-black font-semibold rounded-xl px-4 py-3 hover:bg-white/90 transition-colors disabled:opacity-50"
            >
              {isJoining ? 'Joining...' : 'Enter Event'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
