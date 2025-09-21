import * as v from 'valibot';
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: v.object({
    id: v.string(),
    // Temporarily comment out email to see if that's causing the issue
    // email: v.pipe(v.string(), v.email()),
  }),
});