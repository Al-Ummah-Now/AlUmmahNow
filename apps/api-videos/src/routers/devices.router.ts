/**
 * Push device registration (Epic 9.4). Base: /api/devices (served under /api/v1/).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { DeviceRegister, DevicesList, DeviceUnregister, WebPushKey } from '../endpoints/devices/devices';

export const devicesRouter = fromHono(new Hono());
devicesRouter.get('/', DevicesList);
devicesRouter.get('/webpush-key', WebPushKey);
devicesRouter.put('/:installId', DeviceRegister);
devicesRouter.delete('/:installId', DeviceUnregister);
