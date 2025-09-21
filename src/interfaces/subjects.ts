import * as v from 'valibot';
import { createSubjects } from "@openauthjs/openauth/subject"

export const subjects = createSubjects({
  user: v.object({
    type: v.literal("user"),
    properties: v.object({
      id: v.string(),
      email: v.pipe(v.string(), v.email()),
    }),
  }),
});