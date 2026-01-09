import { Profile } from "@/interfaces"
import { Channel } from "@al-ummah/shared-types"

export type HeaderProps = {
    toggleCollapse: () => void,
    toggleAccountCollapse?: () => void, // Optional - now handled by UnifiedNavigation
    profile?: Profile | null,
    channels?: Channel[]
}