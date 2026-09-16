import { v4 as uuidv4 } from 'uuid';

export const getSessionId = (): string => {
  if (typeof window === 'undefined') return '';
  let sessionId = localStorage.getItem('voterSessionId');
  if (!sessionId) {
    sessionId = uuidv4();
    localStorage.setItem('voterSessionId', sessionId);
  }
  return sessionId;
};
