/**
 * Push device registration (Epic 9.4). Base: /api/devices (served under /api/v1/).
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { DeviceRegister, DevicesList, DeviceUnregister } from '../endpoints/devices/devices';

export const devicesRouter = fromHono(new Hono(), { base: '/api/devices' });
devicesRouter.get('/', DevicesList);
devicesRouter.put('/:installId', DeviceRegister);
devicesRouter.delete('/:installId', DeviceUnregister);
