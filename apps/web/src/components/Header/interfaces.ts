import { Profile } from "@/interfaces"
import { Channel } from "@al-ummah/shared-types"

export type HeaderProps = {
    toggleCollapse: () => void,
    /** Whether the left navigation drawer is open (drives aria-expanded on the menu toggle) */
    isNavOpen?: boolean,
    toggleAccountCollapse?: () => void, // Optional - now handled by UnifiedNavigation
    profile?: Profile | null,
    channels?: Channel[]
}