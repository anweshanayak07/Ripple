'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [joinCode, setJoinCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [userEvents, setUserEvents] = useState<any[]>([]);

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (status === 'authenticated' && (session as any)?.accessToken) {
      const fetchEvents = async () => {
        try {
          const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
          const res = await fetch(`${API_URL}/api/user/events`, {
            headers: { 'Authorization': `Bearer ${(session as any).accessToken}` }
          });
          if (res.ok) {
            const data = await res.json();
            setUserEvents(data);
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchEvents();
    }
  }, [status, session]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.trim()) {
      router.push(`/join/${joinCode.trim().toUpperCase()}`);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim()) return;
    setIsCreating(true);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
      const res = await fetch(`${API_URL}/api/events`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(session as any)?.accessToken}`
        },
        body: JSON.stringify({
          title: eventTitle
        }),
      });
      const event = await res.json();
      router.push(`/host/${event.code}`);
    } catch (error) {
      console.error('Failed to create event', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteEvent = async (e: React.MouseEvent, code: string) => {
    e.preventDefault();
    if (!confirm('Are you sure you want to delete this event?')) return;
    
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
      const res = await fetch(`${API_URL}/api/events/${code}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${(session as any)?.accessToken}` }
      });
      if (res.ok) {
        setUserEvents(prev => prev.filter(evt => evt.code !== code));
      }
    } catch (err) {
      console.error('Failed to delete event', err);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (authMode === 'login') {
      const res = await signIn('credentials', {
        redirect: false,
        email,
        password
      });
      if (res?.error) setAuthError('Invalid email or password');
    } else {
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
        const res = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name: name || 'User' })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Registration failed');
        }
        await signIn('credentials', { redirect: false, email, password });
      } catch (err: any) {
        setAuthError(err.message || 'Registration failed');
      }
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-12 items-center">
        {/* Branding Side */}
        <div className="text-center md:text-left space-y-6">
          <h1 className="text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
            Ripple
          </h1>
          <p className="text-xl text-white/70 font-light">
            Live Polling & Q&A Platform for interactive events and engaging audiences.
          </p>
        </div>

        {/* Action Cards */}
        <div className="space-y-6">
          {/* Join Card */}
          <div className="glass-panel p-8 rounded-3xl space-y-6 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <h2 className="text-2xl font-semibold text-white relative z-10">Join an Event</h2>
            <form onSubmit={handleJoin} className="space-y-4 relative z-10">
              <input
                type="text"
                placeholder="Enter Event Code (e.g. POLL-8X2K)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all uppercase"
                required
              />
              <button
                type="submit"
                className="w-full bg-white text-black font-semibold rounded-xl px-4 py-3 hover:bg-white/90 transition-colors"
              >
                Join Now
              </button>
            </form>
          </div>

          <div className="flex items-center gap-4 text-white/30">
            <div className="h-px bg-white/20 flex-1"></div>
            <span className="text-sm uppercase tracking-widest">or</span>
            <div className="h-px bg-white/20 flex-1"></div>
          </div>

          {/* Host Card */}
          <div className="glass-panel p-8 rounded-3xl space-y-6 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            {status === 'loading' ? (
              <div className="relative z-10 text-white/50 text-center py-4">Loading...</div>
            ) : status === 'authenticated' ? (
              <div className="relative z-10 space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-semibold text-white">Host an Event</h2>
                  <button onClick={() => signOut()} className="text-sm text-white/50 hover:text-white transition-colors">Sign Out</button>
                </div>
                <p className="text-white/60 text-sm">Welcome back, {session?.user?.name || session?.user?.email}</p>
                <form onSubmit={handleCreate} className="space-y-4">
                  <input
                    type="text"
                    placeholder="Event Title"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    required
                  />
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl px-4 py-3 hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isCreating ? 'Creating...' : 'Create New Event'}
                  </button>
                </form>
              </div>
            ) : (
              <div className="relative z-10 space-y-4">
                <h2 className="text-2xl font-semibold text-white">Sign In to Host</h2>
                {authError && <p className="text-red-400 text-sm">{authError}</p>}
                <form onSubmit={handleAuth} className="space-y-4">
                  {authMode === 'register' && (
                    <input
                      type="text"
                      placeholder="Your Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      required
                    />
                  )}
                  <input
                    type="email"
                    placeholder="Email Address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    required
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    required
                  />
                  <button
                    type="submit"
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl px-4 py-3 hover:opacity-90 transition-opacity"
                  >
                    {authMode === 'login' ? 'Sign In' : 'Create Account'}
                  </button>
                </form>
                <div className="text-center">
                  <button 
                    onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}
                    className="text-sm text-white/50 hover:text-white transition-colors"
                  >
                    {authMode === 'login' ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* User Dashboard: Past Events (Only show when authenticated) */}
      {status === 'authenticated' && (
        <div className="w-full max-w-4xl mt-12 space-y-6 animate-fade-in-up">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            My Events <span className="text-sm font-normal text-white/50 bg-white/10 px-2 py-1 rounded-full">{userEvents.length}</span>
          </h2>
          {userEvents.length === 0 ? (
            <div className="glass-panel p-8 rounded-2xl text-center text-white/60">
              You haven't hosted any events yet. Create one above to get started!
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {userEvents.map(evt => (
                <Link 
                  key={evt.id} 
                  href={`/host/${evt.code}`}
                  className="glass-panel p-6 rounded-2xl hover:border-blue-500/50 transition group flex flex-col justify-between h-32 relative"
                >
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold text-white group-hover:text-blue-400 transition-colors line-clamp-1">{evt.title}</h3>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs bg-white/10 text-white px-2 py-1 rounded">{evt.code}</span>
                      <button 
                        onClick={(e) => handleDeleteEvent(e, evt.code)}
                        className="opacity-0 group-hover:opacity-100 bg-red-500/20 text-red-400 hover:bg-red-500/40 p-1.5 rounded transition"
                        title="Delete Event"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-white/40">
                    Created {new Date(evt.createdAt).toLocaleDateString()}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
