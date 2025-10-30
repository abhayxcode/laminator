/**
 * User Session Manager
 * Manages user session state for multi-step flows in the Telegram bot
 */

import { SessionFlow, SessionData } from '../types/telegram.types';

/**
 * User session structure
 */
interface UserSession {
  userId: string;
  chatId: number;
  currentFlow: SessionFlow | null;
  data: SessionData;
  lastActivity: Date;
  expiresAt: Date;
}

/**
 * Session manager class (singleton)
 */
class UserSessionManager {
  private sessions: Map<string, UserSession> = new Map();
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const expiredSessions: string[] = [];

      this.sessions.forEach((session, userId) => {
        if (session.expiresAt < now) {
          expiredSessions.push(userId);
        }
      });

      expiredSessions.forEach((userId) => {
        this.sessions.delete(userId);
        console.log(`[SessionManager] Expired session for user ${userId}`);
      });

      if (expiredSessions.length > 0) {
        console.log(`[SessionManager] Cleaned up ${expiredSessions.length} expired sessions`);
      }
    }, 60 * 1000); // Run every minute
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  public stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get or create session for user
   */
  public getSession(userId: string, chatId: number): UserSession {
    let session = this.sessions.get(userId);

    if (!session) {
      session = this.createSession(userId, chatId);
      this.sessions.set(userId, session);
    } else {
      // Update activity timestamp
      session.lastActivity = new Date();
      session.expiresAt = new Date(Date.now() + this.SESSION_TIMEOUT_MS);
    }

    return session;
  }

  /**
   * Create new session
   */
  private createSession(userId: string, chatId: number): UserSession {
    return {
      userId,
      chatId,
      currentFlow: null,
      data: {},
      lastActivity: new Date(),
      expiresAt: new Date(Date.now() + this.SESSION_TIMEOUT_MS),
    };
  }

  /**
   * Start a new flow
   */
  public startFlow(userId: string, chatId: number, flow: SessionFlow): void {
    const session = this.getSession(userId, chatId);
    session.currentFlow = flow;
    session.data = {}; // Clear previous data
    console.log(`[SessionManager] User ${userId} started flow: ${flow}`);
  }

  /**
   * Update session data
   */
  public updateData(userId: string, data: Partial<SessionData>): void {
    const session = this.sessions.get(userId);
    if (!session) {
      console.warn(`[SessionManager] No session found for user ${userId}`);
      return;
    }

    session.data = { ...session.data, ...data };
    session.lastActivity = new Date();
    session.expiresAt = new Date(Date.now() + this.SESSION_TIMEOUT_MS);
  }

  /**
   * Get session data
   */
  public getData(userId: string): SessionData | null {
    const session = this.sessions.get(userId);
    return session ? session.data : null;
  }

  /**
   * Get current flow
   */
  public getCurrentFlow(userId: string): SessionFlow | null {
    const session = this.sessions.get(userId);
    return session ? session.currentFlow : null;
  }

  /**
   * Check if user is in a flow
   */
  public isInFlow(userId: string, flow?: SessionFlow): boolean {
    const session = this.sessions.get(userId);
    if (!session || !session.currentFlow) return false;

    if (flow) {
      return session.currentFlow === flow;
    }

    return true;
  }

  /**
   * Clear current flow (on completion or cancellation)
   */
  public clearFlow(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      const flow = session.currentFlow;
      session.currentFlow = null;
      session.data = {};
      console.log(`[SessionManager] User ${userId} cleared flow: ${flow}`);
    }
  }

  /**
   * Delete session completely
   */
  public deleteSession(userId: string): void {
    this.sessions.delete(userId);
    console.log(`[SessionManager] Deleted session for user ${userId}`);
  }

  /**
   * Get all active sessions (for debugging)
   */
  public getActiveSessions(): number {
    return this.sessions.size;
  }

  /**
   * Get session info (for debugging)
   */
  public getSessionInfo(userId: string): UserSession | null {
    return this.sessions.get(userId) || null;
  }

  /**
   * Clear all sessions (for shutdown)
   */
  public clearAll(): void {
    this.sessions.clear();
    console.log('[SessionManager] Cleared all sessions');
  }
}

// Export singleton instance
export const sessionManager = new UserSessionManager();

// Export type for external use
export type { UserSession };
