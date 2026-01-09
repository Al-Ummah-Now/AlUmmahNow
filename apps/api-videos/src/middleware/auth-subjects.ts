import { z } from 'zod';
import { createSubjects } from '@al-ummah-now/openauth/subject';

export const subjects = createSubjects({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    tenantId: z.string().optional(),
    roles: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
  }),
});