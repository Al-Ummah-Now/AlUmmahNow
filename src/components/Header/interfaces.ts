import { Profile } from "@/interfaces"

export type HeaderProps = { 
    toggleCollapse: () => void, 
    toggleAccountCollapse: () => void,
    profile: Profile | null
}