import React from "react";
import { auth } from "./../../app/actions";
import { AuthContextProvider } from "./authContext";
import { User } from "@/interfaces";

export default function AuthProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    let user: User | null = null;
    // auth().then(
    //     subject => user = subject ? subject.properties : null
    // );
    // const subject = await auth(); // Call the server-side auth function
    // const user = subject ? subject.properties : null;


    return (
        <AuthContextProvider user={user}>
            {children}
        </AuthContextProvider>
    );
}