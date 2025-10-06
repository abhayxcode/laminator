// Simple in-memory user management for now
// In production, you'd want to use a proper database

export interface User {
  telegramId: number;
  publicKey?: string;
  walletConnected: boolean;
  createdAt: Date;
  lastActive: Date;
}

export interface UserSession {
  telegramId: number;
  isAuthenticated: boolean;
  publicKey?: string;
}

export class UserService {
  private users: Map<number, User> = new Map();
  private sessions: Map<number, UserSession> = new Map();

  createOrGetUser(telegramId: number): User {
    if (this.users.has(telegramId)) {
      const user = this.users.get(telegramId)!;
      user.lastActive = new Date();
      return user;
    }

    const newUser: User = {
      telegramId,
      walletConnected: false,
      createdAt: new Date(),
      lastActive: new Date(),
    };

    this.users.set(telegramId, newUser);
    return newUser;
  }

  connectWallet(telegramId: number, publicKey: string): boolean {
    const user = this.users.get(telegramId);
    if (!user) {
      return false;
    }

    user.publicKey = publicKey;
    user.walletConnected = true;
    user.lastActive = new Date();

    // Update session
    this.sessions.set(telegramId, {
      telegramId,
      isAuthenticated: true,
      publicKey,
    });

    return true;
  }

  disconnectWallet(telegramId: number): boolean {
    const user = this.users.get(telegramId);
    if (!user) {
      return false;
    }

    user.publicKey = undefined;
    user.walletConnected = false;
    user.lastActive = new Date();

    // Clear session
    this.sessions.delete(telegramId);

    return true;
  }

  getUser(telegramId: number): User | undefined {
    return this.users.get(telegramId);
  }

  getUserSession(telegramId: number): UserSession | undefined {
    return this.sessions.get(telegramId);
  }

  isUserAuthenticated(telegramId: number): boolean {
    const session = this.sessions.get(telegramId);
    return session?.isAuthenticated ?? false;
  }

  getConnectedUsers(): User[] {
    return Array.from(this.users.values()).filter(user => user.walletConnected);
  }

  // Clean up inactive users (run periodically)
  cleanupInactiveUsers(maxInactiveHours: number = 24): number {
    const cutoffTime = new Date(Date.now() - maxInactiveHours * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [telegramId, user] of this.users.entries()) {
      if (user.lastActive < cutoffTime) {
        this.users.delete(telegramId);
        this.sessions.delete(telegramId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}

// Singleton instance
export const userService = new UserService();
