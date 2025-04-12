import React, { createContext, useContext } from "react";

interface AuthContextType {
  user: { id: string } | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthContextProvider: React.FC<{
  user: { id: string } | null;
  children: React.ReactNode;
}> = ({ user, children }) => {
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