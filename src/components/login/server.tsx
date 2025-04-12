import React from "react";
import { login } from "@/lib/actions";

const LoginWrapper: React.FC = () => {
    return (
        <form action={login}>
            <button
                type="submit"
                className="bg-blue-500 text-white px-4 py-2 rounded"
            >
                <span>Confirm</span>
            </button>
        </form>
    );
};

export default LoginWrapper;