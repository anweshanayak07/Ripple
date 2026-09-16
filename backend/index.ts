import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // For dev, allow all. Update for production.
    methods: ['GET', 'POST']
  }
});

const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

// Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

// --- Auth Endpoints ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name }
    });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// --- REST Endpoints ---

// Get all events for the logged-in user
app.get('/api/user/events', authenticateToken, async (req: any, res: any) => {
  try {
    const events = await prisma.event.findMany({
      where: { hostId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch user events' });
  }
});

// Create a new event
app.post('/api/events', authenticateToken, async (req: any, res: any) => {
  try {
    const { title } = req.body;
    const hostId = req.user.id;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const event = await prisma.event.create({
      data: {
        code,
        title,
        hostId
      }
    });
    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Get event by code (sync state on reconnect)
app.get('/api/events/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const event = await prisma.event.findUnique({
      where: { code },
      include: {
        polls: {
          include: { options: true }
        },
        questions: {
          orderBy: { upvoteCount: 'desc' }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Delete an event
app.delete('/api/events/:code', authenticateToken, async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const event = await prisma.event.findUnique({ where: { code } });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.hostId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    
    await prisma.event.delete({ where: { code } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Create a new poll (draft)
app.post('/api/events/:code/polls', async (req, res) => {
  try {
    const { code } = req.params;
    const { question, options, type, timer, mediaUrl, mediaType, isQuiz, correctOptionIndex, allowMultipleAnswers } = req.body;

    const event = await prisma.event.findUnique({ where: { code } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const pollData: any = {
      eventId: event.id,
      question,
      type: type || 'MULTIPLE_CHOICE',
      timer: timer ? parseInt(timer, 10) : null,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || null,
      isQuiz: !!isQuiz,
      allowMultipleAnswers: !!allowMultipleAnswers
    };

    if (pollData.type === 'MULTIPLE_CHOICE' && options && options.length > 0) {
      pollData.options = {
        create: options.map((text: string, index: number) => ({ 
          text,
          isCorrect: isQuiz ? index === correctOptionIndex : false
        }))
      };
    }

    const poll = await prisma.poll.create({
      data: pollData,
      include: { options: true }
    });

    res.json(poll);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Delete a poll
app.delete('/api/events/:code/polls/:pollId', authenticateToken, async (req: any, res: any) => {
  try {
    const { code, pollId } = req.params;
    const event = await prisma.event.findUnique({ where: { code } });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.hostId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    await prisma.poll.delete({ where: { id: pollId } });
    io.to(code).emit('poll-deleted', pollId);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete poll' });
  }
});

// Generate AI Polls & Quizzes from a Topic
app.post('/api/events/:code/generate-ai-polls', authenticateToken, async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const { topic, count = 3, isQuiz = true, difficulty = 'medium' } = req.body;

    const event = await prisma.event.findUnique({ where: { code } });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.hostId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    if (!topic || topic.trim() === '') {
      return res.status(400).json({ error: 'Topic is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in environment variables.' });
    }

    const difficultyText = difficulty === 'low'
      ? 'low/easy (beginner-friendly, straightforward questions)'
      : difficulty === 'high'
      ? 'high/hard (advanced, challenging, expert-level questions with subtle nuances)'
      : 'medium (moderately challenging questions testing core concepts)';

    const prompt = `You are an expert event quiz generator. Generate ${count} engaging multiple-choice ${isQuiz ? 'quiz questions with 1 correct answer each' : 'opinion poll questions'} on the topic: "${topic}".
Difficulty level: ${difficultyText}.
Format the response strictly as a raw JSON array of objects. Do not wrap in markdown codeblocks.
Each object must have the following structure:
{
  "question": "The question string",
  "timer": 30,
  "options": [
    { "text": "Option 1", "isCorrect": true },
    { "text": "Option 2", "isCorrect": false },
    { "text": "Option 3", "isCorrect": false },
    { "text": "Option 4", "isCorrect": false }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt
    });

    let rawText = response.text || '';
    rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

    const generatedPolls = JSON.parse(rawText);

    if (!Array.isArray(generatedPolls)) {
      throw new Error('AI output was not a valid array of polls');
    }

    const createdPolls = [];

    for (const pollData of generatedPolls) {
      const poll = await prisma.poll.create({
        data: {
          eventId: event.id,
          question: pollData.question,
          type: 'MULTIPLE_CHOICE',
          isQuiz: Boolean(isQuiz),
          timer: pollData.timer || 30,
          status: 'draft',
          options: {
            create: (pollData.options || []).map((opt: any) => ({
              text: opt.text,
              isCorrect: Boolean(opt.isCorrect)
            }))
          }
        },
        include: {
          options: true
        }
      });
      createdPolls.push(poll);
    }

    io.to(code).emit('deck-updated', createdPolls);

    res.json({ success: true, count: createdPolls.length, polls: createdPolls });
  } catch (error: any) {
    console.error('Error generating AI polls:', error);
    res.status(500).json({ error: error.message || 'Failed to generate AI polls' });
  }
});

async function getLeaderboardData(code: string) {
  const event = await prisma.event.findUnique({ where: { code } });
  if (!event) return [];

  const votes = await prisma.vote.findMany({
    where: { poll: { eventId: event.id, isQuiz: true } },
    select: { voterSessionId: true, voterName: true, scoreEarned: true }
  });

  const scoresMap = new Map();
  for (const v of votes) {
    if (!scoresMap.has(v.voterSessionId)) {
      scoresMap.set(v.voterSessionId, { name: v.voterName, score: 0 });
    }
    scoresMap.get(v.voterSessionId).score += v.scoreEarned;
  }

  return Array.from(scoresMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// Get Leaderboard
app.get('/api/events/:code/leaderboard', async (req: any, res: any) => {
  try {
    const { code } = req.params;
    const leaderboard = await getLeaderboardData(code);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// --- Socket.io Handlers ---

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join-room', ({ eventCode, role, name }) => {
    socket.join(eventCode);
    console.log(`Socket ${socket.id} joined room ${eventCode} as ${role} (name: ${name})`);
    
    // Optional nice-to-have: broadcast user count
    const roomSize = io.sockets.adapter.rooms.get(eventCode)?.size || 0;
    io.to(eventCode).emit('user-count-updated', roomSize);
  });

  socket.on('launch-poll', async ({ eventCode, pollId }) => {
    try {
      // Update poll status to live, and Event currentSlide to pollId
      await prisma.$transaction([
        prisma.poll.update({
          where: { id: pollId },
          data: { status: 'live', launchedAt: new Date() }
        }),
        prisma.event.update({
          where: { code: eventCode },
          data: { currentSlide: pollId }
        })
      ]);
      
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: { options: true }
      });
      io.to(eventCode).emit('poll-launched', poll);
      io.to(eventCode).emit('slide-changed', pollId);

      // Handle timer automatically closing the poll
      if (poll?.timer) {
        setTimeout(async () => {
          // Check if it's still live and this is the active slide
          const currentPoll = await prisma.poll.findUnique({ where: { id: pollId } });
          if (currentPoll?.status === 'live') {
            await prisma.poll.update({ where: { id: pollId }, data: { status: 'closed' } });
            
            const closedPoll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: true } });
            io.to(eventCode).emit('poll-closed', closedPoll);
          }
        }, poll.timer * 1000);
      }
    } catch (error) {
      console.error('Error launching poll:', error);
    }
  });

  socket.on('relaunch-poll', async ({ eventCode, pollId }) => {
    try {
      // Clear existing votes
      await prisma.vote.deleteMany({
        where: { pollId }
      });
      // Reset option counts to 0
      await prisma.option.updateMany({
        where: { pollId },
        data: { voteCount: 0 }
      });
      
      // Update poll status to live, and Event currentSlide to pollId
      await prisma.$transaction([
        prisma.poll.update({
          where: { id: pollId },
          data: { status: 'live', launchedAt: new Date() }
        }),
        prisma.event.update({
          where: { code: eventCode },
          data: { currentSlide: pollId }
        })
      ]);
      
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: { options: true }
      });
      io.to(eventCode).emit('poll-launched', poll);
      io.to(eventCode).emit('slide-changed', pollId);

      // Handle timer automatically closing the poll
      if (poll?.timer) {
        setTimeout(async () => {
          const currentPoll = await prisma.poll.findUnique({ where: { id: pollId } });
          if (currentPoll?.status === 'live') {
            await prisma.poll.update({ where: { id: pollId }, data: { status: 'closed' } });
            
            const closedPoll = await prisma.poll.findUnique({ where: { id: pollId }, include: { options: true } });
            io.to(eventCode).emit('poll-closed', closedPoll);
          }
        }, poll.timer * 1000);
      }
    } catch (error) {
      console.error('Error relaunching poll:', error);
    }
  });

  socket.on('close-poll', async ({ eventCode, pollId }) => {
    try {
      await prisma.poll.update({
        where: { id: pollId },
        data: { status: 'closed' }
      });
      
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: { options: true }
      });
      io.to(eventCode).emit('poll-closed', poll);
    } catch (error) {
      console.error('Error closing poll:', error);
    }
  });

  socket.on('change-slide', async ({ eventCode, slide }) => {
    try {
      await prisma.event.update({
        where: { code: eventCode },
        data: { currentSlide: slide }
      });
      io.to(eventCode).emit('slide-changed', slide);

      if (slide === 'LEADERBOARD') {
        const lb = await getLeaderboardData(eventCode);
        io.to(eventCode).emit('leaderboard-updated', lb);
      }
    } catch (error) {
      console.error('Error changing slide:', error);
    }
  });

  socket.on('cast-vote', async ({ eventCode, pollId, optionId, voterSessionId, voterName }) => {
    try {
      const existingVote = await prisma.vote.findFirst({
        where: { pollId, voterSessionId }
      });
      if (existingVote) return;

      const poll = await prisma.poll.findUnique({ where: { id: pollId } });
      const option = await prisma.option.findUnique({ where: { id: optionId } });

      let scoreEarned = 0;
      if (poll?.isQuiz && option?.isCorrect && poll.launchedAt && poll.timer) {
        const timeTaken = Date.now() - poll.launchedAt.getTime();
        const maxTime = poll.timer * 1000;
        if (timeTaken <= maxTime) {
          scoreEarned = Math.round((1 - timeTaken / maxTime) * 1000);
        } else if (timeTaken > maxTime) {
          scoreEarned = 0;
        }
      }

      // Record vote in transaction to increment counter atomically
      await prisma.$transaction([
        prisma.vote.create({
          data: { pollId, optionId, voterSessionId, voterName: voterName || 'Anonymous', scoreEarned }
        }),
        prisma.option.update({
          where: { id: optionId },
          data: { voteCount: { increment: 1 } }
        })
      ]);

      // Fetch updated poll options
      const options = await prisma.option.findMany({
        where: { pollId }
      });

      io.to(eventCode).emit('poll-results-updated', { pollId, options });

      if (poll?.isQuiz) {
        const lb = await getLeaderboardData(eventCode);
        io.to(eventCode).emit('leaderboard-updated', lb);
      }
    } catch (error) {
      console.error('Error casting vote:', error);
    }
  });

  socket.on('submit-word', async ({ eventCode, pollId, text, voterSessionId }) => {
    try {
      const poll = await prisma.poll.findUnique({ where: { id: pollId } });
      if (!poll) return;

      if (!poll.allowMultipleAnswers) {
        const existingVote = await prisma.vote.findFirst({
          where: { pollId, voterSessionId }
        });
        if (existingVote) return;
      } else {
        // If multiple answers allowed, still prevent submitting the exact same word twice by the same user
        const wordText = text.trim().toLowerCase();
        const option = await prisma.option.findFirst({ where: { pollId, text: wordText } });
        if (option) {
          const existingVoteForWord = await prisma.vote.findFirst({
            where: { pollId, voterSessionId, optionId: option.id }
          });
          if (existingVoteForWord) return;
        }
      }

      const wordText = text.trim().toLowerCase();
      if (!wordText) return;

      let option = await prisma.option.findFirst({
        where: { pollId, text: wordText }
      });

      if (option) {
        await prisma.$transaction([
          prisma.vote.create({ data: { pollId, optionId: option.id, voterSessionId } }),
          prisma.option.update({ where: { id: option.id }, data: { voteCount: { increment: 1 } } })
        ]);
      } else {
        option = await prisma.option.create({
          data: { pollId, text: wordText, voteCount: 1 }
        });
        await prisma.vote.create({ data: { pollId, optionId: option.id, voterSessionId } });
      }

      const options = await prisma.option.findMany({ where: { pollId } });
      io.to(eventCode).emit('poll-results-updated', { pollId, options });
    } catch (error) {
      console.error('Error submitting word:', error);
    }
  });

  socket.on('submit-question', async ({ eventCode, text, authorName }) => {
    try {
      const event = await prisma.event.findUnique({ where: { code: eventCode } });
      if (!event) return;

      const question = await prisma.question.create({
        data: {
          eventId: event.id,
          text,
          authorName
        }
      });

      io.to(eventCode).emit('question-added', question);
    } catch (error) {
      console.error('Error submitting question:', error);
    }
  });

  socket.on('upvote-question', async ({ eventCode, questionId, voterSessionId }) => {
    try {
      // Check existing upvote
      const existingUpvote = await prisma.upvote.findUnique({
        where: {
          questionId_voterSessionId: {
            questionId,
            voterSessionId
          }
        }
      });

      if (existingUpvote) return;

      await prisma.$transaction([
        prisma.upvote.create({
          data: { questionId, voterSessionId }
        }),
        prisma.question.update({
          where: { id: questionId },
          data: { upvoteCount: { increment: 1 } }
        })
      ]);

      const updatedQuestion = await prisma.question.findUnique({
        where: { id: questionId }
      });

      io.to(eventCode).emit('question-upvoted', { 
        questionId, 
        newCount: updatedQuestion?.upvoteCount 
      });
    } catch (error) {
      console.error('Error upvoting question:', error);
    }
  });

  socket.on('moderate-question', async ({ eventCode, questionId, action }) => {
    try {
      if (action === 'delete') {
        await prisma.question.delete({ where: { id: questionId } });
        io.to(eventCode).emit('question-deleted', { questionId });
        return;
      }
      if (action !== 'hide' && action !== 'answered') return;

      const updatedQuestion = await prisma.question.update({
        where: { id: questionId },
        data: { status: action }
      });

      io.to(eventCode).emit('question-moderated', {
        questionId,
        status: updatedQuestion.status
      });
    } catch (error) {
      console.error('Error moderating question:', error);
    }
  });

  socket.on('delete-question', async ({ eventCode, questionId }) => {
    try {
      await prisma.question.delete({ where: { id: questionId } });
      io.to(eventCode).emit('question-deleted', { questionId });
    } catch (error) {
      console.error('Error deleting question:', error);
    }
  });

  socket.on('clear-all-questions', async ({ eventCode }) => {
    try {
      const event = await prisma.event.findUnique({ where: { code: eventCode } });
      if (!event) return;

      await prisma.question.deleteMany({ where: { eventId: event.id } });
      io.to(eventCode).emit('all-questions-cleared');
    } catch (error) {
      console.error('Error clearing questions:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
