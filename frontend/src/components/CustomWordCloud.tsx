'use client';

import React from 'react';

interface WordOption {
  text: string;
  voteCount: number;
}

interface CustomWordCloudProps {
  options: WordOption[];
}

const COLORS = [
  '#A855F7', // Purple
  '#EC4899', // Pink
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#6366F1', // Indigo
  '#14B8A6', // Teal
  '#F43F5E', // Rose
  '#06B6D4', // Cyan
  '#8B5CF6', // Violet
];

export default function CustomWordCloud({ options }: CustomWordCloudProps) {
  const filtered = options.filter((o) => o.voteCount > 0);

  if (filtered.length === 0) {
    return <p className="text-white/40 text-xl md:text-2xl text-center">No words were submitted.</p>;
  }

  const maxVotes = Math.max(...filtered.map((o) => o.voteCount), 1);
  const minVotes = Math.min(...filtered.map((o) => o.voteCount));

  // Sort descending by vote count for visual hierarchy or keep organic
  const sortedWords = [...filtered].sort((a, b) => b.voteCount - a.voteCount);

  return (
    <div className="w-full h-full min-h-[350px] max-h-[550px] flex flex-wrap items-center justify-center content-center gap-4 md:gap-8 p-6 overflow-y-auto">
      {sortedWords.map((word, idx) => {
        const ratio = maxVotes === minVotes ? 0.5 : (word.voteCount - minVotes) / (maxVotes - minVotes);
        // fontSize from 22px to 64px
        const fontSize = Math.round(22 + ratio * 42);
        const color = COLORS[idx % COLORS.length];

        return (
          <div
            key={word.text + '-' + idx}
            className="group relative inline-flex items-center transition-all duration-300 hover:scale-110 cursor-default select-none animate-fade-in py-1 px-2"
            style={{
              fontSize: `${fontSize}px`,
              fontWeight: word.voteCount === maxVotes ? 800 : 600,
              color: color,
              textShadow: `0 0 24px ${color}40`,
            }}
          >
            <span>{word.text}</span>
            <span
              className="ml-2 px-2 py-0.5 font-bold rounded-full bg-white/10 text-white/90 border border-white/15 opacity-80 group-hover:opacity-100 transition-opacity"
              style={{ fontSize: '13px', verticalAlign: 'middle', lineHeight: '1' }}
            >
              {word.voteCount}
            </span>
          </div>
        );
      })}
    </div>
  );
}
