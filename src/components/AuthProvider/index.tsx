import React from "react";
import { auth } from "../../lib/actions";
import { AuthContextProvider } from "./authContext";
import { User } from "@/interfaces";

export type AuthProviderProps = {
    children: React.ReactNode;
}

export default function AuthProvider(props: AuthProviderProps) {
    let user: User | null = null;
    auth().then(
        subject => user = subject ? subject.properties : null
    );
    //const subject = auth(); // Call the server-side auth function
    //user = subject ? subject.properties : null;


    return (
        <AuthContextProvider user={user}>
            {props.children}
        </AuthContextProvider>
    );
}