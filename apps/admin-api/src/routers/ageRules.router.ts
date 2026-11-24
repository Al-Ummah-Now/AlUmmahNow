import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { AgeRulesGet, AgeRulesHistory, AgeRulesPut } from '../endpoints/ageRules/AgeRules';

/** The Age rules page (endpoints/ageRules/AgeRules.ts) at /api/age-rules */
const ageRulesRouter = fromHono(new Hono(), { base: '' });

ageRulesRouter.get('/', AgeRulesGet);
ageRulesRouter.put('/', AgeRulesPut);
ageRulesRouter.get('/history', AgeRulesHistory);

export default ageRulesRouter;
