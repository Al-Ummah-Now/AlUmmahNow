import { AuthSubject, Profile, User } from "@/interfaces";

export interface AccountNavigationProps {
    isVisible: boolean;
    onClose: () => void;
    user: AuthSubject | false;
    profile?: Profile | null;
}

export interface NavItem {
    label: string; 
    icon: string;
    href: string;
    onClick?: () => void;
}