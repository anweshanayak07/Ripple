'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { socket } from '@/lib/socket';
import { getSessionId } from '@/lib/session';
import dynamic from 'next/dynamic';

const ReactPlayer = dynamic(() => import('react-player'), { ssr: false }) as any;
import CustomWordCloud from '@/components/CustomWordCloud';

interface Option {
  id: string;
  text: string;
  voteCount: number;
  isCorrect?: boolean;
}

interface Poll {
  id: string;
  question: string;
  status: string;
  type: string;
  timer?: number | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isQuiz?: boolean;
  allowMultipleAnswers?: boolean;
  options: Option[];
}

interface Question {
  id: string;
  text: string;
  authorName: string;
  upvoteCount: number;
  status: string;
}

export default function EventLivePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const eventCode = decodeURIComponent(code).trim().toUpperCase();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

  const [isLoading, setIsLoading] = useState(true);
  const [activePoll, setActivePoll] = useState<Poll | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [currentSlide, setCurrentSlide] = useState('WELCOME');
  const [eventTitle, setEventTitle] = useState('');
  const [newWord, setNewWord] = useState('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  
  const voterName = typeof window !== 'undefined' ? localStorage.getItem('voterName') || 'Anonymous' : 'Anonymous';
  const sessionId = getSessionId();

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
    // 1. Fetch initial state via REST
    const fetchState = async () => {
      try {
        const res = await fetch(`${API_URL}/api/events/${eventCode}`);
        if (!res.ok) throw new Error('Event not found');
        const data = await res.json();
        setEventTitle(data.title);
        setCurrentSlide(data.currentSlide);
        
        if (data.currentSlide !== 'WELCOME' && data.currentSlide !== 'QNA') {
          const livePoll = data.polls.find((p: Poll) => p.id === data.currentSlide);
          if (livePoll) {
            setActivePoll(livePoll);
            const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
            if (votedPolls[livePoll.id]) setHasVoted(true);
          }
        }
        
        setQuestions(data.questions.filter((q: Question) => q.status !== 'hidden'));
      } catch (err) {
        alert('Event not found! Please check the event code and try again.');
        router.push('/');
      } finally {
        setIsLoading(false);
      }
    };

    fetchState();

    // 2. Connect to Socket
    socket.connect();
    const joinRoom = () => {
      socket.emit('join-room', { eventCode, role: 'audience', name: voterName });
    };
    if (socket.connected) {
      joinRoom();
    }
    socket.on('connect', joinRoom);

    // 3. Socket Listeners
    socket.on('poll-launched', (poll: Poll) => {
      setActivePoll(poll);
      setHasVoted(false);
      setSelectedOptionId(null);
    });

    socket.on('poll-results-updated', ({ pollId, options }: { pollId: string, options: Option[] }) => {
      setActivePoll(prev => {
        if (prev && prev.id === pollId) {
          return { ...prev, options };
        }
        return prev;
      });
    });

    socket.on('poll-closed', (poll: Poll) => {
      setActivePoll(prev => {
        if (prev && prev.id === poll.id) {
          return poll;
        }
        return prev;
      });
      setHasVoted(true); // Disable voting if it closes while they are viewing
    });

    socket.on('slide-changed', (slide) => {
      setCurrentSlide(slide);
    });

    socket.on('question-added', (question: Question) => {
      if (question.status !== 'hidden') {
        setQuestions(prev => [question, ...prev]);
      }
    });

    socket.on('question-upvoted', ({ questionId, newCount }) => {
      setQuestions(prev => prev.map(q => 
        q.id === questionId ? { ...q, upvoteCount: newCount } : q
      ).sort((a, b) => b.upvoteCount - a.upvoteCount));
    });

    socket.on('question-moderated', ({ questionId, status }) => {
      if (status === 'hidden') {
        setQuestions(prev => prev.filter(q => q.id !== questionId));
      } else {
        setQuestions(prev => prev.map(q => 
          q.id === questionId ? { ...q, status } : q
        ));
      }
    });

    socket.on('question-deleted', ({ questionId }) => {
      setQuestions(prev => prev.filter(q => q.id !== questionId));
    });

    socket.on('all-questions-cleared', () => {
      setQuestions([]);
    });

    return () => {
      socket.off('connect', joinRoom);
      socket.off('poll-launched');
      socket.off('poll-results-updated');
      socket.off('poll-closed');
      socket.off('slide-changed');
      socket.off('question-added');
      socket.off('question-upvoted');
      socket.off('question-moderated');
      socket.off('question-deleted');
      socket.off('all-questions-cleared');
      socket.disconnect();
    };
  }, [eventCode, API_URL, router, voterName]);

  const handleVote = (optionId: string) => {
    if (!activePoll || activePoll.status === 'closed' || hasVoted) return;
    
    socket.emit('cast-vote', {
      eventCode,
      pollId: activePoll.id,
      optionId,
      voterSessionId: sessionId,
      voterName
    });

    setHasVoted(true);
    setSelectedOptionId(optionId);
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    votedPolls[activePoll.id] = true;
    localStorage.setItem('votedPolls', JSON.stringify(votedPolls));
  };

  const handleSubmitWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePoll || activePoll.status === 'closed' || !newWord.trim()) return;
    if (!activePoll.allowMultipleAnswers && hasVoted) return;

    socket.emit('submit-word', {
      eventCode,
      pollId: activePoll.id,
      text: newWord,
      voterSessionId: sessionId
    });

    setNewWord('');
    if (!activePoll.allowMultipleAnswers) {
      setHasVoted(true);
      const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
      votedPolls[activePoll.id] = true;
      localStorage.setItem('votedPolls', JSON.stringify(votedPolls));
    }
  };

  const handleAskQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuestionText.trim()) return;

    socket.emit('submit-question', {
      eventCode,
      text: newQuestionText,
      authorName: voterName
    });

    setNewQuestionText('');
  };

  const handleUpvote = (questionId: string) => {
    const upvotedQ = JSON.parse(localStorage.getItem('upvotedQ') || '{}');
    if (upvotedQ[questionId]) return;

    socket.emit('upvote-question', {
      eventCode,
      questionId,
      voterSessionId: sessionId
    });

    upvotedQ[questionId] = true;
    localStorage.setItem('upvotedQ', JSON.stringify(upvotedQ));
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-white">Loading event...</div>;

  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto flex flex-col justify-center">
      {/* Welcome Screen */}
      {currentSlide === 'WELCOME' && (
        <div className="glass-panel p-12 rounded-3xl flex flex-col items-center justify-center text-center space-y-6 animate-fade-in-up">
          <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mb-4">
            <span className="text-4xl">👋</span>
          </div>
          <h2 className="text-3xl font-bold text-white">Welcome to {eventTitle}</h2>
          <p className="text-white/60 text-lg">Please look at the big screen.<br/> The presentation will begin shortly!</p>
        </div>
      )}

      {/* Live Poll Section */}
      {currentSlide !== 'WELCOME' && currentSlide !== 'QNA' && activePoll && (
        <div className="space-y-6 animate-fade-in-up">
          <div className="glass-panel p-6 rounded-3xl space-y-8">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-semibold text-white leading-snug">{activePoll.question}</h3>
              <div className="flex gap-2">
                {timeLeft !== null && activePoll.status === 'live' && (
                  <span className="bg-purple-500/20 text-purple-300 text-xs px-3 py-1.5 rounded-full font-bold tabular-nums">
                    ⏳ {timeLeft}s
                  </span>
                )}
                {activePoll.status === 'closed' && (
                  <span className="bg-white/20 text-white text-xs px-3 py-1.5 rounded-full uppercase tracking-wider font-bold">Closed</span>
                )}
              </div>
            </div>

            {activePoll.mediaUrl && (
              <div className="rounded-xl overflow-hidden bg-black/20 w-full flex justify-center mt-4 mb-4 relative aspect-video">
                {activePoll.mediaType === 'image' ? (
                  <img src={activePoll.mediaUrl} alt="Poll media" className="max-h-64 object-contain" />
                ) : (
                  <ReactPlayer 
                    url={activePoll.mediaUrl.replace(/[?&]list=[^&]+/, '')} 
                    controls 
                    playsinline
                    width="100%" 
                    height="100%"
                  />
                )}
              </div>
            )}

            {activePoll.status === 'closed' && activePoll.isQuiz && (
              <div className="bg-white/10 p-4 rounded-xl text-center mb-4 border border-white/20 animate-fade-in-up">
                {activePoll.options.find(o => o.id === selectedOptionId)?.isCorrect ? (
                  <span className="text-green-400 font-bold text-xl">✅ Correct Answer!</span>
                ) : (
                  <span className="text-red-400 font-bold text-xl">❌ Incorrect</span>
                )}
                <p className="text-white/60 text-sm mt-2">Check the big screen for the leaderboard.</p>
              </div>
            )}
            
            {activePoll.type === 'WORD_CLOUD' ? (
              <div className="space-y-4">
                {activePoll.status === 'closed' ? (
                  <div className="w-full h-[400px] bg-white/5 rounded-3xl border border-white/10 p-4 flex items-center justify-center overflow-hidden">
                    <CustomWordCloud options={activePoll.options} />
                  </div>
                ) : (
                  <>
                    {activePoll.status === 'live' && (
                      <div className="bg-purple-500/10 border border-purple-500/30 p-4 rounded-xl text-center mb-4">
                        <p className="text-purple-300 font-semibold animate-pulse">Words are hidden until the timer ends!</p>
                      </div>
                    )}
                    <form onSubmit={handleSubmitWord} className="space-y-4">
                      <input
                        type="text"
                        value={newWord}
                        onChange={(e) => setNewWord(e.target.value)}
                        disabled={(!activePoll.allowMultipleAnswers && hasVoted) || timeLeft === 0}
                        placeholder="Type your word here..."
                        className="w-full bg-white/10 border border-white/20 rounded-2xl p-6 text-white text-xl focus:ring-2 focus:ring-purple-500 placeholder-white/40 outline-none transition-all disabled:opacity-50"
                        maxLength={30}
                      />
                      <button
                        type="submit"
                        disabled={(!activePoll.allowMultipleAnswers && hasVoted) || timeLeft === 0 || !newWord.trim()}
                        className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold py-4 rounded-2xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(168,85,247,0.4)]"
                      >
                        Submit
                      </button>
                    </form>
                    {activePoll.status === 'live' && activePoll.options.reduce((sum, o) => sum + o.voteCount, 0) > 0 && (
                      <div className="flex flex-wrap justify-center content-start gap-3 mt-6">
                        {Array.from({ length: activePoll.options.reduce((sum, o) => sum + o.voteCount, 0) }).map((_, i) => (
                          <div 
                            key={i} 
                            className="text-3xl animate-bounce"
                            style={{ animationDelay: `${Math.random() * 0.5}s` }}
                          >
                            ☁️
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {activePoll.options.map((option) => {
                  const totalVotes = activePoll.options.reduce((sum, o) => sum + o.voteCount, 0);
                  const percent = totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 100) : 0;
                  
                  return (
                    <button
                      key={option.id}
                      onClick={() => handleVote(option.id)}
                      disabled={hasVoted || activePoll.status === 'closed' || timeLeft === 0}
                      className={`w-full relative overflow-hidden rounded-2xl text-left border transition-all ${
                        (hasVoted || activePoll.status === 'closed' || timeLeft === 0) 
                          ? 'cursor-default border-white/5 bg-white/5' 
                          : 'hover:bg-white/10 border-white/20 hover:border-purple-500/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                      } ${activePoll.status === 'closed' && activePoll.isQuiz && option.isCorrect ? 'border-green-500/50 bg-green-500/10' : ''}
                        ${activePoll.status === 'closed' && activePoll.isQuiz && !option.isCorrect && selectedOptionId === option.id ? 'border-red-500/50 bg-red-500/10' : ''}`}
                    >
                      {(hasVoted || activePoll.status === 'closed' || timeLeft === 0) && (
                        <div 
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500/30 to-pink-500/30 transition-all duration-1000 ease-out"
                          style={{ width: `${percent}%` }}
                        ></div>
                      )}
                      <div className="relative p-6 flex justify-between items-center text-white">
                        <span className="text-lg">{option.text}</span>
                        {hasVoted && <span className="text-lg font-bold">{percent}%</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {activePoll.status === 'closed' ? (
              <p className="text-sm text-center text-white/50 pt-4 font-medium">
                {activePoll.type === 'WORD_CLOUD' ? 'Poll Closed. Final Results' : 'Final Results. Please look at the big screen.'}
              </p>
            ) : hasVoted ? (
              <div className="text-center pt-4 space-y-1">
                <p className="text-sm text-white/50">Submitted! Waiting for next slide...</p>
                {activePoll.type === 'WORD_CLOUD' && (
                  <p className="text-sm text-purple-300 font-semibold mt-2">
                    Total words submitted so far: {activePoll.options.reduce((sum, o) => sum + o.voteCount, 0)}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Q&A Section */}
      {currentSlide === 'QNA' && (
        <div className="space-y-6 flex flex-col h-[80vh] animate-fade-in-up">
          <h2 className="text-3xl font-bold text-white text-center">Ask a Question</h2>
          
          <form onSubmit={handleAskQuestion} className="glass-panel p-4 rounded-2xl flex gap-3 shadow-xl">
            <input
              type="text"
              value={newQuestionText}
              onChange={(e) => setNewQuestionText(e.target.value)}
              placeholder="Type your question..."
              className="flex-1 bg-transparent border-none text-white focus:ring-0 placeholder-white/40 text-lg"
            />
            <button type="submit" className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-xl font-bold hover:opacity-90 transition-opacity">
              Ask
            </button>
          </form>

          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {questions.map((q) => (
              <div key={q.id} className="glass-panel p-5 rounded-2xl flex gap-4 items-start group">
                <button 
                  onClick={() => handleUpvote(q.id)}
                  className="flex flex-col items-center p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors min-w-[60px]"
                >
                  <svg className="w-6 h-6 text-white/50 group-hover:text-purple-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7"></path>
                  </svg>
                  <span className="text-white font-bold">{q.upvoteCount}</span>
                </button>
                <div className="space-y-2 pt-1 flex-1">
                  <p className="text-white text-lg">{q.text}</p>
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <span className="font-medium text-white/60">{q.authorName}</span>
                    {q.status === 'answered' && (
                      <span className="bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full font-bold">Answered</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {questions.length === 0 && (
              <div className="text-center p-12 text-white/40 text-lg">
                Be the first to ask a question!
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
