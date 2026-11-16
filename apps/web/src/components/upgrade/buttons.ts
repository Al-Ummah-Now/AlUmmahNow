// The upgrade, Settings › Tier and billing pages' buttons: the shared flat buttons (components/ui/button), so the
// site's surfaces (theme/system.css [data-slot=button], frosted-glass/flat Material) style them; 44px tall to touch.
import { buttonVariants } from '@/components/ui/button';

export const FILLED = buttonVariants({ size: 'lg', className: 'upg-btn min-h-11' });
export const QUIET = buttonVariants({ variant: 'outline', size: 'lg', className: 'upg-btn min-h-11' });
