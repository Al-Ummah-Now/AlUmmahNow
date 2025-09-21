import React from "react";
import { authenticated } from "../../lib/actions";
import { AuthContextProvider } from "./authContext";
import { User } from "@/interfaces";

export type AuthProviderProps = {
    children: React.ReactNode;
}

export default async function AuthProvider(props: AuthProviderProps) {
    let user: User | null = null;
    const subject = await authenticated(); // Call the server-side auth function
    user = subject ? subject.properties : null;

    return (
        <AuthContextProvider user={user}>
            {props.children}
        </AuthContextProvider>
    );
}