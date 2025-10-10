import React from "react";
import { logout } from "@/lib/actions";

const LoginWrapper: React.FC = () => {
    return (
        <form action={logout}>
            <button
                type="submit"
                className="bg-blue-500 text-white px-4 py-2 rounded"
            >
                <span>تأكيد</span>
            </button>
        </form>
    );
};

export default LoginWrapper;