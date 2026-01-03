import * as v from 'valibot';
import { createSubjects } from "@al-ummah-now/openauth/subject"

export const subjects = createSubjects({
  user: v.object({
    id: v.string(),
    email: v.pipe(v.string(), v.email()),
    tenantId: v.optional(v.string()),
    roles: v.optional(v.array(v.string())),
    permissions: v.optional(v.array(v.string())),
  }),
});
