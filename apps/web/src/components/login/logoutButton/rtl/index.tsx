import React from "react";
import { logout } from "@/lib/actions";

interface LogoutWrapperProps {
    locale?: string;
}

const LogoutWrapper: React.FC<LogoutWrapperProps> = ({ locale = 'ar' }) => {
    const logoutWithLocale = logout.bind(null, locale);

    return (
        <form action={logoutWithLocale}>
            <button
                type="submit"
                className="bg-blue-500 text-white px-4 py-2 rounded"
            >
                <span>تأكيد</span>
            </button>
        </form>
    );
};

export default LogoutWrapper;