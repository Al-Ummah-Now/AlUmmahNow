import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import type { AppBindings } from '../base';
import { EventsCalendarIcs, EventsCalendarList } from '../endpoints/events/eventsCalendar';

const eventsRouter = fromHono(new Hono<{ Bindings: AppBindings }>());

eventsRouter.get('/api/events', EventsCalendarList);
eventsRouter.get('/api/events.ics', EventsCalendarIcs);

export default eventsRouter;
