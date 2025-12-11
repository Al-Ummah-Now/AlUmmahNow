import React from "react";
import { login } from "@/lib/actions";

interface LoginWrapperProps {
    locale?: string;
}

const LoginWrapper: React.FC<LoginWrapperProps> = ({ locale = 'ar' }) => {
    const loginWithLocale = login.bind(null, locale);

    return (
        <form action={loginWithLocale}>
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