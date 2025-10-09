import * as v from 'valibot';
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: v.object({
    id: v.string(),
    email: v.pipe(v.string(), v.email()),
  }),
});