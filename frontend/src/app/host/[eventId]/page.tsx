'use client';

import { useEffect, useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { socket } from '@/lib/socket';

interface Option {
  id?: string;
  text: string;
  voteCount: number;
}

interface Poll {
  id: string;
  question: string;
  status: string;
  type: string;
  timer?: number | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  options: Option[];
}

interface Question {
  id: string;
  text: string;
  authorName: string;
  upvoteCount: number;
  status: string;
}

export default function HostDashboard({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const router = useRouter();
  const { data: session, status } = useSession();
  const eventCode = decodeURIComponent(eventId).trim().toUpperCase();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

  const [polls, setPolls] = useState<Poll[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [currentSlide, setCurrentSlide] = useState<string>('WELCOME');
  
  // New Poll Form State
  const [newPollQuestion, setNewPollQuestion] = useState('');
  const [newPollType, setNewPollType] = useState('MULTIPLE_CHOICE');
  const [newPollOptions, setNewPollOptions] = useState(['', '']);
  const [newPollTimer, setNewPollTimer] = useState('30');
  const [newPollAllowMultiple, setNewPollAllowMultiple] = useState(false);
  const [newPollMediaUrl, setNewPollMediaUrl] = useState('');
  const [newPollMediaType, setNewPollMediaType] = useState('image');
  const [newPollIsQuiz, setNewPollIsQuiz] = useState(false);
  const [newPollCorrectOptionIndex, setNewPollCorrectOptionIndex] = useState(0);

  // Auto-Run & Selection State
  const [selectedPollIds, setSelectedPollIds] = useState<Set<string>>(new Set());
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const isAutoPlayingRef = useRef(false);

  const togglePollSelection = (id: string) => {
    setSelectedPollIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const unclosed = polls.filter(p => p.status !== 'closed').map(p => p.id);
    if (selectedPollIds.size === unclosed.length) {
      setSelectedPollIds(new Set());
    } else {
      setSelectedPollIds(new Set(unclosed));
    }
  };

  // AI Generator Modal State
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiCount, setAiCount] = useState(3);
  const [aiIsQuiz, setAiIsQuiz] = useState(true);
  const [aiDifficulty, setAiDifficulty] = useState<'low' | 'medium' | 'high'>('medium');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
      return;
    }
    if (status === 'loading') return;

    // 1. Fetch State
    const fetchState = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events/${eventCode}`);
        if (!res.ok) {
          router.push('/');
          return;
        }
        const data = await res.json();
        
        if (data.hostId !== (session?.user as any)?.id) {
          alert('You are not authorized to host this event.');
          router.push('/');
          return;
        }

        setPolls(data.polls);
        setSelectedPollIds(new Set(data.polls.filter((p: Poll) => p.status !== 'closed').map((p: Poll) => p.id)));
        setQuestions(data.questions);
        setCurrentSlide(data.currentSlide);
        const live = data.polls.find((p: Poll) => p.status === 'live');
        if (live) setActivePoll(live);
      } catch (err) {
        console.error(err);
      }
    };
    fetchState();

    // 2. Connect to Socket
    socket.connect();
    const joinRoom = () => {
      socket.emit('join-room', { eventCode, role: 'host', name: 'Host' });
    };
    if (socket.connected) {
      joinRoom();
    }
    socket.on('connect', joinRoom);

    // 3. Socket Listeners
    socket.on('poll-results-updated', ({ pollId, options }) => {
      setActivePoll(prev => (prev && prev.id === pollId ? { ...prev, options } : prev));
    });

    socket.on('poll-closed', (poll) => {
      setPolls(prev => prev.map(p => p.id === poll.id ? poll : p));
      setActivePoll(null);
    });

    socket.on('question-added', (question) => {
      setQuestions(prev => [question, ...prev]);
    });

    socket.on('question-upvoted', ({ questionId, newCount }) => {
      setQuestions(prev => prev.map(q => 
        q.id === questionId ? { ...q, upvoteCount: newCount } : q
      ).sort((a, b) => b.upvoteCount - a.upvoteCount));
    });

    socket.on('slide-changed', (slide) => {
      setCurrentSlide(slide);
    });

    socket.on('deck-updated', (newPolls) => {
      setPolls(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const toAdd = newPolls.filter((p: Poll) => !existingIds.has(p.id));
        return [...prev, ...toAdd];
      });
      setSelectedPollIds(prev => {
        const next = new Set(prev);
        newPolls.forEach((p: Poll) => {
          if (p.status !== 'closed') next.add(p.id);
        });
        return next;
      });
    });

    socket.on('question-deleted', ({ questionId }) => {
      setQuestions(prev => prev.filter(q => q.id !== questionId));
    });

    socket.on('all-questions-cleared', () => {
      setQuestions([]);
    });

    return () => {
      socket.off('connect', joinRoom);
      socket.off('poll-results-updated');
      socket.off('poll-closed');
      socket.off('question-added');
      socket.off('question-upvoted');
      socket.off('slide-changed');
      socket.off('deck-updated');
      socket.off('question-deleted');
      socket.off('all-questions-cleared');
      socket.disconnect();
    };
  }, [eventCode, API_URL, status, session, router]);

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    const validOptions = newPollOptions.filter(o => o.trim());
    if (!newPollQuestion.trim()) return;
    if (newPollType === 'MULTIPLE_CHOICE' && validOptions.length < 2) return;

    try {
      const res = await fetch(`${API_URL}/api/events/${eventCode}/polls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: newPollQuestion,
          type: newPollType,
          options: validOptions,
          timer: newPollTimer || null,
          mediaUrl: newPollMediaUrl || null,
          mediaType: newPollMediaUrl ? newPollMediaType : null,
          isQuiz: newPollIsQuiz,
          correctOptionIndex: newPollCorrectOptionIndex,
          allowMultipleAnswers: newPollAllowMultiple
        })
      });
      const newPoll = await res.json();
      setPolls(prev => [...prev, newPoll]);
      setNewPollQuestion('');
      setNewPollOptions(['', '']);
      setNewPollTimer('');
      setNewPollMediaUrl('');
      setNewPollIsQuiz(false);
      setNewPollCorrectOptionIndex(0);
      setNewPollAllowMultiple(false);
    } catch (err) {
      console.error('Error creating poll', err);
    }
  };

  const handleLaunchPoll = (pollId: string) => {
    socket.emit('launch-poll', { eventCode, pollId });
    const pollToLaunch = polls.find(p => p.id === pollId);
    if (pollToLaunch) {
      setActivePoll({ ...pollToLaunch, status: 'live' });
    }
  };

  const handleRelaunchPoll = (pollId: string) => {
    socket.emit('relaunch-poll', { eventCode, pollId });
    const pollToRelaunch = polls.find(p => p.id === pollId);
    if (pollToRelaunch) {
      // Optimistically update status
      const updatedPoll = { ...pollToRelaunch, status: 'live', options: pollToRelaunch.options.map(o => ({ ...o, voteCount: 0 })) };
      setActivePoll(updatedPoll);
      setPolls(prev => prev.map(p => p.id === pollId ? updatedPoll : p));
    }
  };

  const handleClosePoll = (pollId: string) => {
    socket.emit('close-poll', { eventCode, pollId });
  };

  const handleDeletePoll = async (pollId: string) => {
    if (!confirm('Are you sure you want to delete this poll?')) return;
    try {
      const res = await fetch(`${API_URL}/api/events/${eventCode}/polls/${pollId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${(session as any)?.accessToken || ''}`
        }
      });
      if (res.ok) {
        setPolls(prev => prev.filter(p => p.id !== pollId));
        if (activePoll?.id === pollId) setActivePoll(null);
      } else {
        alert('Failed to delete poll.');
      }
    } catch (err) {
      console.error('Error deleting poll:', err);
    }
  };

  const handleModerate = (questionId: string, action: 'hide' | 'answered') => {
    socket.emit('moderate-question', { eventCode, questionId, action });
    setQuestions(prev => prev.map(q => q.id === questionId ? { ...q, status: action } : q));
  };

  const handleDeleteQuestion = (questionId: string) => {
    socket.emit('delete-question', { eventCode, questionId });
    setQuestions(prev => prev.filter(q => q.id !== questionId));
  };

  const handleClearAllQuestions = () => {
    if (!confirm('Are you sure you want to clear all audience questions?')) return;
    socket.emit('clear-all-questions', { eventCode });
    setQuestions([]);
  };

  const handleChangeSlide = (slide: string) => {
    socket.emit('change-slide', { eventCode, slide });
  };

  const stopAutoPlay = () => {
    isAutoPlayingRef.current = false;
    setIsAutoPlaying(false);
  };

  const startAutoPlay = async () => {
    let targetPolls = polls.filter(p => selectedPollIds.has(p.id) && p.status !== 'closed');
    if (targetPolls.length === 0) {
      targetPolls = polls.filter(p => p.status !== 'closed');
    }

    if (targetPolls.length === 0) {
      alert('No selected polls available to auto-run. Select some polls first!');
      return;
    }

    isAutoPlayingRef.current = true;
    setIsAutoPlaying(true);

    for (let i = 0; i < targetPolls.length; i++) {
      if (!isAutoPlayingRef.current) break;

      const currentTarget = targetPolls[i];
      socket.emit('launch-poll', { eventCode, pollId: currentTarget.id });
      setActivePoll({ ...currentTarget, status: 'live' });

      const durationSeconds = (currentTarget.timer || 30) + 3;
      for (let s = 0; s < durationSeconds; s++) {
        if (!isAutoPlayingRef.current) break;
        await new Promise(res => setTimeout(res, 1000));
      }

      if (!isAutoPlayingRef.current) break;

      socket.emit('close-poll', { eventCode, pollId: currentTarget.id });

      for (let s = 0; s < 2; s++) {
        if (!isAutoPlayingRef.current) break;
        await new Promise(res => setTimeout(res, 1000));
      }
    }

    if (isAutoPlayingRef.current) {
      handleChangeSlide('LEADERBOARD');
      stopAutoPlay();
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-[1600px] mx-auto space-y-8">
      <header className="flex justify-between items-center glass-panel p-6 rounded-3xl">
        <div>
          <h1 className="text-3xl font-bold text-white">Host Dashboard</h1>
          <p className="text-white/60">Event Code: <span className="font-mono text-white bg-white/10 px-2 py-1 rounded">{eventCode}</span></p>
        </div>
        <div className="flex gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-1 flex items-center">
            <button
              onClick={() => handleChangeSlide('WELCOME')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentSlide === 'WELCOME' ? 'bg-white text-black' : 'text-white hover:bg-white/10'}`}
            >
              Welcome Slide
            </button>
            <button
              onClick={() => handleChangeSlide('QNA')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentSlide === 'QNA' ? 'bg-white text-black' : 'text-white hover:bg-white/10'}`}
            >
              Q&A Slide
            </button>
            <button
              onClick={() => handleChangeSlide('LEADERBOARD')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentSlide === 'LEADERBOARD' ? 'bg-white text-black' : 'text-white hover:bg-white/10'}`}
            >
              Leaderboard
            </button>
          </div>
          <button 
            onClick={() => window.open(`/present/${eventCode}`, '_blank')}
            className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-3 px-6 rounded-xl hover:opacity-90 transition-opacity flex items-center gap-2 shadow-[0_0_20px_rgba(168,85,247,0.4)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Open Presenter View
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Col: Polls (Expanded 8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h2 className="text-2xl font-bold text-white">Poll Management</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-xs text-white/60 hover:text-white underline mr-1 cursor-pointer"
              >
                {selectedPollIds.size === polls.filter(p => p.status !== 'closed').length && polls.length > 0
                  ? 'Deselect All'
                  : 'Select All'}
              </button>

              <button
                type="button"
                onClick={isAutoPlaying ? stopAutoPlay : startAutoPlay}
                disabled={!isAutoPlaying && selectedPollIds.size === 0}
                className={`font-bold py-2.5 px-4 rounded-xl transition-all flex items-center gap-2 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isAutoPlaying
                    ? 'bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 animate-pulse'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:opacity-90 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                }`}
              >
                {isAutoPlaying ? (
                  <>
                    <span>⏹️</span> Stop Auto-Run
                  </>
                ) : (
                  <>
                    <span>▶️</span> Auto-Run ({selectedPollIds.size})
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowAiModal(true)}
                className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-bold py-2.5 px-4 rounded-xl hover:opacity-90 transition-all shadow-[0_0_15px_rgba(168,85,247,0.4)] flex items-center gap-2 text-sm cursor-pointer"
              >
                ✨ AI Deck Generator
              </button>
            </div>
          </div>
          
          {/* Create Poll */}
          <form onSubmit={handleCreatePoll} className="glass-panel p-6 rounded-2xl space-y-4">
            <h3 className="text-lg font-semibold text-white/90">Create New Poll</h3>
            
            <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setNewPollType('MULTIPLE_CHOICE')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${newPollType === 'MULTIPLE_CHOICE' ? 'bg-white text-black' : 'text-white hover:bg-white/10'}`}
              >
                Multiple Choice
              </button>
              <button
                type="button"
                onClick={() => setNewPollType('WORD_CLOUD')}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${newPollType === 'WORD_CLOUD' ? 'bg-white text-black' : 'text-white hover:bg-white/10'}`}
              >
                Word Cloud
              </button>
            </div>

            <input
              type="text"
              placeholder={newPollType === 'WORD_CLOUD' ? "e.g., Describe our product in one word" : "Poll Question"}
              value={newPollQuestion}
              onChange={e => setNewPollQuestion(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white"
            />
            
            {newPollType === 'MULTIPLE_CHOICE' && (
              <>
                <label className="flex items-center gap-2 text-white/90 text-sm">
                  <input
                    type="checkbox"
                    checked={newPollIsQuiz}
                    onChange={(e) => setNewPollIsQuiz(e.target.checked)}
                    className="w-4 h-4 rounded bg-white/10 border-white/20"
                  />
                  Make this a Quiz (Score based on speed & correctness)
                </label>
                {newPollOptions.map((opt, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    {newPollIsQuiz && (
                      <input
                        type="radio"
                        name="correctOption"
                        checked={newPollCorrectOptionIndex === idx}
                        onChange={() => setNewPollCorrectOptionIndex(idx)}
                        className="w-4 h-4 cursor-pointer accent-green-500"
                        title="Mark as correct answer"
                      />
                    )}
                    <input
                      type="text"
                      placeholder={`Option ${idx + 1}`}
                      value={opt}
                      onChange={e => {
                        const newOpts = [...newPollOptions];
                        newOpts[idx] = e.target.value;
                        setNewPollOptions(newOpts);
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setNewPollOptions(prev => [...prev, ''])}
                  className="text-sm text-blue-400 hover:text-blue-300"
                >
                  + Add Option
                </button>
              </>
            )}

            {newPollType === 'WORD_CLOUD' && (
              <label className="flex items-center gap-2 text-white/90 text-sm mt-4">
                <input
                  type="checkbox"
                  checked={newPollAllowMultiple}
                  onChange={(e) => setNewPollAllowMultiple(e.target.checked)}
                  className="w-4 h-4 rounded bg-white/10 border-white/20"
                />
                Allow multiple submissions per person
              </label>
            )}

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-white/70 mb-1">Timer</label>
                <select
                  value={newPollTimer}
                  onChange={e => setNewPollTimer(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none"
                >
                  <option value="" className="text-black">No Timer</option>
                  <option value="10" className="text-black">10 Seconds</option>
                  <option value="15" className="text-black">15 Seconds</option>
                  <option value="20" className="text-black">20 Seconds</option>
                  <option value="30" className="text-black">30 Seconds</option>
                  <option value="60" className="text-black">60 Seconds</option>
                  <option value="75" className="text-black">75 Seconds</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Add Image (Optional URL)</label>
              <input
                type="text"
                placeholder="https://... (Image URL only)"
                value={newPollMediaUrl}
                onChange={e => {
                  setNewPollMediaUrl(e.target.value);
                  setNewPollMediaType('image');
                }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm"
              />
            </div>
            
            <button type="submit" className="w-full bg-blue-600 text-white rounded-xl py-2 mt-4 font-semibold hover:bg-blue-700">
              Save Draft
            </button>
          </form>

          {/* Active / Draft Polls */}
          <div className="space-y-4">
            {activePoll && (
              <div className="glass-panel p-6 rounded-2xl border-purple-500/50 space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-1 block">
                      {activePoll.type === 'WORD_CLOUD' ? 'Word Cloud' : 'Multiple Choice'}
                    </span>
                    <h3 className="text-xl font-bold text-white">{activePoll.question}</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded-full uppercase tracking-wider font-bold animate-pulse">Live</span>
                    <button
                      onClick={() => handleClosePoll(activePoll.id)}
                      className="bg-white/10 hover:bg-red-500/20 text-white hover:text-red-300 transition-colors px-3 py-1 rounded-lg text-sm font-semibold border border-white/20 hover:border-red-500/50"
                    >
                      Close Poll
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {activePoll.options.map(opt => (
                    <div key={opt.id} className="flex justify-between text-white/80 bg-white/5 p-3 rounded-lg">
                      <span>{opt.text}</span>
                      <span className="font-mono">{opt.voteCount} votes</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {polls.filter(p => p.status === 'draft').map(poll => (
              <div
                key={poll.id}
                className={`glass-panel p-4 rounded-xl flex justify-between items-center transition-all ${
                  selectedPollIds.has(poll.id) ? 'border-purple-500/50 bg-purple-500/5' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedPollIds.has(poll.id)}
                    onChange={() => togglePollSelection(poll.id)}
                    className="w-5 h-5 rounded bg-white/10 border-white/30 text-purple-600 focus:ring-purple-500 cursor-pointer accent-purple-500"
                    title="Select for Auto-Run"
                  />
                  <div>
                    <span className="text-[10px] font-bold text-purple-400/80 uppercase tracking-widest block mb-0.5">
                      {poll.type === 'WORD_CLOUD' ? 'Word Cloud' : 'Multiple Choice'}
                      {poll.timer && ` • ${poll.timer}s`}
                    </span>
                    <span className="text-white font-medium">{poll.question}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleLaunchPoll(poll.id)}
                    className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-green-700 transition"
                  >
                    Launch
                  </button>
                  <button
                    onClick={() => handleDeletePoll(poll.id)}
                    className="bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-red-500/30 transition border border-red-500/20 hover:border-red-500/50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {polls.filter(p => p.status === 'closed').length > 0 && (
              <div className="mt-8 space-y-4">
                <h3 className="text-lg font-semibold text-white/60">Past Polls</h3>
                {polls.filter(p => p.status === 'closed').map(poll => (
                  <div key={poll.id} className="glass-panel p-4 rounded-xl opacity-80 flex flex-col gap-3">
                    <div>
                      <h4 className="text-white font-medium">{poll.question}</h4>
                    </div>
                    <div className="space-y-1">
                      {poll.options.map(opt => (
                        <div key={opt.id} className="flex justify-between text-xs text-white/80 bg-white/5 px-2 py-1 rounded">
                          <span>{opt.text}</span>
                          <span>{opt.voteCount} votes</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleDeletePoll(poll.id)}
                        className="bg-red-500/20 text-red-400 px-3 py-1 rounded-lg text-xs font-semibold hover:bg-red-500/30 transition"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => handleRelaunchPoll(poll.id)}
                        className="bg-purple-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-purple-700 transition"
                      >
                        Re-launch
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Q&A (Compact 4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Audience Q&A</h2>
            {questions.length > 0 && (
              <button
                type="button"
                onClick={handleClearAllQuestions}
                className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-2.5 py-1 rounded-lg transition-colors font-medium cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>
          
          <div className="glass-panel p-4 rounded-2xl h-[520px] flex flex-col space-y-3">
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              {questions.map(q => (
                <div key={q.id} className={`p-4 rounded-xl border ${q.status === 'hidden' ? 'opacity-50 bg-white/5 border-red-500/20' : q.status === 'answered' ? 'bg-green-500/10 border-green-500/20' : 'bg-white/10 border-white/20'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <p className="text-white font-medium">{q.text}</p>
                    <span className="text-white/40 text-sm">{q.upvoteCount} upvotes</span>
                  </div>
                  <div className="flex justify-between items-center mt-4">
                    <span className="text-xs text-white/50">{q.authorName}</span>
                    <div className="flex gap-2">
                      {q.status !== 'answered' && (
                        <button
                          onClick={() => handleModerate(q.id, 'answered')}
                          className="text-xs bg-green-500/20 text-green-300 px-3 py-1 rounded hover:bg-green-500/30 transition cursor-pointer"
                        >
                          Mark Answered
                        </button>
                      )}
                      {q.status !== 'hidden' && (
                        <button
                          onClick={() => handleModerate(q.id, 'hide')}
                          className="text-xs bg-amber-500/20 text-amber-300 px-3 py-1 rounded hover:bg-amber-500/30 transition cursor-pointer"
                        >
                          Hide
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteQuestion(q.id)}
                        className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 px-3 py-1 rounded transition border border-red-500/20 cursor-pointer font-semibold"
                        title="Delete this question"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* AI Deck Generator Modal */}
      {showAiModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-purple-500/30 w-full max-w-lg rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_50px_rgba(168,85,247,0.3)]">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-amber-300 flex items-center gap-2">
                ✨ AI Deck Generator
              </h2>
              <button
                onClick={() => setShowAiModal(false)}
                className="text-white/40 hover:text-white transition-colors text-2xl font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-white/60 text-sm">
              Enter any topic, subject, or prompt. Gemini AI will automatically generate interactive quiz questions with options & timers for your audience!
            </p>

            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!aiTopic.trim()) return;
              setIsGeneratingAi(true);
              setAiError('');

              try {
                const token = (session as any)?.accessToken || (session as any)?.token;
                const res = await fetch(`${API_URL}/api/events/${eventCode}/generate-ai-polls`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                  },
                  body: JSON.stringify({
                    topic: aiTopic,
                    count: aiCount,
                    isQuiz: aiIsQuiz,
                    difficulty: aiDifficulty
                  })
                });

                const data = await res.json();
                if (!res.ok) {
                  throw new Error(data.error || 'Failed to generate polls');
                }

                if (data.polls) {
                  setPolls(prev => {
                    const existingIds = new Set(prev.map(p => p.id));
                    const toAdd = data.polls.filter((p: Poll) => !existingIds.has(p.id));
                    return [...prev, ...toAdd];
                  });
                }
                setShowAiModal(false);
                setAiTopic('');
              } catch (err: any) {
                console.error(err);
                setAiError(err.message || 'Something went wrong');
              } finally {
                setIsGeneratingAi(false);
              }
            }} className="space-y-4">
              <div>
                <label className="block text-white/80 text-sm font-medium mb-1">Topic or Subject</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Modern Web Dev, Company Trivia, React 19..."
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:outline-none focus:border-purple-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-1">Number of Polls</label>
                  <select
                    value={aiCount}
                    onChange={(e) => setAiCount(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none"
                  >
                    <option value={3}>3 Questions</option>
                    <option value={5}>5 Questions</option>
                    <option value={8}>8 Questions</option>
                  </select>
                </div>

                <div>
                  <label className="block text-white/80 text-sm font-medium mb-1">Mode</label>
                  <select
                    value={aiIsQuiz ? 'quiz' : 'poll'}
                    onChange={(e) => setAiIsQuiz(e.target.value === 'quiz')}
                    className="w-full bg-slate-800 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none"
                  >
                    <option value="quiz">Quiz (scored)</option>
                    <option value="poll">Opinion Poll</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-white/80 text-sm font-medium mb-1">Difficulty Level</label>
                <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setAiDifficulty('low')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      aiDifficulty === 'low'
                        ? 'bg-emerald-500 text-white shadow-md'
                        : 'text-white/70 hover:bg-white/10'
                    }`}
                  >
                    🟢 Low (Easy)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiDifficulty('medium')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      aiDifficulty === 'medium'
                        ? 'bg-amber-500 text-white shadow-md'
                        : 'text-white/70 hover:bg-white/10'
                    }`}
                  >
                    🟡 Medium
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiDifficulty('high')}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      aiDifficulty === 'high'
                        ? 'bg-red-500 text-white shadow-md'
                        : 'text-white/70 hover:bg-white/10'
                    }`}
                  >
                    🔴 High (Hard)
                  </button>
                </div>
              </div>

              {aiError && (
                <p className="text-red-400 text-sm bg-red-500/10 p-3 rounded-xl border border-red-500/20">{aiError}</p>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAiModal(false)}
                  className="px-5 py-2.5 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGeneratingAi || !aiTopic.trim()}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold hover:opacity-90 transition-opacity text-sm shadow-lg flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isGeneratingAi ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Generating...
                    </>
                  ) : (
                    <>✨ Generate Deck</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
