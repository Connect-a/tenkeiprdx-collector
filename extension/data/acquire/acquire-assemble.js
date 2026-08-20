import { acquireCore } from './acquire.js';
import { acquireShared } from './acquire-shared-res.js';
import { acquireHome } from './acquire-home.js';
import { acquireCdn } from './acquire-cdn.js';
import { acquireLists } from './acquire-lists.js';

export const assetAcquirer = { ...acquireCore, ...acquireShared, ...acquireHome, ...acquireCdn, ...acquireLists };
