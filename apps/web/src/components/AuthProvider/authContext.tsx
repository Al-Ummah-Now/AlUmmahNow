"use client";
import { User } from "@/interfaces";
import React, { createContext, useContext } from "react";

interface AuthContextType {
  user: User | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export type AuthContextProviderProps = {
  user: User | null;
  children: React.ReactNode;
}

export const AuthContextProvider: React.FC<AuthContextProviderProps> = ({ user, children }) => {
  return (
    <AuthContext.Provider value={{ user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthContextProvider");
  }
  return context;
};
/** The signed-in user, or null outside an AuthContextProvider (menus rendered on their own). */
export const useOptionalAuth = (): AuthContextType => useContext(AuthContext) ?? { user: null };
