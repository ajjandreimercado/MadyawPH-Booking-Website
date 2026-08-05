import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getCurrentUser, isAxiosError, loginUser, loginWithGoogleCredential, registerUser, logoutUser } from '../services/api';

export type UserRole = 'guest' | 'partner' | 'admin' | 'staff' | 'super_admin';

export interface PartnerProfile {
  portalId: string;
  propertyName: string;
  accessLevel: 'Owner' | 'Manager' | 'Admin';
}

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  partner?: PartnerProfile;
  // Profile picture URL — set when the user signs in with Google
  avatar?: string;
  authProvider?: string;
  emailVerified?: boolean;
}

type LoginInput = {
  email: string;
  password: string;
};

type RegisterInput = {
  email: string;
  password: string;
  name: string;
};

interface AuthContextType {
  user: User | null;
  login: (input: LoginInput) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
  getToken: () => string | null;
  verifyToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isPartnerProfile(value: unknown): value is PartnerProfile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const partner = value as Partial<PartnerProfile>;
  return Boolean(partner.portalId && partner.propertyName && partner.accessLevel);
}

function normalizeUser(apiUser: {
  id?: string;
  _id?: string;
  email: string;
  name: string;
  role?: string;
  partner?: unknown;
  avatar?: string;
  authProvider?: string;
  emailVerified?: boolean;
}): User {
  const allowedRoles: UserRole[] = ['guest', 'partner', 'admin', 'staff', 'super_admin'];
  const role = allowedRoles.includes(apiUser.role as UserRole)
    ? (apiUser.role as UserRole)
    : 'guest';

  return {
    id: String(apiUser._id ?? apiUser.id ?? apiUser.email),
    email: apiUser.email,
    name: apiUser.name,
    role,
    partner: isPartnerProfile(apiUser.partner) ? apiUser.partner : undefined,
    avatar: apiUser.avatar ?? undefined,
    authProvider: apiUser.authProvider ?? 'local',
    emailVerified: Boolean(apiUser.emailVerified),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const getToken = () => null; // tokens are stored in httpOnly cookies, not accessible from JS

  const logout = async () => {
    try {
      await logoutUser();
    } catch {
      // ignore network errors during logout
    }
    setUser(null);
  };

  const verifyToken = async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(normalizeUser(currentUser));
      return true;
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        setUser(null);
        return false;
      }

      if (isAxiosError(error) && error.response?.status === 429) {
        return true;
      }

      setUser(null);
      return false;
    }
  };

  const login = async (input: LoginInput) => {
    const session = await loginUser(input);
    setUser(normalizeUser(session.user));
  };

  const loginWithGoogle = async (credential: string) => {
    const session = await loginWithGoogleCredential(credential);
    setUser(normalizeUser(session.user));
  };

  const register = async (input: RegisterInput) => {
    const session = await registerUser(input);
    setUser(normalizeUser(session.user));
  };

  useEffect(() => {
    void verifyToken();
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, loginWithGoogle, register, logout, getToken, verifyToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
