'use client';

import { useEffect, useState, use, useMemo } from 'react';
import QRCode from 'react-qr-code';
import { socket } from '@/lib/socket';
import CustomWordCloud from '@/components/CustomWordCloud';

interface Option {
  id: string;
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

export default function PresenterView({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const eventCode = decodeURIComponent(code).trim().toUpperCase();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/event/${eventCode}` : '';

  const [isLoading, setIsLoading] = useState(true);
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [eventTitle, setEventTitle] = useState('');
  const [currentSlide, setCurrentSlide] = useState('WELCOME');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<Array<{ name: string; score: number }>>([]);

  // Fetch Leaderboard
  useEffect(() => {
    if (currentSlide === 'LEADERBOARD') {
      const fetchLeaderboard = async () => {
        try {
          const res = await fetch(`${API_URL}/api/events/${eventCode}/leaderboard`);
          if (res.ok) {
            setLeaderboard(await res.json());
          }
        } catch (err) {
          console.error('Failed to fetch leaderboard', err);
        }
      };
      fetchLeaderboard();
    }
  }, [currentSlide, eventCode, API_URL]);

  // Timer Effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activePoll && activePoll.status === 'live' && activePoll.timer) {
      let initialTimeLeft = activePoll.timer;
      if ((activePoll as any).launchedAt) {
         const elapsed = Math.floor((Date.now() - new Date((activePoll as any).launchedAt).getTime()) / 1000);
         if (!isNaN(elapsed) && elapsed >= 0) {
           initialTimeLeft = Math.max(0, activePoll.timer - elapsed);
         }
      }
      setTimeLeft(initialTimeLeft);
      
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimeLeft(null);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activePoll?.id, activePoll?.status, activePoll?.timer]);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events/${eventCode}`);
        if (!res.ok) throw new Error('Event not found');
        const data = await res.json();
        
        setEventTitle(data.title);
        setCurrentSlide(data.currentSlide);
        setQuestions(data.questions.filter((q: Question) => q.status !== 'hidden'));
        
        if (data.currentSlide !== 'WELCOME' && data.currentSlide !== 'QNA') {
          const livePoll = data.polls.find((p: Poll) => p.id === data.currentSlide);
          if (livePoll) setActivePoll(livePoll);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchState();

    socket.connect();
    const joinRoom = () => {
      socket.emit('join-room', { eventCode, role: 'presenter', name: 'Big Screen' });
    };
    if (socket.connected) joinRoom();
    socket.on('connect', joinRoom);

    socket.on('user-count-updated', (count) => {
      setUserCount(count);
    });

    socket.on('poll-launched', (poll: Poll) => {
      setActivePoll(poll);
    });

    socket.on('poll-results-updated', ({ pollId, options }) => {
      setActivePoll(prev => {
        if (prev && prev.id === pollId) return { ...prev, options };
        return prev;
      });
    });

    socket.on('poll-closed', (poll: Poll) => {
      setActivePoll(prev => {
        if (prev && prev.id === poll.id) return poll;
        return prev;
      });
    });

    socket.on('slide-changed', (slide) => {
      setCurrentSlide(slide);
    });

    socket.on('question-added', (question: Question) => {
      if (question.status !== 'hidden') {
        setQuestions(prev => [question, ...prev].sort((a, b) => b.upvoteCount - a.upvoteCount));
      }
    });

    socket.on('question-upvoted', ({ questionId, newCount }) => {
      setQuestions(prev => prev.map(q => 
        q.id === questionId ? { ...q, upvoteCount: newCount } : q
      ).sort((a, b) => b.upvoteCount - a.upvoteCount));
    });

    socket.on('leaderboard-updated', (data) => {
      setLeaderboard(data);
    });

    socket.on('question-deleted', ({ questionId }) => {
      setQuestions(prev => prev.filter(q => q.id !== questionId));
    });

    socket.on('all-questions-cleared', () => {
      setQuestions([]);
    });

    return () => {
      socket.off('connect', joinRoom);
      socket.off('user-count-updated');
      socket.off('poll-launched');
      socket.off('poll-results-updated');
      socket.off('poll-closed');
      socket.off('slide-changed');
      socket.off('question-added');
      socket.off('question-upvoted');
      socket.off('leaderboard-updated');
      socket.off('question-deleted');
      socket.off('all-questions-cleared');
      socket.disconnect();
    };
  }, [eventCode, API_URL]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-white">Loading...</div>;

  return (
    <main className="h-screen w-screen flex flex-col p-2 md:p-4 md:pb-8 bg-[#0F172A] overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center px-2 py-1 border-b border-white/10 pb-2 mb-3 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">Ripple</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right flex items-center gap-2">
            <p className="text-xs text-white/50">Join at <span className="text-white font-bold">{joinUrl}</span> with code</p>
            <span className="font-mono text-sm md:text-lg text-white bg-white/10 px-2 py-0.5 rounded">{eventCode}</span>
          </div>
          <div className="flex items-center gap-1.5 text-white/60 bg-white/5 px-3 py-1.5 rounded-full text-xs md:text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            {userCount}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {currentSlide === 'WELCOME' && (
          <div className="flex flex-col items-center animate-fade-in-up max-h-full">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6 md:mb-12">Join the presentation</h2>
            <div className="bg-white p-6 rounded-3xl shadow-[0_0_50px_rgba(168,85,247,0.2)]">
              <QRCode 
                value={joinUrl} 
                size={300}
                level="M" // Error correction level
              />
            </div>
            <p className="text-white/60 mt-12 text-xl max-w-xl text-center">
              Scan this QR code with your phone's camera, or go to the URL at the top right to participate!
            </p>
          </div>
        )}

        {currentSlide === 'QNA' && (
          <div className="w-full h-full max-w-5xl flex flex-col animate-fade-in-up">
            <h2 className="text-4xl md:text-5xl font-bold text-white text-center mb-6 md:mb-8">Q&A</h2>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-4 custom-scrollbar">
              {questions.map((q) => (
                <div key={q.id} className="glass-panel p-6 rounded-3xl flex gap-4 md:gap-6 items-start border border-white/10 shadow-xl">
                  <div className="flex flex-col items-center bg-white/5 p-3 md:p-4 rounded-2xl min-w-[80px] md:min-w-[100px]">
                    <span className="text-3xl md:text-4xl font-bold text-white mb-1 md:mb-2">{q.upvoteCount}</span>
                    <span className="text-white/40 text-xs md:text-sm uppercase tracking-wider font-semibold">Votes</span>
                  </div>
                  <div className="flex-1 pt-2">
                    <p className="text-xl md:text-3xl text-white font-medium leading-tight mb-2 md:mb-4">{q.text}</p>
                    <p className="text-white/40 text-base md:text-lg">{q.authorName}</p>
                  </div>
                  {q.status === 'answered' && (
                    <div className="bg-green-500/20 text-green-300 px-4 py-2 rounded-full font-bold">
                      Answered
                    </div>
                  )}
                </div>
              ))}
              {questions.length === 0 && (
                <div className="text-center p-12 text-white/40 text-2xl">
                  No questions yet.
                </div>
              )}
            </div>
          </div>
        )}

        {currentSlide === 'LEADERBOARD' && (
          <div className="w-full max-w-5xl flex flex-col animate-fade-in-up">
            <h2 className="text-5xl font-bold text-white text-center mb-16">Quiz Leaderboard</h2>
            <div className="flex flex-col gap-6 relative">
              {leaderboard.length === 0 ? (
                <div className="text-center text-white/50 text-2xl">No quiz scores yet...</div>
              ) : (
                leaderboard.map((player, index) => {
                  const maxScore = leaderboard[0].score || 1;
                  const percent = Math.max(2, Math.round((player.score / maxScore) * 100));
                  return (
                    <div 
                      key={player.name + index} 
                      className="relative w-full h-24 bg-white/5 rounded-2xl flex items-center px-8 border border-white/10"
                    >
                      <div 
                        className={`absolute inset-y-0 left-0 transition-all duration-1000 ease-out rounded-2xl ${
                          index === 0 ? 'bg-gradient-to-r from-yellow-500/60 to-orange-500/60 shadow-[0_0_20px_rgba(234,179,8,0.3)]' :
                          index === 1 ? 'bg-gradient-to-r from-gray-300/50 to-gray-200/50' :
                          index === 2 ? 'bg-gradient-to-r from-amber-700/50 to-orange-800/50' :
                          'bg-gradient-to-r from-purple-600/40 to-pink-600/40'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                      <div className="relative z-10 w-full flex justify-between items-center text-white text-3xl font-bold">
                        <div className="flex items-center gap-6">
                          <span className={`w-10 text-center ${index < 3 ? 'text-4xl' : 'text-2xl text-white/50'}`}>
                            {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}
                          </span>
                          <span>{player.name}</span>
                        </div>
                        <span className="tabular-nums opacity-90">{player.score} pts</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {currentSlide !== 'WELCOME' && currentSlide !== 'QNA' && currentSlide !== 'LEADERBOARD' && activePoll && (
          <div className="w-full h-full max-w-7xl flex flex-col animate-fade-in-up overflow-hidden">
            <h2 className="text-3xl md:text-5xl font-bold text-white text-center leading-tight mb-4 shrink-0 px-4">
              {activePoll.question}
            </h2>
            
            <div className="flex justify-center items-center gap-4 mb-4 shrink-0">
              {timeLeft !== null && activePoll.status === 'live' && (
                <div className="bg-purple-500/20 border border-purple-500/50 text-purple-300 text-xl md:text-2xl px-6 py-2 rounded-full font-bold tabular-nums shadow-[0_0_20px_rgba(168,85,247,0.3)]">
                  ⏳ {timeLeft}s remaining
                </div>
              )}
              {activePoll.status === 'closed' && (
                <div className="text-center">
                  <span className="bg-red-500/20 text-red-400 text-sm px-4 py-2 rounded-full uppercase tracking-wider font-bold">Poll Closed - Final Results</span>
                </div>
              )}
            </div>
            
            {activePoll.mediaUrl && activePoll.mediaType === 'image' && (
              <div className="rounded-3xl overflow-hidden bg-black/20 w-full flex justify-center items-center mb-4 border border-white/10 relative aspect-video max-h-[25vh] shrink-0 mx-auto max-w-[45vh]">
                <img src={activePoll.mediaUrl} alt="Poll media" className="absolute inset-0 w-full h-full object-contain p-2" />
              </div>
            )}
            
            <div className="flex-1 min-h-0 w-full relative">
              {activePoll.type === 'WORD_CLOUD' ? (
                <div className="w-full h-full bg-white/5 rounded-3xl border border-white/10 p-4 md:p-8 flex items-center justify-center flex-col relative overflow-hidden">
                  {activePoll.status === 'live' ? (
                    <div className="flex flex-col items-center justify-center text-center animate-fade-in-up w-full h-full">
                      <h3 className="text-2xl md:text-3xl font-bold text-white/80 mb-6 md:mb-12">Words are hidden until the timer ends!</h3>
                      <div className="flex flex-wrap justify-center content-start gap-4 overflow-y-auto w-full flex-1 custom-scrollbar p-4">
                      {Array.from({ length: activePoll.options.reduce((sum, o) => sum + o.voteCount, 0) }).map((_, i) => (
                        <div 
                          key={i} 
                          className="text-6xl animate-bounce"
                          style={{ animationDelay: `${Math.random() * 0.5}s` }}
                        >
                          ☁️
                        </div>
                      ))}
                      {activePoll.options.length === 0 && (
                        <p className="text-white/40 text-2xl w-full">Waiting for words...</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-[50vh] min-h-[400px] flex items-center justify-center">
                    <CustomWordCloud options={activePoll.options} />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 h-full pb-2">
                {activePoll.options.map(option => {
                  const totalVotes = activePoll.options.reduce((sum, o) => sum + o.voteCount, 0);
                  const percent = totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 100) : 0;
                  
                  return (
                    <div key={option.id} className="relative w-full h-full min-h-[3rem] max-h-[5rem] rounded-2xl md:rounded-3xl overflow-hidden bg-white/5 flex items-center px-4 md:px-6 border border-white/10 shadow-lg">
                      <div 
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-600/40 to-pink-600/40 transition-all duration-1000 ease-out"
                        style={{ width: `${percent}%` }}
                      />
                      <div className="relative z-10 w-full flex justify-between items-center text-white text-sm md:text-lg font-bold gap-2">
                        <span className="truncate flex-1">{option.text}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-white/60 text-xs md:text-sm font-medium">{option.voteCount} votes</span>
                          <span className="w-12 md:w-16 text-right text-sm md:text-lg font-extrabold">{percent}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            </div>
            
            <div className="text-center text-white/30 text-sm md:text-lg mt-4 shrink-0 pb-2">
              {activePoll.options.reduce((sum, o) => sum + o.voteCount, 0)} total {activePoll.type === 'WORD_CLOUD' ? 'words submitted' : 'votes'}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
